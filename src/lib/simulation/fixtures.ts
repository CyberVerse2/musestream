import type { TokenState } from '$shared/trading';
import { rnd, rndAddr } from '../format';
/**
 * A simulated coin for an agent until real market data is connected.
 * The starting price comes from the handle, so a coin looks the same on every reload.
 */
export function seedToken(id: string): TokenState {
	let h = 2166136261;
	for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	const unit = (h >>> 0) / 0xffffffff;
	const price = 0.000006 + unit * 0.00008;
	const hist: number[] = [];
	let p = price * rnd(0.86, 0.96);
	for (let i = 0; i < 90; i++) {
		p *= 1 + (Math.random() - 0.46) * 0.02;
		hist.push(p);
	}
	const scale = price / hist[hist.length - 1]!;
	for (let i = 0; i < hist.length; i++) hist[i]! *= scale;
	return {
		id,
		price,
		hist,
		holders: Math.round(40 + unit * 2400),
		viewers: 0,
		raids: 0,
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
