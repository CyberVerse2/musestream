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

/** check a Dynamic access token and return the user and their EVM wallet address */
export async function verifyDynamicToken(
	token: string
): Promise<{ userId: string; address: Address }> {
	const envId = dynamicEnvironmentId();
	if (!envId)
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
	const creds = (payload.verified_credentials ?? []) as { address?: string; chain?: string }[];
	const evm = creds.find((c) => c.chain === 'eip155' && c.address);
	if (!payload.sub || !evm?.address || !/^0x[0-9a-fA-F]{40}$/.test(evm.address)) {
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

/** the wallet address this viewer signed in with, if any */
export function linkedAddress(viewer: string): Address | null {
	const row = db.prepare('SELECT address FROM viewer_links WHERE viewer = ?').get(viewer) as
		{ address: Address } | undefined;
	return row?.address ?? null;
}
