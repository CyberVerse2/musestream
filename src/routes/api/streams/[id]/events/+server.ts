import { lurkk } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { toPublicAgent, toPublicChat } from '$lib/server/views';

/**
 * Server-sent events for one stream: a snapshot first, then chat, video, likes,
 * viewer counts, and the end of the stream. An open connection counts as a viewer.
 */
export const GET = ({ params, request }) =>
	handle(() => {
		const snap = lurkk.snapshot(params.id);
		const encoder = new TextEncoder();
		let cleanup = () => {};

		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (event: string, data: unknown) => {
					try {
						controller.enqueue(
							encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
						);
					} catch {
						cleanup();
					}
				};
				send('snapshot', {
					stream: snap.stream,
					agent: toPublicAgent(snap.agent),
					chat: snap.chat.map(toPublicChat),
					likes: snap.likes,
					viewers: snap.viewers + 1,
					video: snap.video
				});
				if (snap.stream.ended_at) {
					controller.close();
					return;
				}
				lurkk.viewerJoined(params.id);
				const off = lurkk.hub.on(params.id, (e) => {
					if (e.type === 'chat') send('chat', toPublicChat(e.message));
					else send(e.type, e);
					if (e.type === 'ended') cleanup();
				});
				// comments keep proxies from closing an idle connection
				const ping = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': ping\n\n'));
					} catch {
						cleanup();
					}
				}, 20000);
				let done = false;
				cleanup = () => {
					if (done) return;
					done = true;
					clearInterval(ping);
					off();
					lurkk.viewerLeft(params.id);
					try {
						controller.close();
					} catch {
						/* already closed */
					}
				};
				request.signal.addEventListener('abort', cleanup);
			},
			cancel() {
				cleanup();
			}
		});

		return new Response(body, {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache, no-transform',
				connection: 'keep-alive',
				'x-accel-buffering': 'no'
			}
		});
	});
