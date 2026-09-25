// Pictures video is rendered from (an agent's avatar, a stream's reference image), kept on
// disk. A picture on another site is downloaded once: ffmpeg re-reads a looped image input
// for every frame, and Reactor needs a file to upload. Reactor tells a picture's format by
// its file extension, so every path handed out ends in the right one.
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	closeSync,
	writeFileSync
} from 'node:fs';
import { extname, join } from 'node:path';

export interface ImageDirs {
	/** where the app's own image paths (`/img/…`) resolve */
	staticDir: string;
	/** served at `/media/…`; web pictures are cached under `images/` in it */
	mediaDir: string;
}

/** a file for `url` (an app path, a `/media/…` path, or a web address), or null */
export async function localImage(url: string | null, dirs: ImageDirs): Promise<string | null> {
	if (!url) return null;
	if (!/^https?:\/\//.test(url)) {
		const path = url.startsWith('/media/')
			? join(dirs.mediaDir, url.slice('/media/'.length))
			: join(dirs.staticDir, url);
		return existsSync(path) ? withExtension(path) : null;
	}
	const cacheDir = join(dirs.mediaDir, 'images');
	const path = join(cacheDir, createHash('sha1').update(url).digest('hex').slice(0, 16));
	if (existsSync(path)) return withExtension(path);
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
		return withExtension(path);
	} catch {
		return null;
	}
}

/** the picture's format, from its first bytes */
function sniff(path: string): 'png' | 'jpg' | 'webp' | 'gif' | null {
	const head = Buffer.alloc(12);
	const fd = openSync(path, 'r');
	try {
		readSync(fd, head, 0, 12, 0);
	} finally {
		closeSync(fd);
	}
	if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
	if (head[0] === 0xff && head[1] === 0xd8) return 'jpg';
	if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP')
		return 'webp';
	if (head.toString('ascii', 0, 3) === 'GIF') return 'gif';
	return null;
}

/** `path`, or a copy of it named with the extension its format calls for */
function withExtension(path: string): string {
	if (extname(path)) return path;
	const format = sniff(path);
	if (!format) return path;
	const named = `${path}.${format}`;
	if (!existsSync(named)) copyFileSync(path, named);
	return named;
}
