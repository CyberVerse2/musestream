import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBuy, applySell, quoteBuy } from '../shared/trading.ts';

test('quotes and holdings use the same fee-inclusive cost basis', () => {
	const first = applyBuy(undefined, 100, 0.5);
	assert.equal(first.quote.tokens, 198);
	assert.equal(first.holding.amt * first.holding.cost, 100);
	const second = applyBuy(first.holding, 50, 1);
	assert.equal(second.holding.amt, 247.5);
	assert.equal(second.holding.amt * second.holding.cost, 150);
	assert.equal(second.quote.tokens, quoteBuy(50, 1).tokens);
});
test('partial sales preserve cost basis and full sales remove the position', () => {
	const holding = { amt: 100, cost: 2 };
	const partial = applySell(holding, 0.25, 3);
	assert.equal(partial.tokens, 25);
	assert.equal(partial.usd, 74.25);
	assert.deepEqual(partial.holding, { amt: 75, cost: 2 });
	assert.deepEqual(holding, { amt: 100, cost: 2 });
	assert.equal(applySell(holding, 1, 3).holding, null);
});
test('invalid trade amounts cannot corrupt positions', () => {
	for (const value of [-1, 0, NaN, Infinity]) {
		assert.throws(() => quoteBuy(value, 1), RangeError);
		assert.throws(() => quoteBuy(1, value), RangeError);
		assert.throws(() => applySell({ amt: 100, cost: 1 }, value, 1), RangeError);
	}
	assert.throws(() => applySell({ amt: 100, cost: 1 }, 2, 1), RangeError);
});
