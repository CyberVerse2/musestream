// Trading a graduated coin on its Uniswap V4 pool. A Pons coin graduates into one pool:
// native ETH against the coin, no LP fee, the Pons hook charging the trade fee.
// The browser and the server build the same transactions here, so the fork test checks
// exactly what users sign.
import {
	encodeAbiParameters,
	encodeFunctionData,
	encodePacked,
	keccak256,
	maxUint160,
	maxUint256,
	type Address
} from 'viem';
import type { TxRequest } from './tx.ts';

/** Uniswap's deployments on Robinhood Chain (developers.uniswap.org, v4 deployments) */
export const POOL_MANAGER: Address = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const UNIVERSAL_ROUTER: Address = '0x204FAca1764B154221e35c0d20aBb3c525710498';
export const V4_QUOTER: Address = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
export const STATE_VIEW: Address = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
export const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/** the hook on every graduated Pons pool; read from factory.memeHook() */
export const PONS_MEME_HOOK: Address = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
/** graduated pools have no LP fee (the hook charges it) and tick spacing 200 */
export const PONS_POOL_FEE = 0;
export const PONS_TICK_SPACING = 200;
const ETH: Address = '0x0000000000000000000000000000000000000000';

export interface PoolKey {
	currency0: Address;
	currency1: Address;
	fee: number;
	tickSpacing: number;
	hooks: Address;
}

/** ETH sorts first, so it is always currency0 and the coin currency1 */
export function poolKey(token: Address): PoolKey {
	return {
		currency0: ETH,
		currency1: token,
		fee: PONS_POOL_FEE,
		tickSpacing: PONS_TICK_SPACING,
		hooks: PONS_MEME_HOOK
	};
}

const poolKeyType = {
	type: 'tuple',
	components: [
		{ name: 'currency0', type: 'address' },
		{ name: 'currency1', type: 'address' },
		{ name: 'fee', type: 'uint24' },
		{ name: 'tickSpacing', type: 'int24' },
		{ name: 'hooks', type: 'address' }
	]
} as const;

/** the pool id: keccak256(abi.encode(PoolKey)) */
export function poolId(token: Address): `0x${string}` {
	const k = poolKey(token);
	return keccak256(
		encodeAbiParameters(
			[
				{ type: 'address' },
				{ type: 'address' },
				{ type: 'uint24' },
				{ type: 'int24' },
				{ type: 'address' }
			],
			[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]
		)
	);
}

/** ETH per token from the pool's sqrtPriceX96 (token per ETH, squared); for display only */
export function priceFromSqrt(sqrtPriceX96: bigint): number {
	const tokensPerEth = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
	return tokensPerEth > 0 ? 1 / tokensPerEth : 0;
}

export const quoterAbi = [
	{
		type: 'function',
		name: 'quoteExactInputSingle',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'poolKey', ...poolKeyType },
					{ name: 'zeroForOne', type: 'bool' },
					{ name: 'exactAmount', type: 'uint128' },
					{ name: 'hookData', type: 'bytes' }
				]
			}
		],
		outputs: [
			{ name: 'amountOut', type: 'uint256' },
			{ name: 'gasEstimate', type: 'uint256' }
		]
	}
] as const;

export const stateViewAbi = [
	{
		type: 'function',
		name: 'getSlot0',
		stateMutability: 'view',
		inputs: [{ name: 'poolId', type: 'bytes32' }],
		outputs: [
			{ name: 'sqrtPriceX96', type: 'uint160' },
			{ name: 'tick', type: 'int24' },
			{ name: 'protocolFee', type: 'uint24' },
			{ name: 'lpFee', type: 'uint24' }
		]
	}
] as const;

export const poolManagerAbi = [
	{
		type: 'event',
		name: 'Swap',
		inputs: [
			{ name: 'id', type: 'bytes32', indexed: true },
			{ name: 'sender', type: 'address', indexed: true },
			{ name: 'amount0', type: 'int128', indexed: false },
			{ name: 'amount1', type: 'int128', indexed: false },
			{ name: 'sqrtPriceX96', type: 'uint160', indexed: false },
			{ name: 'liquidity', type: 'uint128', indexed: false },
			{ name: 'tick', type: 'int24', indexed: false },
			{ name: 'fee', type: 'uint24', indexed: false }
		]
	}
] as const;

export const permit2Abi = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'token', type: 'address' },
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint160' },
			{ name: 'expiration', type: 'uint48' }
		],
		outputs: []
	},
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [
			{ name: 'user', type: 'address' },
			{ name: 'token', type: 'address' },
			{ name: 'spender', type: 'address' }
		],
		outputs: [
			{ name: 'amount', type: 'uint160' },
			{ name: 'expiration', type: 'uint48' },
			{ name: 'nonce', type: 'uint48' }
		]
	}
] as const;

const routerAbi = [
	{
		type: 'function',
		name: 'execute',
		stateMutability: 'payable',
		inputs: [
			{ name: 'commands', type: 'bytes' },
			{ name: 'inputs', type: 'bytes[]' },
			{ name: 'deadline', type: 'uint256' }
		],
		outputs: []
	}
] as const;

const erc20Approve = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }]
	}
] as const;

const exactInputSingleType = {
	type: 'tuple',
	components: [
		{ name: 'poolKey', ...poolKeyType },
		{ name: 'zeroForOne', type: 'bool' },
		{ name: 'amountIn', type: 'uint128' },
		{ name: 'amountOutMinimum', type: 'uint128' },
		{ name: 'hookData', type: 'bytes' }
	]
} as const;

// Universal Router command and V4 router actions
const V4_SWAP = '0x10';
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

/** one exact-input swap through the Universal Router: pay `amountIn`, take at least `minOut` */
function swapTx(
	token: Address,
	ethIn: boolean,
	amountIn: bigint,
	minOut: bigint,
	deadline: bigint
) {
	const key = poolKey(token);
	const [payIn, takeOut] = ethIn ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
	const input = encodeAbiParameters(
		[{ type: 'bytes' }, { type: 'bytes[]' }],
		[
			encodePacked(['uint8', 'uint8', 'uint8'], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]),
			[
				encodeAbiParameters(
					[exactInputSingleType],
					[{ poolKey: key, zeroForOne: ethIn, amountIn, amountOutMinimum: minOut, hookData: '0x' }]
				),
				encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [payIn, amountIn]),
				encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [takeOut, minOut])
			]
		]
	);
	return encodeFunctionData({
		abi: routerAbi,
		functionName: 'execute',
		args: [V4_SWAP, [input], deadline]
	});
}

/** buy a graduated coin with `wei` ETH, receiving at least `minTokens` */
export function poolBuyTx(
	token: Address,
	wei: bigint,
	minTokens: bigint,
	deadline: bigint
): TxRequest {
	return { to: UNIVERSAL_ROUTER, value: wei, data: swapTx(token, true, wei, minTokens, deadline) };
}

/** sell `tokens` of a graduated coin, receiving at least `minWei` ETH */
export function poolSellTx(
	token: Address,
	tokens: bigint,
	minWei: bigint,
	deadline: bigint
): TxRequest {
	return { to: UNIVERSAL_ROUTER, data: swapTx(token, false, tokens, minWei, deadline) };
}

/** the router pulls sold coins through Permit2: first the coin approves Permit2, once */
export function permit2TokenApprovalTx(token: Address): TxRequest {
	return {
		to: token,
		data: encodeFunctionData({
			abi: erc20Approve,
			functionName: 'approve',
			args: [PERMIT2, maxUint256]
		})
	};
}

/** then Permit2 lets the router move the coin; `expiration` is a unix time in seconds */
export function permit2RouterApprovalTx(token: Address, expiration: number): TxRequest {
	return {
		to: PERMIT2,
		data: encodeFunctionData({
			abi: permit2Abi,
			functionName: 'approve',
			args: [token, UNIVERSAL_ROUTER, maxUint160, expiration]
		})
	};
}

/** the Pons hook's pool fee accounting: what is pending, the sweep, and its event */
export const ponsHookAbi = [
	{
		type: 'event',
		name: 'PoolFeesSwept',
		inputs: [
			{ name: 'poolId', type: 'bytes32', indexed: true },
			{ name: 'protocolAmount', type: 'uint256', indexed: false },
			{ name: 'buybackAmount', type: 'uint256', indexed: false },
			{ name: 'creatorAmount', type: 'uint256', indexed: false },
			{ name: 'tokensLocked', type: 'uint256', indexed: false }
		]
	},
	{
		type: 'function',
		name: 'sweepPoolFees',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'poolId', type: 'bytes32' },
			{ name: 'minConversionQuoteOut', type: 'uint256' },
			{ name: 'minBuybackTokensOut', type: 'uint256' }
		],
		outputs: []
	},
	{
		type: 'function',
		name: 'pendingFees',
		stateMutability: 'view',
		inputs: [
			{ name: '', type: 'bytes32' },
			{ name: 'currency', type: 'address' }
		],
		outputs: [{ type: 'uint256' }]
	}
] as const;
