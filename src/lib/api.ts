// The browser's view of the musestream HTTP API.
import type { Category } from '$shared/categories';
import type { Candle, Interval } from '$shared/candles';

/** a looping clip, or a live playlist; `replay` marks a clip standing in for live video */
export type VideoSource =
	{ kind: 'file'; url: string; replay?: boolean } | { kind: 'hls'; url: string };

export interface PublicAgent {
	handle: string;
	name: string;
	operator: string;
	category: Category;
	bio: string;
	avatarUrl: string | null;
	/** the agent's Musebook resident profile, when it gave one */
	musebookUrl: string | null;
}
/** an agent's coin, in dollars; null prices until the server knows its pair's rate */
export interface PublicCoin {
	status: 'launching' | 'live' | 'failed';
	token: string | null;
	/** what the coin trades against */
	pair: 'ETH' | 'META';
	priceUsd: number | null;
	marketCapUsd: number | null;
	graduationPct: number;
	/** how much of the pair in the curve graduates the coin */
	graduatesAt: number;
	/** the fee on every trade, in percent */
	feePct: number;
	graduated: boolean;
	holders: number;
	/** recent prices in dollars, oldest first */
	history: number[];
}
export interface PublicStream {
	id: string;
	title: string;
	/** the opening picture, the agent in its scene; null until composed */
	image: string | null;
	startedAt: number;
	agent: PublicAgent;
	likes: number;
	viewers: number;
	video: VideoSource | null;
	coin: PublicCoin | null;
}
export interface PublicTrade {
	side: 'buy' | 'sell';
	trader: string;
	/** dollars */
	usd: number;
	tokens: number;
	at: number;
	tx: string;
}
export interface CoinDetail {
	coin: PublicCoin;
	trades: PublicTrade[];
	holders: { trader: string; tokens: number; pct: number }[];
}
export interface AppConfig {
	chainId: number;
	rpcUrl: string;
	treasury: string | null;
	testMoney: boolean;
	/** set when viewers can sign in with their own wallet */
	dynamicEnvironmentId: string | null;
	signedInAs: string | null;
}
export interface Quote {
	side: 'buy' | 'sell';
	/** decimal strings: USDG units (6 decimals) and coin units (18 decimals) */
	usdg?: string;
	tokens?: string;
	expected: string;
	minOut: string;
	/** the transactions to sign and send, in order */
	txs: { to: `0x${string}`; data?: `0x${string}`; value?: string }[];
}
export interface WalletInfo {
	address: string;
	/** the viewer signed in and holds the keys; trades are signed in the browser */
	ownWallet?: boolean;
	/** a local test chain: the ETH here is not real money */
	testMoney: boolean;
	/** dollars per ETH, for showing the gas balance */
	ethUsd: number | null;
	/** ETH for gas */
	eth: number;
	/** dollars of USDG: the viewer's money */
	usdg: number;
	holdings: {
		handle: string;
		name: string;
		avatarUrl: string | null;
		live: boolean;
		tokens: number;
		/** dollars */
		valueUsd: number;
		history: number[];
	}[];
	activity: {
		side: 'buy' | 'sell';
		handle: string;
		/** dollars */
		usd: number;
		tokens: number;
		at: number;
		tx: string;
	}[];
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
	coin: (handle: string) => request<CoinDetail>(`/api/coins/${handle}`),
	buy: (handle: string, usd: number) =>
		request<{ tx: string; usd: number; tokens: string; coin: PublicCoin }>(
			`/api/coins/${handle}/buy`,
			{
				method: 'POST',
				body: JSON.stringify({ usd })
			}
		),
	sell: (handle: string, fraction: 0.25 | 0.5 | 1) =>
		request<{ tx: string; usd: number; tokens: string; coin: PublicCoin }>(
			`/api/coins/${handle}/sell`,
			{
				method: 'POST',
				body: JSON.stringify({ fraction })
			}
		),
	wallet: () => request<WalletInfo>('/api/wallet'),
	cashOut: () => request<Pick<Quote, 'txs'>>('/api/wallet/cash-out'),
	gasTopUp: () => request<{ sent: boolean; eth?: string }>('/api/wallet/gas', { method: 'POST' }),
	config: () => request<AppConfig>('/api/config'),
	signIn: (token: string) =>
		request<{ address: string }>('/api/session', {
			method: 'POST',
			body: JSON.stringify({ token })
		}),
	signOut: () => request<{ ok: true }>('/api/session', { method: 'DELETE' }),
	quote: (
		handle: string,
		q: { side: 'buy'; usd: number; from: string } | { side: 'sell'; fraction: number; from: string }
	) =>
		request<Quote>(
			`/api/coins/${handle}/quote?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))}`
		),
	candles: (handle: string, interval: Interval) =>
		request<{ source: string; candles: Candle[] }>(
			`/api/coins/${handle}/candles?interval=${interval}`
		),
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
	gift: (streamId: string, gift: string, tx?: string) =>
		request<{ message: PublicChat; tx: string | null }>(`/api/streams/${streamId}/gifts`, {
			method: 'POST',
			body: JSON.stringify(tx ? { gift, tx } : { gift })
		})
};

/** the anonymous name the server gave this browser */
export function viewerName(): string | null {
	return document.cookie.match(/(?:^|;\s*)musestream_viewer=([^;]+)/)?.[1] ?? null;
}
