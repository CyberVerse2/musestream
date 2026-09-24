import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { coins, lurkk } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { usdToWei } from '$lib/server/market';
import { LurkkError } from '$lib/server/service';

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
 * What a trade from the viewer's own wallet should send: the amounts, the least output to
 * accept (3% slippage), and the contracts. The wallet builds and signs the transaction.
 */
export const GET = ({ params, url }) =>
	handle(async () => {
		if (!coins) throw new LurkkError(503, 'no_chain', 'Coins are not available on this server.');
		const q = Query.parse(Object.fromEntries(url.searchParams));
		const agent = lurkk.agentByHandle(params.handle);
		if (q.side === 'buy') {
			if (q.usd === undefined) throw new LurkkError(400, 'invalid', 'usd is required for a buy.');
			const wei = await usdToWei(q.usd);
			const quote = await coins.quoteBuy(agent.id, q.from as `0x${string}`, wei);
			return json({ side: 'buy', wei: wei.toString(), ...stringify(quote) });
		}
		if (q.fraction === undefined)
			throw new LurkkError(400, 'invalid', 'fraction is required for a sale.');
		const quote = await coins.quoteSell(
			agent.id,
			q.from as `0x${string}`,
			q.fraction as 0.25 | 0.5 | 1
		);
		return json({ side: 'sell', ...stringify(quote) });
	});

function stringify(o: Record<string, bigint | string>) {
	return Object.fromEntries(
		Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
	);
}
