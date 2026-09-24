// Pons V2 bonding-curve math, mirrored from PonsV2BondingCurve.buy and .sell and
// PonsV2BondingCurveMath.getAmountOut. Integer math, same rounding as the contract.
// Amounts of the quote side are in the coin's pair (ETH or META).

const BPS = 10_000n;

/** constant-product output for `amountIn`, with a fee taken from the input */
export function amountOut(
	amountIn: bigint,
	reserveIn: bigint,
	reserveOut: bigint,
	feeBps: bigint
): bigint {
	if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
	const inWithFee = amountIn * (BPS - feeBps);
	return (inWithFee * reserveOut) / (reserveIn * BPS + inWithFee);
}

/**
 * Tokens a buy of `quoteIn` returns: the fee and creator tax come off the input first. The
 * curve also charges a decaying snipe tax in the first moments after launch; this ignores it,
 * and the buy's slippage limit refuses a fill that tax would spoil.
 */
export function buyQuote(
	quoteIn: bigint,
	reserves: { quote: bigint; tokens: bigint },
	feeBps: bigint,
	creatorTaxBps = 0n
): bigint {
	const net = quoteIn - (quoteIn * feeBps) / BPS - (quoteIn * creatorTaxBps) / BPS;
	return amountOut(net, reserves.quote, reserves.tokens, 0n);
}

/** the pair a sale of `tokensIn` returns: gross output, then the fee and creator tax come off */
export function sellQuote(
	tokensIn: bigint,
	reserves: { quote: bigint; tokens: bigint },
	feeBps: bigint,
	creatorTaxBps = 0n
): bigint {
	const gross = amountOut(tokensIn, reserves.tokens, reserves.quote, 0n);
	return gross - (gross * feeBps) / BPS - (gross * creatorTaxBps) / BPS;
}

/** the least output to accept, `slippageBps` below the quote */
export function withSlippage(quote: bigint, slippageBps: bigint): bigint {
	return (quote * (BPS - slippageBps)) / BPS;
}
