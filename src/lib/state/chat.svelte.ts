export interface ChatMsg {
	id: number;
	author?: string;
	text: string;
	cls: 'chat-you' | 'chat-buy' | '';
}
export const chats = $state<Record<string, ChatMsg[]>>({});
let sequence = 0;
export function pushChat(id: string, text: string, cls: ChatMsg['cls'] = '', author?: string) {
	chats[id] ??= [];
	const list = chats[id];
	list.push({ id: ++sequence, text, cls, author });
	if (list.length > 50) list.splice(0, list.length - 50);
}
