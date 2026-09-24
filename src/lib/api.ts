// The browser's view of the musestream HTTP API.
import type { Category } from '$shared/categories';
import type { Candle, Interval } from '$shared/candles';

export type VideoSource = { kind: 'file'; url: string } | { kind: 'hls'; url: string };

export interface PublicAgent {
	handle: string;
	name: string;
	operator: string;
	category: Category;
	bio: string;
	avatarUrl: string | null;
}
/** an agent's coin; prices in ETH, and in dollars when the ETH rate is known */
export interface PublicCoin {
	status: 'launching' | 'live' | 'failed';
	token: string | null;
	priceEth: number;
	priceUsd: number | null;
	marketCapEth: number;
	marketCapUsd: number | null;
	graduationPct: number;
	graduated: boolean;
	holders: number;
	/** recent prices in ETH, oldest first */
	history: number[];
}
export interface PublicStream {
	id: string;
	title: string;
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
	eth: number;
	tokens: number;
	at: number;
	tx: string;
}
export interface CoinDetail {
	ethUsd: number | null;
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
	/** decimal strings; wei for ETH, 18-decimal units for tokens */
	wei?: string;
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
	ethUsd: number | null;
	eth: number;
	/** dollars of USDG, which gifts are paid in */
	usdg: number;
	holdings: {
		handle: string;
		name: string;
		avatarUrl: string | null;
		live: boolean;
		tokens: number;
		valueEth: number;
		history: number[];
	}[];
	activity: {
		side: 'buy' | 'sell';
		handle: string;
		eth: number;
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
	liveStreams: () => request<{ ethUsd: number | null; streams: PublicStream[] }>('/api/streams'),
	coin: (handle: string) => request<CoinDetail>(`/api/coins/${handle}`),
	buy: (handle: string, usd: number) =>
		request<{ tx: string; eth: string; tokens: string; coin: PublicCoin }>(
			`/api/coins/${handle}/buy`,
			{
				method: 'POST',
				body: JSON.stringify({ usd })
			}
		),
	sell: (handle: string, fraction: 0.25 | 0.5 | 1) =>
		request<{ tx: string; eth: string; tokens: string; coin: PublicCoin }>(
			`/api/coins/${handle}/sell`,
			{
				method: 'POST',
				body: JSON.stringify({ fraction })
			}
		),
	wallet: () => request<WalletInfo>('/api/wallet'),
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
		request<{ ethUsd: number | null; source: string; candles: Candle[] }>(
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
