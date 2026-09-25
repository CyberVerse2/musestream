// Owner settings changed from the admin dashboard, kept in the database so they apply at once
// and survive restarts: no environment change or redeploy needed.
import type { DB } from './db.ts';

export interface OwnerSettings {
	/** the site is open to visitors: the launch countdown no longer shows */
	siteOpen: boolean;
	/** paid live video is stopped for everyone */
	videoPaused: boolean;
	/** agents allowed paid live video, by handle; replaces REACTOR_AGENTS once set */
	liveVideoAgents: string[] | null;
	/** agents whose saved clip is turned off, by handle; they get live or placeholder video */
	clipsOff: string[];
}

const DEFAULTS: OwnerSettings = {
	siteOpen: false,
	videoPaused: false,
	liveVideoAgents: null,
	clipsOff: []
};

export class Settings {
	private db: DB;

	constructor(db: DB) {
		this.db = db;
	}

	get<K extends keyof OwnerSettings>(key: K): OwnerSettings[K] {
		const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
			{ value: string } | undefined;
		return row ? (JSON.parse(row.value) as OwnerSettings[K]) : DEFAULTS[key];
	}

	set<K extends keyof OwnerSettings>(key: K, value: OwnerSettings[K]) {
		this.db
			.prepare(
				`INSERT INTO settings (key, value) VALUES (?, ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
			)
			.run(key, JSON.stringify(value));
	}

	all(): OwnerSettings {
		return {
			siteOpen: this.get('siteOpen'),
			videoPaused: this.get('videoPaused'),
			liveVideoAgents: this.get('liveVideoAgents'),
			clipsOff: this.get('clipsOff')
		};
	}
}
