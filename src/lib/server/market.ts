// Coin data as the app sees it: every amount in dollars. Each coin is priced in its pair
// (ETH or META) and converted at the pair's current dollar rate.
import { formatEther, type Address } from 'viem';
import { coins, musestream, pairPrices } from './app.ts';
import type { TradeRow } from './chain/coins.ts';
import { pairAt, type Pair } from '../../../shared/pairs.ts';

/** dollars per unit of `pair` without waiting; starts a refresh when the rate is stale */
function pairUsd(pair: Pair): number | null {
	const usd = pairPrices?.peek(pair) ?? null;
	if (usd === null) void pairPrices?.usd(pair);
	return usd;
}

export function publicCoin(agentId: string) {
	const view = coins?.view(agentId);
	if (!view) return null;
	const usd = pairUsd(view.pair);
	return {
		status: view.status,
		token: view.token,
		/** what the coin trades against */
		pair: view.pair.symbol,
		priceUsd: usd === null ? null : view.price * usd,
		marketCapUsd: usd === null ? null : view.marketCap * usd,
		graduationPct: view.graduationPct,
		/** how much of the pair in the curve graduates the coin, e.g. 13.57 (META) */
		graduatesAt: view.graduationThreshold,
		/** the fee buyers and sellers pay on every trade, in percent: Pons's 1% plus the creator tax */
		feePct: 1 + view.creatorTaxPct,
		graduated: view.graduated,
		holders: view.holders,
		/** recent prices in dollars, oldest first, for sparklines; empty until the rate is known */
		history: usd === null ? [] : coins!.priceHistory(agentId, 60).map((p) => p.price * usd)
	};
}
export type PublicCoin = NonNullable<ReturnType<typeof publicCoin>>;

/** a trade, valued in dollars at the pair's current rate */
export function publicTrade(t: TradeRow) {
	const pair = pairAt(
		coins?.coinFor(t.agent_id)?.pair ?? '0x0000000000000000000000000000000000000000'
	);
	const usd = pairUsd(pair) ?? 0;
	return {
		side: t.side,
		trader: t.trader,
		usd: Number(formatEther(BigInt(t.quote_amount))) * usd,
		tokens: Number(formatEther(BigInt(t.tokens))),
		at: t.at,
		tx: t.tx
	};
}

/** tell viewers of a live stream that its coin moved */
export function watchCoinEvents() {
	return musestream.hub.onGlobal((e) => {
		if (e.type !== 'coin') return;
		const stream = musestream.currentStream(e.agentId);
		const coin = publicCoin(e.agentId);
		if (stream && coin) musestream.hub.emit(stream.id, { type: 'coin', coin });
	});
}

export function isAddress(a: string): a is Address {
	return /^0x[0-9a-fA-F]{40}$/.test(a);
}
