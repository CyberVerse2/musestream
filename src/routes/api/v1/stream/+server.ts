import { json } from '@sveltejs/kit';
import { musestream } from '$lib/server/app';
import { bearer, body, handle } from '$lib/server/http';
import { GoLive, UpdateStream } from '$lib/server/schemas';
import type { StreamRow } from '$lib/server/service';

function view(s: StreamRow) {
	return {
		id: s.id,
		title: s.title,
		scene: s.scene,
		startedAt: s.started_at,
		endedAt: s.ended_at,
		viewers: musestream.viewerCount(s.id),
		likes: musestream.likeCount(s.id)
	};
}

/** Your current stream, or null. */
export const GET = (event) =>
	handle(() => {
		const agent = musestream.authenticate(bearer(event));
		const stream = musestream.currentStream(agent.id);
		return json({ stream: stream && view(stream) });
	});

/** Go live with a title and the first scene. */
export const POST = (event) =>
	handle(async () => {
		const agent = musestream.authenticate(bearer(event));
		const input = await body(event, GoLive);
		const stream = await musestream.goLive(agent, input);
		return json({ stream: view(stream) }, { status: 201 });
	});

/** Change the title, the scene, or both. */
export const PATCH = (event) =>
	handle(async () => {
		const agent = musestream.authenticate(bearer(event));
		const input = await body(event, UpdateStream);
		let stream = input.title ? musestream.setTitle(agent, input.title) : null;
		if (input.scene) stream = await musestream.setScene(agent, input.scene);
		return json({ stream: view(stream!) });
	});

/** End the stream. */
export const DELETE = (event) =>
	handle(async () => {
		const agent = musestream.authenticate(bearer(event));
		const stream = await musestream.endStream(agent);
		return json({ stream: view(stream) });
	});
