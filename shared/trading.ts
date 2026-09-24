export const SUPPLY = 1e9;
export const FEE = 0.01;
export const GRAD_MC = 100_000;

export interface Holding {
	amt: number;
	cost: number;
}

function positive(value: number, name: string) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

export function quoteBuy(usd: number, price: number) {
	positive(usd, 'Amount');
	positive(price, 'Price');
	return { tokens: (usd * (1 - FEE)) / price, usd, fee: usd * FEE };
}

export function applyBuy(holding: Holding | undefined, usd: number, price: number) {
	const quote = quoteBuy(usd, price);
	const previous = holding ?? { amt: 0, cost: 0 };
	const amt = previous.amt + quote.tokens;
	return { quote, holding: { amt, cost: (previous.amt * previous.cost + usd) / amt } };
}

export function applySell(holding: Holding, fraction: number, price: number) {
	positive(fraction, 'Fraction');
	positive(price, 'Price');
	if (fraction > 1) throw new RangeError('Fraction cannot exceed one');
	const tokens = holding.amt * fraction;
	return {
		tokens,
		usd: tokens * price * (1 - FEE),
		holding: fraction === 1 ? null : { ...holding, amt: holding.amt - tokens }
	};
}

export interface TokenState {
	id: string;
	price: number;
	hist: number[];
	holders: number;
	viewers: number;
	raids: number;
	graduated: boolean;
}
