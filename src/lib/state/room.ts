// The live connection for the stream on screen: chat, likes, viewers, video.
import { api, viewerName, type PublicChat, type PublicCoin, type VideoSource } from '../api';
import { setCoin } from './market.svelte';
import { pushChat } from './chat.svelte';
import { findAgent, refreshDirectory } from './directory.svelte';
import { showToast } from './notifications.svelte';

let source: EventSource | null = null;
let connectedTo: string | null = null;

function addMessage(agentId: string, m: PublicChat) {
	const me = viewerName();
	const cls =
		m.author === me
			? 'chat-you'
			: m.kind === 'agent'
				? 'chat-agent'
				: m.kind === 'gift'
					? 'chat-gift'
					: '';
	pushChat(agentId, m.kind === 'gift' ? `sent ${m.text}` : m.text, cls, m.author, m.id);
}

/** Watch one stream. Opening another closes the previous connection. */
export function watchRoom(agentId: string, streamId: string) {
	if (connectedTo === streamId) return;
	leaveRoom();
	connectedTo = streamId;
	const es = new EventSource(`/api/streams/${streamId}/events`);
	source = es;
	const on = <T>(type: string, fn: (data: T) => void) =>
		es.addEventListener(type, (e) => fn(JSON.parse((e as MessageEvent).data)));

	on<{
		chat: PublicChat[];
		likes: number;
		viewers: number;
		video: VideoSource | null;
		coin: PublicCoin | null;
	}>('snapshot', (snap) => {
		const agent = findAgent(agentId);
		for (const m of snap.chat) addMessage(agentId, m);
		if (snap.coin) setCoin(agentId, snap.coin);
		if (!agent) return;
		agent.likes = Math.max(agent.likes, snap.likes);
		agent.viewers = snap.viewers;
		if (snap.video) agent.video = snap.video;
	});
	on<PublicChat>('chat', (m) => addMessage(agentId, m));
	on<{ coin: PublicCoin }>('coin', ({ coin }) => setCoin(agentId, coin));
	on<{ likes: number }>('likes', ({ likes }) => {
		const agent = findAgent(agentId);
		if (agent) agent.likes = Math.max(agent.likes, likes);
	});
	on<{ viewers: number }>('viewers', ({ viewers }) => {
		const agent = findAgent(agentId);
		if (agent) agent.viewers = viewers;
	});
	on<{ video: VideoSource }>('video', ({ video }) => {
		const agent = findAgent(agentId);
		if (agent) agent.video = video;
	});
	on<{ title: string }>('title', ({ title }) => {
		const agent = findAgent(agentId);
		if (agent) agent.title = title;
	});
	on('ended', () => {
		leaveRoom();
		void refreshDirectory();
	});
}

export function leaveRoom() {
	source?.close();
	source = null;
	connectedTo = null;
}

export async function sendChat(streamId: string, text: string) {
	try {
		await api.chat(streamId, text);
	} catch (err) {
		showToast('⚠', err instanceof Error ? err.message : 'Message not sent');
	}
}

/* taps come fast; send them in small batches */
const pending = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
export function like(agentId: string) {
	const agent = findAgent(agentId);
	if (!agent) return;
	agent.likes += 1;
	pending.set(agent.streamId, (pending.get(agent.streamId) ?? 0) + 1);
	clearTimeout(flushTimer);
	flushTimer = setTimeout(flushLikes, 400);
}
function flushLikes() {
	for (const [streamId, count] of pending) {
		pending.delete(streamId);
		for (let left = count; left > 0; left -= 50) {
			void api.like(streamId, Math.min(50, left)).catch(() => {});
		}
	}
}
