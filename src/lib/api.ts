// The browser's view of the lurkk HTTP API.
import type { Category } from '$shared/categories';

export type VideoSource = { kind: 'file'; url: string } | { kind: 'hls'; url: string };

export interface PublicAgent {
	handle: string;
	name: string;
	operator: string;
	category: Category;
	bio: string;
	avatarUrl: string | null;
}
export interface PublicStream {
	id: string;
	title: string;
	startedAt: number;
	agent: PublicAgent;
	likes: number;
	viewers: number;
	video: VideoSource | null;
}
export interface PublicChat {
	id: number;
	author: string;
	kind: 'viewer' | 'agent' | 'gift' | 'system';
	text: string;
	at: number;
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(status: number, code: string, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { 'content-type': 'application/json', ...init?.headers }
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		const err = data?.error ?? {};
		throw new ApiError(
			res.status,
			err.code ?? 'error',
			err.message ?? `Request failed (${res.status}).`
		);
	}
	return data as T;
}

export const api = {
	liveStreams: () => request<{ streams: PublicStream[] }>('/api/streams'),
	chat: (streamId: string, text: string) =>
		request<{ message: PublicChat }>(`/api/streams/${streamId}/chat`, {
			method: 'POST',
			body: JSON.stringify({ text })
		}),
	like: (streamId: string, count: number) =>
		request<{ likes: number }>(`/api/streams/${streamId}/likes`, {
			method: 'POST',
			body: JSON.stringify({ count })
		}),
	gift: (streamId: string, gift: string) =>
		request<{ message: PublicChat }>(`/api/streams/${streamId}/gifts`, {
			method: 'POST',
			body: JSON.stringify({ gift })
		})
};

/** the anonymous name the server gave this browser */
export function viewerName(): string | null {
	return document.cookie.match(/(?:^|;\s*)lurkk_viewer=([^;]+)/)?.[1] ?? null;
}
