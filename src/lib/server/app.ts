// The one musestream instance for this server process.
import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPublicClient, http, parseEther } from 'viem';
import { robinhood } from 'viem/chains';
import { Charts } from './chain/charts.ts';
import { Coins } from './chain/coins.ts';
import { EthPrice, PairPrices } from './chain/prices.ts';
import { DynamicWallets } from './chain/dynamic-wallets.ts';
import { LocalWallets, Sealer, Wallets, type WalletProvider } from './chain/wallets.ts';
import { openDb } from './db.ts';
import { Musestream } from './service.ts';
import { MockVideo } from './video/mock.ts';
import { VideoBudget } from './video/budget.ts';
import { SceneImages } from './video/scene-image.ts';
import { Voices } from './voice.ts';
import type { VideoProvider } from './video/provider.ts';
import { ReactorVideo } from './video/reactor.ts';

export const DATA_DIR = resolve(env.MUSESTREAM_DATA_DIR ?? 'data');
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
			idleSeconds: Math.max(0, Number(env.REACTOR_IDLE_SECONDS ?? 30)),
			// 10 minutes of paid video per agent per UTC day
			budget: new VideoBudget(db, Math.max(0, Number(env.REACTOR_DAILY_SECONDS ?? 600))),
			mediaDir: MEDIA_DIR,
			staticDir: resolve('static'),
			workerDir: resolve('video-worker'),
			fallback: mock
		});
	}
	throw new Error(`VIDEO_PROVIDER must be "mock" or "reactor", not "${name}".`);
}

export const db = openDb(join(DATA_DIR, 'musestream.db'));
export const musestream = new Musestream(db, videoProvider(), Date.now, {
	sceneImages: env.MODEL_API_KEY
		? new SceneImages(env.MODEL_API_KEY, { staticDir: resolve('static'), mediaDir: MEDIA_DIR })
		: undefined,
	voices: env.OPENAI_API_KEY ? new Voices(env.OPENAI_API_KEY, MEDIA_DIR) : undefined
});
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

/** server wallets: Dynamic when configured, otherwise keys kept (sealed) in the database */
function walletProvider(sealer: Sealer, rpcUrl: string): WalletProvider {
	if ((env.WALLET_PROVIDER ?? 'local') === 'local') return new LocalWallets(sealer);
	if (env.WALLET_PROVIDER !== 'dynamic')
		throw new Error('WALLET_PROVIDER must be "local" or "dynamic".');
	const missing = ['DYNAMIC_ENVIRONMENT_ID', 'DYNAMIC_API_TOKEN', 'DYNAMIC_WALLET_PASSWORD'].filter(
		(k) => !env[k]
	);
	if (missing.length) throw new Error(`WALLET_PROVIDER=dynamic needs ${missing.join(', ')}.`);
	return new DynamicWallets({
		environmentId: env.DYNAMIC_ENVIRONMENT_ID!,
		apiToken: env.DYNAMIC_API_TOKEN!,
		walletPassword: env.DYNAMIC_WALLET_PASSWORD!,
		chain: robinhood,
		rpcUrl,
		sealer
	});
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
	const sealer = new Sealer(walletKey());
	const wallets = new Wallets(db, walletProvider(sealer, rpcUrl));
	console.log(
		`[chain] coins on ${mode === 'fork' ? 'a local fork (test ETH)' : 'Robinhood Chain (real money)'}`
	);
	return new Coins({
		db,
		hub: musestream.hub,
		wallets,
		client,
		rpcUrl,
		devFork: mode === 'fork',
		// launches and payouts cost the treasury gas; this bounds a bad day, e.g. a sign-up flood
		treasuryDailyWei: parseEther(env.TREASURY_DAILY_SPEND_ETH ?? '0.05')
	});
}
export const coins = makeCoins();
/** dollars per unit of each coin pair: ETH from Codex, META from its USDG market */
export const pairPrices = coins
	? new PairPrices(ethPrice, (pair, pairIn, amount) => coins.pairQuote(pair, pairIn, amount))
	: null;
export const charts = coins && pairPrices ? new Charts(coins, pairPrices, env.CODEX_API_KEY) : null;
export const wallets = coins ? coins.walletsStore : null;

// background work: index trades, settle fees. Replaced on dev reloads, never doubled.
const runtime = globalThis as unknown as { __musestreamStop?: () => void };
runtime.__musestreamStop?.();
if (coins) {
	// load the ETH rate early so the first prices can show dollars
	void ethPrice.usd();
	// on a test chain, give coins to agents that registered before coins existed (once per process)
	const once = globalThis as unknown as { __musestreamBackfilled?: boolean };
	if (coins.testMoney && !once.__musestreamBackfilled) {
		once.__musestreamBackfilled = true;
		void (async () => {
			for (const agent of musestream.agentsWithoutCoins()) {
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
	runtime.__musestreamStop = () => {
		stopIndexer();
		clearInterval(settle);
	};
} else {
	runtime.__musestreamStop = undefined;
}
