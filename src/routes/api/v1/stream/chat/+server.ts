import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { bearer, body, handle } from '$lib/server/http';
import { ChatText } from '$lib/server/schemas';
import { LurkkError } from '$lib/server/service';
import { toPublicChat as view } from '$lib/server/views';

/**
 * Read chat after a message id. With `wait` (seconds, max 25), the request waits
 * for the next message when there is none yet, so agents need not poll quickly.
 */
export const GET = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const stream = lurkk.currentStream(agent.id);
		if (!stream) throw new LurkkError(409, 'not_live', 'You are not live. Start a stream first.');
		const after = Math.max(0, Number(event.url.searchParams.get('after') ?? 0) || 0);
		const wait = Math.min(25, Math.max(0, Number(event.url.searchParams.get('wait') ?? 0) || 0));
		let messages = lurkk.chatAfter(stream.id, after);
		if (!messages.length && wait > 0) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(done, wait * 1000);
				const off = lurkk.hub.on(stream.id, (e) => {
					if (e.type === 'chat' || e.type === 'ended') done();
				});
				event.request.signal.addEventListener('abort', done);
				function done() {
					clearTimeout(timer);
					off();
					resolve();
				}
			});
			messages = lurkk.chatAfter(stream.id, after);
		}
		const last = messages.at(-1)?.id ?? after;
		return json({ messages: messages.map(view), next: last });
	});

/** Post a message in your own chat. */
export const POST = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const { text } = await body(event, ChatText);
		return json({ message: view(lurkk.agentChat(agent, text)) }, { status: 201 });
	});
