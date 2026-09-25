// A song the agent sings in its live video. The song is cut into slices H3 can play (5 to 15
// seconds, at gaps between lyric lines). Each slice is one clip's reference audio, so the
// agent sings it with its lips in time, and the saved clip carries the song's own sound.
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LyricLine, Song } from '../music/lyria.ts';
import { songClip, type ClipCast } from './h3-prompts.ts';
import type { SongClip } from './provider.ts';

const run = promisify(execFile);

/** clip lengths H3 makes: 17n + 5 frames at 24 fps, 5.17 to 15.08 seconds */
const GRID = Array.from({ length: 15 }, (_, i) => (17 * (i + 7) + 5) / 24);
const MIN = GRID[0]!;
const MAX = GRID.at(-1)!;
/** H3's singing runs this far behind its reference audio */
const LAG_SECONDS = 0.1;

export interface Slice {
	start: number;
	seconds: number;
	/** the lyrics sung in it */
	words: string;
}

/** the grid length nearest `seconds` */
function snap(seconds: number): number {
	return GRID.reduce((best, g) => (Math.abs(g - seconds) < Math.abs(best - seconds) ? g : best));
}

/**
 * Slices covering the song, about 10 seconds each, cut between lyric lines where it can. A
 * tail shorter than H3's shortest clip is left out.
 */
export function planSlices(duration: number, lines: LyricLine[]): Slice[] {
	const cuts = lines.flatMap((line, i) => {
		const next = lines[i + 1];
		return next && line.end <= next.start ? [(line.end + next.start) / 2] : [line.start];
	});
	const slices: Slice[] = [];
	let start = 0;
	while (duration - start >= MIN) {
		const left = duration - start;
		let seconds: number;
		if (left <= MAX) {
			seconds = GRID.filter((g) => g <= left).at(-1)!;
		} else if (left - 10 < MIN) {
			seconds = snap(left / 2);
		} else {
			const near = cuts
				.filter((t) => t - start >= 7 && t - start <= 13 && duration - t >= MIN)
				.sort((a, b) => Math.abs(a - start - 10) - Math.abs(b - start - 10))[0];
			seconds = snap((near ?? start + 10) - start);
		}
		const end = start + seconds;
		const words = lines
			.filter((l) => (l.start + l.end) / 2 >= start && (l.start + l.end) / 2 < end)
			.map((l) => l.text)
			.join(' ');
		slices.push({ start, seconds, words });
		start = end;
	}
	return slices;
}

async function duration(file: string): Promise<number> {
	const { stdout } = await run('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'format=duration',
		'-of',
		'csv=p=0',
		file
	]);
	return Number(stdout.trim());
}

/** cut `seconds` of `song` from `from` into a 48 kHz mono wav, silence first when `from` < 0 */
async function cut(song: string, from: number, seconds: number, out: string) {
	const lead = Math.max(0, -from);
	await run('ffmpeg', [
		'-v',
		'error',
		'-y',
		'-ss',
		String(Math.max(0, from)),
		'-t',
		String(seconds - lead),
		'-i',
		song,
		'-af',
		lead
			? `adelay=${Math.round(lead * 1000)},apad=whole_dur=${seconds}`
			: `apad=whole_dur=${seconds}`,
		'-ar',
		'48000',
		'-ac',
		'1',
		out
	]);
}

/** the clips that sing `song`, in order, with their slices saved next to it */
export async function songClips(song: Song, cast: ClipCast, scene: string): Promise<SongClip[]> {
	const dir = join(song.file, '..', song.id);
	mkdirSync(dir, { recursive: true });
	const slices = planSlices(await duration(song.file), song.lines);
	return Promise.all(
		slices.map(async (s, i) => {
			const audio = join(dir, `sing-${i}.wav`);
			const sound = join(dir, `sound-${i}.wav`);
			// the sound starts a moment earlier than the slice H3 hears, so it lands with the lips
			await Promise.all([
				cut(song.file, s.start, s.seconds, audio),
				cut(song.file, s.start - LAG_SECONDS, s.seconds, sound)
			]);
			return { ...songClip(cast, scene, s.words, s.seconds), audio, sound };
		})
	);
}
