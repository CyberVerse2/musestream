// Paid video from Reactor's Orbis model, through the Python worker in video-worker/.
//
// Safety first, because every second a session is open is billed:
// - Only agents listed in `agents` use Reactor. Everyone else gets the fallback (the free mock).
// - A session runs only while someone watches. When the last viewer leaves, it ends after
//   `idleSeconds`, and the stream shows its free clip, marked as a replay.
// - Each agent has a daily allowance (`budget`). A session reserves its full length first.
// - At most `maxSessions` sessions run at once; extra streams get the replay clip.
// - Each session ends after `maxSeconds`, or sooner if the allowance is smaller. The worker
//   enforces it, Reactor enforces it on its side, and this class kills a worker that overstays.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, relative } from 'node:path';
import type { StreamInfo, VideoProvider, VideoSource } from './provider.ts';
import type { VideoBudget } from './budget.ts';
import { localImage } from './images.ts';

/** a session shorter than this is mostly start-up time, which is billed too */
const MIN_SESSION_SECONDS = 30;

export interface ReactorOptions {
	apiKey: string;
	/** handles allowed to use paid video */
	agents: string[];
	maxSessions: number;
	maxSeconds: number;
	/** how long a session keeps running after the last viewer leaves */
	idleSeconds: number;
	budget: VideoBudget;
	mediaDir: string;
	/** where the app's own image paths (`/img/…`) resolve on disk */
	staticDir: string;
	workerDir: string;
	/** the worker's command; the session's arguments are added after it */
	workerCommand?: string[];
	fallback: VideoProvider;
}

interface Session {
	proc: ChildProcess;
	source: Promise<VideoSource>;
	lastPrompt: string;
	stream: StreamInfo;
}

export class ReactorVideo implements VideoProvider {
	readonly name = 'reactor';
	private opts: ReactorOptions;
	private sessions = new Map<string, Session>();
	private watching = new Map<string, number>();
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private listener: ((streamId: string, source: VideoSource) => void) | null = null;

	constructor(opts: ReactorOptions) {
		this.opts = opts;
	}

	onChange(listener: (streamId: string, source: VideoSource) => void) {
		this.listener = listener;
		this.opts.fallback.onChange?.(listener);
	}

	async render(stream: StreamInfo, prompt: string): Promise<VideoSource> {
		const running = this.sessions.get(stream.streamId);
		if (running) {
			running.lastPrompt = prompt;
			running.proc.stdin?.write(JSON.stringify({ prompt }) + '\n');
			return running.source;
		}
		if (this.canStart(stream) && (this.watching.get(stream.streamId) ?? 0) > 0) {
			return this.start(stream, prompt);
		}
		return this.replay(stream, prompt);
	}

	watchers(stream: StreamInfo, scene: string, count: number) {
		this.watching.set(stream.streamId, count);
		clearTimeout(this.idleTimers.get(stream.streamId));
		this.idleTimers.delete(stream.streamId);
		const running = this.sessions.get(stream.streamId);
		if (count > 0 && !running && this.canStart(stream)) {
			// nobody asked for this video; tell the stream when it is ready
			this.start(stream, scene)
				.then((source) => this.listener?.(stream.streamId, source))
				.catch(() => {});
		}
		if (count === 0 && running) {
			this.idleTimers.set(
				stream.streamId,
				setTimeout(
					() => this.endSession(stream.streamId, 'no_viewers'),
					this.opts.idleSeconds * 1000
				)
			);
		}
	}

	async stop(streamId: string) {
		clearTimeout(this.idleTimers.get(streamId));
		this.idleTimers.delete(streamId);
		this.watching.delete(streamId);
		this.endSession(streamId, 'stream_ended');
		await this.opts.fallback.stop(streamId);
	}

	private endSession(streamId: string, reason: string) {
		const s = this.sessions.get(streamId);
		if (s) s.proc.stdin?.write(JSON.stringify({ stop: true, reason }) + '\n');
	}

	private canStart(stream: StreamInfo) {
		return (
			this.opts.agents.includes(stream.handle) &&
			this.sessions.size < this.opts.maxSessions &&
			this.opts.budget.remaining(stream.agentId) >= MIN_SESSION_SECONDS
		);
	}

	/** the free clip, marked as a replay when this agent otherwise streams paid video */
	private async replay(stream: StreamInfo, prompt: string): Promise<VideoSource> {
		const clip = await this.opts.fallback.render(stream, prompt);
		return this.opts.agents.includes(stream.handle) && clip.kind === 'file'
			? { ...clip, replay: true }
			: clip;
	}

	private async start(stream: StreamInfo, prompt: string): Promise<VideoSource> {
		const seconds = Math.floor(
			Math.min(this.opts.maxSeconds, this.opts.budget.remaining(stream.agentId))
		);
		const day = this.opts.budget.today();
		this.opts.budget.add(stream.agentId, day, seconds);
		const startedAt = Date.now();

		const out = join(this.opts.mediaDir, stream.streamId, 'live');
		const url = `/media/${relative(this.opts.mediaDir, out)}/live.m3u8`;
		const [cmd, ...cmdArgs] = this.opts.workerCommand ?? ['uv', 'run', '--quiet', 'worker.py'];
		// the stream's reference picture, else the agent's avatar: Orbis starts from it
		const image = await localImage(stream.imageUrl ?? stream.avatarUrl, this.opts);
		const proc = spawn(
			cmd!,
			[
				...cmdArgs,
				'--out',
				out,
				'--prompt',
				prompt,
				'--max-seconds',
				String(seconds),
				// the model's music and atmosphere; the agent's voice comes from the server
				'--audio',
				...(image ? ['--image', image] : [])
			],
			{
				cwd: this.opts.workerDir,
				env: { ...process.env, REACTOR_API_KEY: this.opts.apiKey },
				stdio: ['pipe', 'pipe', 'inherit']
			}
		);
		console.log(`[reactor] session starting for @${stream.handle}, cap ${seconds}s`);

		// last line of defence: a worker that outlives its cap is killed
		const killTimer = setTimeout(() => proc.kill('SIGKILL'), (seconds + 30) * 1000);

		let resolveSource!: (s: VideoSource) => void;
		let rejectSource!: (e: Error) => void;
		const source = new Promise<VideoSource>((res, rej) => {
			resolveSource = res;
			rejectSource = rej;
		});
		const session: Session = { proc, source, lastPrompt: prompt, stream };
		this.sessions.set(stream.streamId, session);

		// runs once, on the worker's "ended" report or on its exit, whichever comes first
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(killTimer);
			this.sessions.delete(stream.streamId);
			// billed time is wall time, start-up included; give back what the session did not use
			const used = Math.ceil((Date.now() - startedAt) / 1000);
			this.opts.budget.add(stream.agentId, day, used - seconds);
			rejectSource(new Error('Reactor session ended before video was ready'));
			// the paid picture is gone; keep the stream moving with the free clip
			this.replay(stream, session.lastPrompt)
				.then((clip) => this.listener?.(stream.streamId, clip))
				.catch(() => {});
		};

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
				finish();
			}
		});

		proc.on('exit', finish);

		return source.catch(() => this.replay(stream, prompt));
	}
}
