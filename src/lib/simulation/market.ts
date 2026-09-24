import { AGENTS, SUPPLY, GRAD_MC, CHAT_GENERIC, CHAT_BY_CAT, CHAT_NAMES, agentById } from '../data';
import { pick, rnd, rndAddr, rndChatName } from '../format';
import { pushChat } from '../state/chat.svelte';
import { live } from '../state/live.svelte';
import { market, tokenOf } from '../state/market.svelte';
import { showToast } from '../state/notifications.svelte';
export function startMarket() {
	const ticks = setInterval(tick, 1000);
	return () => {
		clearInterval(ticks);
	};
}
function tick(): void {
	for (const id of Object.keys(market.tokens)) {
		const tok = tokenOf(id);
		if (agentById(id).graduatesInDemo && !tok.graduated) {
			tok.price *= 1.0034 * (1 + rnd(-0.0015, 0.0015));
			if (tok.price >= GRAD_MC / SUPPLY) {
				tok.price = GRAD_MC / SUPPLY;
				tok.graduated = true;
				showToast('🎓', `$${id.toUpperCase()} graduated. It now trades on the open market.`);
				pushChat(id, `$${id.toUpperCase()} graduated to the open market 🎓`, 'chat-buy');
			}
		} else {
			tok.price *= 1 + rnd(-0.0075, 0.0085);
		}
		tok.hist.push(tok.price);
		if (tok.hist.length > 140) tok.hist.shift();
		if (Math.random() < 0.25) tok.holders += Math.round(rnd(0, 4));
		tok.viewers = Math.max(150, tok.viewers + Math.round(rnd(-160, 190)));
	}

	// ambient chat
	for (const c of AGENTS) {
		if (Math.random() < 0.5) {
			const buyEv = Math.random() < 0.16;
			if (buyEv) {
				pushChat(
					c.id,
					`${rndAddr()} bought ${rnd(0.4, 5).toFixed(1)} SOL of $${c.id.toUpperCase()}`,
					'chat-buy'
				);
			} else {
				const pool = Math.random() < 0.5 ? CHAT_GENERIC : (CHAT_BY_CAT[c.cat] ?? CHAT_GENERIC);
				pushChat(c.id, pick(pool), '', rndChatName(CHAT_NAMES));
			}
		}
	}

	// likes drift with the size of the room
	for (const a of AGENTS) {
		live[a.id]!.likes += Math.round(rnd(0, tokenOf(a.id).viewers / 900));
	}
}
