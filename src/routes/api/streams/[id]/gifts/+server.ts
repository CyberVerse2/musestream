import { json } from '@sveltejs/kit';
import { coins, musestream } from '$lib/server/app';
import { GIFTS, MusestreamError } from '$lib/server/service';
import { viewerWallet } from '$lib/server/viewer';
import { linkedAddress } from '$lib/server/session';
import { z } from 'zod';
import { body, handle, limiter } from '$lib/server/http';
import { Gift } from '$lib/server/schemas';
import { toPublicChat } from '$lib/server/views';
import { usdgFromCents } from '$shared/usdg';

const perViewer = limiter(20, 10 * 1000);

/**
 * Send a gift. With coins on, the gift's dollar price is paid in USDG from the viewer's
 * wallet to the treasury first, and the agent is owed its share; without a chain it is
 * recorded as unpaid.
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
		musestream.requireLiveStream(event.params.id);
		let payment: { tx: string; amount: bigint } | null = null;
		if (coins) {
			const treasury = await coins.treasury();
			const amount = usdgFromCents(GIFTS[gift]);
			const own = linkedAddress(event.locals.viewer);
			if (own) {
				// the viewer's wallet already paid
				if (!paidTx)
					throw new MusestreamError(400, 'invalid', 'Send the payment transaction with the gift.');
				await coins.verifyUsdgPayment(paidTx as `0x${string}`, own, treasury.address, amount);
				payment = { tx: paidTx, amount };
			} else {
				const tx = await coins.sendUsdg(
					await viewerWallet(event.locals.viewer),
					treasury.address,
					amount
				);
				payment = { tx, amount };
			}
		}
		const msg = musestream.gift(event.params.id, event.locals.viewer, gift, payment);
		return json({ message: toPublicChat(msg), tx: payment?.tx ?? null }, { status: 201 });
	});
