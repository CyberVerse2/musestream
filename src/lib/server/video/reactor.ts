// Paid video from Reactor's Orbis model, through the Python worker in video-worker/.
//
// Safety first, because every second is billed:
// - Only agents listed in `agents` use Reactor. Everyone else gets the fallback (the free mock).
// - At most `maxSessions` sessions run at once; extra streams get the fallback.
// - Each session ends after `maxSeconds`. The worker enforces it, Reactor enforces it on its side,
//   and this class kills a worker that overstays.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import type { VideoProvider, VideoSource } from './provider.ts';

export interface ReactorOptions {
	apiKey: string;
	/** handles allowed to use paid video */
	agents: string[];
	maxSessions: number;
	maxSeconds: number;
	mediaDir: string;
	workerDir: string;
	fallback: VideoProvider;
}

interface Session {
	proc: ChildProcess;
	source: Promise<VideoSource>;
	killTimer: ReturnType<typeof setTimeout>;
	lastPrompt: string;
	stream: { streamId: string; avatarUrl: string | null; handle: string };
}

export class ReactorVideo implements VideoProvider {
	readonly name = 'reactor';
	private opts: ReactorOptions;
	private sessions = new Map<string, Session>();
	private listener: ((streamId: string, source: VideoSource) => void) | null = null;

	constructor(opts: ReactorOptions) {
		this.opts = opts;
	}

	onChange(listener: (streamId: string, source: VideoSource) => void) {
		this.listener = listener;
		this.opts.fallback.onChange?.(listener);
	}

	async render(
		stream: { streamId: string; avatarUrl: string | null; handle: string },
		prompt: string
	): Promise<VideoSource> {
		const running = this.sessions.get(stream.streamId);
		if (running) {
			running.lastPrompt = prompt;
			running.proc.stdin?.write(JSON.stringify({ prompt }) + '\n');
			return running.source;
		}
		const allowed = this.opts.agents.includes(stream.handle);
		if (!allowed || this.sessions.size >= this.opts.maxSessions) {
			return this.opts.fallback.render(stream, prompt);
		}
		return this.start(stream, prompt);
	}

	async stop(streamId: string) {
		const s = this.sessions.get(streamId);
		if (s) s.proc.stdin?.write(JSON.stringify({ stop: true, reason: 'stream_ended' }) + '\n');
		await this.opts.fallback.stop(streamId);
	}

	private start(
		stream: { streamId: string; avatarUrl: string | null; handle: string },
		prompt: string
	): Promise<VideoSource> {
		const out = join(this.opts.mediaDir, stream.streamId, 'live');
		const url = `/media/${relative(this.opts.mediaDir, out)}/live.m3u8`;
		const proc = spawn(
			'uv',
			[
				'run',
				'--quiet',
				'worker.py',
				'--out',
				out,
				'--prompt',
				prompt,
				'--max-seconds',
				String(this.opts.maxSeconds)
			],
			{
				cwd: this.opts.workerDir,
				env: { ...process.env, REACTOR_API_KEY: this.opts.apiKey },
				stdio: ['pipe', 'pipe', 'inherit']
			}
		);
		console.log(`[reactor] session starting for @${stream.handle}, cap ${this.opts.maxSeconds}s`);

		// last line of defence: a worker that outlives its cap is killed
		const killTimer = setTimeout(() => proc.kill('SIGKILL'), (this.opts.maxSeconds + 30) * 1000);

		let resolveSource!: (s: VideoSource) => void;
		let rejectSource!: (e: Error) => void;
		const source = new Promise<VideoSource>((res, rej) => {
			resolveSource = res;
			rejectSource = rej;
		});
		const session: Session = { proc, source, killTimer, lastPrompt: prompt, stream };
		this.sessions.set(stream.streamId, session);

		createInterface({ input: proc.stdout! }).on('line', (line) => {
			let msg: { event?: string; reason?: string; seconds?: number };
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg.event === 'playlist') resolveSource({ kind: 'hls', url });
			if (msg.event === 'ended') {
				console.log(
					`[reactor] session for @${stream.handle} ended: ${msg.reason}, ${msg.seconds}s`
				);
			}
		});

		proc.on('exit', () => {
			clearTimeout(killTimer);
			this.sessions.delete(stream.streamId);
			rejectSource(new Error('Reactor session ended before video was ready'));
			// the paid picture is gone; keep the stream moving with the free clip
			this.opts.fallback
				.render(stream, session.lastPrompt)
				.then((clip) => this.listener?.(stream.streamId, clip))
				.catch(() => {});
		});

		return source.catch(() => this.opts.fallback.render(stream, prompt));
	}
}
