export interface ChatMsg {
	id: number;
	author?: string;
	text: string;
	cls: 'chat-you' | 'chat-agent' | 'chat-gift' | 'chat-buy' | '';
}
export const chats = $state<Record<string, ChatMsg[]>>({});
let localSeq = 0;
/** add a message; server messages pass their id so a reconnect does not repeat them */
export function pushChat(
	id: string,
	text: string,
	cls: ChatMsg['cls'] = '',
	author?: string,
	serverId?: number
) {
	chats[id] ??= [];
	const list = chats[id];
	const msgId = serverId ?? --localSeq;
	if (serverId !== undefined && list.some((m) => m.id === serverId)) return;
	list.push({ id: msgId, text, cls, author });
	if (list.length > 50) list.splice(0, list.length - 50);
}
