import { SUPPLY, GRAD_MC } from '../data';
import { clamp } from '../format';
import { seedToken } from '../simulation/fixtures';
import type { TokenState } from '$shared/trading';
export const market = $state({ tokens: {} as Record<string, TokenState> });

/** give an agent a coin the first time the app sees it */
export function ensureToken(id: string) {
	market.tokens[id] ??= seedToken(id);
}

export function tokenOf(id: string): TokenState {
	const tok = market.tokens[id];
	if (!tok) throw new Error(`Unknown token: ${id}`);
	return tok;
}

export function deltaOf(tok: TokenState): number {
	const old = tok.hist.length > 60 ? tok.hist[tok.hist.length - 61]! : tok.hist[0]!;
	return ((tok.price - old) / old) * 100;
}

export function gradPct(tok: TokenState): number {
	return clamp(((tok.price * SUPPLY) / GRAD_MC) * 100, 2, 100);
}
