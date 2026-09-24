import { json } from '@sveltejs/kit';
import { coins } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { MusestreamError } from '$lib/server/service';
import { linkedAddress } from '$lib/server/session';

/**
 * After a trade from the viewer's own wallet: the transaction that swaps its ETH above a gas
 * reserve back into USDG, so the balance stays in dollars. `txs` is empty when there is too
 * little ETH to bother.
 */
export const GET = (event) =>
	handle(async () => {
		if (!coins)
			throw new MusestreamError(503, 'no_chain', 'Coins are not available on this server.');
		const from = linkedAddress(event.locals.viewer);
		if (!from) throw new MusestreamError(401, 'sign_in', 'Sign in first.');
		const plan = await coins.planCashOut(from);
		return json({
			txs: (plan?.txs ?? []).map((tx) => ({
				to: tx.to,
				data: tx.data,
				value: tx.value?.toString()
			}))
		});
	});
