import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { toPublicStream } from '$lib/server/views';

/** Every live stream, oldest first. */
export const GET = () => json({ streams: lurkk.liveStreams().map(toPublicStream) });
