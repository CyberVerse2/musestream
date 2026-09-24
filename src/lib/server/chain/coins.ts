// Agent coins on the Pons V2 launchpad: launch, trade, index, and share fees.
//
// The lurkk treasury launches every coin. That makes it the curve's deployer, so it may
// sweep fees, and it is the creator fee recipient, so fees land in its escrow balance.
// lurkk then owes each agent 40% of the creator share and pays it out in `settleFees`.
import { randomBytes } from 'node:crypto';
import {
	BaseError,
	ContractFunctionRevertedError,
	createWalletClient,
	decodeEventLog,
	erc20Abi,
	formatEther,
	http,
	parseEventLogs,
	type Address,
	type Hash,
	type PublicClient,
	type Transport,
	type Chain
} from 'viem';
import { splitFee } from '../../../../shared/fees.ts';
import type { DB } from '../db.ts';
import type { Hub } from '../hub.ts';
import type { AgentRow } from '../service.ts';
import { LurkkError } from '../service.ts';
import {
	curveAbi,
	escrowAbi,
	factoryAbi,
	NATIVE_PAIR,
	PONS_FACTORY,
	PONS_LAUNCH_CONFIG
} from './abi.ts';
import type { Wallets, WalletRow } from './wallets.ts';

export const TOKEN_SUPPLY = 10n ** 27n; // 1B tokens, 18 decimals
/** agents are paid once their unpaid share passes this, so gas does not eat it */
const PAYOUT_MIN_WEI = 10n ** 14n; // 0.0001 ETH

export interface CoinRow {
	agent_id: string;
	status: 'launching' | 'live' | 'failed';
	token: Address | null;
	curve: Address | null;
	launch_tx: Hash | null;
	quote_reserve: string;
	token_reserve: string;
	real_quote: string;
	graduated: number;
	error: string | null;
	created_at: number;
}

export interface TradeRow {
	id: number;
	agent_id: string;
	side: 'buy' | 'sell';
	trader: Address;
	quote_wei: string;
	tokens: string;
	fee_wei: string;
	price_eth: number;
	block: number;
	tx: Hash;
	log_index: number;
	at: number;
}

export interface CoinsOptions {
	db: DB;
	hub: Hub;
	wallets: Wallets;
	client: PublicClient<Transport, Chain>;
	rpcUrl: string;
	/** a local fork: wallets may be topped up for free with anvil_setBalance */
	devFork: boolean;
	now?: () => number;
}

/** what the app shows for a coin; amounts in ETH as numbers, fine for display */
export interface CoinView {
	status: CoinRow['status'];
	token: Address | null;
	priceEth: number;
	marketCapEth: number;
	graduationPct: number;
	graduated: boolean;
	holders: number;
}

function revertReason(err: unknown): string {
	if (err instanceof BaseError) {
		const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
		if (revert instanceof ContractFunctionRevertedError) {
			return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
		}
		return err.shortMessage;
	}
	return err instanceof Error ? err.message : String(err);
}

export class Coins {
	private o: Required<CoinsOptions>;
	/** Pons's share of each curve's fee, read once per curve */
	private protocolBps = new Map<string, bigint>();
	private graduationThreshold: bigint | null = null;

	constructor(opts: CoinsOptions) {
		this.o = { now: Date.now, ...opts };
	}

	get walletsStore(): Wallets {
		return this.o.wallets;
	}

	/** true on a local fork, where wallets get free test ETH */
	get testMoney(): boolean {
		return this.o.devFork;
	}

	/** wait for a transaction and fail loudly if it reverted; viem only reports it in the receipt */
	private async confirm(hash: Hash) {
		const receipt = await this.o.client.waitForTransactionReceipt({ hash });
		if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted.`);
		return receipt;
	}

	/* ---------------- wallets ---------------- */

	private async signer(row: WalletRow) {
		const account = await this.o.wallets.account(row);
		return createWalletClient({
			account,
			chain: this.o.client.chain,
			transport: http(this.o.rpcUrl)
		});
	}

	async treasury(): Promise<WalletRow> {
		const row = await this.o.wallets.ensure('treasury', 'main');
		if (this.o.devFork) await this.topUp(row.address, 10n ** 19n);
		return row;
	}

	/** development only: give a wallet test ETH on the local fork */
	async topUp(address: Address, atLeast: bigint) {
		if (!this.o.devFork) return;
		const balance = await this.o.client.getBalance({ address });
		if (balance >= atLeast) return;
		await this.o.client.request({
			method: 'anvil_setBalance' as never,
			params: [address, `0x${atLeast.toString(16)}`] as never
		});
	}

	/* ---------------- launch ---------------- */

	coinFor(agentId: string): CoinRow | null {
		return (
			(this.o.db.prepare('SELECT * FROM coins WHERE agent_id = ?').get(agentId) as
				CoinRow | undefined) ?? null
		);
	}

	/** One transaction at a time per wallet; parallel sends from one wallet collide on nonces. */
	private queues = new Map<string, Promise<unknown>>();
	private serial<T>(address: Address, fn: () => Promise<T>): Promise<T> {
		const key = address.toLowerCase();
		const run = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
		this.queues.set(
			key,
			run.catch(() => {})
		);
		return run;
	}
	/** launches running in this process; a "launching" row not in here was cut off by a restart */
	private launching = new Set<string>();

	/** Launch the agent's coin. Safe to call again after a failure. */
	async launch(agent: AgentRow): Promise<CoinRow> {
		const treasury = await this.treasury();
		return this.serial(treasury.address, () => this.launchNow(agent));
	}

	private async launchNow(agent: AgentRow): Promise<CoinRow> {
		const existing = this.coinFor(agent.id);
		if (existing?.status === 'live') return existing;
		if (existing?.status === 'launching' && this.launching.has(agent.id)) return existing;
		this.launching.add(agent.id);
		const now = this.o.now();
		this.o.db
			.prepare(
				`INSERT INTO coins (agent_id, status, created_at) VALUES (?, 'launching', ?)
				 ON CONFLICT(agent_id) DO UPDATE SET status = 'launching', error = NULL`
			)
			.run(agent.id, now);
		try {
			const treasury = await this.treasury();
			const wallet = await this.signer(treasury);
			const [launchFee, economics] = await Promise.all([
				this.o.client.readContract({
					address: PONS_FACTORY,
					abi: factoryAbi,
					functionName: 'launchFee'
				}),
				this.o.client.readContract({
					address: PONS_FACTORY,
					abi: factoryAbi,
					functionName: 'previewLaunchEconomics',
					args: [PONS_LAUNCH_CONFIG, NATIVE_PAIR]
				})
			]);
			const params = {
				name: agent.name,
				symbol: agent.handle.toUpperCase(),
				logo: agent.avatar_url ?? '',
				description: agent.bio,
				socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
				creatorFeeRecipient: treasury.address,
				creatorTaxBps: 0,
				buybackEnabled: false,
				expectedEconomics: economics,
				salt: `0x${randomBytes(32).toString('hex')}` as `0x${string}`
			};
			const { request } = await this.o.client.simulateContract({
				account: wallet.account,
				address: PONS_FACTORY,
				abi: factoryAbi,
				functionName: 'launchToken',
				args: [params, PONS_LAUNCH_CONFIG, NATIVE_PAIR],
				value: launchFee
			});
			const hash = await wallet.writeContract(request);
			const receipt = await this.confirm(hash);
			const [launched] = parseEventLogs({
				abi: factoryAbi,
				eventName: 'TokenLaunched',
				logs: receipt.logs
			});
			if (!launched) throw new Error('The launch transaction emitted no TokenLaunched event.');
			this.o.db
				.prepare(
					`UPDATE coins SET status = 'live', token = ?, curve = ?, launch_tx = ?, error = NULL
					 WHERE agent_id = ?`
				)
				.run(launched.args.token, launched.args.curve, hash, agent.id);
			// start indexing from the launch block; nothing traded before it
			this.o.db
				.prepare(`INSERT OR IGNORE INTO chain_cursor (name, block) VALUES ('trades', ?)`)
				.run(Number(receipt.blockNumber) - 1);
			await this.refreshReserves(agent.id);
			this.launching.delete(agent.id);
			return this.coinFor(agent.id)!;
		} catch (err) {
			this.launching.delete(agent.id);
			const reason = revertReason(err);
			console.error(`coin launch for @${agent.handle} failed: ${reason}`);
			this.o.db
				.prepare(`UPDATE coins SET status = 'failed', error = ? WHERE agent_id = ?`)
				.run(reason, agent.id);
			return this.coinFor(agent.id)!;
		}
	}

	/* ---------------- reads ---------------- */

	private async thresholds() {
		if (this.graduationThreshold !== null) return;
		const cfg = await this.o.client.readContract({
			address: PONS_FACTORY,
			abi: factoryAbi,
			functionName: 'getLaunchConfig',
			args: [PONS_LAUNCH_CONFIG]
		});
		this.graduationThreshold = cfg.graduationThreshold;
	}

	private async protocolShare(curve: Address): Promise<bigint> {
		const key = curve.toLowerCase();
		let bps = this.protocolBps.get(key);
		if (bps === undefined) {
			bps = BigInt(
				await this.o.client.readContract({
					address: curve,
					abi: curveAbi,
					functionName: 'protocolFeeShareBps'
				})
			);
			this.protocolBps.set(key, bps);
		}
		return bps;
	}

	async refreshReserves(agentId: string) {
		const coin = this.coinFor(agentId);
		if (!coin?.curve) return;
		const [[quote, tokens], real, graduated] = await Promise.all([
			this.o.client.readContract({
				address: coin.curve,
				abi: curveAbi,
				functionName: 'getReserves'
			}),
			this.o.client.readContract({
				address: coin.curve,
				abi: curveAbi,
				functionName: 'realQuoteReserve'
			}),
			this.o.client.readContract({ address: coin.curve, abi: curveAbi, functionName: 'graduated' })
		]);
		this.o.db
			.prepare(
				`UPDATE coins SET quote_reserve = ?, token_reserve = ?, real_quote = ?, graduated = ?
				 WHERE agent_id = ?`
			)
			.run(quote.toString(), tokens.toString(), real.toString(), graduated ? 1 : 0, agentId);
	}

	view(agentId: string): CoinView | null {
		const coin = this.coinFor(agentId);
		if (!coin) return null;
		const quote = BigInt(coin.quote_reserve);
		const tokens = BigInt(coin.token_reserve);
		const priceEth = tokens > 0n ? Number(formatEther((quote * 10n ** 18n) / tokens)) : 0;
		const threshold = this.graduationThreshold ?? 42n * 10n ** 17n;
		const graduationPct = coin.graduated
			? 100
			: Math.min(100, Number((BigInt(coin.real_quote) * 10_000n) / threshold) / 100);
		const holders = (
			this.o.db
				.prepare(
					`SELECT COUNT(DISTINCT trader) AS n FROM trades WHERE agent_id = ? AND side = 'buy'`
				)
				.get(agentId) as { n: number }
		).n;
		return {
			status: coin.status,
			token: coin.token,
			priceEth,
			marketCapEth: priceEth * 1e9,
			graduationPct,
			graduated: !!coin.graduated,
			holders
		};
	}

	recentTrades(agentId: string, limit = 20): TradeRow[] {
		return this.o.db
			.prepare('SELECT * FROM trades WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
			.all(agentId, limit) as TradeRow[];
	}

	/** largest holders from indexed trades: net tokens bought minus sold, per wallet */
	topHolders(agentId: string, limit = 10): { trader: Address; tokens: bigint; pct: number }[] {
		const rows = this.o.db
			.prepare('SELECT trader, side, tokens FROM trades WHERE agent_id = ?')
			.all(agentId) as { trader: Address; side: 'buy' | 'sell'; tokens: string }[];
		const net = new Map<string, { trader: Address; tokens: bigint }>();
		for (const r of rows) {
			const key = r.trader.toLowerCase();
			const entry = net.get(key) ?? { trader: r.trader, tokens: 0n };
			entry.tokens += r.side === 'buy' ? BigInt(r.tokens) : -BigInt(r.tokens);
			net.set(key, entry);
		}
		return [...net.values()]
			.filter((h) => h.tokens > 0n)
			.sort((a, b) => (b.tokens > a.tokens ? 1 : b.tokens < a.tokens ? -1 : 0))
			.slice(0, limit)
			.map((h) => ({ ...h, pct: Number((h.tokens * 1_000_000n) / TOKEN_SUPPLY) / 10_000 }));
	}

	/** every trade's price and ETH volume, oldest first, for candles */
	pricePoints(agentId: string, sinceMs = 0): { at: number; price: number; volume: number }[] {
		const rows = this.o.db
			.prepare(
				'SELECT at, price_eth, quote_wei FROM trades WHERE agent_id = ? AND at >= ? ORDER BY id'
			)
			.all(agentId, sinceMs) as { at: number; price_eth: number; quote_wei: string }[];
		return rows.map((r) => ({
			at: r.at,
			price: r.price_eth,
			volume: Number(formatEther(BigInt(r.quote_wei)))
		}));
	}

	/** trades made by one address, newest first */
	tradesBy(address: Address, limit = 30): TradeRow[] {
		return this.o.db
			.prepare('SELECT * FROM trades WHERE trader = ? COLLATE NOCASE ORDER BY id DESC LIMIT ?')
			.all(address, limit) as TradeRow[];
	}

	/** price after each trade, oldest first, for charts */
	priceHistory(agentId: string, limit = 120): { at: number; price: number }[] {
		const rows = this.o.db
			.prepare('SELECT at, price_eth FROM trades WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
			.all(agentId, limit) as { at: number; price_eth: number }[];
		return rows.reverse().map((r) => ({ at: r.at, price: r.price_eth }));
	}

	/** token balances of an address for every live coin */
	async holdings(address: Address): Promise<{ agentId: string; tokens: bigint }[]> {
		const coins = this.o.db
			.prepare(`SELECT agent_id, token FROM coins WHERE status = 'live' AND token IS NOT NULL`)
			.all() as { agent_id: string; token: Address }[];
		if (!coins.length) return [];
		const balances = await Promise.all(
			coins.map((c) =>
				this.o.client.readContract({
					address: c.token,
					abi: erc20Abi,
					functionName: 'balanceOf',
					args: [address]
				})
			)
		);
		return coins
			.map((c, i) => ({ agentId: c.agent_id, tokens: balances[i]! }))
			.filter((h) => h.tokens > 0n);
	}

	/* ---------------- trading ---------------- */

	private liveCoin(agentId: string) {
		const coin = this.coinFor(agentId);
		if (!coin || coin.status !== 'live' || !coin.curve || !coin.token) {
			throw new LurkkError(409, 'no_coin', 'This agent has no coin yet.');
		}
		if (coin.graduated) {
			throw new LurkkError(409, 'graduated', 'This coin has graduated. It trades on Uniswap now.');
		}
		return coin as CoinRow & { curve: Address; token: Address };
	}

	/** buy with `weiIn` ETH; refuses if the price moves more than `slippageBps` */
	buy(wallet: WalletRow, agentId: string, weiIn: bigint, slippageBps = 300n) {
		return this.serial(wallet.address, () => this.buyNow(wallet, agentId, weiIn, slippageBps));
	}
	private async buyNow(wallet: WalletRow, agentId: string, weiIn: bigint, slippageBps: bigint) {
		const coin = this.liveCoin(agentId);
		const signer = await this.signer(wallet);
		try {
			const { result: expected } = await this.o.client.simulateContract({
				account: signer.account,
				address: coin.curve,
				abi: curveAbi,
				functionName: 'buy',
				args: [weiIn, 0n, wallet.address],
				value: weiIn
			});
			const minOut = (expected * (10_000n - slippageBps)) / 10_000n;
			const { request } = await this.o.client.simulateContract({
				account: signer.account,
				address: coin.curve,
				abi: curveAbi,
				functionName: 'buy',
				args: [weiIn, minOut, wallet.address],
				value: weiIn
			});
			const hash = await signer.writeContract(request);
			await this.confirm(hash);
			await this.sync();
			return { hash, tokens: expected };
		} catch (err) {
			if (err instanceof LurkkError) throw err;
			throw new LurkkError(
				400,
				'trade_failed',
				`The buy did not go through: ${revertReason(err)}.`
			);
		}
	}

	/** sell `tokensIn` tokens; refuses if the price moves more than `slippageBps` */
	sell(wallet: WalletRow, agentId: string, tokensIn: bigint, slippageBps = 300n) {
		return this.serial(wallet.address, () => this.sellNow(wallet, agentId, tokensIn, slippageBps));
	}
	private async sellNow(wallet: WalletRow, agentId: string, tokensIn: bigint, slippageBps: bigint) {
		const coin = this.liveCoin(agentId);
		const signer = await this.signer(wallet);
		try {
			const allowance = await this.o.client.readContract({
				address: coin.token,
				abi: erc20Abi,
				functionName: 'allowance',
				args: [wallet.address, coin.curve]
			});
			if (allowance < tokensIn) {
				const hash = await signer.writeContract({
					address: coin.token,
					abi: erc20Abi,
					functionName: 'approve',
					args: [coin.curve, tokensIn],
					chain: this.o.client.chain,
					account: signer.account
				});
				await this.confirm(hash);
			}
			const { result: expected } = await this.o.client.simulateContract({
				account: signer.account,
				address: coin.curve,
				abi: curveAbi,
				functionName: 'sell',
				args: [tokensIn, 0n, wallet.address]
			});
			const minOut = (expected * (10_000n - slippageBps)) / 10_000n;
			const { request } = await this.o.client.simulateContract({
				account: signer.account,
				address: coin.curve,
				abi: curveAbi,
				functionName: 'sell',
				args: [tokensIn, minOut, wallet.address]
			});
			const hash = await signer.writeContract(request);
			await this.confirm(hash);
			await this.sync();
			return { hash, wei: expected };
		} catch (err) {
			if (err instanceof LurkkError) throw err;
			throw new LurkkError(
				400,
				'trade_failed',
				`The sale did not go through: ${revertReason(err)}.`
			);
		}
	}

	/** move ETH, e.g. a gift from a viewer to the treasury */
	send(from: WalletRow, to: Address, wei: bigint): Promise<Hash> {
		return this.serial(from.address, () => this.sendNow(from, to, wei));
	}
	private async sendNow(from: WalletRow, to: Address, wei: bigint): Promise<Hash> {
		const signer = await this.signer(from);
		const hash = await signer.sendTransaction({
			to,
			value: wei,
			chain: this.o.client.chain,
			account: signer.account
		});
		await this.confirm(hash);
		return hash;
	}

	async balance(address: Address): Promise<bigint> {
		return this.o.client.getBalance({ address });
	}

	/* ---------------- indexing ---------------- */

	private syncing: Promise<void> | null = null;

	/** read new curve events into the trades table; one run at a time */
	sync(): Promise<void> {
		this.syncing ??= this.syncOnce().finally(() => (this.syncing = null));
		return this.syncing;
	}

	private async syncOnce() {
		const coins = this.o.db
			.prepare(`SELECT agent_id, curve FROM coins WHERE status = 'live' AND curve IS NOT NULL`)
			.all() as { agent_id: string; curve: Address }[];
		if (!coins.length) return;
		await this.thresholds();
		const byCurve = new Map(coins.map((c) => [c.curve.toLowerCase(), c.agent_id]));
		// viem caches the block number for seconds by default; the indexer needs the real head
		const head = await this.o.client.getBlockNumber({ cacheTime: 0 });
		const cursor = this.o.db
			.prepare(`SELECT block FROM chain_cursor WHERE name = 'trades'`)
			.get() as { block: number } | undefined;
		let from = BigInt(cursor?.block ?? Number(head) - 1) + 1n;
		const touched = new Set<string>();
		while (from <= head) {
			const to = from + 5_000n > head ? head : from + 5_000n;
			const logs = await this.o.client.getLogs({
				address: coins.map((c) => c.curve),
				fromBlock: from,
				toBlock: to
			});
			const blockTimes = new Map<bigint, number>();
			for (const log of logs) {
				let event;
				try {
					event = decodeEventLog({ abi: curveAbi, data: log.data, topics: log.topics });
				} catch {
					continue;
				}
				if (event.eventName !== 'CurveBuy' && event.eventName !== 'CurveSell') continue;
				const agentId = byCurve.get(log.address.toLowerCase());
				if (!agentId || log.blockNumber === null || log.transactionHash === null) continue;
				if (!blockTimes.has(log.blockNumber)) {
					const block = await this.o.client.getBlock({ blockNumber: log.blockNumber });
					blockTimes.set(log.blockNumber, Number(block.timestamp) * 1000);
				}
				const buy = event.eventName === 'CurveBuy';
				const a = event.args as {
					recipient: Address;
					quoteIn?: bigint;
					quoteOut?: bigint;
					tokensOut?: bigint;
					tokensIn?: bigint;
					fee: bigint;
				};
				const quote = buy ? a.quoteIn! : a.quoteOut!;
				const tokens = buy ? a.tokensOut! : a.tokensIn!;
				const price = tokens > 0n ? Number(formatEther((quote * 10n ** 18n) / tokens)) : 0;
				const inserted = this.o.db
					.prepare(
						`INSERT OR IGNORE INTO trades
						 (agent_id, side, trader, quote_wei, tokens, fee_wei, price_eth, block, tx, log_index, at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run(
						agentId,
						buy ? 'buy' : 'sell',
						a.recipient,
						quote.toString(),
						tokens.toString(),
						a.fee.toString(),
						price,
						Number(log.blockNumber),
						log.transactionHash,
						log.logIndex ?? 0,
						blockTimes.get(log.blockNumber)!
					);
				if (inserted.changes) {
					const split = splitFee(a.fee, await this.protocolShare(log.address));
					this.o.db
						.prepare(
							'INSERT OR IGNORE INTO fee_ledger (agent_id, trade_id, agent_wei, treasury_wei) VALUES (?, ?, ?, ?)'
						)
						.run(
							agentId,
							inserted.lastInsertRowid,
							split.agent.toString(),
							split.treasury.toString()
						);
					touched.add(agentId);
				}
			}
			this.o.db
				.prepare(
					`INSERT INTO chain_cursor (name, block) VALUES ('trades', ?)
					 ON CONFLICT(name) DO UPDATE SET block = excluded.block`
				)
				.run(Number(to));
			from = to + 1n;
		}
		for (const agentId of touched) {
			await this.refreshReserves(agentId);
			this.o.hub.emitGlobal({ type: 'coin', agentId });
		}
	}

	/** poll the chain for trades until the returned function is called */
	start(intervalMs = 2000): () => void {
		let stopped = false;
		const loop = async () => {
			while (!stopped) {
				try {
					await this.sync();
				} catch (err) {
					console.error('trade indexer:', revertReason(err));
				}
				await new Promise((r) => setTimeout(r, intervalMs));
			}
		};
		void loop();
		return () => (stopped = true);
	}

	/* ---------------- fees ---------------- */

	/**
	 * Move fees out of every curve into the escrow, claim the treasury's balance, and pay
	 * each agent what it is owed. Returns what happened, for logs.
	 */
	async settleFees() {
		const treasury = await this.treasury();
		return this.serial(treasury.address, () => this.settleFeesNow(treasury));
	}
	private async settleFeesNow(treasury: WalletRow) {
		await this.sync();
		const signer = await this.signer(treasury);
		const coins = this.o.db
			.prepare(
				`SELECT agent_id, curve FROM coins WHERE status = 'live' AND graduated = 0 AND curve IS NOT NULL`
			)
			.all() as { agent_id: string; curve: Address }[];
		let swept = 0;
		for (const c of coins) {
			const pending = await this.o.client.readContract({
				address: c.curve,
				abi: curveAbi,
				functionName: 'quoteFeeBalance'
			});
			if (pending === 0n) continue;
			const hash = await signer.writeContract({
				address: c.curve,
				abi: curveAbi,
				functionName: 'sweepFees',
				args: [0n],
				chain: this.o.client.chain,
				account: signer.account
			});
			await this.confirm(hash);
			swept++;
		}
		const escrow = await this.o.client.readContract({
			address: PONS_FACTORY,
			abi: factoryAbi,
			functionName: 'feeEscrow'
		});
		const claimable = await this.o.client.readContract({
			address: escrow,
			abi: escrowAbi,
			functionName: 'balanceOf',
			args: [treasury.address]
		});
		if (claimable > 0n) {
			const hash = await signer.writeContract({
				address: escrow,
				abi: escrowAbi,
				functionName: 'claim',
				chain: this.o.client.chain,
				account: signer.account
			});
			await this.confirm(hash);
		}
		const owed = this.o.db
			.prepare(
				`SELECT agent_id, GROUP_CONCAT(id) AS ids, GROUP_CONCAT(agent_wei) AS amounts
				 FROM fee_ledger WHERE paid_at IS NULL GROUP BY agent_id`
			)
			.all() as { agent_id: string; ids: string; amounts: string }[];
		const paid: { agentId: string; wei: bigint; tx: Hash }[] = [];
		for (const row of owed) {
			const wei = row.amounts.split(',').reduce((s, v) => s + BigInt(v), 0n);
			if (wei < PAYOUT_MIN_WEI) continue;
			const agentWallet = await this.o.wallets.ensure('agent', row.agent_id);
			const tx = await this.sendNow(treasury, agentWallet.address, wei);
			const ids = row.ids.split(',').map(Number);
			this.o.db
				.prepare(
					`UPDATE fee_ledger SET payout_tx = ?, paid_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`
				)
				.run(tx, this.o.now(), ...ids);
			paid.push({ agentId: row.agent_id, wei, tx });
		}
		return { swept, claimedWei: claimable, paid };
	}

	/** what an agent has earned, paid and unpaid, in wei */
	earnings(agentId: string) {
		const rows = this.o.db
			.prepare('SELECT agent_wei, paid_at FROM fee_ledger WHERE agent_id = ?')
			.all(agentId) as { agent_wei: string; paid_at: number | null }[];
		let paid = 0n;
		let unpaid = 0n;
		for (const r of rows) {
			if (r.paid_at) paid += BigInt(r.agent_wei);
			else unpaid += BigInt(r.agent_wei);
		}
		return { paid, unpaid };
	}
}
