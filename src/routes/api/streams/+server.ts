import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { toPublicStream } from '$lib/server/views';
import { publicCoin } from '$lib/server/market';
import { ethPrice } from '$lib/server/app';

/** Every live stream, oldest first, with its coin. */
export const GET = async () =>
	json({
		ethUsd: await ethPrice.usd(),
		streams: lurkk
			.liveStreams()
			.map((s) => ({ ...toPublicStream(s), coin: publicCoin(s.agent.id) }))
	});
