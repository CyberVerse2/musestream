// The viewer's wallet, from the server: ETH, coins held, and trades.
import { api, type WalletInfo } from '../api';
import { showToast } from './notifications.svelte';
import { setCoin } from './market.svelte';

export const wallet = $state({
	loaded: false,
	error: null as string | null,
	info: null as WalletInfo | null
});

let inflight: Promise<void> | null = null;
export function refreshWallet(): Promise<void> {
	inflight ??= api
		.wallet()
		.then((info) => {
			wallet.info = info;
			wallet.error = null;
		})
		.catch((err: unknown) => {
			wallet.error = err instanceof Error ? err.message : 'Could not load your wallet.';
		})
		.finally(() => {
			wallet.loaded = true;
			inflight = null;
		});
	return inflight;
}

/** dollars of ETH the viewer can spend, or 0 when unknown */
export function spendableUsd(): number {
	const info = wallet.info;
	return info?.ethUsd ? info.eth * info.ethUsd : 0;
}

export function holdingOf(handle: string) {
	return wallet.info?.holdings.find((h) => h.handle === handle) ?? null;
}

export async function buy(handle: string, usd: number) {
	const res = await api.buy(handle, usd);
	setCoin(handle, res.coin);
	void refreshWallet();
	return res;
}

export async function sell(handle: string, fraction: 0.25 | 0.5 | 1) {
	try {
		const res = await api.sell(handle, fraction);
		setCoin(handle, res.coin);
		void refreshWallet();
		return res;
	} catch (err) {
		showToast('⚠', err instanceof Error ? err.message : 'The sale did not go through');
		return null;
	}
}
