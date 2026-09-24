import { error } from '@sveltejs/kit';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_DIR } from '$lib/server/app';

const TYPES: Record<string, string> = {
	mp4: 'video/mp4',
	m3u8: 'application/vnd.apple.mpegurl',
	ts: 'video/mp2t'
};

/** Serves clips and live playlists, with byte ranges (Safari needs them to play video). */
export const GET = ({ params, request }) => {
	const file = resolve(MEDIA_DIR, params.path);
	const type = TYPES[file.split('.').pop() ?? ''];
	if (!file.startsWith(MEDIA_DIR + sep) || !type) error(404);
	let size: number;
	try {
		size = statSync(file).size;
	} catch {
		error(404);
	}
	const headers: Record<string, string> = {
		'content-type': type,
		'accept-ranges': 'bytes',
		// clips and segments never change once written; a live playlist changes every few seconds
		'cache-control': file.endsWith('.m3u8') ? 'no-cache' : 'public, max-age=31536000, immutable'
	};
	const range = request.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
	if (range) {
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start > end || start >= size) {
			return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
		}
		const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
		return new Response(stream, {
			status: 206,
			headers: {
				...headers,
				'content-range': `bytes ${start}-${end}/${size}`,
				'content-length': String(end - start + 1)
			}
		});
	}
	const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
	return new Response(stream, { headers: { ...headers, 'content-length': String(size) } });
};
