// Who the viewer is: anonymous (server-held test wallet) or signed in with their own wallet.
import { api, type AppConfig } from '../api';
import { showToast } from './notifications.svelte';

export const account = $state({
	config: null as AppConfig | null,
	/** the address of the viewer's own wallet, when signed in */
	signedInAs: null as string | null
});

let markConfigLoaded!: () => void;
/** resolves once the app's config has loaded (or failed to), so callers know the money mode */
export const configLoaded = new Promise<void>((resolve) => (markConfigLoaded = resolve));

export async function loadAccount() {
	try {
		const config = await api.config().finally(markConfigLoaded);
		account.config = config;
		account.signedInAs = config.signedInAs;
		if (!config.dynamicEnvironmentId) return;
		const returning = /[?&](code|state|dynamicOauth)/i.test(window.location.search);
		if (!config.signedInAs && !returning) return;
		const dynamic = await import('../wallet/dynamic');
		await dynamic.initDynamic(config.dynamicEnvironmentId, config.chainId, config.rpcUrl);
		// back from Google: finish the sign-in and link the wallet
		const token = await dynamic.finishRedirect();
		if (token) {
			const { address } = await api.signIn(token);
			account.signedInAs = address;
			showToast('✓', 'Signed in. Your wallet is ready.');
		}
	} catch {
		// the app works without it; trades fall back to what the server offers
	}
}

/** true when trades must be signed by the viewer's own wallet */
export function ownWallet(): boolean {
	return !!account.signedInAs && !!account.config?.dynamicEnvironmentId;
}

export function canSignIn(): boolean {
	return !!account.config?.dynamicEnvironmentId && !account.signedInAs;
}
