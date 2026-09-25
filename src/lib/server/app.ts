// The one musestream instance for this server process.
import './logbook.ts';
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
import { Settings } from './settings.ts';
import { ClipVideo } from './video/clips.ts';
import { MockVideo } from './video/mock.ts';
import { VideoBudget } from './video/budget.ts';
import { SceneImages } from './video/scene-image.ts';
import { VoiceSamples } from './video/voice-sample.ts';
import { Voices } from './voice.ts';
import type { VideoProvider } from './video/provider.ts';
import { ReactorVideo } from './video/reactor.ts';

export const DATA_DIR = resolve(env.MUSESTREAM_DATA_DIR ?? 'data');
export const MEDIA_DIR = join(DATA_DIR, 'media');
/** when this server process started */
export const STARTED_AT = Date.now();

/** the video providers the owner can switch from the admin dashboard, when they run */
export const video: { reactor: ReactorVideo | null; clips: ClipVideo | null } = {
	reactor: null,
	clips: null
};

/**
 * `VIDEO_CLIPS=love=love.mp4,…`: agents whose stream loops a saved clip from `<data>/media/clips/`
 * in place of generated video
 */
function withClips(inner: VideoProvider): VideoProvider {
	const clips = new Map(
		(env.VIDEO_CLIPS ?? '')
			.split(',')
			.map((entry) => entry.trim().split('='))
			.filter(([handle, file]) => handle && file)
			.map(([handle, file]) => [handle.toLowerCase(), `/media/clips/${file}`] as const)
	);
	if (!clips.size) return inner;
	console.log(
		`[video] Looping saved clips for ${[...clips.keys()].map((h) => '@' + h).join(', ')}`
	);
	video.clips = new ClipVideo(clips, inner);
	return video.clips;
}

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
		video.reactor = new ReactorVideo({
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
			fallback: mock,
			voiceSamples:
				env.FISH_AUDIO_API_KEY && env.FISH_VOICE_ID
					? new VoiceSamples(env.FISH_AUDIO_API_KEY, env.FISH_VOICE_ID, MEDIA_DIR)
					: undefined
		});
		return video.reactor;
	}
	throw new Error(`VIDEO_PROVIDER must be "mock" or "reactor", not "${name}".`);
}

export const db = openDb(join(DATA_DIR, 'musestream.db'));
export const musestream = new Musestream(db, withClips(videoProvider()), Date.now, {
	sceneImages: env.MODEL_API_KEY
		? new SceneImages(env.MODEL_API_KEY, { staticDir: resolve('static'), mediaDir: MEDIA_DIR })
		: undefined,
	voices: env.OPENAI_API_KEY ? new Voices(env.OPENAI_API_KEY, MEDIA_DIR) : undefined
});
export const settings = new Settings(db);

/** the owner's video switches, saved from the admin dashboard, applied over the environment */
function applyVideoSettings() {
	const saved = settings.all();
	if (video.reactor) {
		if (saved.liveVideoAgents) {
			for (const handle of video.reactor.status().agents)
				if (!saved.liveVideoAgents.includes(handle)) video.reactor.allowAgent(handle, false);
			for (const handle of saved.liveVideoAgents) video.reactor.allowAgent(handle, true);
		}
		video.reactor.setPaused(saved.videoPaused);
	}
	for (const handle of saved.clipsOff) video.clips?.setClipOn(handle, false);
}
applyVideoSettings();
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
	// runSettlement logs and records its own failures
	const settle = setInterval(() => runSettlement('schedule').catch(() => {}), settleMs);
	runtime.__musestreamStop = () => {
		stopIndexer();
		clearInterval(settle);
	};
} else {
	runtime.__musestreamStop = undefined;
}

/**
 * One fee settlement run, on the hour or from the admin dashboard: every result is logged and
 * kept in the database, so a failure is never silent.
 */
export async function runSettlement(trigger: 'schedule' | 'admin') {
	if (!coins) throw new Error('No chain is configured, so there are no fees to settle.');
	const record = (ok: boolean, result: unknown) =>
		db.prepare('INSERT INTO settle_runs (at, trigger, ok, result) VALUES (?, ?, ?, ?)').run(
			Date.now(),
			trigger,
			ok ? 1 : 0,
			JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
		);
	try {
		const result = await coins.settleFees();
		const { fees, gifts, failed, skipped } = result;
		if (skipped) console.log('[fees] settlement skipped: another process holds it');
		for (const f of fees) {
			console.log(
				`[fees] ${f.agentId}: claimed ${f.claimed} ${f.pair} wei, sent ${f.toTreasury} to the treasury${f.tx ? ` (${f.tx})` : ''}`
			);
		}
		for (const f of failed) console.error(`[fees] ${f.agentId} failed: ${f.error}`);
		if (gifts.length) console.log(`[fees] paid ${gifts.length} gift share payouts`);
		record(!failed.length, result);
		return result;
	} catch (err) {
		console.error('[fees] settlement failed:', err);
		record(false, { error: err instanceof Error ? err.message : String(err) });
		throw err;
	}
}
