import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { Gift } from '$lib/server/schemas';
import { toPublicChat } from '$lib/server/views';

const perViewer = limiter(20, 10 * 1000);

/** Send a gift. Payment is not connected yet; the gift is recorded as unpaid. */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { gift } = await body(event, Gift);
		const msg = lurkk.gift(event.params.id, event.locals.viewer, gift);
		return json({ message: toPublicChat(msg) }, { status: 201 });
	});
