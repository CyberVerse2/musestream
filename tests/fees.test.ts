import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFee } from '../shared/fees.ts';

test('a 1% fee splits 30% Pons, then 60/40 treasury and agent', () => {
	// 1 ETH trade, 1% fee = 0.01 ETH
	const fee = 10n ** 16n;
	const s = splitFee(fee, 3000n);
	assert.equal(s.protocol, 3n * 10n ** 15n); // 0.003 ETH, 0.30% of the trade
	assert.equal(s.treasury, 42n * 10n ** 14n); // 0.0042 ETH, 0.42%
	assert.equal(s.agent, 28n * 10n ** 14n); // 0.0028 ETH, 0.28%
});

test('the parts always add up to the fee, even with rounding', () => {
	for (const fee of [0n, 1n, 7n, 999n, 123456789n, 10n ** 18n + 3n]) {
		const s = splitFee(fee, 3000n);
		assert.equal(s.protocol + s.treasury + s.agent, fee);
	}
});

test('bad inputs are refused', () => {
	assert.throws(() => splitFee(-1n, 3000n), RangeError);
	assert.throws(() => splitFee(1n, 10001n), RangeError);
});
