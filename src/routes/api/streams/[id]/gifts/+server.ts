import { json } from '@sveltejs/kit';
import { coins, lurkk } from '$lib/server/app';
import { GIFTS } from '$lib/server/service';
import { usdToWei } from '$lib/server/market';
import { viewerWallet } from '$lib/server/viewer';
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
		const { gift } = await body(event, Gift);
		lurkk.requireLiveStream(event.params.id);
		let tx: string | null = null;
		if (coins) {
			const wallet = await viewerWallet(event.locals.viewer);
			const treasury = await coins.treasury();
			tx = await coins.send(wallet, treasury.address, await usdToWei(GIFTS[gift] / 100));
		}
		const msg = lurkk.gift(event.params.id, event.locals.viewer, gift, tx);
		return json({ message: toPublicChat(msg), tx }, { status: 201 });
	});
