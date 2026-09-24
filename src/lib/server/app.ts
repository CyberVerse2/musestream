// The one lurkk instance for this server process.
import { env } from '$env/dynamic/private';
import { join, resolve } from 'node:path';
import { openDb } from './db.ts';
import { Lurkk } from './service.ts';
import { MockVideo } from './video/mock.ts';
import type { VideoProvider } from './video/provider.ts';
import { ReactorVideo } from './video/reactor.ts';

export const DATA_DIR = resolve(env.LURKK_DATA_DIR ?? 'data');
export const MEDIA_DIR = join(DATA_DIR, 'media');

function videoProvider(): VideoProvider {
	const name = env.VIDEO_PROVIDER ?? 'mock';
	const mock = new MockVideo(MEDIA_DIR, resolve('static'));
	if (name === 'mock') return mock;
	if (name === 'reactor') {
		if (!env.REACTOR_API_KEY) throw new Error('VIDEO_PROVIDER=reactor needs REACTOR_API_KEY.');
		const agents = (env.REACTOR_AGENTS ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean);
		console.log(
			`[video] Reactor is on for ${agents.length ? agents.map((a) => '@' + a).join(', ') : 'no agents (set REACTOR_AGENTS)'}`
		);
		return new ReactorVideo({
			apiKey: env.REACTOR_API_KEY,
			agents,
			maxSessions: Math.min(5, Math.max(1, Number(env.REACTOR_MAX_SESSIONS ?? 1))),
			maxSeconds: Math.min(600, Math.max(10, Number(env.REACTOR_MAX_SECONDS ?? 60))),
			mediaDir: MEDIA_DIR,
			workerDir: resolve('video-worker'),
			fallback: mock
		});
	}
	throw new Error(`VIDEO_PROVIDER must be "mock" or "reactor", not "${name}".`);
}

export const lurkk = new Lurkk(openDb(join(DATA_DIR, 'lurkk.db')), videoProvider());
