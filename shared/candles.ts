// Candles from individual trades. Pure: the server builds them, tests check them.

export interface PricePoint {
	/** milliseconds */
	at: number;
	price: number;
	/** traded volume in the quote currency */
	volume: number;
}

export interface Candle {
	/** bucket start, seconds */
	time: number;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

export const INTERVALS = { '1m': 60, '5m': 300, '1h': 3600, '1d': 86400 } as const;
export type Interval = keyof typeof INTERVALS;

/**
 * Group trades into `seconds`-wide candles, oldest first. Quiet buckets between trades are
 * filled flat at the last close, so the chart's time axis stays even. At most `limit` candles.
 */
export function buildCandles(points: PricePoint[], seconds: number, limit = 120): Candle[] {
	if (!points.length) return [];
	const sorted = [...points].sort((a, b) => a.at - b.at);
	const candles: Candle[] = [];
	for (const p of sorted) {
		const time = Math.floor(p.at / 1000 / seconds) * seconds;
		const last = candles.at(-1);
		if (last && last.time === time) {
			last.high = Math.max(last.high, p.price);
			last.low = Math.min(last.low, p.price);
			last.close = p.price;
			last.volume += p.volume;
			continue;
		}
		if (last) {
			for (let t = last.time + seconds; t < time; t += seconds) {
				candles.push({
					time: t,
					open: last.close,
					high: last.close,
					low: last.close,
					close: last.close,
					volume: 0
				});
			}
		}
		const open = candles.at(-1)?.close ?? p.price;
		candles.push({
			time,
			open,
			high: Math.max(open, p.price),
			low: Math.min(open, p.price),
			close: p.price,
			volume: p.volume
		});
	}
	return candles.slice(-limit);
}
