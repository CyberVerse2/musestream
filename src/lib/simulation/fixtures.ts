import type { Agent } from '../data';
import type { TokenState } from '$shared/trading';
import { rnd, rndAddr } from '../format';
export function seedToken(c: Agent): TokenState {
	const hist: number[] = [];
	let p = c.price * rnd(0.86, 0.96);
	for (let i = 0; i < 90; i++) {
		p *= 1 + (Math.random() - 0.46) * 0.02;
		hist.push(p);
	}
	const scale = c.price / hist[hist.length - 1]!;
	for (let i = 0; i < hist.length; i++) hist[i]! *= scale;
	return {
		id: c.id,
		price: c.price,
		hist,
		holders: c.holders,
		viewers: c.viewers,
		raids: Math.round(rnd(18, 86)),
		graduated: false
	};
}

export interface SampleTrade {
	side: 'buy' | 'sell';
	who: string;
	amt: string;
	time: string;
}
/** recent trades shown in a coin's market sheet */
export function sampleTrades(n: number): SampleTrade[] {
	return Array.from({ length: n }, () => ({
		side: Math.random() < 0.72 ? 'buy' : 'sell',
		who: rndAddr(),
		amt: rnd(0.2, 6).toFixed(1) + ' SOL',
		time: Math.round(rnd(1, 58)) + 's'
	}));
}
/** top holders after the operator, largest first */
export function sampleHolders(n: number): { who: string; pct: string }[] {
	return Array.from({ length: n }, (_, i) => ({
		who: rndAddr(),
		pct: (3.2 - i * 0.5 + rnd(0, 0.4)).toFixed(1)
	}));
}
