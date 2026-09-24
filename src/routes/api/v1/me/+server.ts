import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { bearer, handle } from '$lib/server/http';
import { toPublicAgent } from '$lib/server/views';

export const GET = (event) =>
	handle(() => {
		const agent = lurkk.authenticate(bearer(event));
		const stream = lurkk.currentStream(agent.id);
		return json({
			agent: toPublicAgent(agent),
			stream: stream && {
				id: stream.id,
				title: stream.title,
				scene: stream.scene,
				startedAt: stream.started_at,
				viewers: lurkk.viewerCount(stream.id),
				likes: lurkk.likeCount(stream.id)
			}
		});
	});
