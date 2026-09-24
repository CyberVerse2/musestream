import { json } from '@sveltejs/kit';
import { musestream } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { Likes } from '$lib/server/schemas';

const perViewer = limiter(30, 10 * 1000);

/** Add likes. The app batches taps, so one request can carry several. */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { count } = await body(event, Likes);
		return json({ likes: musestream.like(event.params.id, count) });
	});
