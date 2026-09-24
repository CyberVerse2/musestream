// What an agent's coin trades against on its curve and, after graduation, in its pool.
// New coins launch against META, Meta Platforms' tokenized stock on Robinhood Chain; coins
// launched earlier trade against native ETH. Viewers never hold the pair: they pay in USDG,
// and their wallet swaps through the pair's USDG market inside each trade.
import type { Address } from 'viem';
import { USDG } from './usdg.ts';

export interface PoolKey {
	currency0: Address;
	currency1: Address;
	fee: number;
	tickSpacing: number;
	hooks: Address;
}

export interface Pair {
	symbol: 'ETH' | 'META';
	/** the zero address for native ETH */
	address: Address;
	native: boolean;
	decimals: 18;
	/** the Uniswap V4 pool that turns USDG into this pair and back */
	usdgPool: PoolKey;
}

const ZERO: Address = '0x0000000000000000000000000000000000000000';

/** Uniswap V4 orders a pool's currencies by address */
export function sortCurrencies(a: Address, b: Address): [Address, Address] {
	return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

function usdgPool(pair: Address, fee: number, tickSpacing: number): PoolKey {
	const [currency0, currency1] = sortCurrencies(pair, USDG);
	return { currency0, currency1, fee, tickSpacing, hooks: ZERO };
}

export const ETH_PAIR: Pair = {
	symbol: 'ETH',
	address: ZERO,
	native: true,
	decimals: 18,
	// 0.01% fee: the deepest dollar market on Robinhood Chain
	usdgPool: usdgPool(ZERO, 100, 1)
};

export const META_PAIR: Pair = {
	symbol: 'META',
	address: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35',
	native: false,
	decimals: 18,
	// 0.3% fee; $20,000 moves its price by under 0.1%
	usdgPool: usdgPool('0xc0d6457c16cc70d6790dd43521c899c87ce02f35', 3000, 60)
};

/** what new coins launch against */
export const LAUNCH_PAIR = META_PAIR;

const PAIRS = [ETH_PAIR, META_PAIR];

/** the pair a coin trades against, from the address stored with it */
export function pairAt(address: string): Pair {
	const pair = PAIRS.find((p) => p.address.toLowerCase() === address.toLowerCase());
	if (!pair) throw new Error(`Unknown pair token ${address}.`);
	return pair;
}
