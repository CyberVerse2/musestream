// Pictures video is rendered from (an agent's avatar, a stream's reference image), kept on
// disk. A picture on another site is downloaded once: ffmpeg re-reads a looped image input
// for every frame, and Reactor needs a file to upload.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
		return existsSync(path) ? path : null;
	}
	const cacheDir = join(dirs.mediaDir, 'images');
	const path = join(cacheDir, createHash('sha1').update(url).digest('hex').slice(0, 16));
	if (existsSync(path)) return path;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return null;
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
		return path;
	} catch {
		return null;
	}
}
