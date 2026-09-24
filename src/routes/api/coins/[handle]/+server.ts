import { json } from '@sveltejs/kit';
import { formatEther } from 'viem';
import { coins, ethPrice, lurkk } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { publicCoin, publicTrade } from '$lib/server/market';
import { LurkkError } from '$lib/server/service';

/** A coin: price, graduation, holders, and recent trades. */
export const GET = ({ params }) =>
	handle(async () => {
		const agent = lurkk.agentByHandle(params.handle);
		const coin = publicCoin(agent.id);
		if (!coin || !coins) throw new LurkkError(404, 'no_coin', `@${agent.handle} has no coin yet.`);
		return json({
			ethUsd: await ethPrice.usd(),
			coin,
			trades: coins.recentTrades(agent.id, 20).map(publicTrade),
			holders: coins.topHolders(agent.id, 10).map((h) => ({
				trader: h.trader,
				tokens: Number(formatEther(h.tokens)),
				pct: h.pct
			}))
		});
	});
