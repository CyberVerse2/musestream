// Each agent's daily allowance of paid video, counted in UTC days. A session reserves its full
// length before it starts and gives back what it did not use when it ends, so a crash can
// only leave an agent under its allowance, never over it.
import type { DB } from '../db.ts';

export class VideoBudget {
	private db: DB;
	private dailySeconds: number;
	private now: () => number;

	constructor(db: DB, dailySeconds: number, now: () => number = Date.now) {
		this.db = db;
		this.dailySeconds = dailySeconds;
		this.now = now;
	}

	/** today's UTC date, the key usage is counted under */
	today(): string {
		return new Date(this.now()).toISOString().slice(0, 10);
	}

	/** seconds of paid video the agent has left today */
	remaining(agentId: string): number {
		const row = this.db
			.prepare('SELECT seconds FROM video_usage WHERE agent_id = ? AND day = ?')
			.get(agentId, this.today()) as { seconds: number } | undefined;
		return Math.max(0, this.dailySeconds - (row?.seconds ?? 0));
	}

	/** count `seconds` against the agent's `day`; negative gives unused time back */
	add(agentId: string, day: string, seconds: number) {
		this.db
			.prepare(
				`INSERT INTO video_usage (agent_id, day, seconds) VALUES (@agentId, @day, MAX(0, @seconds))
				 ON CONFLICT(agent_id, day) DO UPDATE SET seconds = MAX(0, seconds + @seconds)`
			)
			.run({ agentId, day, seconds });
	}
}
