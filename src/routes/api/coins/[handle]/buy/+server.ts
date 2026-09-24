import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { formatEther } from 'viem';
import { coins, musestream } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { publicCoin } from '$lib/server/market';
import { usdgFromCents } from '$shared/usdg';
import { viewerWallet } from '$lib/server/viewer';

const Buy = z.object({ usd: z.number().min(1).max(1000) });
const perViewer = limiter(10, 60 * 1000);

/** Buy the agent's coin for a dollar amount, paid in USDG. */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { usd } = await body(event, Buy);
		const agent = musestream.agentByHandle(event.params.handle);
		const wallet = await viewerWallet(event.locals.viewer);
		const { hash, tokens } = await coins!.buy(
			wallet,
			agent.id,
			usdgFromCents(Math.round(usd * 100))
		);
		return json({
			tx: hash,
			usd,
			tokens: formatEther(tokens),
			coin: publicCoin(agent.id)
		});
	});
