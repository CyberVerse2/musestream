// Viewers who sign in with Dynamic hold their own wallet. The server learns their address
// from Dynamic's signed token and never holds their keys.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Address } from 'viem';
import { env } from '$env/dynamic/private';
import { db } from './app.ts';
import { MusestreamError } from './service.ts';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** the Dynamic environment viewers sign in to, or null when sign-in is off */
export function dynamicEnvironmentId(): string | null {
	return env.DYNAMIC_ENVIRONMENT_ID || null;
}

/**
 * Check a Dynamic access token and return the user and their EVM wallet address. The token
 * names the user but carries only hashes of their wallets, so the address comes from
 * Dynamic's API.
 */
export async function verifyDynamicToken(
	token: string
): Promise<{ userId: string; address: Address }> {
	const envId = dynamicEnvironmentId();
	if (!envId || !env.DYNAMIC_API_TOKEN)
		throw new MusestreamError(501, 'no_signin', 'Wallet sign-in is not set up on this server.');
	jwks ??= createRemoteJWKSet(
		new URL(`https://app.dynamicauth.com/api/v0/sdk/${envId}/.well-known/jwks`)
	);
	let payload;
	try {
		({ payload } = await jwtVerify(token, jwks, { issuer: `app.dynamicauth.com/${envId}` }));
	} catch {
		throw new MusestreamError(401, 'bad_token', 'The sign-in token is not valid. Sign in again.');
	}
	if (!payload.sub) throw new MusestreamError(401, 'bad_token', 'The sign-in token names no user.');
	const res = await fetch(
		`https://app.dynamicauth.com/api/v0/environments/${envId}/users/${encodeURIComponent(payload.sub)}`,
		{ headers: { Authorization: `Bearer ${env.DYNAMIC_API_TOKEN}` } }
	);
	if (!res.ok) throw new MusestreamError(502, 'dynamic', 'Could not reach Dynamic. Try again.');
	const { user } = (await res.json()) as {
		user: { verifiedCredentials?: { format?: string; chain?: string; address?: string }[] };
	};
	const evm = user.verifiedCredentials?.find(
		(c) => c.format === 'blockchain' && c.chain === 'eip155' && c.address
	);
	if (!evm?.address || !/^0x[0-9a-fA-F]{40}$/.test(evm.address)) {
		throw new MusestreamError(400, 'no_wallet', 'The signed-in account has no EVM wallet yet.');
	}
	return { userId: payload.sub, address: evm.address as Address };
}

export function linkViewer(viewer: string, userId: string, address: Address) {
	db.prepare(
		`INSERT INTO viewer_links (viewer, user_id, address, linked_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(viewer) DO UPDATE SET user_id = excluded.user_id, address = excluded.address,
		 linked_at = excluded.linked_at`
	).run(viewer, userId, address, Date.now());
}

export function unlinkViewer(viewer: string) {
	db.prepare('DELETE FROM viewer_links WHERE viewer = ?').run(viewer);
}

/** the Dynamic account and wallet this viewer signed in with, if any */
export function linkedAccount(viewer: string): { userId: string; address: Address } | null {
	const row = db
		.prepare('SELECT user_id, address FROM viewer_links WHERE viewer = ?')
		.get(viewer) as { user_id: string; address: Address } | undefined;
	return row ? { userId: row.user_id, address: row.address } : null;
}

/** the wallet address this viewer signed in with, if any */
export function linkedAddress(viewer: string): Address | null {
	const row = db.prepare('SELECT address FROM viewer_links WHERE viewer = ?').get(viewer) as
		{ address: Address } | undefined;
	return row?.address ?? null;
}
