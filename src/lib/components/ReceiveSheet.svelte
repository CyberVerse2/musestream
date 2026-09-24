<script lang="ts">
	// Add money to the viewer's own wallet: its address, as text and as a QR code, and where
	// to get USDG, the app's only money, onto Robinhood Chain.
	import qrcode from 'qrcode-generator';
	import Sheet from './Sheet.svelte';
	import { closeSheet } from '$lib/state/ui.svelte';
	import { wallet } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { Copy, ArrowSquareOut } from 'phosphor-svelte';

	const address = $derived(wallet.info?.address ?? '');
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

<Sheet label="Add money" onclose={closeSheet}>
	<h2>Add money</h2>
	<p class="lede">
		Send USDG on Robinhood Chain to your wallet. It is your balance in the app: it buys coins and
		pays for gifts. Network fees are covered for you.
	</p>

	{#if address}
		{#if qr}
			<svg
				class="qr"
				viewBox="0 0 {qr.size} {qr.size}"
				aria-hidden="true"
				shape-rendering="crispEdges"><path d={qr.path} fill="#000" /></svg
			>
		{/if}
		<button class="addr press" onclick={copy} aria-label="Copy wallet address">
			<code>{address}</code>
			<span><Copy size={16} />Copy</span>
		</button>
	{/if}

	<p class="warn">
		Send only USDG, and only on Robinhood Chain. Other tokens do not count toward your balance, and
		money sent on another network does not arrive in this wallet.
	</p>

	<h3>Your money is on another network?</h3>
	<ul class="links">
		<li>
			<a href="https://relay.link/bridge/robinhood" target="_blank" rel="noopener noreferrer"
				>Move it with Relay <ArrowSquareOut size={14} /></a
			>
		</li>
		<li>
			<a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noopener noreferrer"
				>Other ways to bridge to Robinhood Chain <ArrowSquareOut size={14} /></a
			>
		</li>
	</ul>
</Sheet>

<style>
	h2 {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.lede {
		margin-top: 6px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--mut);
	}
	.qr {
		display: block;
		width: 184px;
		height: 184px;
		margin: 20px auto 0;
		padding: 12px;
		border-radius: var(--r-md);
		background: #fff;
	}
	.addr {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		margin-top: 16px;
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
	.warn {
		margin-top: 12px;
		font-size: 13px;
		line-height: 1.45;
		color: var(--mut);
	}
	h3 {
		margin-top: 20px;
		font-size: 15px;
	}
	.links {
		list-style: none;
		margin-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.links a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
