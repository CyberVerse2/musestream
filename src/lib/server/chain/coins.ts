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
import { sellQuote, withSlippage } from '../../../../shared/curve.ts';
import { USDG } from '../../../../shared/usdg.ts';
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
	poolBuyTx,
	poolId,
	poolKey,
	poolManagerAbi,
	poolSellTx,
	ponsHookAbi,
	priceFromSqrt,
	quoterAbi,
	stateViewAbi
} from '../../../../shared/v4.ts';
import type { DB } from '../db.ts';
import type { Hub } from '../hub.ts';
import type { AgentRow } from '../service.ts';
import { MusestreamError } from '../service.ts';
import {
	curveAbi,
	escrowAbi,
	factoryAbi,
	graduationAbi,
	NATIVE_PAIR,
	PONS_FACTORY,
	PONS_LAUNCH_CONFIG
} from './abi.ts';
import type { Wallets, WalletRow } from './wallets.ts';

export const TOKEN_SUPPLY = 10n ** 27n; // 1B tokens, 18 decimals
/** agents are paid once their unpaid share passes this, so gas does not eat it */
const PAYOUT_MIN_WEI = 10n ** 14n; // 0.0001 ETH
const PAYOUT_MIN_USDG = 100_000n; // $0.10
/** gas budgets for funding an agent's wallet; a launch measured about 3.6M gas on a fork */
const LAUNCH_GAS = 4_500_000n;
const SETTLE_GAS = 400_000n;
const POOL_GAS = 3_000_000n;
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
	error: string | null;
	created_at: number;
}

/** one agent's fee settlement: fees swept and claimed by its wallet, musestream's share sent on */
interface FeeSettlement {
	agentId: string;
	swept: bigint;
	claimed: bigint;
	toTreasury: bigint;
	tx: Hash | null;
}

/** the transactions for one trade, in order, and what the trade should return */
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
		const treasury = await this.treasury();
		await this.send(treasury, address, need - balance);
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

	/** Launch the agent's coin from the agent's wallet. Safe to call again after a failure. */
	async launch(agent: AgentRow): Promise<CoinRow> {
		const wallet = await this.o.wallets.ensure('agent', agent.id);
		return this.serial(wallet.address, () => this.launchNow(agent, wallet));
	}

	private async launchNow(agent: AgentRow, agentWallet: WalletRow): Promise<CoinRow> {
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
					args: [PONS_LAUNCH_CONFIG, NATIVE_PAIR]
				})
			]);
			await this.fundGas(agentWallet.address, LAUNCH_GAS, launchFee);
			const params = {
				name: agent.name,
				symbol: agent.handle.toUpperCase(),
				logo: agent.avatar_url ?? '',
				description: agent.bio,
				socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
				creatorFeeRecipient: agentWallet.address,
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
		if (graduated && coin.token) {
			let sqrtPriceX96 = await this.poolPrice(coin.token);
			if (sqrtPriceX96 === 0n) {
				await this.createPool(agentId, coin.token);
				sqrtPriceX96 = await this.poolPrice(coin.token);
			}
			this.o.db
				.prepare('UPDATE coins SET pool_sqrt_price = ? WHERE agent_id = ?')
				.run(sqrtPriceX96.toString(), agentId);
		}
	}

	private async poolPrice(token: Address): Promise<bigint> {
		const [sqrtPriceX96] = await this.o.client.readContract({
			address: STATE_VIEW,
			abi: stateViewAbi,
			functionName: 'getSlot0',
			args: [poolId(token)]
		});
		return sqrtPriceX96;
	}

	/** seed a graduated coin's pool from the agent's wallet, unless someone already has */
	private async createPool(agentId: string, token: Address) {
		const agent = this.o.wallets.find('agent', agentId);
		if (!agent) return;
		await this.fundGas(agent.address, POOL_GAS);
		await this.serial(agent.address, async () => {
			if ((await this.poolPrice(token)) !== 0n) return;
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
		const quote = BigInt(coin.quote_reserve);
		const tokens = BigInt(coin.token_reserve);
		// a graduated coin's price is its pool's; the curve is empty after graduation
		const priceEth =
			coin.graduated && coin.pool_sqrt_price
				? priceFromSqrt(BigInt(coin.pool_sqrt_price))
				: tokens > 0n
					? Number(formatEther((quote * 10n ** 18n) / tokens))
					: 0;
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
			throw new MusestreamError(409, 'no_coin', 'This agent has no coin yet.');
		}
		return coin as CoinRow & { curve: Address; token: Address };
	}

	/**
	 * The transactions that buy `wei` of an agent's coin for `from`, in order, and what they
	 * should return. On the bonding curve until graduation, then on the Uniswap V4 pool.
	 * Every trade refuses a price more than 3% worse than quoted.
	 */
	async planBuy(agentId: string, from: Address, wei: bigint): Promise<TradePlan> {
		const coin = this.liveCoin(agentId);
		try {
			if (coin.graduated) {
				const expected = await this.poolQuote(coin.token, true, wei);
				const minOut = withSlippage(expected, 300n);
				return {
					expected,
					minOut,
					txs: [poolBuyTx(coin.token, wei, minOut, await this.deadline())]
				};
			}
			const { result: expected } = await this.o.client.simulateContract({
				account: from,
				address: coin.curve,
				abi: curveAbi,
				functionName: 'buy',
				args: [wei, 0n, from],
				value: wei,
				// the quote must not depend on whether the wallet is funded yet
				stateOverride: [{ address: from, balance: wei + 10n ** 18n }]
			});
			const minOut = withSlippage(expected, 300n);
			return { expected, minOut, txs: [buyTx(coin.curve, wei, minOut, from)] };
		} catch (err) {
			throw new MusestreamError(
				400,
				'quote_failed',
				`No price for this buy: ${revertReason(err)}.`
			);
		}
	}

	/** the transactions that sell `tokens` of an agent's coin from `from`, approvals first */
	async planSell(agentId: string, from: Address, tokens: bigint): Promise<TradePlan> {
		const coin = this.liveCoin(agentId);
		if (tokens === 0n)
			throw new MusestreamError(409, 'nothing_to_sell', 'This wallet holds none of this coin.');
		try {
			if (coin.graduated) {
				const [expected, toPermit2, [toRouter, expiration]] = await Promise.all([
					this.poolQuote(coin.token, false, tokens),
					this.o.client.readContract({
						address: coin.token,
						abi: erc20Abi,
						functionName: 'allowance',
						args: [from, PERMIT2]
					}),
					this.o.client.readContract({
						address: PERMIT2,
						abi: permit2Abi,
						functionName: 'allowance',
						args: [from, coin.token, UNIVERSAL_ROUTER]
					})
				]);
				const deadline = await this.deadline();
				const txs: TxRequest[] = [];
				if (toPermit2 < tokens) txs.push(permit2TokenApprovalTx(coin.token));
				if (toRouter < tokens || BigInt(expiration) < deadline) {
					txs.push(permit2RouterApprovalTx(coin.token, Number(deadline) + 30 * 86_400));
				}
				const minOut = withSlippage(expected, 300n);
				txs.push(poolSellTx(coin.token, tokens, minOut, deadline));
				return { expected, minOut, txs };
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
			const expected = sellQuote(tokens, { quote, tokens: reserveTokens }, feeBps);
			const minOut = withSlippage(expected, 300n);
			const txs: TxRequest[] = [];
			if (allowance < tokens) txs.push(approveTx(coin.token, coin.curve, tokens));
			txs.push(sellTx(coin.curve, tokens, minOut, from));
			return { expected, minOut, txs };
		} catch (err) {
			throw new MusestreamError(
				400,
				'quote_failed',
				`No price for this sale: ${revertReason(err)}.`
			);
		}
	}

	/** what the pool pays out now for `amountIn` of ETH (`ethIn`) or of the coin */
	private async poolQuote(token: Address, ethIn: boolean, amountIn: bigint): Promise<bigint> {
		const { result } = await this.o.client.simulateContract({
			address: V4_QUOTER,
			abi: quoterAbi,
			functionName: 'quoteExactInputSingle',
			args: [{ poolKey: poolKey(token), zeroForOne: ethIn, exactAmount: amountIn, hookData: '0x' }]
		});
		return result[0];
	}

	/** a swap deadline 20 minutes past the chain's clock, which a fork may have moved */
	private async deadline(): Promise<bigint> {
		const block = await this.o.client.getBlock();
		return block.timestamp + 20n * 60n;
	}

	/** buy with `weiIn` ETH from a server-held wallet */
	buy(wallet: WalletRow, agentId: string, weiIn: bigint) {
		return this.serial(wallet.address, async () => {
			const plan = await this.planBuy(agentId, wallet.address, weiIn);
			const hash = await this.execute(wallet, plan, 'The buy');
			return { hash, tokens: plan.expected };
		});
	}

	/** sell `tokensIn` tokens from a server-held wallet */
	sell(wallet: WalletRow, agentId: string, tokensIn: bigint) {
		return this.serial(wallet.address, async () => {
			const plan = await this.planSell(agentId, wallet.address, tokensIn);
			const hash = await this.execute(wallet, plan, 'The sale');
			return { hash, wei: plan.expected };
		});
	}

	/** send a plan's transactions in order; returns the last one, the trade itself */
	private async execute(wallet: WalletRow, plan: TradePlan, what: string): Promise<Hash> {
		const signer = await this.signer(wallet);
		try {
			let hash: Hash | null = null;
			for (const tx of plan.txs) {
				hash = await signer.sendTransaction({
					...tx,
					chain: this.o.client.chain,
					account: signer.account
				});
				await this.confirm(hash);
			}
			await this.sync();
			return hash!;
		} catch (err) {
			throw new MusestreamError(
				400,
				'trade_failed',
				`${what} did not go through: ${revertReason(err)}.`
			);
		}
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
	private async sendUsdgNow(from: WalletRow, to: Address, amount: bigint): Promise<Hash> {
		const signer = await this.signer(from);
		const hash = await signer.sendTransaction({
			...transferTx(USDG, to, amount),
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
			await this.indexPools(from, to, blockTimes, touched);
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
			.prepare(`SELECT agent_id, token FROM coins WHERE graduated = 1 AND token IS NOT NULL`)
			.all() as { agent_id: string; token: Address }[];
		if (!graduated.length) return;
		const byPool = new Map(graduated.map((c) => [poolId(c.token), c.agent_id]));
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
			const agentId = byPool.get(log.args.id!);
			if (!agentId || log.blockNumber === null || log.transactionHash === null) continue;
			// amounts are the swapper's: negative is what it paid in
			const buy = log.args.amount0! < 0n;
			const abs = (v: bigint) => (v < 0n ? -v : v);
			const { from: trader } = await this.o.client.getTransaction({ hash: log.transactionHash });
			const inserted = this.o.db
				.prepare(
					`INSERT OR IGNORE INTO trades
					 (agent_id, side, trader, quote_wei, tokens, fee_wei, price_eth, block, tx, log_index, at)
					 VALUES (?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?)`
				)
				.run(
					agentId,
					buy ? 'buy' : 'sell',
					trader,
					abs(log.args.amount0!).toString(),
					abs(log.args.amount1!).toString(),
					priceFromSqrt(log.args.sqrtPriceX96!),
					Number(log.blockNumber),
					log.transactionHash,
					log.logIndex ?? 0,
					await at(log.blockNumber)
				);
			if (inserted.changes) touched.add(agentId);
		}
		for (const log of sweeps) {
			const agentId = byPool.get(log.args.poolId!);
			if (!agentId || log.blockNumber === null || log.transactionHash === null) continue;
			const creator = log.args.creatorAmount!;
			const split = splitCreatorShare(creator);
			this.o.db
				.prepare(
					`INSERT OR IGNORE INTO pool_fees
					 (agent_id, creator_wei, agent_wei, treasury_wei, block, tx, log_index)
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
		await this.sync();
		const treasury = await this.treasury();
		const coins = this.o.db
			.prepare(
				`SELECT agent_id, curve, token, graduated FROM coins
				 WHERE status = 'live' AND curve IS NOT NULL AND token IS NOT NULL`
			)
			.all() as { agent_id: string; curve: Address; token: Address; graduated: number }[];
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

	/** trade and pool fee shares the treasury has not collected from one agent yet */
	private unsettledFees(agentId: string) {
		const rows = this.o.db
			.prepare(
				`SELECT 'fee_ledger' AS tbl, id, treasury_wei FROM fee_ledger WHERE agent_id = ? AND paid_at IS NULL
				 UNION ALL
				 SELECT 'pool_fees', id, treasury_wei FROM pool_fees WHERE agent_id = ? AND paid_at IS NULL`
			)
			.all(agentId, agentId) as {
			tbl: 'fee_ledger' | 'pool_fees';
			id: number;
			treasury_wei: string;
		}[];
		return {
			rows,
			treasuryWei: rows.reduce((sum, r) => sum + BigInt(r.treasury_wei), 0n)
		};
	}

	/** what is waiting to be collected for one coin, read without sending anything */
	private async pendingFor(
		agent: Address,
		coin: { curve: Address; token: Address; graduated: number }
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
			this.o.client.readContract({
				address: escrow,
				abi: escrowAbi,
				functionName: 'balanceOf',
				args: [agent]
			})
		]);
		// a pool's creator may sweep only fees already in ETH; fees taken in the coin need Pons's
		// own sweeper to convert them first, so the sweep is simulated before it is sent
		let pool = false;
		if (coin.graduated) {
			const pendingEth = await this.o.client.readContract({
				address: PONS_MEME_HOOK,
				abi: ponsHookAbi,
				functionName: 'pendingFees',
				args: [poolId(coin.token), NATIVE_PAIR]
			});
			if (pendingEth >= PAYOUT_MIN_WEI) {
				pool = await this.o.client
					.simulateContract({
						account: agent,
						address: PONS_MEME_HOOK,
						abi: ponsHookAbi,
						functionName: 'sweepPoolFees',
						args: [poolId(coin.token), 0n, 0n]
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
		coin: { agent_id: string; curve: Address; token: Address; graduated: number }
	): Promise<FeeSettlement | null> {
		const agent = this.o.wallets.find('agent', coin.agent_id);
		if (!agent) return null;
		const pending = await this.pendingFor(agent.address, coin);
		const sweepCurve = pending.curve >= PAYOUT_MIN_WEI;
		const owed = this.unsettledFees(coin.agent_id).treasuryWei;
		if (!sweepCurve && !pending.pool && pending.claimable < PAYOUT_MIN_WEI && owed < PAYOUT_MIN_WEI)
			return null;
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
					args: [poolId(coin.token), 0n, 0n]
				});
				// the sweep's event is what records the pool fees; read it before paying
				await this.sync();
			}
			const claimed = await this.o.client.readContract({
				address: pending.escrow,
				abi: escrowAbi,
				functionName: 'balanceOf',
				args: [agent.address]
			});
			if (claimed > 0n) {
				await send({ ...base, address: pending.escrow, abi: escrowAbi, functionName: 'claim' });
			}
			const { rows, treasuryWei } = this.unsettledFees(coin.agent_id);
			if (treasuryWei < PAYOUT_MIN_WEI) {
				return { agentId: coin.agent_id, swept: pending.curve, claimed, toTreasury: 0n, tx: null };
			}
			const tx = await this.sendNow(agent, treasury.address, treasuryWei);
			const at = this.o.now();
			this.o.db.transaction(() => {
				for (const r of rows) {
					this.o.db
						.prepare(`UPDATE ${r.tbl} SET payout_tx = ?, paid_at = ? WHERE id = ?`)
						.run(tx, at, r.id);
				}
			})();
			return { agentId: coin.agent_id, swept: pending.curve, claimed, toTreasury: treasuryWei, tx };
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

	/** what an agent has earned, paid and unpaid: trade fees in wei, gifts in USDG units */
	earnings(agentId: string) {
		const out = { eth: { paid: 0n, unpaid: 0n }, usdg: { paid: 0n, unpaid: 0n } };
		for (const r of this.shares(agentId)) {
			const bucket = r.source === 'fees' ? out.eth : out.usdg;
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
				   SELECT 'fees' AS source, id, agent_id, agent_wei AS agent_amount, paid_at FROM fee_ledger
				   UNION ALL
				   SELECT 'fees', id, agent_id, agent_wei, paid_at FROM pool_fees
				   UNION ALL
				   SELECT 'gifts', g.id, s.agent_id, g.agent_amount, g.payout_at
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
		}[];
	}
}
