// Agent coins on the Pons V2 launchpad: launch, trade, index, and share fees.
//
// Each agent's own wallet launches its coin, so the agent is the coin's creator on chain: the
// curve's fee sweep operator and its creator fee recipient. The server holds that wallet. In
// `settleFees` the agent's wallet collects its fees and sends musestream 60% of the creator
// share, and the treasury pays each agent 70% of the USDG gifts it received.
// The treasury funds the gas for each agent's launch and settlement.
import { randomBytes } from 'node:crypto';
import {
	BaseError,
	ContractFunctionRevertedError,
	createWalletClient,
	decodeEventLog,
	encodeAbiParameters,
	erc20Abi,
	formatEther,
	http,
	keccak256,
	pad,
	parseEventLogs,
	toHex,
	type Address,
	type Hash,
	type PublicClient,
	type Transport,
	type Chain
} from 'viem';
import { splitCreatorShare, splitFee } from '../../../../shared/fees.ts';
import { buyQuote, sellQuote, withSlippage } from '../../../../shared/curve.ts';
import { USDG } from '../../../../shared/usdg.ts';
import {
	ETH_PAIR,
	LAUNCH_PAIR,
	META_PAIR,
	pairAt,
	sortCurrencies,
	type Pair
} from '../../../../shared/pairs.ts';
import { approveTx, buyTx, sellTx, transferTx, type TxRequest } from '../../../../shared/tx.ts';
import {
	PERMIT2,
	POOL_MANAGER,
	PONS_MEME_HOOK,
	STATE_VIEW,
	UNIVERSAL_ROUTER,
	V4_QUOTER,
	permit2Abi,
	permit2RouterApprovalTx,
	permit2TokenApprovalTx,
	pairToUsdgTx,
	poolBuyTx,
	poolId,
	poolKey,
	poolManagerAbi,
	poolSellTx,
	ponsHookAbi,
	priceInPair,
	quoterAbi,
	stateViewAbi,
	usdgToPairTx
} from '../../../../shared/v4.ts';
import type { DB } from '../db.ts';
import type { Hub } from '../hub.ts';
import type { AgentRow } from '../service.ts';
import { MusestreamError } from '../service.ts';
import {
	curveAbi,
	escrowAbi,
	escrowTokenAbi,
	factoryAbi,
	graduationAbi,
	PONS_FACTORY,
	PONS_LAUNCH_CONFIG
} from './abi.ts';
import type { Wallets, WalletRow } from './wallets.ts';

export const TOKEN_SUPPLY = 10n ** 27n; // 1B tokens, 18 decimals
/** agents are paid once their unpaid share passes this, so gas does not eat it */
/** the same floor in a pair's units: 0.0001 ETH, or 0.001 META (about $0.77) */
const PAYOUT_MIN: Record<Pair['symbol'], bigint> = { ETH: 10n ** 14n, META: 10n ** 15n };
const PAYOUT_MIN_USDG = 100_000n; // $0.10
/** gas budgets for funding an agent's wallet; a launch measured about 3.6M gas on a fork */
const LAUNCH_GAS = 4_500_000n;
const SETTLE_GAS = 400_000n;
const POOL_GAS = 3_000_000n;
/** a trade from a server-held wallet: approvals, swaps, the trade, and the cash-out after it */
const TRADE_GAS = 1_500_000n;
/**
 * new coins charge a 1% creator tax on every trade, on top of Pons's 1% fee; it reaches the
 * agent's wallet, and musestream and the agent split it 60/40 like the creator's fee share
 */
const CREATOR_TAX_BPS = 100n;
/** gas a wallet keeps in ETH after a trade; the rest goes back to USDG */
const GAS_RESERVE = 600_000n;
/** each pair's USDG market is deep; a swap moving it more than this is refused */
const USDG_SWAP_SLIPPAGE_BPS = 100n;
/** where USDG keeps balances: `mapping(address => uint256)` at storage slot 1 */
const USDG_BALANCE_SLOT = 1n;

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
	pool_sqrt_price: string | null;
	/** the pair token's address; the zero address for native ETH */
	pair: string;
	/** how much of the pair the curve holds when it graduates, in the pair's units */
	graduation_threshold: string | null;
	/** the creator tax the coin launched with, charged on every trade on top of the fee */
	creator_tax_bps: number;
	error: string | null;
	created_at: number;
}

/** one agent's fee settlement: fees swept and claimed by its wallet, musestream's share sent on */
interface FeeSettlement {
	agentId: string;
	/** the currency of the amounts below */
	pair: Pair['symbol'];
	swept: bigint;
	claimed: bigint;
	toTreasury: bigint;
	tx: Hash | null;
}

/** the transactions for one trade, in order, and what it should deliver: tokens for a buy, USDG for a sale */
export interface TradePlan {
	expected: bigint;
	minOut: bigint;
	txs: TxRequest[];
}

export interface TradeRow {
	id: number;
	agent_id: string;
	side: 'buy' | 'sell';
	trader: Address;
	/** amounts are in the coin's pair: wei for ETH, 18-decimal units for META */
	quote_amount: string;
	tokens: string;
	fee_amount: string;
	/** price in the pair, per token */
	price: number;
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
	/** the most ETH the treasury may send to fund gas in one UTC day; unlimited when unset */
	treasuryDailyWei?: bigint;
	now?: () => number;
}

/** what the app shows for a coin; prices in its pair, as numbers, fine for display */
export interface CoinView {
	status: CoinRow['status'];
	token: Address | null;
	pair: Pair;
	/** the price of one coin in its pair */
	price: number;
	/** the whole supply at that price, in the pair */
	marketCap: number;
	/** how much of the pair in the curve graduates the coin */
	graduationThreshold: number;
	/** the creator tax on every trade, in percent */
	creatorTaxPct: number;
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
	private o: Required<Omit<CoinsOptions, 'treasuryDailyWei'>> &
		Pick<CoinsOptions, 'treasuryDailyWei'>;
	/** Pons's share of each curve's fee, read once per curve */
	private protocolBps = new Map<string, bigint>();

	constructor(opts: CoinsOptions) {
		this.o = { now: Date.now, ...opts };
	}

	get walletsStore(): Wallets {
		return this.o.wallets;
	}

	/** true on a local fork, where wallets get free test ETH and USDG */
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

	/**
	 * Make sure `address` can pay for `gas` units plus `extraWei`, sending the difference from
	 * the treasury. Budgets twice the current gas price, so a small rise does not strand it.
	 */
	private async fundGas(address: Address, gas: bigint, extraWei = 0n) {
		const need = gas * (await this.o.client.getGasPrice()) * 2n + extraWei;
		const balance = await this.o.client.getBalance({ address });
		if (balance >= need) return;
		if (this.o.devFork) return this.topUp(address, need);
		await this.sendFromTreasury(address, need - balance);
	}

	/**
	 * Give a viewer's own wallet `wei` of ETH for gas, from the treasury. On a local fork the
	 * ETH is created instead. Returns the transfer, or null on a fork.
	 */
	async sendGas(address: Address, wei: bigint): Promise<Hash | null> {
		if (this.o.devFork) {
			const balance = await this.o.client.getBalance({ address });
			await this.topUp(address, balance + wei);
			return null;
		}
		return this.sendFromTreasury(address, wei);
	}

	/** send ETH from the treasury, within its daily spending limit */
	private async sendFromTreasury(address: Address, amount: bigint): Promise<Hash> {
		const day = new Date(this.o.now()).toISOString().slice(0, 10);
		const spent = BigInt(
			(
				this.o.db.prepare('SELECT wei FROM treasury_spend WHERE day = ?').get(day) as
					{ wei: string } | undefined
			)?.wei ?? '0'
		);
		if (this.o.treasuryDailyWei !== undefined && spent + amount > this.o.treasuryDailyWei) {
			throw new MusestreamError(
				503,
				'treasury_limit',
				"The treasury reached today's spending limit. Launches, payouts, and gas top-ups resume tomorrow."
			);
		}
		const treasury = await this.treasury();
		const hash = await this.send(treasury, address, amount);
		this.o.db
			.prepare(
				`INSERT INTO treasury_spend (day, wei) VALUES (?, ?)
				 ON CONFLICT(day) DO UPDATE SET wei = excluded.wei`
			)
			.run(day, (spent + amount).toString());
		return hash;
	}

	/**
	 * Hold a named lease so only one server process does a job at a time, even when several
	 * share the database. Returns false when another process holds it.
	 */
	private readonly holder = randomBytes(8).toString('hex');
	private takeLease(name: string, ms: number): boolean {
		const now = this.o.now();
		this.o.db
			.prepare(
				`INSERT INTO leases (name, holder, until) VALUES (@name, @holder, @until)
				 ON CONFLICT(name) DO UPDATE SET holder = @holder, until = @until
				 WHERE leases.until < @now OR leases.holder = @holder`
			)
			.run({ name, holder: this.holder, until: now + ms, now });
		const row = this.o.db.prepare('SELECT holder FROM leases WHERE name = ?').get(name) as {
			holder: string;
		};
		return row.holder === this.holder;
	}
	private releaseLease(name: string) {
		this.o.db
			.prepare('UPDATE leases SET until = 0 WHERE name = ? AND holder = ?')
			.run(name, this.holder);
	}

	/** development only: give a wallet test USDG on the local fork, by writing its balance */
	async topUpUsdg(address: Address, atLeast: bigint) {
		if (!this.o.devFork) return;
		if ((await this.usdgBalance(address)) >= atLeast) return;
		const slot = keccak256(
			encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [address, USDG_BALANCE_SLOT])
		);
		await this.o.client.request({
			method: 'anvil_setStorageAt' as never,
			params: [USDG, slot, pad(toHex(atLeast))] as never
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

	/**
	 * Launch the agent's coin from the agent's wallet, paired with `pair` (META for new coins).
	 * Safe to call again after a failure.
	 */
	async launch(agent: AgentRow, pair: Pair = LAUNCH_PAIR): Promise<CoinRow> {
		const wallet = await this.o.wallets.ensure('agent', agent.id);
		return this.serial(wallet.address, () => this.launchNow(agent, wallet, pair));
	}

	private async launchNow(agent: AgentRow, agentWallet: WalletRow, pair: Pair): Promise<CoinRow> {
		const existing = this.coinFor(agent.id);
		if (existing?.status === 'live') return existing;
		if (existing?.status === 'launching' && this.launching.has(agent.id)) return existing;
		this.launching.add(agent.id);
		const now = this.o.now();
		this.o.db
			.prepare(
				`INSERT INTO coins (agent_id, status, pair, creator_tax_bps, created_at)
				 VALUES (?, 'launching', ?, ?, ?)
				 ON CONFLICT(agent_id) DO UPDATE SET status = 'launching', pair = excluded.pair,
				   creator_tax_bps = excluded.creator_tax_bps, error = NULL`
			)
			.run(agent.id, pair.address, Number(CREATOR_TAX_BPS), now);
		try {
			const wallet = await this.signer(agentWallet);
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
					args: [PONS_LAUNCH_CONFIG, pair.address]
				})
			]);
			await this.fundGas(agentWallet.address, LAUNCH_GAS, launchFee);
			const params = {
				name: agent.name,
				symbol: agent.handle.toUpperCase(),
				logo: agent.avatar_url ?? '',
				description: agent.bio,
				// the agent's Musebook profile is its home page on Pons
				socials: {
					twitter: '',
					telegram: '',
					discord: '',
					website: agent.musebook_url ?? '',
					farcaster: ''
				},
				creatorFeeRecipient: agentWallet.address,
				creatorTaxBps: Number(CREATOR_TAX_BPS),
				buybackEnabled: false,
				expectedEconomics: economics,
				salt: `0x${randomBytes(32).toString('hex')}` as `0x${string}`
			};
			const { request } = await this.o.client.simulateContract({
				account: wallet.account,
				address: PONS_FACTORY,
				abi: factoryAbi,
				functionName: 'launchToken',
				args: [params, PONS_LAUNCH_CONFIG, pair.address],
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
		// a curve can fill up without graduating (see `graduationAbi`); finish the sweep for it
		if (!coin.graduated && coin.token) {
			const ready = await this.o.client.readContract({
				address: coin.curve,
				abi: curveAbi,
				functionName: 'readyToGraduate'
			});
			if (ready) await this.graduate(agentId, coin.token);
		}
		const pair = pairAt(coin.pair);
		const [[quote, tokens], real, graduated, threshold] = await Promise.all([
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
			this.o.client.readContract({ address: coin.curve, abi: curveAbi, functionName: 'graduated' }),
			this.o.client.readContract({
				address: coin.curve,
				abi: curveAbi,
				functionName: 'graduationThreshold'
			})
		]);
		this.o.db
			.prepare(
				`UPDATE coins SET quote_reserve = ?, token_reserve = ?, real_quote = ?, graduated = ?,
				 graduation_threshold = ? WHERE agent_id = ?`
			)
			.run(
				quote.toString(),
				tokens.toString(),
				real.toString(),
				graduated ? 1 : 0,
				threshold.toString(),
				agentId
			);
		if (graduated && coin.token) {
			let sqrtPriceX96 = await this.poolPrice(coin.token, pair);
			if (sqrtPriceX96 === 0n) {
				await this.createPool(agentId, coin.token, pair);
				sqrtPriceX96 = await this.poolPrice(coin.token, pair);
			}
			this.o.db
				.prepare('UPDATE coins SET pool_sqrt_price = ? WHERE agent_id = ?')
				.run(sqrtPriceX96.toString(), agentId);
		}
	}

	private async poolPrice(token: Address, pair: Pair): Promise<bigint> {
		const [sqrtPriceX96] = await this.o.client.readContract({
			address: STATE_VIEW,
			abi: stateViewAbi,
			functionName: 'getSlot0',
			args: [poolId(token, pair)]
		});
		return sqrtPriceX96;
	}

	/** sweep a ready curve from the agent's wallet, unless someone already has */
	private async graduate(agentId: string, token: Address) {
		const agent = this.o.wallets.find('agent', agentId);
		if (!agent) return;
		await this.fundGas(agent.address, POOL_GAS);
		await this.serial(agent.address, async () => {
			const signer = await this.signer(agent);
			try {
				const { request } = await this.o.client.simulateContract({
					account: signer.account,
					address: PONS_FACTORY,
					abi: graduationAbi,
					functionName: 'graduate',
					args: [token]
				});
				await this.confirm(await signer.writeContract(request));
			} catch (err) {
				// someone else graduated it first: the next refresh sees the flag
				console.error(`graduating ${token}: ${revertReason(err)}`);
			}
		});
	}

	/** seed a graduated coin's pool from the agent's wallet, unless someone already has */
	private async createPool(agentId: string, token: Address, pair: Pair) {
		const agent = this.o.wallets.find('agent', agentId);
		if (!agent) return;
		await this.fundGas(agent.address, POOL_GAS);
		await this.serial(agent.address, async () => {
			if ((await this.poolPrice(token, pair)) !== 0n) return;
			const signer = await this.signer(agent);
			const { request } = await this.o.client.simulateContract({
				account: signer.account,
				address: PONS_FACTORY,
				abi: graduationAbi,
				functionName: 'createGraduatedPool',
				args: [token]
			});
			await this.confirm(await signer.writeContract(request));
		});
	}

	view(agentId: string): CoinView | null {
		const coin = this.coinFor(agentId);
		if (!coin) return null;
		const pair = pairAt(coin.pair);
		const quote = BigInt(coin.quote_reserve);
		const tokens = BigInt(coin.token_reserve);
		// a graduated coin's price is its pool's; the curve is empty after graduation
		const price =
			coin.graduated && coin.pool_sqrt_price && coin.token
				? priceInPair(BigInt(coin.pool_sqrt_price), coin.token, pair)
				: tokens > 0n
					? Number(formatEther((quote * 10n ** 18n) / tokens))
					: 0;
		const threshold = BigInt(coin.graduation_threshold ?? '0');
		const graduationPct = coin.graduated
			? 100
			: threshold > 0n
				? Math.min(100, Number((BigInt(coin.real_quote) * 10_000n) / threshold) / 100)
				: 0;
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
			pair,
			price,
			marketCap: price * 1e9,
			graduationThreshold: Number(formatEther(threshold)),
			creatorTaxPct: coin.creator_tax_bps / 100,
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
				'SELECT at, price, quote_amount FROM trades WHERE agent_id = ? AND at >= ? ORDER BY id'
			)
			.all(agentId, sinceMs) as { at: number; price: number; quote_amount: string }[];
		return rows.map((r) => ({
			at: r.at,
			price: r.price,
			volume: Number(formatEther(BigInt(r.quote_amount)))
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
			.prepare('SELECT at, price FROM trades WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
			.all(agentId, limit) as { at: number; price: number }[];
		return rows.reverse().map((r) => ({ at: r.at, price: r.price }));
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
			throw new MusestreamError(409, 'no_coin', 'This agent has no coin yet.');
		}
		return coin as CoinRow & { curve: Address; token: Address };
	}

	/**
	 * The transactions that buy an agent's coin with `usdg` from `from`'s own wallet, in order,
	 * and how many tokens they should deliver. USDG is the app's money; each coin trades
	 * against its pair (META, or ETH for older coins), so the wallet swaps through the pair's
	 * USDG market on the way. Approvals come first the first time. Every trade refuses a price
	 * more than 3% worse than quoted.
	 */
	async planBuy(agentId: string, from: Address, usdg: bigint): Promise<TradePlan> {
		const coin = this.liveCoin(agentId);
		const pair = pairAt(coin.pair);
		try {
			const [approvals, deadline] = await Promise.all([
				this.routerApprovals(from, USDG, usdg),
				this.deadline()
			]);
			if (coin.graduated) {
				// one router transaction: USDG to the pair to the coin
				const paid = await this.pairQuote(pair, false, usdg);
				const expected = await this.poolQuote(coin.token, pair, true, paid);
				const minOut = withSlippage(expected, 300n);
				return {
					expected,
					minOut,
					txs: [...approvals, poolBuyTx(coin.token, pair, usdg, minOut, deadline)]
				};
			}
			// swap first, then spend the least the swap may return on the curve; any remainder
			// stays in the wallet until the cash-out after the trade
			const minPaid = withSlippage(await this.pairQuote(pair, false, usdg), USDG_SWAP_SLIPPAGE_BPS);
			const [[quote, reserveTokens], feeBps] = await Promise.all([
				this.o.client.readContract({
					address: coin.curve,
					abi: curveAbi,
					functionName: 'getReserves'
				}),
				this.o.client.readContract({ address: coin.curve, abi: curveAbi, functionName: 'feeBps' })
			]);
			const expected = buyQuote(
				minPaid,
				{ quote, tokens: reserveTokens },
				feeBps,
				BigInt(coin.creator_tax_bps)
			);
			const minOut = withSlippage(expected, 300n);
			const txs: TxRequest[] = [...approvals, usdgToPairTx(pair, usdg, minPaid, deadline)];
			if (!pair.native) {
				const allowance = await this.o.client.readContract({
					address: pair.address,
					abi: erc20Abi,
					functionName: 'allowance',
					args: [from, coin.curve]
				});
				if (allowance < minPaid) txs.push(approveTx(pair.address, coin.curve, minPaid));
			}
			txs.push(buyTx(coin.curve, minPaid, minOut, from, pair.native));
			return { expected, minOut, txs };
		} catch (err) {
			throw new MusestreamError(
				400,
				'quote_failed',
				`No price for this buy: ${revertReason(err)}.`
			);
		}
	}

	/**
	 * The transactions that sell `tokens` of an agent's coin from `from`'s own wallet for USDG,
	 * and how much USDG they should return. Approvals come first when needed.
	 */
	async planSell(agentId: string, from: Address, tokens: bigint): Promise<TradePlan> {
		const coin = this.liveCoin(agentId);
		const pair = pairAt(coin.pair);
		if (tokens === 0n)
			throw new MusestreamError(409, 'nothing_to_sell', 'This wallet holds none of this coin.');
		try {
			const deadline = await this.deadline();
			if (coin.graduated) {
				// one router transaction: the coin to the pair to USDG
				const [approvals, paid] = await Promise.all([
					this.routerApprovals(from, coin.token, tokens),
					this.poolQuote(coin.token, pair, false, tokens)
				]);
				const expected = await this.pairQuote(pair, true, paid);
				const minOut = withSlippage(expected, 300n);
				return {
					expected,
					minOut,
					txs: [...approvals, poolSellTx(coin.token, pair, tokens, minOut, deadline)]
				};
			}
			const [[quote, reserveTokens], feeBps, allowance] = await Promise.all([
				this.o.client.readContract({
					address: coin.curve,
					abi: curveAbi,
					functionName: 'getReserves'
				}),
				this.o.client.readContract({ address: coin.curve, abi: curveAbi, functionName: 'feeBps' }),
				this.o.client.readContract({
					address: coin.token,
					abi: erc20Abi,
					functionName: 'allowance',
					args: [from, coin.curve]
				})
			]);
			// sell on the curve for the pair; `planCashOut` then turns what arrived into USDG
			const proceeds = sellQuote(
				tokens,
				{ quote, tokens: reserveTokens },
				feeBps,
				BigInt(coin.creator_tax_bps)
			);
			const expected = await this.pairQuote(pair, true, proceeds);
			const txs: TxRequest[] = [];
			if (allowance < tokens) txs.push(approveTx(coin.token, coin.curve, tokens));
			txs.push(sellTx(coin.curve, tokens, withSlippage(proceeds, 300n), from));
			return { expected, minOut: withSlippage(expected, 300n), txs };
		} catch (err) {
			throw new MusestreamError(
				400,
				'quote_failed',
				`No price for this sale: ${revertReason(err)}.`
			);
		}
	}

	/**
	 * Keep a viewer's balance in dollars: after a trade, swap what the trade left behind back
	 * into USDG. That is all of any META (a sale's proceeds, a buy's swap buffer), and ETH above
	 * a gas reserve. Returns no plan when there is too little to bother.
	 */
	async planCashOut(from: Address): Promise<TradePlan | null> {
		const [eth, meta, gasPrice, deadline] = await Promise.all([
			this.o.client.getBalance({ address: from }),
			this.o.client.readContract({
				address: META_PAIR.address,
				abi: erc20Abi,
				functionName: 'balanceOf',
				args: [from]
			}),
			this.o.client.getGasPrice(),
			this.deadline()
		]);
		const txs: TxRequest[] = [];
		let expected = 0n;
		let minOut = 0n;
		for (const [pair, amount] of [
			[META_PAIR, meta],
			[ETH_PAIR, eth - GAS_RESERVE * gasPrice * 2n]
		] as const) {
			if (amount <= 0n) continue;
			const usdg = await this.pairQuote(pair, true, amount);
			// under a cent is not worth the gas
			if (usdg < 10_000n) continue;
			const least = withSlippage(usdg, USDG_SWAP_SLIPPAGE_BPS);
			if (!pair.native) txs.push(...(await this.routerApprovals(from, pair.address, amount)));
			txs.push(pairToUsdgTx(pair, amount, least, deadline));
			expected += usdg;
			minOut += least;
		}
		return txs.length ? { expected, minOut, txs } : null;
	}

	/** the approvals the Universal Router needs to take `amount` of `token` from `from` */
	private async routerApprovals(
		from: Address,
		token: Address,
		amount: bigint
	): Promise<TxRequest[]> {
		const [toPermit2, [toRouter, expiration], deadline] = await Promise.all([
			this.o.client.readContract({
				address: token,
				abi: erc20Abi,
				functionName: 'allowance',
				args: [from, PERMIT2]
			}),
			this.o.client.readContract({
				address: PERMIT2,
				abi: permit2Abi,
				functionName: 'allowance',
				args: [from, token, UNIVERSAL_ROUTER]
			}),
			this.deadline()
		]);
		const txs: TxRequest[] = [];
		if (toPermit2 < amount) txs.push(permit2TokenApprovalTx(token));
		if (toRouter < amount || BigInt(expiration) < deadline) {
			txs.push(permit2RouterApprovalTx(token, Number(deadline) + 30 * 86_400));
		}
		return txs;
	}

	/** what a pair's USDG market pays out now: USDG for `amountIn` of the pair (`pairIn`), or the pair for USDG */
	async pairQuote(pair: Pair, pairIn: boolean, amountIn: bigint): Promise<bigint> {
		const key = pair.usdgPool;
		const currencyIn = pairIn ? pair.address : USDG;
		const { result } = await this.o.client.simulateContract({
			address: V4_QUOTER,
			abi: quoterAbi,
			functionName: 'quoteExactInputSingle',
			args: [
				{
					poolKey: key,
					zeroForOne: currencyIn.toLowerCase() === key.currency0.toLowerCase(),
					exactAmount: amountIn,
					hookData: '0x'
				}
			]
		});
		return result[0];
	}

	/** what a graduated coin's pool pays out now for `amountIn` of the pair (`pairIn`) or of the coin */
	private async poolQuote(
		token: Address,
		pair: Pair,
		pairIn: boolean,
		amountIn: bigint
	): Promise<bigint> {
		const key = poolKey(token, pair);
		const currencyIn = pairIn ? pair.address : token;
		const { result } = await this.o.client.simulateContract({
			address: V4_QUOTER,
			abi: quoterAbi,
			functionName: 'quoteExactInputSingle',
			args: [
				{
					poolKey: key,
					zeroForOne: currencyIn.toLowerCase() === key.currency0.toLowerCase(),
					exactAmount: amountIn,
					hookData: '0x'
				}
			]
		});
		return result[0];
	}

	/** a swap deadline 20 minutes past the chain's clock, which a fork may have moved */
	private async deadline(): Promise<bigint> {
		const block = await this.o.client.getBlock();
		return block.timestamp + 20n * 60n;
	}

	/** buy with `usdg` from a server-held wallet */
	buy(wallet: WalletRow, agentId: string, usdg: bigint) {
		return this.serial(wallet.address, async () => {
			await this.fundGas(wallet.address, TRADE_GAS);
			const plan = await this.planBuy(agentId, wallet.address, usdg);
			const hash = await this.execute(wallet, plan, 'The buy');
			await this.cashOut(wallet);
			return { hash, tokens: plan.expected };
		});
	}

	/** sell `tokensIn` tokens from a server-held wallet, for USDG */
	sell(wallet: WalletRow, agentId: string, tokensIn: bigint) {
		return this.serial(wallet.address, async () => {
			await this.fundGas(wallet.address, TRADE_GAS);
			const plan = await this.planSell(agentId, wallet.address, tokensIn);
			const hash = await this.execute(wallet, plan, 'The sale');
			await this.cashOut(wallet);
			return { hash, usdg: plan.expected };
		});
	}

	private async cashOut(wallet: WalletRow) {
		const plan = await this.planCashOut(wallet.address);
		if (plan) await this.execute(wallet, plan, 'Turning ETH into USDG');
	}

	/** send a plan's transactions in order; returns the last one, the trade itself */
	private async execute(wallet: WalletRow, plan: TradePlan, what: string): Promise<Hash> {
		const signer = await this.signer(wallet);
		let hash: Hash | null = null;
		try {
			for (const tx of plan.txs) {
				hash = await signer.sendTransaction({
					...tx,
					chain: this.o.client.chain,
					account: signer.account
				});
				await this.confirm(hash);
			}
		} catch (err) {
			throw new MusestreamError(
				400,
				'trade_failed',
				`${what} did not go through: ${revertReason(err)}.`
			);
		}
		// the trade landed; a failure to index it now is the indexer's to retry, not the trade's
		await this.sync().catch((err) => console.error('indexing after a trade:', revertReason(err)));
		return hash!;
	}

	/** how many of an agent's coins `address` holds */
	tokenBalance(agentId: string, address: Address): Promise<bigint> {
		const coin = this.liveCoin(agentId);
		return this.o.client.readContract({
			address: coin.token,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address]
		});
	}

	/**
	 * Check a USDG payment a viewer's own wallet sent: it succeeded and moved at least `amount`
	 * USDG from `from` to `to`.
	 */
	async verifyUsdgPayment(tx: Hash, from: Address, to: Address, amount: bigint) {
		const receipt = await this.o.client.waitForTransactionReceipt({ hash: tx, timeout: 30_000 });
		const paid = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
			.filter(
				(l) =>
					l.address.toLowerCase() === USDG.toLowerCase() &&
					l.args.from.toLowerCase() === from.toLowerCase() &&
					l.args.to.toLowerCase() === to.toLowerCase()
			)
			.reduce((sum, l) => sum + l.args.value, 0n);
		if (receipt.status !== 'success' || paid < amount)
			throw new MusestreamError(400, 'bad_payment', 'That transaction does not pay for this gift.');
	}

	/** move USDG, e.g. a gift from a viewer's test wallet to the treasury */
	sendUsdg(from: WalletRow, to: Address, amount: bigint): Promise<Hash> {
		return this.serial(from.address, () => this.sendUsdgNow(from, to, amount));
	}
	private sendUsdgNow(from: WalletRow, to: Address, amount: bigint): Promise<Hash> {
		return this.sendTokenNow(from, USDG, to, amount);
	}

	/** send an ERC-20 token, e.g. USDG or META, from a server-held wallet */
	private async sendTokenNow(
		from: WalletRow,
		token: Address,
		to: Address,
		amount: bigint
	): Promise<Hash> {
		const signer = await this.signer(from);
		const hash = await signer.sendTransaction({
			...transferTx(token, to, amount),
			chain: this.o.client.chain,
			account: signer.account
		});
		await this.confirm(hash);
		return hash;
	}

	usdgBalance(address: Address): Promise<bigint> {
		return this.o.client.readContract({
			address: USDG,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address]
		});
	}

	/** move ETH, e.g. an agent's fee payout */
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

	gasPrice(): Promise<bigint> {
		return this.o.client.getGasPrice();
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
					tax?: bigint;
				};
				const quote = buy ? a.quoteIn! : a.quoteOut!;
				const tokens = buy ? a.tokensOut! : a.tokensIn!;
				const price = tokens > 0n ? Number(formatEther((quote * 10n ** 18n) / tokens)) : 0;
				const inserted = this.o.db
					.prepare(
						`INSERT OR IGNORE INTO trades
						 (agent_id, side, trader, quote_amount, tokens, fee_amount, price, block, tx, log_index, at)
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
					// the creator's share of the fee, plus all of the creator tax, reaches the agent's
					// wallet; musestream and the agent split both 60/40
					const fee = splitFee(a.fee, await this.protocolShare(log.address));
					const tax = splitCreatorShare(a.tax ?? 0n);
					this.o.db
						.prepare(
							'INSERT OR IGNORE INTO fee_ledger (agent_id, trade_id, agent_amount, treasury_amount) VALUES (?, ?, ?, ?)'
						)
						.run(
							agentId,
							inserted.lastInsertRowid,
							(fee.agent + tax.agent).toString(),
							(fee.treasury + tax.treasury).toString()
						);
					touched.add(agentId);
				}
			}
			await this.indexPools(from, to, blockTimes, touched);
			this.o.db
				.prepare(
					`INSERT INTO chain_cursor (name, block) VALUES ('trades', ?)
					 ON CONFLICT(name) DO UPDATE SET block = excluded.block`
				)
				.run(Number(to));
			from = to + 1n;
		}
		// coins launched before thresholds were stored get theirs on the first pass
		const unread = this.o.db
			.prepare(
				`SELECT agent_id FROM coins WHERE status = 'live' AND curve IS NOT NULL AND graduation_threshold IS NULL`
			)
			.all() as { agent_id: string }[];
		for (const { agent_id } of unread) touched.add(agent_id);
		for (const agentId of touched) {
			await this.refreshReserves(agentId);
			this.o.hub.emitGlobal({ type: 'coin', agentId });
		}
	}

	/**
	 * Graduated coins trade on their Uniswap V4 pools: record each swap as a trade (the trader
	 * is whoever sent the transaction, since the pool sees only the router), and record the
	 * creator fees Pons sweeps from each pool, which musestream and the agent split 60/40.
	 */
	private async indexPools(
		from: bigint,
		to: bigint,
		blockTimes: Map<bigint, number>,
		touched: Set<string>
	) {
		const graduated = this.o.db
			.prepare(`SELECT agent_id, token, pair FROM coins WHERE graduated = 1 AND token IS NOT NULL`)
			.all() as { agent_id: string; token: Address; pair: string }[];
		if (!graduated.length) return;
		const byPool = new Map(
			graduated.map((c) => {
				const pair = pairAt(c.pair);
				return [poolId(c.token, pair), { agentId: c.agent_id, token: c.token, pair }];
			})
		);
		const ids = [...byPool.keys()];
		const [swaps, sweeps] = await Promise.all([
			this.o.client.getLogs({
				address: POOL_MANAGER,
				event: poolManagerAbi[0],
				args: { id: ids },
				fromBlock: from,
				toBlock: to
			}),
			this.o.client.getLogs({
				address: PONS_MEME_HOOK,
				event: ponsHookAbi[0],
				args: { poolId: ids },
				fromBlock: from,
				toBlock: to
			})
		]);
		const at = async (block: bigint) => {
			if (!blockTimes.has(block)) {
				const b = await this.o.client.getBlock({ blockNumber: block });
				blockTimes.set(block, Number(b.timestamp) * 1000);
			}
			return blockTimes.get(block)!;
		};
		for (const log of swaps) {
			const coin = byPool.get(log.args.id!);
			if (!coin || log.blockNumber === null || log.transactionHash === null) continue;
			const agentId = coin.agentId;
			// amounts are the swapper's: negative is what it paid in. A buy pays in the pair.
			const pairIsZero =
				sortCurrencies(coin.pair.address, coin.token)[0].toLowerCase() ===
				coin.pair.address.toLowerCase();
			const [pairAmount, coinAmount] = pairIsZero
				? [log.args.amount0!, log.args.amount1!]
				: [log.args.amount1!, log.args.amount0!];
			const buy = pairAmount < 0n;
			const abs = (v: bigint) => (v < 0n ? -v : v);
			const { from: trader } = await this.o.client.getTransaction({ hash: log.transactionHash });
			const inserted = this.o.db
				.prepare(
					`INSERT OR IGNORE INTO trades
					 (agent_id, side, trader, quote_amount, tokens, fee_amount, price, block, tx, log_index, at)
					 VALUES (?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?)`
				)
				.run(
					agentId,
					buy ? 'buy' : 'sell',
					trader,
					abs(pairAmount).toString(),
					abs(coinAmount).toString(),
					priceInPair(log.args.sqrtPriceX96!, coin.token, coin.pair),
					Number(log.blockNumber),
					log.transactionHash,
					log.logIndex ?? 0,
					await at(log.blockNumber)
				);
			if (inserted.changes) touched.add(agentId);
		}
		for (const log of sweeps) {
			const agentId = byPool.get(log.args.poolId!)?.agentId;
			if (!agentId || log.blockNumber === null || log.transactionHash === null) continue;
			const creator = log.args.creatorAmount!;
			const split = splitCreatorShare(creator);
			this.o.db
				.prepare(
					`INSERT OR IGNORE INTO pool_fees
					 (agent_id, creator_amount, agent_amount, treasury_amount, block, tx, log_index)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.run(
					agentId,
					creator.toString(),
					split.agent.toString(),
					split.treasury.toString(),
					Number(log.blockNumber),
					log.transactionHash,
					log.logIndex ?? 0
				);
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
	 * Settle what each side is owed. Each agent's wallet collects its creator fees (sweeping
	 * its curve, or its graduated pool when Pons allows the creator to, then claiming the
	 * escrow) and sends the treasury musestream's 60% in ETH. The treasury then pays each
	 * agent its gift share in USDG. One agent failing does not stop the others.
	 * Returns what happened, for logs.
	 */
	async settleFees() {
		// two processes settling together would pay the same fees twice
		if (!this.takeLease('settle', 30 * 60_000))
			return { fees: [], gifts: [], failed: [], skipped: true };
		try {
			return { ...(await this.settleFeesNow()), skipped: false };
		} finally {
			this.releaseLease('settle');
		}
	}
	private async settleFeesNow() {
		await this.sync();
		const treasury = await this.treasury();
		const coins = this.o.db
			.prepare(
				`SELECT agent_id, curve, token, graduated, pair FROM coins
				 WHERE status = 'live' AND curve IS NOT NULL AND token IS NOT NULL`
			)
			.all() as {
			agent_id: string;
			curve: Address;
			token: Address;
			graduated: number;
			pair: string;
		}[];
		const fees: FeeSettlement[] = [];
		const failed: { agentId: string; error: string }[] = [];
		for (const coin of coins) {
			try {
				const settled = await this.settleAgentFees(treasury, coin);
				if (settled) fees.push(settled);
			} catch (err) {
				failed.push({ agentId: coin.agent_id, error: revertReason(err) });
			}
		}
		const gifts = await this.serial(treasury.address, () => this.payGiftShares(treasury));
		return { fees, gifts, failed };
	}

	/** trade and pool fee shares the treasury has not collected from one agent yet, in its pair */
	private unsettledFees(agentId: string) {
		const rows = this.o.db
			.prepare(
				`SELECT 'fee_ledger' AS tbl, id, treasury_amount FROM fee_ledger WHERE agent_id = ? AND paid_at IS NULL
				 UNION ALL
				 SELECT 'pool_fees', id, treasury_amount FROM pool_fees WHERE agent_id = ? AND paid_at IS NULL`
			)
			.all(agentId, agentId) as {
			tbl: 'fee_ledger' | 'pool_fees';
			id: number;
			treasury_amount: string;
		}[];
		return {
			rows,
			treasuryAmount: rows.reduce((sum, r) => sum + BigInt(r.treasury_amount), 0n)
		};
	}

	/** the agent's claimable escrow balance in its coin's pair */
	private async escrowBalance(escrow: Address, agent: Address, pair: Pair): Promise<bigint> {
		return pair.native
			? this.o.client.readContract({
					address: escrow,
					abi: escrowAbi,
					functionName: 'balanceOf',
					args: [agent]
				})
			: this.o.client.readContract({
					address: escrow,
					abi: escrowTokenAbi,
					functionName: 'balanceOfToken',
					args: [agent, pair.address]
				});
	}

	/** what is waiting to be collected for one coin, read without sending anything */
	private async pendingFor(
		agent: Address,
		coin: { curve: Address; token: Address; graduated: number },
		pair: Pair
	) {
		const escrow = await this.feeEscrow();
		const [curve, claimable] = await Promise.all([
			coin.graduated
				? Promise.resolve(0n)
				: this.o.client.readContract({
						address: coin.curve,
						abi: curveAbi,
						functionName: 'quoteFeeBalance'
					}),
			this.escrowBalance(escrow, agent, pair)
		]);
		// a pool's creator may sweep only fees already in the pair; fees taken in the coin need
		// Pons's own sweeper to convert them first, so the sweep is simulated before it is sent
		let pool = false;
		if (coin.graduated) {
			const pendingInPair = await this.o.client.readContract({
				address: PONS_MEME_HOOK,
				abi: ponsHookAbi,
				functionName: 'pendingFees',
				args: [poolId(coin.token, pair), pair.address]
			});
			if (pendingInPair >= PAYOUT_MIN[pair.symbol]) {
				pool = await this.o.client
					.simulateContract({
						account: agent,
						address: PONS_MEME_HOOK,
						abi: ponsHookAbi,
						functionName: 'sweepPoolFees',
						args: [poolId(coin.token, pair), 0n, 0n]
					})
					.then(() => true)
					.catch(() => false);
			}
		}
		return { escrow, curve, claimable, pool };
	}

	private feeEscrowAddress: Address | null = null;
	private async feeEscrow(): Promise<Address> {
		this.feeEscrowAddress ??= await this.o.client.readContract({
			address: PONS_FACTORY,
			abi: factoryAbi,
			functionName: 'feeEscrow'
		});
		return this.feeEscrowAddress;
	}

	private async settleAgentFees(
		treasury: WalletRow,
		coin: { agent_id: string; curve: Address; token: Address; graduated: number; pair: string }
	): Promise<FeeSettlement | null> {
		const agent = this.o.wallets.find('agent', coin.agent_id);
		if (!agent) return null;
		const pair = pairAt(coin.pair);
		const min = PAYOUT_MIN[pair.symbol];
		const pending = await this.pendingFor(agent.address, coin, pair);
		const sweepCurve = pending.curve >= min;
		const owed = this.unsettledFees(coin.agent_id).treasuryAmount;
		if (!sweepCurve && !pending.pool && pending.claimable < min && owed < min) return null;
		await this.fundGas(agent.address, SETTLE_GAS);
		return this.serial(agent.address, async () => {
			const signer = await this.signer(agent);
			const send = async (request: Parameters<typeof signer.writeContract>[0]) =>
				this.confirm(await signer.writeContract(request));
			const base = { chain: this.o.client.chain, account: signer.account };
			if (sweepCurve) {
				await send({
					...base,
					address: coin.curve,
					abi: curveAbi,
					functionName: 'sweepFees',
					args: [0n]
				});
			}
			if (pending.pool) {
				await send({
					...base,
					address: PONS_MEME_HOOK,
					abi: ponsHookAbi,
					functionName: 'sweepPoolFees',
					args: [poolId(coin.token, pair), 0n, 0n]
				});
				// the sweep's event is what records the pool fees; read it before paying
				await this.sync();
			}
			const claimed = await this.escrowBalance(pending.escrow, agent.address, pair);
			if (claimed > 0n) {
				await send(
					pair.native
						? { ...base, address: pending.escrow, abi: escrowAbi, functionName: 'claim' }
						: {
								...base,
								address: pending.escrow,
								abi: escrowTokenAbi,
								functionName: 'claimToken',
								args: [pair.address]
							}
				);
			}
			const { rows, treasuryAmount } = this.unsettledFees(coin.agent_id);
			if (treasuryAmount < min) {
				return {
					agentId: coin.agent_id,
					pair: pair.symbol,
					swept: pending.curve,
					claimed,
					toTreasury: 0n,
					tx: null
				};
			}
			const tx = pair.native
				? await this.sendNow(agent, treasury.address, treasuryAmount)
				: await this.sendTokenNow(agent, pair.address, treasury.address, treasuryAmount);
			const at = this.o.now();
			this.o.db.transaction(() => {
				for (const r of rows) {
					this.o.db
						.prepare(`UPDATE ${r.tbl} SET payout_tx = ?, paid_at = ? WHERE id = ?`)
						.run(tx, at, r.id);
				}
			})();
			return {
				agentId: coin.agent_id,
				pair: pair.symbol,
				swept: pending.curve,
				claimed,
				toTreasury: treasuryAmount,
				tx
			};
		});
	}

	/** pay each agent its unpaid gift share, in USDG, from the treasury */
	private async payGiftShares(treasury: WalletRow) {
		const owed = new Map<string, { ids: number[]; amount: bigint }>();
		for (const r of this.shares()) {
			if (r.source !== 'gifts' || r.paid_at) continue;
			const o = owed.get(r.agent_id) ?? { ids: [], amount: 0n };
			o.ids.push(r.id);
			o.amount += BigInt(r.agent_amount);
			owed.set(r.agent_id, o);
		}
		const paid: { agentId: string; amount: bigint; tx: Hash }[] = [];
		for (const [agentId, o] of owed) {
			if (o.amount < PAYOUT_MIN_USDG) continue;
			const agent = await this.o.wallets.ensure('agent', agentId);
			const tx = await this.sendUsdgNow(treasury, agent.address, o.amount);
			this.o.db
				.prepare(
					`UPDATE gifts SET payout_tx = ?, payout_at = ? WHERE id IN (${o.ids.map(() => '?').join(',')})`
				)
				.run(tx, this.o.now(), ...o.ids);
			paid.push({ agentId, amount: o.amount, tx });
		}
		return paid;
	}

	/**
	 * What an agent has earned, paid and unpaid: its trade-fee share in its coin's pair (wei for
	 * ETH, 18-decimal units for META), and its gift share in USDG units.
	 */
	earnings(agentId: string) {
		const out = {
			eth: { paid: 0n, unpaid: 0n },
			meta: { paid: 0n, unpaid: 0n },
			usdg: { paid: 0n, unpaid: 0n }
		};
		for (const r of this.shares(agentId)) {
			const bucket =
				r.source === 'gifts' ? out.usdg : pairAt(r.pair!).symbol === 'META' ? out.meta : out.eth;
			if (r.paid_at) bucket.paid += BigInt(r.agent_amount);
			else bucket.unpaid += BigInt(r.agent_amount);
		}
		return out;
	}

	/** the agent's share of every trade fee and paid gift, for one agent or all of them */
	private shares(agentId: string | null = null) {
		return this.o.db
			.prepare(
				`SELECT * FROM (
				   SELECT 'fees' AS source, f.id, f.agent_id, f.agent_amount, f.paid_at, c.pair
				   FROM fee_ledger f JOIN coins c ON c.agent_id = f.agent_id
				   UNION ALL
				   SELECT 'fees', p.id, p.agent_id, p.agent_amount, p.paid_at, c.pair
				   FROM pool_fees p JOIN coins c ON c.agent_id = p.agent_id
				   UNION ALL
				   SELECT 'gifts', g.id, s.agent_id, g.agent_amount, g.payout_at, NULL
				   FROM gifts g JOIN streams s ON s.id = g.stream_id
				   WHERE g.agent_amount IS NOT NULL
				 ) WHERE @agent IS NULL OR agent_id = @agent`
			)
			.all({ agent: agentId }) as {
			source: 'fees' | 'gifts';
			id: number;
			agent_id: string;
			agent_amount: string;
			paid_at: number | null;
			/** the coin's pair, for fee shares */
			pair: string | null;
		}[];
	}
}
