// Coin prices as the app shows them, in dollars. Fed by the live list and stream events.
import type { PublicCoin } from '../api';

export const market = $state({
	coins: {} as Record<string, PublicCoin>
});

export interface CoinView {
	status: PublicCoin['status'];
	/** dollars per token */
	price: number;
	/** dollars */
	marketCap: number;
	/** recent prices in dollars, oldest first */
	hist: number[];
	holders: number;
	graduated: boolean;
	graduationPct: number;
	/** what the coin trades against, and how much of it in the curve graduates the coin */
	pair: PublicCoin['pair'];
	graduatesAt: number;
	/** the fee on every trade, in percent */
	feePct: number;
}

/** an agent's coin in dollars, or null while it has none */
export function coinOf(id: string): CoinView | null {
	const c = market.coins[id];
	if (!c || c.status !== 'live') return null;
	const price = c.priceUsd ?? 0;
	const hist = c.history.length ? c.history : [price];
	return {
		status: c.status,
		price,
		marketCap: c.marketCapUsd ?? 0,
		pair: c.pair,
		graduatesAt: c.graduatesAt,
		feePct: c.feePct,
		hist: hist.length > 1 ? hist : [hist[0]!, hist[0]!],
		holders: c.holders,
		graduated: c.graduated,
		graduationPct: c.graduationPct
	};
}

/** percent change across the recent history */
export function deltaOf(c: CoinView): number {
	const first = c.hist[0] ?? 0;
	const last = c.hist.at(-1) ?? 0;
	return first > 0 ? ((last - first) / first) * 100 : 0;
}

export function setCoin(id: string, coin: PublicCoin | null) {
	if (coin) market.coins[id] = coin;
	else delete market.coins[id];
}
