// Who the viewer is: anonymous (server-held test wallet) or signed in with their own wallet.
import { api, type AppConfig } from '../api';

export const account = $state({
	config: null as AppConfig | null,
	/** the address of the viewer's own wallet, when signed in */
	signedInAs: null as string | null
});

export async function loadAccount() {
	try {
		const config = await api.config();
		account.config = config;
		account.signedInAs = config.signedInAs;
		if (config.dynamicEnvironmentId && config.signedInAs) {
			const { initDynamic } = await import('../wallet/dynamic');
			await initDynamic(config.dynamicEnvironmentId, config.chainId);
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
