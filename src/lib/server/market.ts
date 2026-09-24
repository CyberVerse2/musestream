// Coin data as the app sees it, in ETH and, when the rate is known, US dollars.
import { formatEther, type Address } from 'viem';
import { coins, ethPrice, musestream } from './app.ts';
import type { TradeRow } from './chain/coins.ts';

export function publicCoin(agentId: string) {
	const view = coins?.view(agentId);
	if (!view) return null;
	const usd = ethPrice.peek();
	return {
		status: view.status,
		token: view.token,
		priceEth: view.priceEth,
		priceUsd: usd === null ? null : view.priceEth * usd,
		marketCapEth: view.marketCapEth,
		marketCapUsd: usd === null ? null : view.marketCapEth * usd,
		graduationPct: view.graduationPct,
		graduated: view.graduated,
		holders: view.holders,
		/** recent prices in ETH, oldest first, for sparklines */
		history: coins!.priceHistory(agentId, 60).map((p) => p.price)
	};
}
export type PublicCoin = NonNullable<ReturnType<typeof publicCoin>>;

export function publicTrade(t: TradeRow) {
	return {
		side: t.side,
		trader: t.trader,
		eth: Number(formatEther(BigInt(t.quote_wei))),
		tokens: Number(formatEther(BigInt(t.tokens))),
		at: t.at,
		tx: t.tx
	};
}

/** tell viewers of a live stream that its coin moved */
export function watchCoinEvents() {
	return musestream.hub.onGlobal((e) => {
		if (e.type !== 'coin') return;
		const stream = musestream.currentStream(e.agentId);
		const coin = publicCoin(e.agentId);
		if (stream && coin) musestream.hub.emit(stream.id, { type: 'coin', coin });
	});
}

export function isAddress(a: string): a is Address {
	return /^0x[0-9a-fA-F]{40}$/.test(a);
}
