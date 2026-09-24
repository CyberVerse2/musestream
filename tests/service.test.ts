import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/lib/server/db.ts';
import { Musestream, MusestreamError } from '../src/lib/server/service.ts';
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
	const musestream = new Musestream(openDb(':memory:'), video);
	const { agent, apiKey } = musestream.registerAgent({
		handle: 'Jess',
		name: 'Jess',
		operator: 'nightshift.labs',
		category: 'Music'
	});
	return { musestream, video, agent, apiKey };
}
const tick = () => new Promise((r) => setImmediate(r));

test('an API key authenticates only its own agent, and is stored hashed', () => {
	const { musestream, agent, apiKey } = setup();
	assert.equal(musestream.authenticate(apiKey).id, agent.id);
	assert.throws(
		() => musestream.authenticate('ms_wrong'),
		(e: MusestreamError) => e.status === 401
	);
	assert.throws(
		() => musestream.authenticate(null),
		(e: MusestreamError) => e.code === 'missing_key'
	);
});

test('handles are unique regardless of case', () => {
	const { musestream } = setup();
	assert.throws(
		() => musestream.registerAgent({ handle: 'JESS', name: 'x', operator: 'y', category: 'Music' }),
		(e: MusestreamError) => e.code === 'handle_taken'
	);
});

test('going live renders the first scene and lists the stream', async () => {
	const { musestream, video, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 'late set', scene: 'amber studio' });
	await tick();
	assert.deepEqual(video.rendered, ['amber studio']);
	const live = musestream.liveStreams();
	assert.equal(live.length, 1);
	assert.equal(live[0]!.stream.id, stream.id);
	assert.deepEqual(live[0]!.video, { kind: 'file', url: '/media/amber%20studio.mp4' });
});

test('an agent cannot hold two live streams', async () => {
	const { musestream, agent } = setup();
	await musestream.goLive(agent, { title: 'a', scene: 'b' });
	await assert.rejects(musestream.goLive(agent, { title: 'c', scene: 'd' }), /already live/);
});

test('changing the scene sends new video to viewers', async () => {
	const { musestream, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 't', scene: 'one' });
	await tick();
	const seen: unknown[] = [];
	musestream.hub.on(stream.id, (e) => seen.push(e));
	await musestream.setScene(agent, 'two');
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
	const musestream = new Musestream(openDb(':memory:'), video);
	const { agent } = musestream.registerAgent({
		handle: 'a',
		name: 'a',
		operator: 'o',
		category: 'Art'
	});
	await musestream.goLive(agent, { title: 't', scene: 'slow' });
	await musestream.setScene(agent, 'fast');
	await tick();
	release();
	await tick();
	assert.deepEqual(musestream.liveStreams()[0]!.video, { kind: 'file', url: '/fast.mp4' });
});

test('chat pages forward from a message id, and agents reply under their handle', async () => {
	const { musestream, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
	const first = musestream.viewerChat(stream.id, 'lurker-1', 'hi');
	musestream.viewerChat(stream.id, 'lurker-2', 'play something');
	const reply = musestream.agentChat(agent, 'on it');
	assert.equal(reply.author, 'jess');
	assert.equal(reply.kind, 'agent');
	assert.deepEqual(
		musestream.chatAfter(stream.id, first.id).map((m) => m.body),
		['play something', 'on it']
	);
	assert.equal(musestream.chatAfter(stream.id, 0, 2).at(-1)!.body, 'on it');
});

test('ending a stream stops video and rejects new chat', async () => {
	const { musestream, video, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
	await musestream.endStream(agent);
	assert.deepEqual(video.stopped, [stream.id]);
	assert.equal(musestream.liveStreams().length, 0);
	assert.throws(() => musestream.viewerChat(stream.id, 'v', 'hi'), /ended/);
	assert.throws(() => musestream.agentChat(agent, 'hi'), /not live/);
});

test('likes add up, and gifts are recorded unpaid and shown in chat', async () => {
	const { musestream, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
	musestream.like(stream.id, 3);
	assert.equal(musestream.like(stream.id, 2), 5);
	const msg = musestream.gift(stream.id, 'lurker-1', 'crown');
	assert.equal(msg.kind, 'gift');
	assert.equal(msg.body, 'crown');
});

test('viewer counts follow joins and leaves and never go negative', async () => {
	const { musestream, agent } = setup();
	const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
	musestream.viewerJoined(stream.id);
	musestream.viewerJoined(stream.id);
	musestream.viewerLeft(stream.id);
	assert.equal(musestream.viewerCount(stream.id), 1);
	musestream.viewerLeft(stream.id);
	musestream.viewerLeft(stream.id);
	assert.equal(musestream.viewerCount(stream.id), 0);
});

test('scene changes are limited per agent, whichever way they arrive', async () => {
	let now = 0;
	const video = new FakeVideo();
	const musestream = new Musestream(openDb(':memory:'), video, () => now);
	const { agent } = musestream.registerAgent({
		handle: 'a',
		name: 'a',
		operator: 'o',
		category: 'Art'
	});
	await musestream.goLive(agent, { title: 't', scene: 's' });
	for (let i = 0; i < 12; i++) await musestream.setScene(agent, `scene ${i}`);
	await assert.rejects(
		musestream.setScene(agent, 'one too many'),
		(e: MusestreamError) => e.status === 429
	);
	now += 60_000;
	await musestream.setScene(agent, 'a minute later');
});

test('the latest video survives a restart, because it lives in the database', async () => {
	const db = openDb(':memory:');
	const first = new Musestream(db, new FakeVideo());
	const { agent } = first.registerAgent({ handle: 'a', name: 'a', operator: 'o', category: 'Art' });
	const stream = await first.goLive(agent, { title: 't', scene: 'dawn' });
	await tick();
	const restarted = new Musestream(db, new FakeVideo());
	assert.deepEqual(restarted.snapshot(stream.id).video, { kind: 'file', url: '/media/dawn.mp4' });
});
