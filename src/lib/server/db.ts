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
