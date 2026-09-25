// Who may open the admin dashboard: a viewer signed in with an account whose email is in
// ADMIN_EMAILS. Anyone else gets a plain 404, so the dashboard does not show that it exists.
import { env } from '$env/dynamic/private';
import { db } from '../app.ts';
import { MusestreamError } from '../service.ts';
import { dynamicEnvironmentId, linkedAccount } from '../session.ts';

export interface Admin {
	email: string;
	userId: string;
}

/** each Dynamic account's email, looked up once in a while */
const emails = new Map<string, { email: string | null; at: number }>();
const FRESH_MS = 10 * 60_000;

async function emailOf(userId: string): Promise<string | null> {
	const hit = emails.get(userId);
	if (hit && Date.now() - hit.at < FRESH_MS) return hit.email;
	const envId = dynamicEnvironmentId();
	if (!envId || !env.DYNAMIC_API_TOKEN) return null;
	const res = await fetch(
		`https://app.dynamicauth.com/api/v0/environments/${envId}/users/${encodeURIComponent(userId)}`,
		{ headers: { Authorization: `Bearer ${env.DYNAMIC_API_TOKEN}` } }
	).catch(() => null);
	if (!res?.ok) return null;
	const { user } = (await res.json()) as {
		user: { email?: string; verifiedCredentials?: { format?: string; email?: string }[] };
	};
	const email =
		user.email ?? user.verifiedCredentials?.find((c) => c.format === 'email')?.email ?? null;
	const lower = email?.toLowerCase() ?? null;
	emails.set(userId, { email: lower, at: Date.now() });
	return lower;
}

function allowed(): string[] {
	return (env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
}

/** the admin behind this viewer, or null */
export async function adminFor(viewer: string): Promise<Admin | null> {
	const list = allowed();
	if (!list.length) return null;
	const account = linkedAccount(viewer);
	if (!account) return null;
	const email = await emailOf(account.userId);
	return email && list.includes(email) ? { email, userId: account.userId } : null;
}

/** the admin, or a 404 that looks like any missing page */
export async function requireAdmin(viewer: string): Promise<Admin> {
	const admin = await adminFor(viewer);
	if (!admin) throw new MusestreamError(404, 'not_found', 'Not found.');
	return admin;
}

/** keep a record of an admin action */
export function audit(admin: Admin, action: string, target?: string | null, detail?: unknown) {
	db.prepare(
		'INSERT INTO admin_audit (at, admin, action, target, detail) VALUES (?, ?, ?, ?, ?)'
	).run(
		Date.now(),
		admin.email,
		action,
		target ?? null,
		detail === undefined
			? null
			: JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
	);
}
