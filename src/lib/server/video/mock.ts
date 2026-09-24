// Free stand-in for the video model. Renders a short looping clip with ffmpeg:
// the agent's picture with a slow drift, tinted by the prompt so scene changes are visible.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VideoProvider, VideoSource } from './provider.ts';

const run = promisify(execFile);

export class MockVideo implements VideoProvider {
	readonly name = 'mock';

	/**
	 * @param mediaDir where clips are written; served at `/media/…`
	 * @param staticDir where `/img/…` avatar paths resolve on disk
	 */
	private mediaDir: string;
	private staticDir: string;
	constructor(mediaDir: string, staticDir: string) {
		this.mediaDir = mediaDir;
		this.staticDir = staticDir;
	}

	async render(
		{ streamId, avatarUrl }: { streamId: string; avatarUrl: string | null },
		prompt: string
	): Promise<VideoSource> {
		const hash = createHash('sha1').update(`${avatarUrl}|${prompt}`).digest('hex');
		const dir = join(this.mediaDir, streamId);
		const file = join(dir, `${hash.slice(0, 16)}.mp4`);
		const url = `/media/${streamId}/${hash.slice(0, 16)}.mp4`;
		if (existsSync(file)) return { kind: 'file', url };
		mkdirSync(dir, { recursive: true });

		// a hue from the prompt, so each scene looks different
		const hue = parseInt(hash.slice(0, 4), 16) % 360;
		const image = this.localImage(avatarUrl);
		const drift =
			"zoompan=z=1.12:x='iw/2-(iw/zoom/2)+sin(on/90*PI)*18':y='ih/2-(ih/zoom/2)+cos(on/90*PI)*12':d=1:s=480x854:fps=30";
		const input = image
			? ['-loop', '1', '-framerate', '30', '-i', image]
			: [
					'-f',
					'lavfi',
					'-i',
					'gradients=s=480x854:speed=0.015:c0=0x2a1f4d:c1=0x0e3b43:c2=0x3d1030'
				];
		const scale = image ? 'scale=540:960:force_original_aspect_ratio=increase,crop=540:960,' : '';
		await run('ffmpeg', [
			'-y',
			'-loglevel',
			'error',
			...input,
			'-vf',
			`${scale}${image ? drift + ',' : ''}hue=h=${hue}:s=1.1,format=yuv420p`,
			'-t',
			'6',
			'-an',
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-crf',
			'28',
			'-movflags',
			'+faststart',
			file
		]);
		return { kind: 'file', url };
	}

	async stop() {
		// nothing runs between renders
	}

	/** a path or URL ffmpeg can read, or null for a plain gradient */
	private localImage(avatarUrl: string | null): string | null {
		if (!avatarUrl) return null;
		if (/^https?:\/\//.test(avatarUrl)) return avatarUrl;
		const path = join(this.staticDir, avatarUrl);
		return existsSync(path) ? path : null;
	}
}
