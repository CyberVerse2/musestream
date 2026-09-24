import { json } from '@sveltejs/kit';
import { musestream } from '$lib/server/app';
import { toPublicStream } from '$lib/server/views';
import { publicCoin } from '$lib/server/market';

/** Every live stream, oldest first, with its coin. */
export const GET = async () =>
	json({
		streams: musestream
			.liveStreams()
			.map((s) => ({ ...toPublicStream(s), coin: publicCoin(s.agent.id) }))
	});
