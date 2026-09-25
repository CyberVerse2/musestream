// The server's recent warnings and errors, kept in memory for the admin dashboard. Everything
// still goes to the normal log too.
import { inspect } from 'node:util';

export interface LogEntry {
	at: number;
	level: 'error' | 'warn';
	text: string;
}

const KEEP = 200;
// kept on globalThis: in development this module reloads, but the patched console stays
const shared = globalThis as unknown as { __musestreamLogbook?: LogEntry[] };
const patched = shared.__musestreamLogbook !== undefined;
const entries: LogEntry[] = (shared.__musestreamLogbook ??= []);

// terminal color codes, as in SvelteKit's own request log
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function format(args: unknown[]): string {
	return args
		.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: 120 })))
		.join(' ')
		.replace(ANSI, '')
		.trim()
		.slice(0, 4000);
}

if (!patched) {
	for (const level of ['error', 'warn'] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			entries.push({ at: Date.now(), level, text: format(args) });
			if (entries.length > KEEP) entries.splice(0, entries.length - KEEP);
			original(...args);
		};
	}
}

/** the newest entries first */
export function recentLogs(limit = 50): LogEntry[] {
	return entries.slice(-limit).reverse();
}
