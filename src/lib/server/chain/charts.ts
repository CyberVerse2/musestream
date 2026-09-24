// Price candles for a coin. While it trades on its bonding curve, every trade is in our
// database. After graduation it trades on Uniswap V4, which Codex indexes.
import type { Address } from 'viem';
import { buildCandles, INTERVALS, type Candle, type Interval } from '../../../../shared/candles.ts';
import { poolId } from '../../../../shared/v4.ts';
import type { Coins } from './coins.ts';

const ROBINHOOD_NETWORK_ID = 4663;
const CODEX_RESOLUTION: Record<Interval, string> = { '1m': '1', '5m': '5', '1h': '60', '1d': '1D' };

export interface CandleSet {
	interval: Interval;
	/** where the candles came from */
	source: 'curve' | 'codex' | 'none';
	/** prices in ETH per token */
	candles: Candle[];
}

export class Charts {
	private coins: Coins;
	private codexKey: string | undefined;
	private cache = new Map<string, { until: number; data: CandleSet }>();

	constructor(coins: Coins, codexKey: string | undefined) {
		this.coins = coins;
		this.codexKey = codexKey;
	}

	async candles(agentId: string, interval: Interval): Promise<CandleSet> {
		const coin = this.coins.coinFor(agentId);
		if (!coin?.token) return { interval, source: 'none', candles: [] };
		if (!coin.graduated) {
			const seconds = INTERVALS[interval];
			const points = this.coins.pricePoints(agentId, Date.now() - seconds * 1000 * 200);
			return { interval, source: 'curve', candles: buildCandles(points, seconds, 120) };
		}
		const key = `${coin.token}:${interval}`;
		const hit = this.cache.get(key);
		if (hit && hit.until > Date.now()) return hit.data;
		const data = await this.codexBars(coin.token, interval);
		this.cache.set(key, { until: Date.now() + 30_000, data });
		return data;
	}

	private async codexBars(token: Address, interval: Interval): Promise<CandleSet> {
		const none: CandleSet = { interval, source: 'none', candles: [] };
		if (!this.codexKey) return none;
		try {
			const res = await fetch('https://graph.codex.io/graphql', {
				method: 'POST',
				headers: { Authorization: this.codexKey, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: `query Bars($symbol: String!, $to: Int!, $resolution: String!) {
						getBars(symbol: $symbol, symbolType: POOL, from: 0, to: $to, resolution: $resolution,
							countback: 120, currencyCode: "TOKEN", quoteToken: token1,
							removeEmptyBars: true, removeLeadingNullValues: true) { s t o h l c volumeNativeToken }
					}`,
					variables: {
						symbol: `${poolId(token)}:${ROBINHOOD_NETWORK_ID}`,
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
				volume: Number(bars.volumeNativeToken[i] ?? 0)
			}));
			return { interval, source: 'codex', candles };
		} catch {
			return none;
		}
	}
}
