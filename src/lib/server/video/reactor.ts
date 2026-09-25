// Paid video from Reactor's H3 Reference model, through the Python worker in video-worker/.
// The video is a chain of short clips of the agent in its scene, each saved as a file:
// the agent's acts become clips, and between acts it carries on with the last one. Players
// play the files back to back, so viewers see one continuous stream.
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
import type { LiveClip, StreamInfo, VideoProvider, VideoSource } from './provider.ts';
import type { VideoBudget } from './budget.ts';
import { localImage } from './images.ts';
import { actClips, idleClip, type Act, type ClipCast } from './h3-prompts.ts';
import type { VoiceSamples } from './voice-sample.ts';

/** a session shorter than this is mostly start-up time, which is billed too */
const MIN_SESSION_SECONDS = 30;
/** clips a stream's source lists; a player joining late starts from the newest */
const RECENT_CLIPS = 6;

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
	/** each agent's voice sample; without it the model picks a voice */
	voiceSamples?: VoiceSamples;
}

interface Session {
	proc: ChildProcess;
	source: Promise<VideoSource>;
	lastPrompt: string;
	/** the last act's action, which idle clips carry on */
	lastAction?: string;
	stream: StreamInfo;
	cast: ClipCast;
	clips: LiveClip[];
	startedAt: number;
}

/** what paid video is doing right now, for the owner */
export interface ReactorStatus {
	paused: boolean;
	/** handles allowed paid live video */
	agents: string[];
	maxSessions: number;
	maxSeconds: number;
	sessions: { streamId: string; handle: string; startedAt: number; clips: number }[];
}

export class ReactorVideo implements VideoProvider {
	readonly name = 'reactor';
	private opts: ReactorOptions;
	private sessions = new Map<string, Session>();
	/** streams whose session is being set up, holding a place in `maxSessions` */
	private starting = new Set<string>();
	private watching = new Map<string, number>();
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private listener: ((streamId: string, source: VideoSource) => void) | null = null;
	private paused = false;

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
			this.send(running, { idle: idleClip(running.cast, prompt, running.lastAction) });
			return running.clips.length ? clipsSource(running) : running.source;
		}
		if (this.canStart(stream) && (this.watching.get(stream.streamId) ?? 0) > 0) {
			return this.start(stream, prompt);
		}
		return this.replay(stream, prompt);
	}

	act(stream: StreamInfo, scene: string, act: Act): boolean {
		const running = this.sessions.get(stream.streamId);
		if (!running) return false;
		for (const clip of actClips(running.cast, scene, act)) this.send(running, { clip });
		running.lastAction = act.action;
		this.send(running, { idle: idleClip(running.cast, scene, act.action) });
		return true;
	}

	private send(session: Session, msg: object) {
		session.proc.stdin?.write(JSON.stringify(msg) + '\n');
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

	/** stop all paid video: running sessions end, and none start until it resumes */
	setPaused(paused: boolean) {
		this.paused = paused;
		if (paused) for (const streamId of this.sessions.keys()) this.endSession(streamId, 'paused');
	}

	/** let an agent use paid live video, or stop it (ending its running session) */
	allowAgent(handle: string, allowed: boolean) {
		const agents = this.opts.agents;
		const i = agents.indexOf(handle);
		if (allowed && i < 0) agents.push(handle);
		if (!allowed && i >= 0) {
			agents.splice(i, 1);
			for (const [streamId, s] of this.sessions)
				if (s.stream.handle === handle) this.endSession(streamId, 'not_allowed');
		}
	}

	status(): ReactorStatus {
		return {
			paused: this.paused,
			agents: [...this.opts.agents],
			maxSessions: this.opts.maxSessions,
			maxSeconds: this.opts.maxSeconds,
			sessions: [...this.sessions.values()].map((s) => ({
				streamId: s.stream.streamId,
				handle: s.stream.handle,
				startedAt: s.startedAt,
				clips: s.clips.length
			}))
		};
	}

	private canStart(stream: StreamInfo) {
		return (
			!this.paused &&
			this.opts.agents.includes(stream.handle) &&
			!this.starting.has(stream.streamId) &&
			this.sessions.size + this.starting.size < this.opts.maxSessions &&
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
		this.starting.add(stream.streamId);
		const startedAt = Date.now();

		// a folder per session: clip names restart with each session, and clips are cached for good
		const out = join(this.opts.mediaDir, stream.streamId, `session-${startedAt}`);
		const base = `/media/${relative(this.opts.mediaDir, out)}`;
		const [cmd, ...cmdArgs] = this.opts.workerCommand ?? ['uv', 'run', '--quiet', 'worker.py'];
		// the agent's look and voice, and its scene, carry through every clip
		const [avatar, scenePicture, voice] = await Promise.all([
			localImage(stream.avatarUrl, this.opts),
			localImage(stream.imageUrl, this.opts),
			this.opts.voiceSamples?.sample(stream.agentId, stream.name) ?? null
		]).catch((err: unknown) => {
			this.starting.delete(stream.streamId);
			this.opts.budget.add(stream.agentId, day, -seconds);
			throw err;
		});
		const cast: ClipCast = {
			name: stream.name,
			avatarPicture: Boolean(avatar),
			scenePicture: Boolean(scenePicture),
			voice: Boolean(voice)
		};
		const idle = idleClip(cast, prompt);
		const proc = spawn(
			cmd!,
			[
				...cmdArgs,
				'--out',
				out,
				'--max-seconds',
				String(seconds),
				'--idle-prompt',
				idle.prompt,
				'--idle-seconds',
				String(idle.seconds),
				...[avatar, scenePicture].flatMap((image) => (image ? ['--image', image] : [])),
				...(voice ? ['--voice', voice] : [])
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
		const session: Session = {
			proc,
			source,
			lastPrompt: prompt,
			stream,
			cast,
			clips: [],
			startedAt
		};
		this.sessions.set(stream.streamId, session);
		this.starting.delete(stream.streamId);

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
			let msg: { event?: string; reason?: string; seconds?: number; file?: string; kind?: string };
			try {
				msg = JSON.parse(line);
			} catch {
				return;
			}
			if (msg.event === 'clip' && msg.file) {
				const first = session.clips.length === 0;
				session.clips = [
					...session.clips,
					{ url: `${base}/${msg.file}`, idle: msg.kind === 'idle' }
				].slice(-RECENT_CLIPS);
				if (first) resolveSource(clipsSource(session));
				else this.listener?.(stream.streamId, clipsSource(session));
			}
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

function clipsSource(session: Session): VideoSource {
	return { kind: 'clips', clips: session.clips };
}
