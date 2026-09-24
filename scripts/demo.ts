// Development demo: registers the demo agents, puts them live, and keeps their rooms busy.
// Everything goes through the public HTTP API, the same way a real agent would call it.
//
//   npm run demo                      # against http://localhost:5173
//   LURKK_URL=http://localhost:5174 npm run demo
//
// Uses the mock video provider on the server; it never calls a paid video model.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CHAT_BY_CAT, CHAT_GENERIC, DEMO_AGENTS, REPLIES } from './demo-data.ts';

const BASE = process.env.LURKK_URL ?? 'http://localhost:5173';
const KEYS_FILE = 'data/demo-keys.json';

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, init: RequestInit & { key?: string; viewer?: string } = {}) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (init.key) headers.authorization = `Bearer ${init.key}`;
	if (init.viewer) headers.cookie = `lurkk_viewer=${init.viewer}`;
	const res = await fetch(BASE + path, { ...init, headers });
	const data = await res.json().catch(() => null);
	return { status: res.status, data };
}

function loadKeys(): Record<string, string> {
	return existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
}

async function ensureAgents() {
	const keys = loadKeys();
	for (const a of DEMO_AGENTS) {
		if (keys[a.id]) continue;
		const { status, data } = await call('/api/v1/agents', {
			method: 'POST',
			body: JSON.stringify({
				handle: a.id,
				name: a.name,
				operator: a.operator,
				category: a.cat,
				bio: a.bio,
				avatarUrl: `${BASE}/${a.img}`
			})
		});
		if (status !== 201) throw new Error(`register ${a.id}: ${JSON.stringify(data)}`);
		keys[a.id] = data.apiKey;
		// save each key at once: the server shows it only this one time
		mkdirSync('data', { recursive: true });
		writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
		console.log(`registered @${a.id}`);
	}
	return keys;
}

async function ensureLive(id: string, key: string, title: string) {
	const { data } = await call('/api/v1/stream', { key });
	if (data?.stream) return data.stream.id as string;
	const res = await call('/api/v1/stream', {
		method: 'POST',
		key,
		body: JSON.stringify({ title, scene: `${title}, opening shot` })
	});
	if (res.status !== 201) throw new Error(`go live ${id}: ${JSON.stringify(res.data)}`);
	console.log(`@${id} is live`);
	return res.data.stream.id as string;
}

/** the agent answers some viewer messages and changes the scene now and then */
async function runAgent(id: string, key: string, title: string) {
	let after = 0;
	let scene = 0;
	for (;;) {
		const { status, data } = await call(`/api/v1/stream/chat?after=${after}&wait=20`, { key });
		if (status !== 200) {
			await sleep(5000);
			continue;
		}
		after = data.next;
		for (const m of data.messages) {
			if (m.kind === 'viewer' && Math.random() < 0.35) {
				await call('/api/v1/stream/chat', {
					method: 'POST',
					key,
					body: JSON.stringify({ text: `@${m.author} ${pick(REPLIES)}` })
				});
			}
		}
		if (Math.random() < 0.15) {
			scene += 1;
			await call('/api/v1/stream/scene', {
				method: 'POST',
				key,
				body: JSON.stringify({ prompt: `${title}, scene ${scene}` })
			});
		}
	}
}

/** a few viewers per room who chat and like */
async function runAudience(streamId: string, cat: string) {
	const viewers = Array.from(
		{ length: 4 },
		() => `lurker-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`
	);
	for (;;) {
		await sleep(2500 + Math.random() * 5000);
		const viewer = pick(viewers);
		const pool = Math.random() < 0.5 ? CHAT_GENERIC : (CHAT_BY_CAT[cat] ?? CHAT_GENERIC);
		await call(`/api/streams/${streamId}/chat`, {
			method: 'POST',
			viewer,
			body: JSON.stringify({ text: pick(pool) })
		});
		if (Math.random() < 0.4) {
			await call(`/api/streams/${streamId}/likes`, {
				method: 'POST',
				viewer,
				body: JSON.stringify({ count: 1 + Math.floor(Math.random() * 8) })
			});
		}
	}
}

const keys = await ensureAgents();
for (const a of DEMO_AGENTS) {
	const key = keys[a.id]!;
	const streamId = await ensureLive(a.id, key, a.title);
	void runAgent(a.id, key, a.title).catch((e) => console.error(`@${a.id}:`, e));
	void runAudience(streamId, a.cat).catch((e) => console.error(`@${a.id} audience:`, e));
}
console.log(`${DEMO_AGENTS.length} demo agents are live on ${BASE}. Press Ctrl+C to stop.`);
