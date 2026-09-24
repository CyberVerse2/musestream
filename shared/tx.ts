// Transactions a viewer's own wallet sends. The browser (Dynamic wallets) and the fork test
// both build them here, so what the test checks is what users sign.
import { encodeFunctionData, type Address, type Hex } from 'viem';

export interface TxRequest {
	to: Address;
	data?: Hex;
	value?: bigint;
}

const curveTrade = [
	{
		type: 'function',
		name: 'buy',
		stateMutability: 'payable',
		inputs: [
			{ name: 'quoteIn', type: 'uint256' },
			{ name: 'minTokensOut', type: 'uint256' },
			{ name: 'recipient', type: 'address' }
		],
		outputs: [{ name: 'tokensOut', type: 'uint256' }]
	},
	{
		type: 'function',
		name: 'sell',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'tokensIn', type: 'uint256' },
			{ name: 'minQuoteOut', type: 'uint256' },
			{ name: 'recipient', type: 'address' }
		],
		outputs: [{ name: 'quoteOut', type: 'uint256' }]
	}
] as const;

const erc20 = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }]
	},
	{
		type: 'function',
		name: 'transfer',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }]
	}
] as const;

/** buy on a native-ETH curve: send `wei`, receive at least `minTokens` */
export function buyTx(
	curve: Address,
	wei: bigint,
	minTokens: bigint,
	recipient: Address
): TxRequest {
	return {
		to: curve,
		value: wei,
		data: encodeFunctionData({
			abi: curveTrade,
			functionName: 'buy',
			args: [wei, minTokens, recipient]
		})
	};
}

/** let the curve take `tokens` from the seller; sent before `sellTx` */
export function approveTx(token: Address, curve: Address, tokens: bigint): TxRequest {
	return {
		to: token,
		data: encodeFunctionData({ abi: erc20, functionName: 'approve', args: [curve, tokens] })
	};
}

/** sell `tokens`, receive at least `minWei` */
export function sellTx(
	curve: Address,
	tokens: bigint,
	minWei: bigint,
	recipient: Address
): TxRequest {
	return {
		to: curve,
		data: encodeFunctionData({
			abi: curveTrade,
			functionName: 'sell',
			args: [tokens, minWei, recipient]
		})
	};
}

/** send `amount` of an ERC-20 token, e.g. a USDG gift to the treasury */
export function transferTx(token: Address, to: Address, amount: bigint): TxRequest {
	return {
		to: token,
		data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [to, amount] })
	};
}
