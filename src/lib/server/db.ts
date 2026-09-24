// SQLite access. One connection per process; WAL keeps readers and the writer apart.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
	`
	CREATE TABLE agents (
		id          TEXT PRIMARY KEY,
		handle      TEXT NOT NULL UNIQUE,
		name        TEXT NOT NULL,
		operator    TEXT NOT NULL,
		category    TEXT NOT NULL,
		bio         TEXT NOT NULL DEFAULT '',
		avatar_url  TEXT,
		created_at  INTEGER NOT NULL
	);
	CREATE TABLE api_keys (
		key_hash    TEXT PRIMARY KEY,
		agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		created_at  INTEGER NOT NULL,
		revoked_at  INTEGER
	);
	CREATE TABLE streams (
		id          TEXT PRIMARY KEY,
		agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		title       TEXT NOT NULL,
		scene       TEXT NOT NULL,
		started_at  INTEGER NOT NULL,
		ended_at    INTEGER
	);
	CREATE INDEX streams_live ON streams(agent_id) WHERE ended_at IS NULL;
	CREATE TABLE chat_messages (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		stream_id   TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
		author      TEXT NOT NULL,
		kind        TEXT NOT NULL CHECK (kind IN ('viewer', 'agent', 'gift', 'system')),
		body        TEXT NOT NULL,
		created_at  INTEGER NOT NULL
	);
	CREATE INDEX chat_by_stream ON chat_messages(stream_id, id);
	CREATE TABLE likes (
		stream_id   TEXT PRIMARY KEY REFERENCES streams(id) ON DELETE CASCADE,
		count       INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE gifts (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		stream_id   TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
		viewer      TEXT NOT NULL,
		gift        TEXT NOT NULL,
		usd_cents   INTEGER NOT NULL,
		status      TEXT NOT NULL CHECK (status IN ('unpaid', 'paid')),
		created_at  INTEGER NOT NULL
	);
	CREATE TABLE video_segments (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		stream_id   TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
		provider    TEXT NOT NULL,
		prompt      TEXT NOT NULL,
		url         TEXT,
		started_at  INTEGER NOT NULL,
		ended_at    INTEGER
	);
	CREATE INDEX video_by_stream ON video_segments(stream_id, id);
	`,
	// the whole VideoSource as JSON: a clip file or a live playlist
	`
	ALTER TABLE video_segments ADD COLUMN source TEXT;
	UPDATE video_segments SET source = json_object('kind', 'file', 'url', url) WHERE url IS NOT NULL;
	ALTER TABLE video_segments DROP COLUMN url;
	`,
	// coins on chain. Wei and token amounts are decimal strings: they do not fit in 64 bits.
	`
	CREATE TABLE wallets (
		id          TEXT PRIMARY KEY,
		owner_kind  TEXT NOT NULL CHECK (owner_kind IN ('treasury', 'agent', 'viewer')),
		owner_id    TEXT NOT NULL,
		address     TEXT NOT NULL UNIQUE,
		provider    TEXT NOT NULL,
		secret      TEXT NOT NULL,
		created_at  INTEGER NOT NULL,
		UNIQUE (owner_kind, owner_id)
	);
	CREATE TABLE coins (
		agent_id       TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
		status         TEXT NOT NULL CHECK (status IN ('launching', 'live', 'failed')),
		token          TEXT,
		curve          TEXT,
		launch_tx      TEXT,
		quote_reserve  TEXT NOT NULL DEFAULT '0',
		token_reserve  TEXT NOT NULL DEFAULT '0',
		real_quote     TEXT NOT NULL DEFAULT '0',
		graduated      INTEGER NOT NULL DEFAULT 0,
		error          TEXT,
		created_at     INTEGER NOT NULL
	);
	CREATE INDEX coins_by_curve ON coins(curve);
	CREATE TABLE trades (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		side        TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
		trader      TEXT NOT NULL,
		quote_wei   TEXT NOT NULL,
		tokens      TEXT NOT NULL,
		fee_wei     TEXT NOT NULL,
		price_eth   REAL NOT NULL,
		block       INTEGER NOT NULL,
		tx          TEXT NOT NULL,
		log_index   INTEGER NOT NULL,
		at          INTEGER NOT NULL,
		UNIQUE (tx, log_index)
	);
	CREATE INDEX trades_by_agent ON trades(agent_id, id);
	CREATE TABLE fee_ledger (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		trade_id    INTEGER NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
		agent_wei   TEXT NOT NULL,
		treasury_wei TEXT NOT NULL,
		payout_tx   TEXT,
		paid_at     INTEGER
	);
	CREATE TABLE chain_cursor (
		name   TEXT PRIMARY KEY,
		block  INTEGER NOT NULL
	);
	ALTER TABLE gifts ADD COLUMN tx TEXT;
	`,
	// viewers who signed in with their own wallet (Dynamic)
	`
	CREATE TABLE viewer_links (
		viewer      TEXT PRIMARY KEY,
		user_id     TEXT NOT NULL,
		address     TEXT NOT NULL,
		linked_at   INTEGER NOT NULL
	);
	CREATE UNIQUE INDEX gifts_by_tx ON gifts(tx) WHERE tx IS NOT NULL;
	`,
	// what each paid gift carried in USDG units, the agent's share, and when it was paid out
	`
	ALTER TABLE gifts ADD COLUMN amount TEXT;
	ALTER TABLE gifts ADD COLUMN agent_amount TEXT;
	ALTER TABLE gifts ADD COLUMN payout_tx TEXT;
	ALTER TABLE gifts ADD COLUMN payout_at INTEGER;
	`,
	// graduated coins: the pool's latest price, and the creator fees Pons swept from each pool
	`
	ALTER TABLE coins ADD COLUMN pool_sqrt_price TEXT;
	CREATE TABLE pool_fees (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		creator_wei  TEXT NOT NULL,
		agent_wei    TEXT NOT NULL,
		treasury_wei TEXT NOT NULL,
		block        INTEGER NOT NULL,
		tx           TEXT NOT NULL,
		log_index    INTEGER NOT NULL,
		payout_tx    TEXT,
		paid_at      INTEGER,
		UNIQUE (tx, log_index)
	);
	`,
	// paid video used per agent per UTC day, against the daily allowance
	`
	CREATE TABLE video_usage (
		agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
		day       TEXT NOT NULL,
		seconds   REAL NOT NULL,
		PRIMARY KEY (agent_id, day)
	);
	`,
	// jobs only one process may run at a time, and what the treasury spends on gas each day
	`
	CREATE TABLE leases (
		name    TEXT PRIMARY KEY,
		holder  TEXT NOT NULL,
		until   INTEGER NOT NULL
	);
	CREATE TABLE treasury_spend (
		day  TEXT PRIMARY KEY,
		wei  TEXT NOT NULL
	);
	`,
	// gas the treasury gave signed-in viewers' wallets: at most one top-up per account per day
	`
	CREATE TABLE gas_topups (
		user_id  TEXT NOT NULL,
		day      TEXT NOT NULL,
		address  TEXT NOT NULL,
		wei      TEXT NOT NULL,
		tx       TEXT,
		at       INTEGER NOT NULL,
		PRIMARY KEY (user_id, day)
	);
	`,
	// an agent's Musebook resident profile, which its coin links to as its website
	`
	ALTER TABLE agents ADD COLUMN musebook_url TEXT;
	`
];

export function openDb(path: string): DB {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	migrate(db);
	return db;
}

function migrate(db: DB) {
	const version = db.pragma('user_version', { simple: true }) as number;
	for (let v = version; v < MIGRATIONS.length; v++) {
		db.transaction(() => {
			db.exec(MIGRATIONS[v]!);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}
