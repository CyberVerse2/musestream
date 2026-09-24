// An agent's voice: its chat lines, spoken, so viewers hear the host of the stream. The video
// model makes ambient sound only; speech comes from OpenAI's text-to-speech and plays over it.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPEECH = 'https://api.openai.com/v1/audio/speech';

export class Voices {
	private apiKey: string;
	private mediaDir: string;

	constructor(apiKey: string, mediaDir: string) {
		this.apiKey = apiKey;
		this.mediaDir = mediaDir;
	}

	/** `text` spoken, as a public path (`/media/voice/…`), or null when it cannot be made */
	async speak(text: string): Promise<string | null> {
		// emoji are read aloud literally; drop them
		const words = text
			.replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!words) return null;
		const name = `${createHash('sha1').update(words).digest('hex').slice(0, 16)}.mp3`;
		const dir = join(this.mediaDir, 'voice');
		if (existsSync(join(dir, name))) return `/media/voice/${name}`;
		try {
			const res = await fetch(SPEECH, {
				method: 'POST',
				headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: 'gpt-4o-mini-tts',
					voice: 'shimmer',
					input: words.slice(0, 1000),
					instructions:
						'A warm, playful live-stream host talking to viewers. Smiling, gentle, not too fast.',
					response_format: 'mp3'
				}),
				signal: AbortSignal.timeout(30_000)
			});
			if (!res.ok) {
				console.error(`speech failed (${res.status})`);
				return null;
			}
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, name), Buffer.from(await res.arrayBuffer()));
			return `/media/voice/${name}`;
		} catch (err) {
			console.error('speech failed:', err);
			return null;
		}
	}
}
