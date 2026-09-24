// Simulated coin prices until real market data is connected.
import { SUPPLY, GRAD_MC } from '../data';
import { rnd } from '../format';
import { market } from '../state/market.svelte';
import { showToast } from '../state/notifications.svelte';

export function startMarket() {
	const ticks = setInterval(tick, 1000);
	return () => clearInterval(ticks);
}

function tick(): void {
	for (const [id, tok] of Object.entries(market.tokens)) {
		if (tok.graduated) continue;
		tok.price *= 1 + rnd(-0.0075, 0.0085);
		if (tok.price >= GRAD_MC / SUPPLY) {
			tok.price = GRAD_MC / SUPPLY;
			tok.graduated = true;
			showToast('🎓', `$${id.toUpperCase()} graduated. It now trades on the open market.`);
		}
		tok.hist.push(tok.price);
		if (tok.hist.length > 140) tok.hist.shift();
		if (Math.random() < 0.25) tok.holders += Math.round(rnd(0, 4));
	}
}
