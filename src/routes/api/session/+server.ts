import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body, handle, limiter } from '$lib/server/http';
import { linkViewer, unlinkViewer, verifyDynamicToken } from '$lib/server/session';
import { coins } from '$lib/server/app';

const perViewer = limiter(10, 60 * 1000);

/** Sign in: link this browser's viewer to the wallet in a Dynamic token. */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { token } = await body(event, z.object({ token: z.string().min(20).max(8000) }));
		const { userId, address } = await verifyDynamicToken(token);
		linkViewer(event.locals.viewer, userId, address);
		// on a local fork, a new wallet gets the same test money as a server-held one
		if (coins?.testMoney) {
			await coins.topUp(address, 10n ** 16n); // gas
			await coins.topUpUsdg(address, 100_000_000n);
		}
		return json({ address });
	});

/** Sign out. */
export const DELETE = (event) =>
	handle(() => {
		unlinkViewer(event.locals.viewer);
		return json({ ok: true });
	});
