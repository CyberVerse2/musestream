import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/lib/server/db.ts';
import { VideoBudget } from '../src/lib/server/video/budget.ts';
import { ReactorVideo } from '../src/lib/server/video/reactor.ts';
import type { StreamInfo, VideoProvider, VideoSource } from '../src/lib/server/video/provider.ts';

const clip: VideoProvider = {
	name: 'clip',
	render: async (s) => ({ kind: 'file', url: `/media/${s.streamId}/clip.mp4` }),
	stop: async () => {}
};
const stream: StreamInfo = {
	streamId: 's1',
	agentId: 'a1',
	avatarUrl: null,
	imageUrl: null,
	handle: 'jess',
	name: 'Jess'
};
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(dailySeconds = 600) {
	const db = openDb(':memory:');
	db.prepare(
		`INSERT INTO agents (id, handle, name, operator, category, bio, created_at)
		 VALUES ('a1', 'jess', 'Jess', 'o', 'Music', '', 0)`
	).run();
	const budget = new VideoBudget(db, dailySeconds);
	const video = new ReactorVideo({
		apiKey: 'test',
		agents: ['jess'],
		maxSessions: 1,
		maxSeconds: 60,
		idleSeconds: 0.05,
		budget,
		mediaDir: '/tmp/musestream-test-media',
		staticDir: '.',
		workerDir: '.',
		workerCommand: ['node', fileURLToPath(new URL('./fixtures/fake-worker.mjs', import.meta.url))],
		fallback: clip
	});
	const changes: VideoSource[] = [];
	video.onChange((_id, source) => changes.push(source));
	return { budget, video, changes };
}

test('with nobody watching, a paid agent shows its replay clip and spends nothing', async () => {
	const { budget, video } = setup();
	const source = await video.render(stream, 'a rooftop at dusk');
	assert.deepEqual(source, { kind: 'file', url: '/media/s1/clip.mp4', replay: true });
	assert.equal(budget.remaining('a1'), 600);
});

test('a viewer starts paid video; when the last one leaves, it stops and the replay returns', async () => {
	const { budget, video, changes } = setup();
	video.watchers(stream, 'a rooftop at dusk', 1);
	await tick(300);
	assert.equal(changes.at(-1)?.kind, 'clips', 'the first live clip reached the stream');
	assert.equal(budget.remaining('a1'), 540, 'the session reserved its full 60 seconds');

	video.watchers(stream, 'a rooftop at dusk', 0);
	await tick(500);
	assert.deepEqual(changes.at(-1), { kind: 'file', url: '/media/s1/clip.mp4', replay: true });
	assert.equal(budget.remaining('a1'), 599, 'unused time came back; wall time is billed');
});

test('an agent out of paid time today gets the replay even with viewers', async () => {
	const { budget, video } = setup(20);
	video.watchers(stream, 'scene', 3);
	await tick(100);
	assert.equal(budget.remaining('a1'), 20, 'no session started');
	assert.equal((await video.render(stream, 'scene')).kind, 'file');
});

test('a session never runs past what is left of the allowance', async () => {
	const { budget, video } = setup(45);
	video.watchers(stream, 'scene', 1);
	await tick(300);
	assert.equal(budget.remaining('a1'), 0, 'it reserved all 45 seconds, not the 60 cap');
	await video.stop('s1');
	await tick(300);
	assert.equal(budget.remaining('a1'), 44);
});

test('in live video an act plays as the next clips, and idle clips carry it on', async () => {
	const log = join(mkdtempSync(join(tmpdir(), 'musestream-')), 'worker.jsonl');
	process.env.FAKE_WORKER_LOG = log;
	const { video } = setup();
	const act = { action: 'waves at the camera', say: 'Hi everyone, welcome in!' };
	assert.equal(video.act(stream, 'a rooftop at dusk', act), false, 'nothing is live yet');

	video.watchers(stream, 'a rooftop at dusk', 1);
	await tick(300);
	const source = await video.render(stream, 'a rooftop at dusk');
	assert.deepEqual(source, {
		kind: 'clips',
		clips: [{ url: source.kind === 'clips' ? source.clips[0]!.url : '', idle: true }]
	});
	assert.match(
		source.kind === 'clips' ? source.clips[0]!.url : '',
		/^\/media\/s1\/session-\d+\/00001-idle\.mp4$/
	);
	assert.equal(video.act(stream, 'a rooftop at dusk', act), true);
	await video.render(stream, 'the roof, now in rain');
	await video.stop('s1');
	await tick(200);
	delete process.env.FAKE_WORKER_LOG;

	const entries = readFileSync(log, 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));
	const args: string[] = entries[0].args;
	assert.match(args[args.indexOf('--idle-prompt') + 1], /a rooftop at dusk/);
	const clips = entries.filter((e) => e.clip);
	assert.equal(clips.length, 1);
	assert.match(clips[0].clip.prompt, /waves at the camera/);
	assert.match(clips[0].clip.prompt, /<d>\[English\] Hi everyone, welcome in!<\/d>/);
	const idle = entries.filter((e) => e.idle).at(-1);
	assert.match(idle.idle.prompt, /the roof, now in rain/, 'a new scene reaches the idle clip');
	assert.match(idle.idle.prompt, /carries on: waves at the camera/);
});
