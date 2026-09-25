// The viewer's wallet, from the server: USDG (the app's money), coins held, trades, and a
// little ETH for gas.
import { api, type Quote, type WalletInfo } from '../api';
import { showToast } from './notifications.svelte';
import { setCoin } from './market.svelte';
import { account, configLoaded, ownWallet, requireWallet } from './account.svelte';
import { transferTx } from '$shared/tx';
import { USDG, usdgFromCents, usdgToUsd } from '$shared/usdg';
import { formatEther } from 'viem';

export const wallet = $state({
	loaded: false,
	error: null as string | null,
	info: null as WalletInfo | null
});

let inflight: Promise<void> | null = null;
export function refreshWallet(): Promise<void> {
	inflight ??= configLoaded
		.then(() => {
			// with real money, a viewer has a wallet only after signing in
			if (account.config && !account.config.testMoney && !account.signedInAs) return null;
			return api.wallet();
		})
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

/** the viewer's spendable dollars: their USDG, the app's only money; 0 when unknown */
export function balanceUsd(): number {
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

/**
 * Sign and send a trade's transactions in order, each after the one before it lands. Then
 * swap any ETH the trade left behind, above a gas reserve, back into USDG.
 */
async function sendAll(q: Pick<Quote, 'txs'>) {
	await requireWallet();
	await ensureGas();
	const { sendFromWallet } = await import('../wallet/dynamic');
	const send = async (txs: Quote['txs']) => {
		for (const tx of txs) {
			await sendFromWallet({
				to: tx.to,
				data: tx.data,
				value: tx.value ? BigInt(tx.value) : undefined
			});
		}
	};
	await send(q.txs);
	await send((await api.cashOut()).txs);
}

/** the server sees a signed trade a moment later; refresh after it has had time to index */
function refreshSoon() {
	setTimeout(() => void refreshWallet(), 2500);
}

export async function buy(handle: string, usd: number): Promise<{ tokens: string; usd: number }> {
	if (ownWallet()) {
		const from = account.signedInAs!;
		const q = await api.quote(handle, { side: 'buy', usd, from });
		await sendAll(q);
		refreshSoon();
		return { tokens: formatEther(BigInt(q.expected)), usd };
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
			return { tokens: formatEther(BigInt(q.tokens!)), usd: usdgToUsd(BigInt(q.expected)) };
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
		await requireWallet();
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
