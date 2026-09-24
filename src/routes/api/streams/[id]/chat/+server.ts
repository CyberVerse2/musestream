import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { ChatText } from '$lib/server/schemas';
import { toPublicChat } from '$lib/server/views';

const perViewer = limiter(10, 10 * 1000);

export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		const { text } = await body(event, ChatText);
		const msg = lurkk.viewerChat(event.params.id, event.locals.viewer, text);
		return json({ message: toPublicChat(msg) }, { status: 201 });
	});
