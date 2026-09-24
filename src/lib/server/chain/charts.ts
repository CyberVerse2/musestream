// Price candles for a coin, in dollars. While it trades on its bonding curve, every trade is
// in our database, priced in its pair and converted at the pair's current dollar rate. After
// graduation it trades on Uniswap V4, which Codex indexes and prices in dollars itself.
import type { Address } from 'viem';
import { buildCandles, INTERVALS, type Candle, type Interval } from '../../../../shared/candles.ts';
import { pairAt, sortCurrencies, type Pair } from '../../../../shared/pairs.ts';
import { poolId } from '../../../../shared/v4.ts';
import type { Coins } from './coins.ts';
import type { PairPrices } from './prices.ts';

const ROBINHOOD_NETWORK_ID = 4663;
const CODEX_RESOLUTION: Record<Interval, string> = { '1m': '1', '5m': '5', '1h': '60', '1d': '1D' };

export interface CandleSet {
	interval: Interval;
	/** where the candles came from */
	source: 'curve' | 'codex' | 'none';
	/** prices in dollars per token */
	candles: Candle[];
}

export class Charts {
	private coins: Coins;
	private prices: PairPrices;
	private codexKey: string | undefined;
	private cache = new Map<string, { until: number; data: CandleSet }>();

	constructor(coins: Coins, prices: PairPrices, codexKey: string | undefined) {
		this.coins = coins;
		this.prices = prices;
		this.codexKey = codexKey;
	}

	async candles(agentId: string, interval: Interval): Promise<CandleSet> {
		const coin = this.coins.coinFor(agentId);
		if (!coin?.token) return { interval, source: 'none', candles: [] };
		const pair = pairAt(coin.pair);
		if (!coin.graduated) {
			const usd = await this.prices.usd(pair);
			if (usd === null) return { interval, source: 'none', candles: [] };
			const seconds = INTERVALS[interval];
			const points = this.coins
				.pricePoints(agentId, Date.now() - seconds * 1000 * 200)
				.map((p) => ({ ...p, price: p.price * usd, volume: p.volume * usd }));
			return { interval, source: 'curve', candles: buildCandles(points, seconds, 120) };
		}
		const key = `${coin.token}:${interval}`;
		const hit = this.cache.get(key);
		if (hit && hit.until > Date.now()) return hit.data;
		const data = await this.codexBars(coin.token, pair, interval);
		this.cache.set(key, { until: Date.now() + 30_000, data });
		return data;
	}

	private async codexBars(token: Address, pair: Pair, interval: Interval): Promise<CandleSet> {
		// Codex prices one side of the pool; name the coin's side, in dollars
		const coinSide =
			sortCurrencies(pair.address, token)[0].toLowerCase() === token.toLowerCase()
				? 'token0'
				: 'token1';
		const none: CandleSet = { interval, source: 'none', candles: [] };
		if (!this.codexKey) return none;
		try {
			const res = await fetch('https://graph.codex.io/graphql', {
				method: 'POST',
				headers: { Authorization: this.codexKey, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: `query Bars($symbol: String!, $to: Int!, $resolution: String!, $quoteToken: QuoteToken!) {
						getBars(symbol: $symbol, symbolType: POOL, from: 0, to: $to, resolution: $resolution,
							countback: 120, currencyCode: "USD", quoteToken: $quoteToken,
							removeEmptyBars: true, removeLeadingNullValues: true) { s t o h l c volume }
					}`,
					variables: {
						symbol: `${poolId(token, pair)}:${ROBINHOOD_NETWORK_ID}`,
						quoteToken: coinSide,
						to: Math.floor(Date.now() / 1000),
						resolution: CODEX_RESOLUTION[interval]
					}
				}),
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) return none;
			const bars = (await res.json())?.data?.getBars;
			if (bars?.s !== 'ok' || !Array.isArray(bars.t)) return none;
			const candles = (bars.t as number[]).map((time, i) => ({
				time,
				open: Number(bars.o[i]),
				high: Number(bars.h[i]),
				low: Number(bars.l[i]),
				close: Number(bars.c[i]),
				volume: Number(bars.volume?.[i] ?? 0)
			}));
			return { interval, source: 'codex', candles };
		} catch {
			return none;
		}
	}
}
