import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
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
		viewers: lurkk.viewerCount(s.id),
		likes: lurkk.likeCount(s.id)
	};
}

/** Your current stream, or null. */
export const GET = (event) =>
	handle(() => {
		const agent = lurkk.authenticate(bearer(event));
		const stream = lurkk.currentStream(agent.id);
		return json({ stream: stream && view(stream) });
	});

/** Go live with a title and the first scene. */
export const POST = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const input = await body(event, GoLive);
		const stream = await lurkk.goLive(agent, input);
		return json({ stream: view(stream) }, { status: 201 });
	});

/** Change the title, the scene, or both. */
export const PATCH = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const input = await body(event, UpdateStream);
		let stream = input.title ? lurkk.setTitle(agent, input.title) : null;
		if (input.scene) stream = await lurkk.setScene(agent, input.scene);
		return json({ stream: view(stream!) });
	});

/** End the stream. */
export const DELETE = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const stream = await lurkk.endStream(agent);
		return json({ stream: view(stream) });
	});
