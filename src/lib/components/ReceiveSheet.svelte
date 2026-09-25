<script lang="ts">
	// Add money to the viewer's own wallet: what USDG is, step-by-step ways to get it onto
	// Robinhood Chain, the wallet's address (as text and a QR code), and a live balance that
	// says when the money has arrived, then goes on to what needed it.
	import { onMount } from 'svelte';
	import qrcode from 'qrcode-generator';
	import Sheet from './Sheet.svelte';
	import { closeSheet, continueWith, type SheetState } from '$lib/state/ui.svelte';
	import { balanceUsd, refreshWallet, wallet } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { fmtCash } from '$lib/format';
	import { Copy, ArrowSquareOut, CheckCircle, QrCode } from 'phosphor-svelte';

	let { after }: { after?: SheetState } = $props();

	type Route = 'robinhood' | 'wallet' | 'usdg';
	const ROUTES: { id: Route; label: string }[] = [
		{ id: 'robinhood', label: 'Robinhood app' },
		{ id: 'wallet', label: 'Another wallet' },
		{ id: 'usdg', label: 'I have USDG' }
	];
	let route = $state<Route>('robinhood');
	let showQr = $state(false);

	const address = $derived(wallet.info?.address ?? '');
	const balance = $derived(balanceUsd());
	/** the balance when the sheet opened; anything above it is money that just arrived */
	let startBalance = $state<number | null>(null);
	const arrived = $derived(
		startBalance !== null && balance > startBalance + 0.001 ? balance - startBalance : 0
	);
	const next = $derived(
		after?.kind === 'buy' ? `Buy $${after.id.toUpperCase()}` : after ? 'Continue' : 'Done'
	);

	onMount(() => {
		void refreshWallet().then(() => (startBalance = balanceUsd()));
		// money sent from another app lands in a few seconds; keep checking while the sheet is open
		const poll = setInterval(() => void refreshWallet(), 5000);
		return () => clearInterval(poll);
	});

	/** the address as QR modules: one square per dark cell, drawn as a single SVG path */
	const qr = $derived.by(() => {
		if (!address) return null;
		const code = qrcode(0, 'M');
		code.addData(address);
		code.make();
		const size = code.getModuleCount();
		let path = '';
		for (let r = 0; r < size; r++)
			for (let c = 0; c < size; c++) if (code.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
		return { size, path };
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(address);
			showToast('✓', 'Address copied');
		} catch {
			showToast('⚠', 'Could not copy the address');
		}
	}
</script>

<Sheet label="Add money" onclose={closeSheet} tall>
	<h2>Add money</h2>

	{#if arrived > 0}
		<div class="arrived" role="status">
			<CheckCircle size={28} weight="fill" />
			<div>
				<b>{fmtCash(arrived)} arrived</b>
				<span>Your balance is {fmtCash(balance)}.</span>
			</div>
		</div>
		<button class="btn-money go" onclick={() => continueWith(after)}>{next}</button>
	{:else}
		<p class="balance" aria-live="polite">
			<i aria-hidden="true"></i>Balance {fmtCash(balance)} · this updates when your money arrives
		</p>
	{/if}

	<p class="lede">
		Your balance is in <b>USDG</b>, a digital dollar: 1 USDG is always worth $1. It buys coins and
		pays for gifts, and network fees are on us.
	</p>

	<h3>Your wallet address</h3>
	{#if address}
		<button class="addr press" onclick={copy} aria-label="Copy wallet address">
			<code>{address}</code>
			<span><Copy size={16} />Copy</span>
		</button>
		<button class="qr-toggle" onclick={() => (showQr = !showQr)} aria-expanded={showQr}>
			<QrCode size={16} />{showQr ? 'Hide QR code' : 'Show QR code'}
		</button>
		{#if showQr && qr}
			<svg
				class="qr"
				viewBox="0 0 {qr.size} {qr.size}"
				role="img"
				aria-label="QR code of your wallet address"
				shape-rendering="crispEdges"><path d={qr.path} fill="#000" /></svg
			>
		{/if}
	{/if}

	<h3>How to get USDG</h3>
	<div class="routes" role="tablist" aria-label="Where your money is now">
		{#each ROUTES as r (r.id)}
			<button class="chip" role="tab" aria-selected={route === r.id} onclick={() => (route = r.id)}
				>{r.label}</button
			>
		{/each}
	</div>

	<div class="steps" role="tabpanel">
		{#if route === 'robinhood'}
			<ol>
				<li>In the Robinhood app, buy <b>USDG</b> (Global Dollar) with the amount you want.</li>
				<li>Open USDG, tap <b>Send</b>, and choose <b>Robinhood Chain</b> as the network.</li>
				<li>Paste your wallet address from above and send. It arrives in seconds.</li>
			</ol>
			<p class="fine">Robinhood does not allow USDG transfers in New York yet.</p>
		{:else if route === 'wallet'}
			<ol>
				<li>Copy your wallet address from above.</li>
				<li>
					Open Across and connect the wallet that holds your USDC, on Base, Ethereum, Arbitrum, or
					another network.
				</li>
				<li>
					Choose <b>Robinhood Chain</b> as the destination and paste your address as the recipient. Your
					USDC arrives here as USDG.
				</li>
			</ol>
			<a
				class="out"
				href="https://across.to/robinhood-bridge"
				target="_blank"
				rel="noopener noreferrer">Open Across <ArrowSquareOut size={14} /></a
			>
			<p class="fine">
				If you leave the recipient as your own wallet, the USDG lands there on Robinhood Chain; then
				send it to the address above. <a
					href="https://relay.link/bridge/robinhood"
					target="_blank"
					rel="noopener noreferrer">Relay</a
				> works too.
			</p>
		{:else}
			<ol>
				<li>From any wallet, send USDG on <b>Robinhood Chain</b> to your wallet address above.</li>
			</ol>
		{/if}
	</div>

	<p class="warn">
		Send only USDG, and only on Robinhood Chain. Other tokens do not count toward your balance, and
		money sent on another network does not arrive in this wallet.
	</p>
</Sheet>

<style>
	h2 {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	h3 {
		margin-top: 20px;
		font-size: 15px;
	}
	.balance {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		font-size: 13px;
		color: var(--mut);
	}
	.balance i {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--money);
		animation: pulse 1.6s ease-in-out infinite;
	}
	.arrived {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
		padding: 14px;
		border-radius: var(--r-md);
		background: var(--money-soft);
		color: var(--money);
	}
	.arrived b {
		display: block;
		font-size: 16px;
		color: var(--ink);
	}
	.arrived span {
		font-size: 13px;
		color: var(--mut);
	}
	.go {
		width: 100%;
		margin-top: 12px;
	}
	.lede {
		margin-top: 14px;
		font-size: 14px;
		line-height: 1.5;
		color: var(--mut);
	}
	.lede b,
	.steps b {
		color: var(--ink);
		font-weight: 600;
	}
	.addr {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		margin-top: 8px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
		text-align: left;
	}
	.addr code {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		line-height: 1.4;
		word-break: break-all;
	}
	.addr span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: none;
		font-size: 13px;
		font-weight: 600;
	}
	.qr-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 13px;
		color: var(--mut);
	}
	.qr {
		display: block;
		width: 184px;
		height: 184px;
		margin: 12px auto 0;
		padding: 12px;
		border-radius: var(--r-md);
		background: #fff;
	}
	.routes {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin-top: 10px;
	}
	.routes .chip {
		justify-content: center;
		height: 38px;
		padding: 0 8px;
		font-size: 13px;
	}
	.routes .chip[aria-selected='true'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}
	.steps {
		margin-top: 14px;
		padding: 14px 16px;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.steps ol {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 14px;
		line-height: 1.45;
	}
	.steps li::marker {
		color: var(--money);
		font-weight: 700;
	}
	.out {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 14px;
		font-size: 14px;
		font-weight: 600;
		color: var(--money);
	}
	.fine {
		margin-top: 10px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--mut);
	}
	.fine a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.warn {
		margin-top: 14px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--mut);
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.balance i {
			animation: none;
		}
	}
</style>
