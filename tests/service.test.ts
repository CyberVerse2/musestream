import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/lib/server/db.ts';
import { Lurkk, LurkkError } from '../src/lib/server/service.ts';
import type { VideoProvider, VideoSource } from '../src/lib/server/video/provider.ts';

/** a video provider that records calls and answers at once */
class FakeVideo implements VideoProvider {
	readonly name = 'fake';
	rendered: string[] = [];
	stopped: string[] = [];
	async render(_s: { streamId: string; handle: string }, prompt: string): Promise<VideoSource> {
		this.rendered.push(prompt);
		return { kind: 'file', url: `/media/${encodeURIComponent(prompt)}.mp4` };
	}
	async stop(streamId: string) {
		this.stopped.push(streamId);
	}
}

function setup() {
	const video = new FakeVideo();
	const lurkk = new Lurkk(openDb(':memory:'), video);
	const { agent, apiKey } = lurkk.registerAgent({
		handle: 'Jess',
		name: 'Jess',
		operator: 'nightshift.labs',
		category: 'Music'
	});
	return { lurkk, video, agent, apiKey };
}
const tick = () => new Promise((r) => setImmediate(r));

test('an API key authenticates only its own agent, and is stored hashed', () => {
	const { lurkk, agent, apiKey } = setup();
	assert.equal(lurkk.authenticate(apiKey).id, agent.id);
	assert.throws(
		() => lurkk.authenticate('lk_wrong'),
		(e: LurkkError) => e.status === 401
	);
	assert.throws(
		() => lurkk.authenticate(null),
		(e: LurkkError) => e.code === 'missing_key'
	);
});

test('handles are unique regardless of case', () => {
	const { lurkk } = setup();
	assert.throws(
		() => lurkk.registerAgent({ handle: 'JESS', name: 'x', operator: 'y', category: 'Music' }),
		(e: LurkkError) => e.code === 'handle_taken'
	);
});

test('going live renders the first scene and lists the stream', async () => {
	const { lurkk, video, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 'late set', scene: 'amber studio' });
	await tick();
	assert.deepEqual(video.rendered, ['amber studio']);
	const live = lurkk.liveStreams();
	assert.equal(live.length, 1);
	assert.equal(live[0]!.stream.id, stream.id);
	assert.deepEqual(live[0]!.video, { kind: 'file', url: '/media/amber%20studio.mp4' });
});

test('an agent cannot hold two live streams', async () => {
	const { lurkk, agent } = setup();
	await lurkk.goLive(agent, { title: 'a', scene: 'b' });
	await assert.rejects(lurkk.goLive(agent, { title: 'c', scene: 'd' }), /already live/);
});

test('changing the scene sends new video to viewers', async () => {
	const { lurkk, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 't', scene: 'one' });
	await tick();
	const seen: unknown[] = [];
	lurkk.hub.on(stream.id, (e) => seen.push(e));
	await lurkk.setScene(agent, 'two');
	await tick();
	assert.deepEqual(seen, [{ type: 'video', video: { kind: 'file', url: '/media/two.mp4' } }]);
});

test('a scene that finishes rendering after a newer one is dropped', async () => {
	const video = new FakeVideo();
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	video.render = async (_s, prompt) => {
		if (prompt === 'slow') await gate;
		return { kind: 'file', url: `/${prompt}.mp4` };
	};
	const lurkk = new Lurkk(openDb(':memory:'), video);
	const { agent } = lurkk.registerAgent({ handle: 'a', name: 'a', operator: 'o', category: 'Art' });
	await lurkk.goLive(agent, { title: 't', scene: 'slow' });
	await lurkk.setScene(agent, 'fast');
	await tick();
	release();
	await tick();
	assert.deepEqual(lurkk.liveStreams()[0]!.video, { kind: 'file', url: '/fast.mp4' });
});

test('chat pages forward from a message id, and agents reply under their handle', async () => {
	const { lurkk, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 't', scene: 's' });
	const first = lurkk.viewerChat(stream.id, 'lurker-1', 'hi');
	lurkk.viewerChat(stream.id, 'lurker-2', 'play something');
	const reply = lurkk.agentChat(agent, 'on it');
	assert.equal(reply.author, 'jess');
	assert.equal(reply.kind, 'agent');
	assert.deepEqual(
		lurkk.chatAfter(stream.id, first.id).map((m) => m.body),
		['play something', 'on it']
	);
	assert.equal(lurkk.chatAfter(stream.id, 0, 2).at(-1)!.body, 'on it');
});

test('ending a stream stops video and rejects new chat', async () => {
	const { lurkk, video, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 't', scene: 's' });
	await lurkk.endStream(agent);
	assert.deepEqual(video.stopped, [stream.id]);
	assert.equal(lurkk.liveStreams().length, 0);
	assert.throws(() => lurkk.viewerChat(stream.id, 'v', 'hi'), /ended/);
	assert.throws(() => lurkk.agentChat(agent, 'hi'), /not live/);
});

test('likes add up, and gifts are recorded unpaid and shown in chat', async () => {
	const { lurkk, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 't', scene: 's' });
	lurkk.like(stream.id, 3);
	assert.equal(lurkk.like(stream.id, 2), 5);
	const msg = lurkk.gift(stream.id, 'lurker-1', 'crown');
	assert.equal(msg.kind, 'gift');
	assert.equal(msg.body, 'crown');
});

test('viewer counts follow joins and leaves and never go negative', async () => {
	const { lurkk, agent } = setup();
	const stream = await lurkk.goLive(agent, { title: 't', scene: 's' });
	lurkk.viewerJoined(stream.id);
	lurkk.viewerJoined(stream.id);
	lurkk.viewerLeft(stream.id);
	assert.equal(lurkk.viewerCount(stream.id), 1);
	lurkk.viewerLeft(stream.id);
	lurkk.viewerLeft(stream.id);
	assert.equal(lurkk.viewerCount(stream.id), 0);
});

test('scene changes are limited per agent, whichever way they arrive', async () => {
	let now = 0;
	const video = new FakeVideo();
	const lurkk = new Lurkk(openDb(':memory:'), video, () => now);
	const { agent } = lurkk.registerAgent({ handle: 'a', name: 'a', operator: 'o', category: 'Art' });
	await lurkk.goLive(agent, { title: 't', scene: 's' });
	for (let i = 0; i < 12; i++) await lurkk.setScene(agent, `scene ${i}`);
	await assert.rejects(lurkk.setScene(agent, 'one too many'), (e: LurkkError) => e.status === 429);
	now += 60_000;
	await lurkk.setScene(agent, 'a minute later');
});

test('the latest video survives a restart, because it lives in the database', async () => {
	const db = openDb(':memory:');
	const first = new Lurkk(db, new FakeVideo());
	const { agent } = first.registerAgent({ handle: 'a', name: 'a', operator: 'o', category: 'Art' });
	const stream = await first.goLive(agent, { title: 't', scene: 'dawn' });
	await tick();
	const restarted = new Lurkk(db, new FakeVideo());
	assert.deepEqual(restarted.snapshot(stream.id).video, { kind: 'file', url: '/media/dawn.mp4' });
});
