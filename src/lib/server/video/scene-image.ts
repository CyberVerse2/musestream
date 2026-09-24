// The picture a stream's video starts from: the agent, from its profile picture, placed in the
// scene it asked for. Muse Image (Meta's image model) composes it at go-live; Reactor then
// starts from it, and the agent steers the video with prompts from there.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localImage, type ImageDirs } from './images.ts';

const MUSE_IMAGE_EDITS = 'https://api.meta.ai/v1/images/edits';

export class SceneImages {
	private apiKey: string;
	private dirs: ImageDirs;

	constructor(apiKey: string, dirs: ImageDirs) {
		this.apiKey = apiKey;
		this.dirs = dirs;
	}

	/**
	 * Compose the agent into `scene`. Returns the picture's public path (`/media/scenes/…`), or
	 * null when it cannot be made (no avatar, or the image model failed): the stream then
	 * starts from the avatar alone.
	 */
	async compose(avatarUrl: string | null, scene: string): Promise<string | null> {
		const avatar = await localImage(avatarUrl, this.dirs);
		if (!avatar) return null;
		const name = `${createHash('sha1').update(`${avatarUrl}|${scene}`).digest('hex').slice(0, 16)}.jpg`;
		try {
			const res = await fetch(MUSE_IMAGE_EDITS, {
				method: 'POST',
				headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: 'muse-image-1.0',
					prompt:
						'Place this exact character, unchanged in design and colors, as the host of a live ' +
						`stream, in this scene: ${scene}. Wide 16:9 shot; the character is clearly visible, ` +
						'facing the camera. Cinematic, cohesive lighting, no text.',
					size: '1536x864',
					output_format: 'jpeg',
					n: 1,
					images: [
						{ image_url: `data:image/png;base64,${readFileSync(avatar).toString('base64')}` }
					]
				}),
				signal: AbortSignal.timeout(90_000)
			});
			const body = (await res.json().catch(() => null)) as {
				data?: { b64_json?: string }[];
			} | null;
			const b64 = body?.data?.[0]?.b64_json;
			if (!res.ok || !b64) {
				console.error(`scene image failed (${res.status})`);
				return null;
			}
			const dir = join(this.dirs.mediaDir, 'scenes');
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, name), Buffer.from(b64, 'base64'));
			return `/media/scenes/${name}`;
		} catch (err) {
			console.error('scene image failed:', err);
			return null;
		}
	}
}
