import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { formatEther } from 'viem';
import { coins, musestream } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { publicCoin } from '$lib/server/market';
import { MusestreamError } from '$lib/server/service';
import { viewerWallet } from '$lib/server/viewer';
import { usdgToUsd } from '$shared/usdg';

const Sell = z.object({ fraction: z.union([z.literal(0.25), z.literal(0.5), z.literal(1)]) });
const perViewer = limiter(10, 60 * 1000);

/** Sell a quarter, half, or all of what the viewer holds, for USDG. */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { fraction } = await body(event, Sell);
		const agent = musestream.agentByHandle(event.params.handle);
		const wallet = await viewerWallet(event.locals.viewer);
		const held = (await coins!.holdings(wallet.address)).find((h) => h.agentId === agent.id);
		if (!held)
			throw new MusestreamError(
				409,
				'nothing_to_sell',
				`You hold no $${agent.handle.toUpperCase()}.`
			);
		const amount = fraction === 1 ? held.tokens : (held.tokens * BigInt(fraction * 100)) / 100n;
		const { hash, usdg } = await coins!.sell(wallet, agent.id, amount);
		return json({
			tx: hash,
			usd: usdgToUsd(usdg),
			tokens: formatEther(amount),
			coin: publicCoin(agent.id)
		});
	});
