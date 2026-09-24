import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandles } from '../shared/candles.ts';

const at = (sec: number) => sec * 1000;

test('trades in one bucket make one candle with open, high, low, close, and volume', () => {
	const c = buildCandles(
		[
			{ at: at(60), price: 10, volume: 1 },
			{ at: at(70), price: 14, volume: 2 },
			{ at: at(80), price: 9, volume: 1 },
			{ at: at(119), price: 12, volume: 3 }
		],
		60
	);
	assert.deepEqual(c, [{ time: 60, open: 10, high: 14, low: 9, close: 12, volume: 7 }]);
});

test('a new candle opens at the previous close, and quiet buckets stay flat', () => {
	const c = buildCandles(
		[
			{ at: at(60), price: 10, volume: 1 },
			{ at: at(240), price: 20, volume: 1 }
		],
		60
	);
	assert.deepEqual(
		c.map((x) => [x.time, x.open, x.close, x.volume]),
		[
			[60, 10, 10, 1],
			[120, 10, 10, 0],
			[180, 10, 10, 0],
			[240, 10, 20, 1]
		]
	);
	assert.equal(c.at(-1)!.low, 10);
	assert.equal(c.at(-1)!.high, 20);
});

test('order of input does not matter, and the limit keeps the newest candles', () => {
	const pts = [300, 60, 180].map((s, i) => ({ at: at(s), price: i + 1, volume: 1 }));
	const c = buildCandles(pts, 60, 2);
	assert.deepEqual(
		c.map((x) => x.time),
		[240, 300]
	);
});

test('no trades, no candles', () => {
	assert.deepEqual(buildCandles([], 60), []);
});
