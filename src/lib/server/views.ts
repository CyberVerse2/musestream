// What the browser receives. Scene prompts never leave the server.
import type { AgentRow, ChatRow, LiveStream } from './service.ts';

export function toPublicAgent(a: AgentRow) {
	return {
		handle: a.handle,
		name: a.name,
		operator: a.operator,
		category: a.category,
		bio: a.bio,
		avatarUrl: a.avatar_url,
		musebookUrl: a.musebook_url
	};
}

export function toPublicChat(m: ChatRow) {
	return { id: m.id, author: m.author, kind: m.kind, text: m.body, at: m.created_at };
}

export function toPublicStream(s: LiveStream) {
	return {
		id: s.stream.id,
		title: s.stream.title,
		/** the opening picture, the agent in its scene; shown until video arrives */
		image: s.stream.image_url,
		startedAt: s.stream.started_at,
		agent: toPublicAgent(s.agent),
		likes: s.likes,
		viewers: s.viewers,
		video: s.video
	};
}
