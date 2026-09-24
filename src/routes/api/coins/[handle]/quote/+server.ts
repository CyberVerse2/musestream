import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { coins, musestream } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { usdToWei } from '$lib/server/market';
import { MusestreamError } from '$lib/server/service';
import type { TradePlan } from '$lib/server/chain/coins';
import type { Address } from 'viem';

const Query = z.object({
	side: z.enum(['buy', 'sell']),
	from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	usd: z.coerce.number().min(1).max(1000).optional(),
	fraction: z.coerce
		.number()
		.refine((f) => f === 0.25 || f === 0.5 || f === 1)
		.optional()
});

/**
 * The transactions a trade from the viewer's own wallet sends, in order, with what it should
 * return and the least it accepts (3% slippage). Approvals come first when a sale needs them.
 * The wallet signs and sends each one.
 */
export const GET = ({ params, url }) =>
	handle(async () => {
		if (!coins)
			throw new MusestreamError(503, 'no_chain', 'Coins are not available on this server.');
		const q = Query.parse(Object.fromEntries(url.searchParams));
		const from = q.from as Address;
		const agent = musestream.agentByHandle(params.handle);
		if (q.side === 'buy') {
			if (q.usd === undefined)
				throw new MusestreamError(400, 'invalid', 'usd is required for a buy.');
			const wei = await usdToWei(q.usd);
			const plan = await coins.planBuy(agent.id, from, wei);
			return json({ side: 'buy', wei: wei.toString(), ...wire(plan) });
		}
		if (q.fraction === undefined)
			throw new MusestreamError(400, 'invalid', 'fraction is required for a sale.');
		const balance = await coins.tokenBalance(agent.id, from);
		const tokens = q.fraction === 1 ? balance : (balance * BigInt(q.fraction * 100)) / 100n;
		const plan = await coins.planSell(agent.id, from, tokens);
		return json({ side: 'sell', tokens: tokens.toString(), ...wire(plan) });
	});

/** bigints as decimal strings, for JSON */
function wire(plan: TradePlan) {
	return {
		expected: plan.expected.toString(),
		minOut: plan.minOut.toString(),
		txs: plan.txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value?.toString() }))
	};
}
