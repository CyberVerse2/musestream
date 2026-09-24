// The viewer's wallet, from the server: ETH, USDG, coins held, and trades.
import { api, type Quote, type WalletInfo } from '../api';
import { showToast } from './notifications.svelte';
import { setCoin } from './market.svelte';
import { account, ownWallet } from './account.svelte';
import { transferTx } from '$shared/tx';
import { USDG, usdgFromCents } from '$shared/usdg';
import { formatEther } from 'viem';

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

/** dollars of USDG the viewer can gift, or 0 when unknown */
export function giftableUsd(): number {
	return wallet.info?.usdg ?? 0;
}

export function holdingOf(handle: string) {
	return wallet.info?.holdings.find((h) => h.handle === handle) ?? null;
}

/**
 * Make sure the viewer's own wallet can pay network fees: when it is low on ETH, the treasury
 * sends a little, at most once a day. The server decides; this only skips the request when
 * the wallet clearly has enough.
 */
async function ensureGas() {
	const info = wallet.info;
	if (info && info.ethUsd && info.eth * info.ethUsd >= 0.05) return;
	const { sent } = await api.gasTopUp();
	if (sent) await refreshWallet();
}

/** sign and send a quote's transactions in order, each after the one before it lands */
async function sendAll(q: Quote) {
	await ensureGas();
	const { sendFromWallet } = await import('../wallet/dynamic');
	for (const tx of q.txs) {
		await sendFromWallet({
			to: tx.to,
			data: tx.data,
			value: tx.value ? BigInt(tx.value) : undefined
		});
	}
}

/** the server sees a signed trade a moment later; refresh after it has had time to index */
function refreshSoon() {
	setTimeout(() => void refreshWallet(), 2500);
}

export async function buy(handle: string, usd: number): Promise<{ tokens: string; eth: string }> {
	if (ownWallet()) {
		const from = account.signedInAs!;
		const q = await api.quote(handle, { side: 'buy', usd, from });
		await sendAll(q);
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
			const from = account.signedInAs! as `0x${string}`;
			const q = await api.quote(handle, { side: 'sell', fraction, from });
			await sendAll(q);
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
		if (!treasury) throw new Error('Gifts are unavailable right now.');
		await ensureGas();
		const { sendFromWallet } = await import('../wallet/dynamic');
		const amount = usdgFromCents(Math.round(usd * 100));
		const tx = await sendFromWallet(transferTx(USDG, treasury as `0x${string}`, amount));
		await api.gift(streamId, gift, tx);
	} else {
		await api.gift(streamId, gift);
	}
	refreshSoon();
}
