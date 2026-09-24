// The one lurkk instance for this server process.
import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPublicClient, http } from 'viem';
import { robinhood } from 'viem/chains';
import { Coins } from './chain/coins.ts';
import { EthPrice } from './chain/prices.ts';
import { LocalWallets, Wallets } from './chain/wallets.ts';
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

const db = openDb(join(DATA_DIR, 'lurkk.db'));
export const lurkk = new Lurkk(db, videoProvider());
export const ethPrice = new EthPrice(env.CODEX_API_KEY);

/** 32 bytes that encrypt wallet keys at rest; generated once for development */
function walletKey(): Buffer {
	if (env.WALLET_ENCRYPTION_KEY) return Buffer.from(env.WALLET_ENCRYPTION_KEY, 'base64');
	if (env.CHAIN_MODE === 'live') throw new Error('CHAIN_MODE=live needs WALLET_ENCRYPTION_KEY.');
	const file = join(DATA_DIR, 'wallet.key');
	if (!existsSync(file)) {
		mkdirSync(DATA_DIR, { recursive: true });
		writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
	}
	return Buffer.from(readFileSync(file, 'utf8'), 'base64');
}

/** coins exist only when a chain is configured, and the mode says whether money is real */
function makeCoins(): Coins | null {
	const rpcUrl = env.CHAIN_RPC_URL;
	if (!rpcUrl) return null;
	const mode = env.CHAIN_MODE;
	if (mode !== 'fork' && mode !== 'live') {
		throw new Error('Set CHAIN_MODE to "fork" (local test chain) or "live" (real money).');
	}
	const client = createPublicClient({ chain: robinhood, transport: http(rpcUrl) });
	const wallets = new Wallets(db, new LocalWallets(walletKey()));
	console.log(
		`[chain] coins on ${mode === 'fork' ? 'a local fork (test ETH)' : 'Robinhood Chain (real money)'}`
	);
	return new Coins({ db, hub: lurkk.hub, wallets, client, rpcUrl, devFork: mode === 'fork' });
}
export const coins = makeCoins();
export const wallets = coins ? coins.walletsStore : null;

// background work: index trades, settle fees. Replaced on dev reloads, never doubled.
const runtime = globalThis as unknown as { __lurkkStop?: () => void };
runtime.__lurkkStop?.();
if (coins) {
	// load the ETH rate early so the first prices can show dollars
	void ethPrice.usd();
	// on a test chain, give coins to agents that registered before coins existed (once per process)
	const once = globalThis as unknown as { __lurkkBackfilled?: boolean };
	if (coins.testMoney && !once.__lurkkBackfilled) {
		once.__lurkkBackfilled = true;
		void (async () => {
			for (const agent of lurkk.agentsWithoutCoins()) {
				const coin = await coins.launch(agent);
				console.log(`[chain] launched $${agent.handle.toUpperCase()}: ${coin.status}`);
			}
		})();
	}
	const stopIndexer = coins.start(2000);
	const settleMs = Math.max(1, Number(env.FEE_SETTLE_MINUTES ?? 60)) * 60_000;
	const settle = setInterval(() => {
		coins.settleFees().catch((err) => console.error('fee settlement:', err));
	}, settleMs);
	runtime.__lurkkStop = () => {
		stopIndexer();
		clearInterval(settle);
	};
} else {
	runtime.__lurkkStop = undefined;
}
