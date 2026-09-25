// Everything the admin dashboard shows, gathered in one pass: money health, fee settlement,
// revenue, agents and coins, live streams and chat, paid video, viewers, and the system.
import { env } from '$env/dynamic/private';
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { robinhood } from 'viem/chains';
import { ETH_PAIR, META_PAIR, pairAt } from '../../../../shared/pairs.ts';
import { USDG } from '../../../../shared/usdg.ts';
import {
	coins,
	db,
	musestream,
	pairPrices,
	settings,
	settleEveryMinutes,
	settlementOn,
	STARTED_AT,
	video
} from '../app.ts';
import { recentLogs } from '../logbook.ts';
import { displayName } from '../names.ts';

/** what one second of paid H3 video costs, in dollars */
const VIDEO_USD_PER_SECOND = 0.0125;
const DAY_MS = 86_400_000;

const client = env.CHAIN_RPC_URL
	? createPublicClient({ chain: robinhood, transport: http(env.CHAIN_RPC_URL) })
	: null;

/** a bigint amount as a plain number, for display only */
const units = (amount: bigint | string | null | undefined, decimals = 18) =>
	amount === null || amount === undefined ? null : Number(formatUnits(BigInt(amount), decimals));

function utcDay(at: number) {
	return new Date(at).toISOString().slice(0, 10);
}

async function balances(address: Address) {
	if (!client) return { eth: null, meta: null, usdg: null };
	const token = (t: Address) =>
		client
			.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
			.catch(() => null);
	const [eth, meta, usdg] = await Promise.all([
		client.getBalance({ address }).catch(() => null),
		token(META_PAIR.address),
		token(USDG)
	]);
	return { eth: units(eth), meta: units(meta), usdg: units(usdg, 6) };
}

async function prices() {
	const [eth, meta] = await Promise.all([
		pairPrices?.usd(ETH_PAIR).catch(() => null) ?? null,
		pairPrices?.usd(META_PAIR).catch(() => null) ?? null
	]);
	return { ETH: eth, META: meta, USDG: 1 } as Record<'ETH' | 'META' | 'USDG', number | null>;
}

async function money(usd: Awaited<ReturnType<typeof prices>>) {
	if (!coins) return null;
	const treasury = await coins.treasury();
	const held = await balances(treasury.address as Address);
	const today = utcDay(Date.now());
	const spend = db
		.prepare('SELECT day, wei FROM treasury_spend ORDER BY day DESC LIMIT 14')
		.all() as { day: string; wei: string }[];
	const spentToday = units(spend.find((d) => d.day === today)?.wei ?? '0') ?? 0;
	const lastWeek = spend.slice(0, 7).map((d) => units(d.wei) ?? 0);
	const perDay = lastWeek.length ? lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length : 0;
	const topups = db
		.prepare(
			`SELECT COUNT(*) AS n, COALESCE(SUM(CAST(wei AS REAL)), 0) AS wei FROM gas_topups WHERE day = ?`
		)
		.get(today) as { n: number; wei: number };
	return {
		treasury: treasury.address,
		held,
		usd,
		gasSpentToday: spentToday,
		gasCapPerDay: Number(env.TREASURY_DAILY_SPEND_ETH ?? '0.05'),
		gasPerDay: perDay,
		/** days the treasury's ETH lasts at last week's spend */
		daysLeft: perDay > 0 && held.eth !== null ? held.eth / perDay : null,
		gasSpend: spend.map((d) => ({ day: d.day, eth: units(d.wei) ?? 0 })).reverse(),
		topupsToday: { count: topups.n, eth: topups.wei / 1e18 }
	};
}

async function settlement() {
	const runs = (
		db
			.prepare('SELECT id, at, trigger, ok, result FROM settle_runs ORDER BY id DESC LIMIT 20')
			.all() as { id: number; at: number; trigger: string; ok: number; result: string }[]
	).map((r) => ({ ...r, ok: !!r.ok, result: JSON.parse(r.result) as unknown }));
	const handles = new Map(
		(db.prepare('SELECT id, handle FROM agents').all() as { id: string; handle: string }[]).map(
			(a) => [a.id, a.handle]
		)
	);
	const fees = coins ? await coins.feeOverview() : { coins: [], retired: [] };
	return {
		runs,
		on: settlementOn,
		everyMinutes: settleEveryMinutes,
		coins: fees.coins.map((c) => ({
			handle: handles.get(c.agentId) ?? c.agentId,
			agentId: c.agentId,
			token: c.token,
			pair: c.pair,
			inCurve: units(c.inCurve),
			claimable: units(c.claimable),
			poolSweepable: c.poolSweepable,
			owedToTreasury: units(c.owedToTreasury),
			payoutMin: units(c.payoutMin)
		})),
		retired: fees.retired.map((r) => ({
			handle: handles.get(r.agentId) ?? r.agentId,
			token: r.token,
			pair: r.pair,
			retiredAt: r.retiredAt,
			inCurve: units(r.inCurve)
		}))
	};
}

function revenue() {
	// musestream's share of trading fees, by the coin's pair, and of gifts, in USDG
	const fees = db
		.prepare(
			`WITH every_coin AS (
			   SELECT token, pair FROM coins WHERE token IS NOT NULL
			   UNION ALL SELECT token, pair FROM retired_coins
			 )
			 SELECT k.pair, f.treasury_amount AS amount, f.paid_at, t.at, t.agent_id
			 FROM fee_ledger f JOIN trades t ON t.id = f.trade_id JOIN every_coin k ON k.token = t.token
			 UNION ALL
			 SELECT k.pair, p.treasury_amount, p.paid_at, p.paid_at, p.agent_id
			 FROM pool_fees p JOIN every_coin k ON k.token = p.token`
		)
		.all() as {
		pair: string;
		amount: string;
		paid_at: number | null;
		at: number | null;
		agent_id: string;
	}[];
	const gifts = db
		.prepare(
			`SELECT g.amount, g.agent_amount, g.payout_at, g.created_at AS at, s.agent_id
			 FROM gifts g JOIN streams s ON s.id = g.stream_id WHERE g.amount IS NOT NULL`
		)
		.all() as {
		amount: string;
		agent_amount: string | null;
		payout_at: number | null;
		at: number;
		agent_id: string;
	}[];

	type Totals = { collected: number; owed: number };
	const totals: Record<'ETH' | 'META' | 'USDG', Totals> = {
		ETH: { collected: 0, owed: 0 },
		META: { collected: 0, owed: 0 },
		USDG: { collected: 0, owed: 0 }
	};
	const days = new Map<string, Record<'ETH' | 'META' | 'USDG', number>>();
	const agents = new Map<string, Record<'ETH' | 'META' | 'USDG', number>>();
	const add = (
		symbol: 'ETH' | 'META' | 'USDG',
		amount: number,
		paid: boolean,
		at: number | null,
		agent: string
	) => {
		totals[symbol][paid ? 'collected' : 'owed'] += amount;
		if (at) {
			const day = utcDay(at);
			const d = days.get(day) ?? { ETH: 0, META: 0, USDG: 0 };
			d[symbol] += amount;
			days.set(day, d);
		}
		const a = agents.get(agent) ?? { ETH: 0, META: 0, USDG: 0 };
		a[symbol] += amount;
		agents.set(agent, a);
	};
	for (const f of fees)
		add(pairAt(f.pair).symbol, units(f.amount) ?? 0, !!f.paid_at, f.at, f.agent_id);
	for (const g of gifts) {
		// musestream keeps what the agent does not get
		const share = BigInt(g.amount) - BigInt(g.agent_amount ?? '0');
		add('USDG', units(share, 6) ?? 0, !!g.payout_at, g.at, g.agent_id);
	}
	const since = utcDay(Date.now() - 13 * DAY_MS);
	const handles = new Map(
		(db.prepare('SELECT id, handle FROM agents').all() as { id: string; handle: string }[]).map(
			(a) => [a.id, a.handle]
		)
	);
	return {
		totals,
		byDay: [...days]
			.filter(([day]) => day >= since)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([day, v]) => ({ day, ...v })),
		byAgent: [...agents].map(([id, v]) => ({ handle: handles.get(id) ?? id, ...v }))
	};
}

async function agents() {
	const rows = db
		.prepare(
			`SELECT a.id, a.handle, a.name, a.operator, a.category, a.avatar_url, a.musebook_url,
			        a.created_at, a.suspended_at,
			        (SELECT MAX(created_at) FROM api_keys k WHERE k.agent_id = a.id AND k.revoked_at IS NULL) AS key_created_at
			 FROM agents a ORDER BY a.created_at`
		)
		.all() as {
		id: string;
		handle: string;
		name: string;
		operator: string;
		category: string;
		avatar_url: string | null;
		musebook_url: string | null;
		created_at: number;
		suspended_at: number | null;
		key_created_at: number | null;
	}[];
	const reactor = video.reactor?.status();
	const clips = video.clips?.status() ?? [];
	return Promise.all(
		rows.map(async (a) => {
			const stream = musestream.currentStream(a.id);
			const coin = coins?.view(a.id) ?? null;
			const wallet = coins?.walletsStore.find('agent', a.id) ?? null;
			const earned = coins?.earnings(a.id);
			const clip = clips.find((c) => c.handle === a.handle);
			return {
				...a,
				live: stream
					? {
							streamId: stream.id,
							title: stream.title,
							startedAt: stream.started_at,
							viewers: musestream.viewerCount(stream.id)
						}
					: null,
				coin: coin && {
					token: coin.token,
					pair: coin.pair.symbol,
					price: coin.price,
					marketCap: coin.marketCap,
					creatorTaxPct: coin.creatorTaxPct,
					graduationPct: coin.graduationPct,
					graduated: coin.graduated,
					holders: coin.holders
				},
				wallet: wallet
					? { address: wallet.address, ...(await balances(wallet.address as Address)) }
					: null,
				earnings: earned && {
					META: { paid: units(earned.meta.paid), owed: units(earned.meta.unpaid) },
					ETH: { paid: units(earned.eth.paid), owed: units(earned.eth.unpaid) },
					USDG: { paid: units(earned.usdg.paid, 6), owed: units(earned.usdg.unpaid, 6) }
				},
				video: {
					liveAllowed: reactor ? reactor.agents.includes(a.handle) : null,
					clip: clip ? { url: clip.url, on: clip.on } : null
				}
			};
		})
	);
}

function streams() {
	const live = musestream.liveStreams();
	const since = Date.now() - 5 * 60_000;
	const today = new Date(utcDay(Date.now())).getTime();
	const recentChat = db
		.prepare(
			`SELECT c.id, c.stream_id, c.author, c.kind, c.body, c.created_at, c.hidden_at, a.handle
			 FROM chat_messages c JOIN streams s ON s.id = c.stream_id JOIN agents a ON a.id = s.agent_id
			 WHERE c.kind IN ('viewer', 'gift') ORDER BY c.id DESC LIMIT 60`
		)
		.all() as {
		id: number;
		stream_id: string;
		author: string;
		kind: string;
		body: string;
		created_at: number;
		hidden_at: number | null;
		handle: string;
	}[];
	const muted = db
		.prepare('SELECT viewer, muted_at FROM muted_viewers ORDER BY muted_at DESC')
		.all() as {
		viewer: string;
		muted_at: number;
	}[];
	return {
		live: live.map((s) => {
			const chat = db
				.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE stream_id = ? AND created_at > ?')
				.get(s.stream.id, since) as { n: number };
			const gifts = db
				.prepare(
					'SELECT COUNT(*) AS n, COALESCE(SUM(usd_cents), 0) AS cents FROM gifts WHERE stream_id = ? AND created_at >= ?'
				)
				.get(s.stream.id, today) as { n: number; cents: number };
			return {
				streamId: s.stream.id,
				handle: s.agent.handle,
				agentId: s.agent.id,
				title: s.stream.title,
				startedAt: s.stream.started_at,
				viewers: s.viewers,
				likes: s.likes,
				chatLast5Min: chat.n,
				giftsToday: { count: gifts.n, usd: gifts.cents / 100 },
				video: s.video?.kind ?? null
			};
		}),
		recentChat: recentChat.map((m) => ({
			id: m.id,
			handle: m.handle,
			viewer: m.author,
			name: displayName(m.author),
			kind: m.kind,
			text: m.body,
			at: m.created_at,
			hidden: !!m.hidden_at,
			muted: muted.some((x) => x.viewer === m.author)
		})),
		muted: muted.map((m) => ({
			viewer: m.viewer,
			name: displayName(m.viewer),
			mutedAt: m.muted_at
		}))
	};
}

function paidVideo() {
	const today = utcDay(Date.now());
	const month = today.slice(0, 7);
	const usage = db
		.prepare(
			`SELECT a.handle, u.day, u.seconds FROM video_usage u JOIN agents a ON a.id = u.agent_id
			 WHERE u.day LIKE ? ORDER BY u.day`
		)
		.all(`${month}%`) as { handle: string; day: string; seconds: number }[];
	const todayRows = usage.filter((u) => u.day === today);
	const monthSeconds = usage.reduce((s, u) => s + u.seconds, 0);
	const todaySeconds = todayRows.reduce((s, u) => s + u.seconds, 0);
	return {
		provider: env.VIDEO_PROVIDER ?? 'mock',
		reactor: video.reactor?.status() ?? null,
		clips: video.clips?.status() ?? [],
		dailySecondsPerAgent: Number(env.REACTOR_DAILY_SECONDS ?? 600),
		usdPerSecond: VIDEO_USD_PER_SECOND,
		today: todayRows.map((u) => ({ handle: u.handle, seconds: u.seconds })),
		todayUsd: todaySeconds * VIDEO_USD_PER_SECOND,
		monthUsd: monthSeconds * VIDEO_USD_PER_SECOND,
		monthSeconds
	};
}

function viewers() {
	const today = new Date(utcDay(Date.now())).getTime();
	const accounts = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM viewer_links').get() as {
		n: number;
	};
	const newToday = db
		.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM viewer_links WHERE linked_at >= ?')
		.get(today) as { n: number };
	const chattersToday = db
		.prepare(
			`SELECT COUNT(DISTINCT author) AS n, COUNT(*) AS messages FROM chat_messages
			 WHERE kind = 'viewer' AND created_at >= ?`
		)
		.get(today) as { n: number; messages: number };
	const gifts = db
		.prepare(
			`SELECT COUNT(*) AS n, COALESCE(SUM(usd_cents), 0) AS cents,
			        COALESCE(SUM(CASE WHEN created_at >= ? THEN usd_cents ELSE 0 END), 0) AS today_cents
			 FROM gifts WHERE status = 'paid'`
		)
		.get(today) as { n: number; cents: number; today_cents: number };
	const topups = db
		.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(CAST(wei AS REAL)), 0) AS wei FROM gas_topups')
		.get() as { n: number; wei: number };
	const traders = db.prepare('SELECT COUNT(DISTINCT trader) AS n FROM trades').get() as {
		n: number;
	};
	return {
		watchingNow: musestream.liveStreams().reduce((s, l) => s + l.viewers, 0),
		signedInAccounts: accounts.n,
		newAccountsToday: newToday.n,
		chattersToday: chattersToday.n,
		messagesToday: chattersToday.messages,
		traders: traders.n,
		gifts: { count: gifts.n, usd: gifts.cents / 100, todayUsd: gifts.today_cents / 100 },
		gasTopups: { count: topups.n, eth: topups.wei / 1e18 }
	};
}

function buildInfo(): { sha: string | null; branch: string | null; builtAt: string | null } {
	try {
		if (existsSync('build-info.json')) return JSON.parse(readFileSync('build-info.json', 'utf8'));
	} catch {
		// fall through
	}
	return { sha: null, branch: null, builtAt: null };
}

async function timed<T>(fn: () => Promise<T>) {
	const start = Date.now();
	try {
		const value = await fn();
		return { ok: true, ms: Date.now() - start, value };
	} catch (err) {
		return {
			ok: false,
			ms: Date.now() - start,
			error: err instanceof Error ? err.message.split('\n')[0]! : String(err)
		};
	}
}

async function system() {
	const envId = env.DYNAMIC_ENVIRONMENT_ID;
	const [rpc, dynamic] = await Promise.all([
		client ? timed(() => client.getBlockNumber().then((b) => Number(b))) : null,
		envId
			? timed(async () => {
					const res = await fetch(
						`https://app.dynamicauth.com/api/v0/sdk/${envId}/.well-known/jwks`,
						{ signal: AbortSignal.timeout(8000) }
					);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					return res.status;
				})
			: null
	]);
	const saved = settings.all();
	const launchAt = env.LAUNCH_AT ? Date.parse(env.LAUNCH_AT) : null;
	return {
		build: buildInfo(),
		startedAt: STARTED_AT,
		node: process.version,
		chainMode: env.CHAIN_MODE ?? null,
		walletProvider: env.WALLET_PROVIDER ?? 'local',
		health: { rpc, dynamic, codexKey: !!env.CODEX_API_KEY },
		countdown: {
			launchAt,
			hosts: (env.LAUNCH_HOSTS ?? '')
				.split(',')
				.map((h) => h.trim())
				.filter(Boolean),
			siteOpen: saved.siteOpen,
			showing: launchAt !== null && !saved.siteOpen
		},
		logs: recentLogs(60),
		audit: db
			.prepare(
				'SELECT id, at, admin, action, target, detail FROM admin_audit ORDER BY id DESC LIMIT 40'
			)
			.all() as {
			id: number;
			at: number;
			admin: string;
			action: string;
			target: string | null;
			detail: string | null;
		}[]
	};
}

/** One section's data, or null with the reason when it could not be read (a chain call failed). */
async function section<T>(name: string, fn: () => T | Promise<T>, errors: Record<string, string>) {
	try {
		return await fn();
	} catch (e) {
		const message = e instanceof Error ? e.message.split('\n')[0]! : String(e);
		errors[name] = message;
		console.warn(`[admin] ${name} unavailable: ${message}`);
		return null;
	}
}

export async function overview() {
	const errors: Record<string, string> = {};
	const usd = await prices();
	const [
		moneyPart,
		settlementPart,
		agentsPart,
		systemPart,
		revenuePart,
		streamsPart,
		videoPart,
		viewersPart
	] = await Promise.all([
		section('money', () => money(usd), errors),
		section('settlement', settlement, errors),
		section('agents', agents, errors),
		section('system', system, errors),
		section('revenue', revenue, errors),
		section('streams', streams, errors),
		section('video', paidVideo, errors),
		section('viewers', viewers, errors)
	]);
	return {
		at: Date.now(),
		errors,
		money: moneyPart,
		settlement: settlementPart,
		revenue: revenuePart,
		agents: agentsPart,
		streams: streamsPart,
		video: videoPart,
		viewers: viewersPart,
		system: systemPart
	};
}

export type Overview = Awaited<ReturnType<typeof overview>>;
