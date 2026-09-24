import { applyBuy, applySell, type Holding } from '$shared/trading';
import { tokenOf } from './market.svelte';
import { pushChat } from './chat.svelte';
import { fmtTok } from '../format';

export const holdings = $state<Record<string, Holding>>({
	kira: { amt: 4.2e6, cost: 0.0000412 },
	nova: { amt: 1.1e6, cost: 0.0000698 }
});

export interface Activity {
	id: number;
	kind: 'buy' | 'sell' | 'gift';
	agent: string;
	usd: number;
	tokens: number;
	at: number;
}

export const wallet = $state({
	/** demo buying power, in USD */
	cash: 1000,
	address: '7xKpQm3fVh2nW9rLd4sTc8yBjE5gUa1oZ6iNvR3fQ',
	activity: [] as Activity[]
});

let sequence = 0;
function log(entry: Omit<Activity, 'id' | 'at'>) {
	wallet.activity.unshift({ ...entry, id: ++sequence, at: Date.now() });
	if (wallet.activity.length > 30) wallet.activity.length = 30;
}

export function buy(id: string, usd: number) {
	if (usd > wallet.cash) return null;
	const result = applyBuy(holdings[id], usd, tokenOf(id).price);
	holdings[id] = result.holding;
	wallet.cash -= usd;
	log({ kind: 'buy', agent: id, usd, tokens: result.quote.tokens });
	pushChat(id, `bought ${fmtTok(result.quote.tokens)} ${id.toUpperCase()} 🟢`, 'chat-you', 'you');
	return result.quote;
}

export function sell(id: string, fraction: number) {
	const holding = holdings[id];
	if (!holding) return null;
	const result = applySell(holding, fraction, tokenOf(id).price);
	if (result.holding) holdings[id] = result.holding;
	else delete holdings[id];
	wallet.cash += result.usd;
	log({ kind: 'sell', agent: id, usd: result.usd, tokens: result.tokens });
	return result;
}

export function logGift(id: string, usd: number) {
	wallet.cash = Math.max(0, wallet.cash - usd);
	log({ kind: 'gift', agent: id, usd, tokens: 0 });
}
