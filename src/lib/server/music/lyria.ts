// Songs from Google's Lyria, through the Gemini API: a 30 second track with sung vocals, and
// the time each lyric line is sung at. Songs are kept on disk under `media/songs/`.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INTERACTIONS = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODEL = 'lyria-3-clip-preview';

export interface SongRequest {
	/** the sound: genre, mood, instruments, the singer's voice */
	style: string;
	/** what the song is about */
	about: string;
	/** lyric lines, sung in order */
	lyrics: string[];
}

export interface LyricLine {
	start: number;
	end: number;
	text: string;
}

export interface Song {
	id: string;
	/** the mp3 on disk */
	file: string;
	lines: LyricLine[];
}

/** Lyria would not make the song; `reason` is safe to show */
export class SongRefused extends Error {}

export class Lyria {
	private apiKey: string;
	private dir: string;

	constructor(apiKey: string, mediaDir: string) {
		this.apiKey = apiKey;
		this.dir = join(mediaDir, 'songs');
	}

	async song(req: SongRequest): Promise<Song> {
		const input =
			`${req.style}. A song about ${req.about}, sung by a sweet, playful female voice. ` +
			req.lyrics.map((line) => `[Verse] ${line}`).join(' / ');
		const res = await fetch(INTERACTIONS, {
			method: 'POST',
			headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: MODEL, input }),
			signal: AbortSignal.timeout(180_000)
		});
		const body = (await res.json().catch(() => null)) as LyriaResponse | null;
		if (!res.ok || !body) {
			const message = body?.error?.message ?? `Lyria failed (${res.status})`;
			// a prompt the safety filters block comes back as a client error
			if (res.status === 400) throw new SongRefused(message);
			throw new Error(message);
		}
		const content = (body.steps ?? []).flatMap((s) => s.content ?? []);
		const audio = content.find((c) => c.type === 'audio' && c.data);
		if (!audio?.data) throw new SongRefused('Lyria returned no song for this request.');
		const text = content
			.filter((c) => c.type === 'text')
			.map((c) => c.text ?? '')
			.join('\n');
		const id = randomUUID();
		mkdirSync(this.dir, { recursive: true });
		const file = join(this.dir, `${id}.mp3`);
		writeFileSync(file, Buffer.from(audio.data, 'base64'));
		return { id, file, lines: parseLines(text) };
	}
}

interface LyriaResponse {
	error?: { message?: string };
	steps?: { content?: { type: string; text?: string; data?: string }[] }[];
}

/** `[2.9:8.5] Rain on the glass` lines, in seconds */
export function parseLines(text: string): LyricLine[] {
	const lines: LyricLine[] = [];
	for (const m of text.matchAll(/\[(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)\]\s*([^\n[]*)/g)) {
		lines.push({ start: Number(m[1]), end: Number(m[2]), text: m[3]!.trim() });
	}
	return lines.sort((a, b) => a.start - b.start);
}
