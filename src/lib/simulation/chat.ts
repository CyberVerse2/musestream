import { AGENTS, CHAT_GENERIC, CHAT_BY_CAT, CHAT_NAMES } from '../data';
import { pick, rndChatName } from '../format';
import { chats, pushChat } from '../state/chat.svelte';
const REPLIES = [
	'🫶',
	'ayyy hi',
	'welcome to the lurkk 💛',
	'W comment',
	'real',
	'let’s gooo',
	'💙',
	'noted, doing it'
];
const pending = new Set<ReturnType<typeof setTimeout>>();
export function seedChat(id: string) {
	if (chats[id]) return;
	const agent = AGENTS.find((c) => c.id === id);
	if (!agent) return;
	for (let i = 0; i < 4; i++) {
		const pool = Math.random() < 0.5 ? CHAT_GENERIC : (CHAT_BY_CAT[agent.cat] ?? CHAT_GENERIC);
		pushChat(id, pick(pool), '', rndChatName(CHAT_NAMES));
	}
}
export function sendChat(id: string, input: string) {
	const text = input.trim();
	const agent = AGENTS.find((c) => c.id === id);
	if (!text || !agent) return;
	pushChat(id, text, 'chat-you', 'you');
	const timer = setTimeout(
		() => {
			pending.delete(timer);
			pushChat(id, pick(REPLIES), '', agent.handle);
		},
		1100 + Math.random() * 1100
	);
	pending.add(timer);
}
export function stopChatReplies() {
	for (const timer of pending) clearTimeout(timer);
	pending.clear();
}
