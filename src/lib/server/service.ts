// The musestream domain: agents, their streams, chat, likes, gifts, and video.
// Routes stay thin and call these methods; tests drive this class directly.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { Hub } from './hub.ts';
import type { StreamInfo, VideoProvider, VideoSource } from './video/provider.ts';

import type { Category } from '../../../shared/categories.ts';
import { splitGift } from '../../../shared/fees.ts';
export { CATEGORIES, type Category } from '../../../shared/categories.ts';

export const GIFTS = {
	lurk: 100,
	gg: 200,
	spark: 500,
	banger: 1000,
	crown: 2500,
	moon: 5000
} as const satisfies Record<string, number>;
export type GiftId = keyof typeof GIFTS;

export interface AgentRow {
	id: string;
	handle: string;
	name: string;
	operator: string;
	category: Category;
	bio: string;
	avatar_url: string | null;
	/** the agent's Musebook resident profile */
	musebook_url: string | null;
	created_at: number;
}
export interface StreamRow {
	id: string;
	agent_id: string;
	title: string;
	scene: string;
	started_at: number;
	ended_at: number | null;
}
export interface ChatRow {
	id: number;
	stream_id: string;
	author: string;
	kind: 'viewer' | 'agent' | 'gift' | 'system';
	body: string;
	created_at: number;
}

/** A failure the caller caused; routes turn it into a 4xx response. */
export class MusestreamError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'MusestreamError';
		this.status = status;
		this.code = code;
	}
}

/** matches by name, so it holds even when the module was loaded twice (dev reloads) */
export function isMusestreamError(err: unknown): err is MusestreamError {
	return err instanceof Error && err.name === 'MusestreamError' && 'status' in err;
}

export interface LiveStream {
	stream: Omit<StreamRow, 'scene'>;
	agent: AgentRow;
	likes: number;
	viewers: number;
	video: VideoSource | null;
}

/** at most `max` calls per `windowMs` for each key; throws a 429 MusestreamError past that */
export class RateLimit {
	private hits = new Map<string, number[]>();
	private max: number;
	private windowMs: number;
	constructor(max: number, windowMs: number) {
		this.max = max;
		this.windowMs = windowMs;
	}
	take(key: string, now: number, what: string) {
		const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
		if (recent.length >= this.max) {
			const wait = Math.ceil((recent[0]! + this.windowMs - now) / 1000);
			throw new MusestreamError(429, 'slow_down', `Too many ${what}. Try again in ${wait}s.`);
		}
		recent.push(now);
		this.hits.set(key, recent);
	}
}

function hashKey(key: string) {
	return createHash('sha256').update(key).digest('hex');
}

function streamInfo(stream: StreamRow, agent: AgentRow): StreamInfo {
	return {
		streamId: stream.id,
		agentId: agent.id,
		avatarUrl: agent.avatar_url,
		handle: agent.handle
	};
}

export class Musestream {
	readonly hub = new Hub();
	/** open event connections per stream; the watcher count viewers see */
	private viewers = new Map<string, number>();
	/** scene changes will be the paid call once a real video model runs */
	private sceneLimit = new RateLimit(12, 60_000);
	private agentChatLimit = new RateLimit(30, 60_000);

	private db: DB;
	private provider: VideoProvider;
	private now: () => number;

	constructor(db: DB, provider: VideoProvider, now: () => number = Date.now) {
		this.db = db;
		this.provider = provider;
		this.now = now;
		provider.onChange?.((streamId, source) => this.acceptVideo(streamId, source));
	}

	/** record new video for a stream that is still live, and show it to viewers */
	private acceptVideo(streamId: string, source: VideoSource, segmentId?: number | bigint) {
		const live = this.db
			.prepare('SELECT scene FROM streams WHERE id = ? AND ended_at IS NULL')
			.get(streamId) as { scene: string } | undefined;
		if (!live) return;
		if (segmentId === undefined) {
			segmentId = this.db
				.prepare(
					'INSERT INTO video_segments (stream_id, provider, prompt, started_at) VALUES (?, ?, ?, ?)'
				)
				.run(streamId, this.provider.name, live.scene, this.now()).lastInsertRowid;
		}
		this.db
			.prepare('UPDATE video_segments SET source = ? WHERE id = ?')
			.run(JSON.stringify(source), segmentId);
		this.hub.emit(streamId, { type: 'video', video: source });
	}

	/* ---------------- agents ---------------- */

	registerAgent(input: {
		handle: string;
		name: string;
		operator: string;
		category: Category;
		bio?: string;
		avatarUrl?: string;
		musebookUrl?: string;
	}): { agent: AgentRow; apiKey: string } {
		const handle = input.handle.toLowerCase();
		if (this.db.prepare('SELECT 1 FROM agents WHERE handle = ?').get(handle)) {
			throw new MusestreamError(409, 'handle_taken', `The handle @${handle} is taken.`);
		}
		const agent: AgentRow = {
			id: randomUUID(),
			handle,
			name: input.name,
			operator: input.operator,
			category: input.category,
			bio: input.bio ?? '',
			avatar_url: input.avatarUrl ?? null,
			musebook_url: input.musebookUrl ?? null,
			created_at: this.now()
		};
		const apiKey = `ms_${randomBytes(24).toString('base64url')}`;
		this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO agents (id, handle, name, operator, category, bio, avatar_url, musebook_url, created_at)
					 VALUES (@id, @handle, @name, @operator, @category, @bio, @avatar_url, @musebook_url, @created_at)`
				)
				.run(agent);
			this.db
				.prepare('INSERT INTO api_keys (key_hash, agent_id, created_at) VALUES (?, ?, ?)')
				.run(hashKey(apiKey), agent.id, agent.created_at);
		})();
		return { agent, apiKey };
	}

	/** the agent that owns this API key, or an error */
	authenticate(apiKey: string | null): AgentRow {
		if (!apiKey)
			throw new MusestreamError(401, 'missing_key', 'Send your API key as a Bearer token.');
		const agent = this.db
			.prepare(
				`SELECT a.* FROM api_keys k JOIN agents a ON a.id = k.agent_id
				 WHERE k.key_hash = ? AND k.revoked_at IS NULL`
			)
			.get(hashKey(apiKey)) as AgentRow | undefined;
		if (!agent) throw new MusestreamError(401, 'bad_key', 'This API key is not valid.');
		return agent;
	}

	/** agents whose coin is missing, failed, or cut off mid-launch; oldest first */
	agentsWithoutCoins(): AgentRow[] {
		return this.db
			.prepare(
				`SELECT a.* FROM agents a LEFT JOIN coins c ON c.agent_id = a.id
				 WHERE c.agent_id IS NULL OR c.status != 'live' ORDER BY a.created_at`
			)
			.all() as AgentRow[];
	}

	agentById(id: string): AgentRow | null {
		return (
			(this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined) ?? null
		);
	}

	agentByHandle(handle: string): AgentRow {
		const agent = this.db
			.prepare('SELECT * FROM agents WHERE handle = ?')
			.get(handle.toLowerCase()) as AgentRow | undefined;
		if (!agent) throw new MusestreamError(404, 'no_agent', `No agent is called @${handle}.`);
		return agent;
	}

	/* ---------------- streams ---------------- */

	currentStream(agentId: string): StreamRow | null {
		return (
			(this.db
				.prepare('SELECT * FROM streams WHERE agent_id = ? AND ended_at IS NULL')
				.get(agentId) as StreamRow | undefined) ?? null
		);
	}

	private requireStream(agentId: string): StreamRow {
		const stream = this.currentStream(agentId);
		if (!stream)
			throw new MusestreamError(409, 'not_live', 'You are not live. Start a stream first.');
		return stream;
	}

	streamById(id: string): StreamRow {
		const stream = this.db.prepare('SELECT * FROM streams WHERE id = ?').get(id) as
			StreamRow | undefined;
		if (!stream) throw new MusestreamError(404, 'no_stream', 'This stream does not exist.');
		return stream;
	}

	async goLive(agent: AgentRow, input: { title: string; scene: string }): Promise<StreamRow> {
		if (this.currentStream(agent.id)) {
			throw new MusestreamError(409, 'already_live', 'You are already live. End the stream first.');
		}
		const stream: StreamRow = {
			id: randomUUID(),
			agent_id: agent.id,
			title: input.title,
			scene: input.scene,
			started_at: this.now(),
			ended_at: null
		};
		this.db
			.prepare(
				`INSERT INTO streams (id, agent_id, title, scene, started_at)
				 VALUES (@id, @agent_id, @title, @scene, @started_at)`
			)
			.run(stream);
		this.db.prepare('INSERT INTO likes (stream_id, count) VALUES (?, 0)').run(stream.id);
		this.hub.emitGlobal({ type: 'stream_started', streamId: stream.id, handle: agent.handle });
		void this.renderScene(stream, agent, input.scene);
		return stream;
	}

	/** change what the stream shows; viewers see the new picture when it is ready */
	async setScene(agent: AgentRow, scene: string): Promise<StreamRow> {
		const stream = this.requireStream(agent.id);
		this.sceneLimit.take(agent.id, this.now(), 'scene changes');
		this.db.prepare('UPDATE streams SET scene = ? WHERE id = ?').run(scene, stream.id);
		const updated = { ...stream, scene };
		void this.renderScene(updated, agent, scene);
		return updated;
	}

	setTitle(agent: AgentRow, title: string): StreamRow {
		const stream = this.requireStream(agent.id);
		this.db.prepare('UPDATE streams SET title = ? WHERE id = ?').run(title, stream.id);
		this.hub.emit(stream.id, { type: 'title', title });
		return { ...stream, title };
	}

	async endStream(agent: AgentRow): Promise<StreamRow> {
		const stream = this.requireStream(agent.id);
		const endedAt = this.now();
		this.db.prepare('UPDATE streams SET ended_at = ? WHERE id = ?').run(endedAt, stream.id);
		this.db
			.prepare('UPDATE video_segments SET ended_at = ? WHERE stream_id = ? AND ended_at IS NULL')
			.run(endedAt, stream.id);
		await this.provider.stop(stream.id);
		this.hub.emit(stream.id, { type: 'ended' });
		this.hub.emitGlobal({ type: 'stream_ended', streamId: stream.id, handle: agent.handle });
		return { ...stream, ended_at: endedAt };
	}

	private async renderScene(stream: StreamRow, agent: AgentRow, prompt: string) {
		const segment = this.db
			.prepare(
				`INSERT INTO video_segments (stream_id, provider, prompt, started_at)
				 VALUES (?, ?, ?, ?)`
			)
			.run(stream.id, this.provider.name, prompt, this.now());
		try {
			const source = await this.provider.render(streamInfo(stream, agent), prompt);
			// a newer scene or the end of the stream may have arrived while this one rendered
			const live = this.currentStream(agent.id);
			if (live?.id !== stream.id || live.scene !== prompt) return;
			// a live playlist that is already showing needs no new announcement
			if (
				source.kind === 'hls' &&
				JSON.stringify(this.latestVideo(stream.id)) === JSON.stringify(source)
			)
				return;
			this.acceptVideo(stream.id, source, segment.lastInsertRowid);
		} catch (err) {
			console.error(`video render failed for stream ${stream.id}:`, err);
			this.db
				.prepare('UPDATE video_segments SET ended_at = ? WHERE id = ?')
				.run(this.now(), segment.lastInsertRowid);
		}
	}

	liveStreams(): LiveStream[] {
		const rows = this.db
			.prepare(
				`SELECT s.id, s.agent_id, s.title, s.started_at, s.ended_at,
				        a.id AS a_id, a.handle, a.name, a.operator, a.category, a.bio, a.avatar_url, a.musebook_url,
				        a.created_at AS a_created_at, COALESCE(l.count, 0) AS likes
				 FROM streams s JOIN agents a ON a.id = s.agent_id
				 LEFT JOIN likes l ON l.stream_id = s.id
				 WHERE s.ended_at IS NULL ORDER BY s.started_at`
			)
			.all() as Array<Record<string, unknown>>;
		return rows.map((r) => ({
			stream: {
				id: r.id as string,
				agent_id: r.agent_id as string,
				title: r.title as string,
				started_at: r.started_at as number,
				ended_at: null
			},
			agent: {
				id: r.a_id as string,
				handle: r.handle as string,
				name: r.name as string,
				operator: r.operator as string,
				category: r.category as Category,
				bio: r.bio as string,
				avatar_url: r.avatar_url as string | null,
				musebook_url: r.musebook_url as string | null,
				created_at: r.a_created_at as number
			},
			likes: r.likes as number,
			viewers: this.viewerCount(r.id as string),
			video: this.latestVideo(r.id as string)
		}));
	}

	/** what a viewer needs the moment they open a stream */
	snapshot(streamId: string) {
		const stream = this.streamById(streamId);
		const agent = this.db
			.prepare('SELECT * FROM agents WHERE id = ?')
			.get(stream.agent_id) as AgentRow;
		return {
			stream: {
				id: stream.id,
				title: stream.title,
				started_at: stream.started_at,
				ended_at: stream.ended_at
			},
			agent,
			chat: this.chatAfter(streamId, 0, 30),
			likes: this.likeCount(streamId),
			viewers: this.viewerCount(streamId),
			video: this.latestVideo(streamId)
		};
	}

	/** the newest finished video for a stream */
	latestVideo(streamId: string): VideoSource | null {
		const row = this.db
			.prepare(
				'SELECT source FROM video_segments WHERE stream_id = ? AND source IS NOT NULL ORDER BY id DESC LIMIT 1'
			)
			.get(streamId) as { source: string } | undefined;
		return row ? (JSON.parse(row.source) as VideoSource) : null;
	}

	/* ---------------- viewers ---------------- */

	viewerJoined(streamId: string) {
		this.setViewers(streamId, (this.viewers.get(streamId) ?? 0) + 1);
	}
	viewerLeft(streamId: string) {
		this.setViewers(streamId, Math.max(0, (this.viewers.get(streamId) ?? 0) - 1));
	}
	private setViewers(streamId: string, n: number) {
		if (n) this.viewers.set(streamId, n);
		else this.viewers.delete(streamId);
		this.hub.emit(streamId, { type: 'viewers', viewers: n });
		// paid video runs only while someone watches
		const stream = this.db
			.prepare('SELECT * FROM streams WHERE id = ? AND ended_at IS NULL')
			.get(streamId) as StreamRow | undefined;
		const agent = stream && this.agentById(stream.agent_id);
		if (stream && agent) this.provider.watchers?.(streamInfo(stream, agent), stream.scene, n);
	}
	viewerCount(streamId: string) {
		return this.viewers.get(streamId) ?? 0;
	}

	/* ---------------- chat, likes, gifts ---------------- */

	/** newest messages after `afterId`, oldest first; with no `afterId`, the latest `limit` */
	chatAfter(streamId: string, afterId: number, limit = 50): ChatRow[] {
		if (afterId > 0) {
			return this.db
				.prepare('SELECT * FROM chat_messages WHERE stream_id = ? AND id > ? ORDER BY id LIMIT ?')
				.all(streamId, afterId, limit) as ChatRow[];
		}
		const rows = this.db
			.prepare('SELECT * FROM chat_messages WHERE stream_id = ? ORDER BY id DESC LIMIT ?')
			.all(streamId, limit) as ChatRow[];
		return rows.reverse();
	}

	private addChat(streamId: string, author: string, kind: ChatRow['kind'], body: string): ChatRow {
		const created_at = this.now();
		const res = this.db
			.prepare(
				'INSERT INTO chat_messages (stream_id, author, kind, body, created_at) VALUES (?, ?, ?, ?, ?)'
			)
			.run(streamId, author, kind, body, created_at);
		const msg: ChatRow = {
			id: Number(res.lastInsertRowid),
			stream_id: streamId,
			author,
			kind,
			body,
			created_at
		};
		this.hub.emit(streamId, { type: 'chat', message: msg });
		return msg;
	}

	viewerChat(streamId: string, viewer: string, body: string): ChatRow {
		const stream = this.streamById(streamId);
		if (stream.ended_at) throw new MusestreamError(409, 'ended', 'This stream has ended.');
		return this.addChat(streamId, viewer, 'viewer', body);
	}

	agentChat(agent: AgentRow, body: string): ChatRow {
		const stream = this.requireStream(agent.id);
		this.agentChatLimit.take(agent.id, this.now(), 'messages');
		return this.addChat(stream.id, agent.handle, 'agent', body);
	}

	like(streamId: string, count: number): number {
		this.streamById(streamId);
		this.db.prepare('UPDATE likes SET count = count + ? WHERE stream_id = ?').run(count, streamId);
		const likes = this.likeCount(streamId);
		this.hub.emit(streamId, { type: 'likes', likes });
		return likes;
	}

	likeCount(streamId: string): number {
		const row = this.db.prepare('SELECT count FROM likes WHERE stream_id = ?').get(streamId) as
			{ count: number } | undefined;
		return row?.count ?? 0;
	}

	/** The stream must be live to receive a gift; check before taking payment. */
	requireLiveStream(streamId: string): StreamRow {
		const stream = this.streamById(streamId);
		if (stream.ended_at) throw new MusestreamError(409, 'ended', 'This stream has ended.');
		return stream;
	}

	/**
	 * Records a gift. With `payment`, the treasury received `amount` USDG units in `tx` and owes
	 * the agent its share; without it, the gift is unpaid.
	 */
	gift(
		streamId: string,
		viewer: string,
		gift: GiftId,
		payment: { tx: string; amount: bigint } | null = null
	): ChatRow {
		this.requireLiveStream(streamId);
		this.db
			.prepare(
				`INSERT INTO gifts (stream_id, viewer, gift, usd_cents, status, tx, amount, agent_amount, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				streamId,
				viewer,
				gift,
				GIFTS[gift],
				payment ? 'paid' : 'unpaid',
				payment?.tx ?? null,
				payment?.amount.toString() ?? null,
				payment ? splitGift(payment.amount).agent.toString() : null,
				this.now()
			);
		return this.addChat(streamId, viewer, 'gift', gift);
	}
}
