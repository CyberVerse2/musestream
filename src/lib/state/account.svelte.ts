// Who the viewer is: anonymous (server-held test wallet) or signed in with their own wallet.
import { api, type AppConfig } from '../api';
import { showToast } from './notifications.svelte';

export const account = $state({
	config: null as AppConfig | null,
	/** the address of the viewer's own wallet, when signed in */
	signedInAs: null as string | null
});

const LAPSED = 'Your sign-in expired. Sign in again to use your wallet.';

let markConfigLoaded!: () => void;
/** resolves once the app's config has loaded (or failed to), so callers know the money mode */
export const configLoaded = new Promise<void>((resolve) => (markConfigLoaded = resolve));

/** load the app's config and the viewer's session; true when a Google sign-in just finished */
export async function loadAccount(): Promise<boolean> {
	try {
		const config = await api.config().finally(markConfigLoaded);
		account.config = config;
		account.signedInAs = config.signedInAs;
		if (!config.dynamicEnvironmentId) return false;
		const returning = /[?&](code|state|dynamicOauth)/i.test(window.location.search);
		if (!config.signedInAs && !returning) return false;
		const dynamic = await import('../wallet/dynamic');
		await dynamic.initDynamic(config.dynamicEnvironmentId, config.chainId, config.rpcUrl);
		// back from Google: finish the sign-in and link the wallet
		const token = await dynamic.finishRedirect();
		if (token) {
			const { address } = await api.signIn(token);
			account.signedInAs = address;
			showToast('✓', 'Signed in. Your wallet is ready.');
			return true;
		}
		if (config.signedInAs && !(await checkWalletSession())) showToast('⚠', LAPSED);
	} catch {
		// the app works without it; trades fall back to what the server offers
	}
	return false;
}

/**
 * The app keeps a sign-in until the viewer signs out, but the wallet session in this browser can
 * end sooner. When it has, sign out of the app too, so the app asks for a fresh sign-in instead
 * of failing when it tries to sign. True while the wallet can sign.
 */
export async function checkWalletSession(): Promise<boolean> {
	const signedInAs = account.signedInAs;
	if (!signedInAs) return false;
	const { walletAddress } = await import('../wallet/dynamic');
	const address = await walletAddress();
	if (address?.toLowerCase() === signedInAs.toLowerCase()) return true;
	await api.signOut().catch(() => {});
	account.signedInAs = null;
	return false;
}

/** before signing anything: when the wallet session has ended, ask the viewer to sign in again */
export async function requireWallet(): Promise<void> {
	if (await checkWalletSession()) return;
	const { askSignIn } = await import('./ui.svelte');
	askSignIn(LAPSED);
	throw new Error(LAPSED);
}

/** true when trades must be signed by the viewer's own wallet */
export function ownWallet(): boolean {
	return !!account.signedInAs && !!account.config?.dynamicEnvironmentId;
}

export function canSignIn(): boolean {
	return !!account.config?.dynamicEnvironmentId && !account.signedInAs;
}
