// The viewer's wallet, from the server: ETH, coins held, and trades.
import { api, type WalletInfo } from '../api';
import { showToast } from './notifications.svelte';
import { market, setCoin } from './market.svelte';
import { account, ownWallet } from './account.svelte';
import { buyTx, approveTx, sellTx, sendTx } from '$shared/tx';
import { formatEther, parseEther } from 'viem';

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

/** the server sees a signed trade a moment later; refresh after it has had time to index */
function refreshSoon() {
	setTimeout(() => void refreshWallet(), 2500);
}

export async function buy(handle: string, usd: number): Promise<{ tokens: string; eth: string }> {
	if (ownWallet()) {
		const { sendFromWallet } = await import('../wallet/dynamic');
		const from = account.signedInAs!;
		const q = await api.quote(handle, { side: 'buy', usd, from });
		await sendFromWallet(buyTx(q.curve, BigInt(q.wei!), BigInt(q.minOut), from as `0x${string}`));
		refreshSoon();
		return { tokens: formatEther(BigInt(q.expected)), eth: formatEther(BigInt(q.wei!)) };
	}
	const res = await api.buy(handle, usd);
	setCoin(handle, res.coin);
	void refreshWallet();
	return res;
}

export async function sell(handle: string, fraction: 0.25 | 0.5 | 1) {
	try {
		if (ownWallet()) {
			const { sendFromWallet } = await import('../wallet/dynamic');
			const from = account.signedInAs! as `0x${string}`;
			const q = await api.quote(handle, { side: 'sell', fraction, from });
			await sendFromWallet(approveTx(q.token, q.curve, BigInt(q.tokens!)));
			await sendFromWallet(sellTx(q.curve, BigInt(q.tokens!), BigInt(q.minOut), from));
			refreshSoon();
			return { tokens: formatEther(BigInt(q.tokens!)), eth: formatEther(BigInt(q.expected)) };
		}
		const res = await api.sell(handle, fraction);
		setCoin(handle, res.coin);
		void refreshWallet();
		return res;
	} catch (err) {
		showToast('⚠', err instanceof Error ? err.message : 'The sale did not go through');
		return null;
	}
}

/** pay for a gift: from the viewer's own wallet, or let the server pay from the test wallet */
export async function payGift(streamId: string, gift: string, usd: number) {
	if (ownWallet()) {
		const treasury = account.config?.treasury;
		if (!treasury || !market.ethUsd) throw new Error('Gifts are unavailable right now.');
		const { sendFromWallet } = await import('../wallet/dynamic');
		const wei = parseEther((usd / market.ethUsd).toFixed(18));
		const tx = await sendFromWallet(sendTx(treasury as `0x${string}`, wei));
		await api.gift(streamId, gift, tx);
	} else {
		await api.gift(streamId, gift);
	}
	refreshSoon();
}
