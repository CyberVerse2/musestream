// USDG (Global Dollar), the dollar token gifts are paid in. Robinhood Chain has almost no USDC.
import type { Address } from 'viem';

export const USDG: Address = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const USDG_DECIMALS = 6;

/** a dollar price in cents, in USDG's smallest unit */
export function usdgFromCents(cents: number): bigint {
	if (!Number.isInteger(cents) || cents < 0) throw new RangeError('cents must be a whole number');
	return BigInt(cents) * 10_000n;
}

/** USDG's smallest unit, in dollars; for display only */
export function usdgToUsd(amount: bigint): number {
	return Number(amount) / 10 ** USDG_DECIMALS;
}
