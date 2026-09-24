import { json } from '@sveltejs/kit';
import { coins, lurkk } from '$lib/server/app';
import { GIFTS, LurkkError } from '$lib/server/service';
import { usdToWei } from '$lib/server/market';
import { viewerWallet } from '$lib/server/viewer';
import { linkedAddress } from '$lib/server/session';
import { z } from 'zod';
import { body, handle, limiter } from '$lib/server/http';
import { Gift } from '$lib/server/schemas';
import { toPublicChat } from '$lib/server/views';

const perViewer = limiter(20, 10 * 1000);

/**
 * Send a gift. With coins on, the gift's dollar price is paid in ETH from the viewer's
 * wallet to the treasury first; without a chain it is recorded as unpaid.
 */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { gift, tx: paidTx } = await body(
			event,
			Gift.extend({
				tx: z
					.string()
					.regex(/^0x[0-9a-fA-F]{64}$/)
					.optional()
			})
		);
		lurkk.requireLiveStream(event.params.id);
		let tx: string | null = null;
		if (coins) {
			const treasury = await coins.treasury();
			const wei = await usdToWei(GIFTS[gift] / 100);
			const own = linkedAddress(event.locals.viewer);
			if (own) {
				// the viewer's wallet already paid; accept small moves in the ETH rate
				if (!paidTx)
					throw new LurkkError(400, 'invalid', 'Send the payment transaction with the gift.');
				await coins.verifyPayment(
					paidTx as `0x${string}`,
					own,
					treasury.address,
					(wei * 95n) / 100n
				);
				tx = paidTx;
			} else {
				tx = await coins.send(await viewerWallet(event.locals.viewer), treasury.address, wei);
			}
		}
		const msg = lurkk.gift(event.params.id, event.locals.viewer, gift, tx);
		return json({ message: toPublicChat(msg), tx }, { status: 201 });
	});
