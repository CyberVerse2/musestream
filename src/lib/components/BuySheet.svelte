<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import { onDestroy } from 'svelte';
	import { closeSheet } from '$lib/state/ui.svelte';
	import { buy, refreshWallet, spendableUsd, wallet } from '$lib/state/portfolio.svelte';
	import { coinOf, market } from '$lib/state/market.svelte';
	import { agentById } from '$lib/state/directory.svelte';
	import { fmtCash, fmtPrice, fmtTok } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import { CheckCircle } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const PRESETS = [10, 25, 50, 100];
	let usd = $state(25);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let receipt = $state<{ tokens: number; eth: number } | null>(null);
	let closeTimer: ReturnType<typeof setTimeout>;
	onDestroy(() => clearTimeout(closeTimer));

	if (!wallet.loaded) void refreshWallet();

	const sym = $derived(id.toUpperCase());
	const agent = $derived(agentById(id));
	const tok = $derived(coinOf(id));
	const eth = $derived(market.ethUsd ? usd / market.ethUsd : 0);
	// before price impact; the server applies the exact curve math and a 3% slippage limit
	const tokens = $derived(tok && tok.price > 0 ? (usd * 0.99) / tok.price : 0);
	const balance = $derived(spendableUsd());
	const short = $derived(wallet.loaded && usd > balance);

	async function confirm() {
		if (receipt || short || busy || !tok) return;
		busy = true;
		error = null;
		try {
			const res = await buy(id, usd);
			receipt = { tokens: Number(res.tokens), eth: Number(res.eth) };
			closeTimer = setTimeout(closeSheet, 1800);
		} catch (err) {
			error = err instanceof Error ? err.message : 'The buy did not go through.';
		} finally {
			busy = false;
		}
	}
</script>

<Sheet label="Buy ${sym}" onclose={closeSheet}>
	{#if !tok}
		<p class="note">${sym} is still launching. Try again in a moment.</p>
	{:else if !receipt}
		<div class="head">
			<AgentAvatar {agent} size={44} />
			<div>
				<h2>Buy ${sym}</h2>
				<p>
					{fmtPrice(tok.price)}
					{#if wallet.info}· balance {fmtCash(balance)}{/if}
				</p>
			</div>
		</div>

		<p class="amount" aria-live="polite">${usd}</p>
		<div class="presets" role="group" aria-label="Amount">
			{#each PRESETS as p (p)}
				<button
					class="chip"
					aria-pressed={usd === p}
					disabled={wallet.loaded && p > balance}
					onclick={() => (usd = p)}>${p}</button
				>
			{/each}
		</div>

		<dl class="rows">
			<div>
				<dt>You pay</dt>
				<dd>≈ {eth.toFixed(5)} ETH</dd>
			</div>
			<div>
				<dt>You get</dt>
				<dd>≈ {fmtTok(tokens)} {sym}</dd>
			</div>
			<div>
				<dt>Fee</dt>
				<dd>1% · a share goes to {agent.name}</dd>
			</div>
		</dl>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button class="btn-lime confirm" disabled={short || busy} onclick={confirm}>
			{busy ? 'Buying…' : short ? 'Not enough balance' : `Buy $${usd} of ${sym}`}
		</button>
		<p class="note">
			{wallet.info?.testMoney ? 'Test ETH on a local chain. ' : ''}{tok.graduated
				? 'This coin trades in its Uniswap pool.'
				: 'The coin moves to its Uniswap pool when 4.2 ETH is in its curve.'}
		</p>
	{:else}
		<div class="done">
			<CheckCircle size={56} weight="fill" />
			<h2>You bought ${sym}</h2>
			<p>+{fmtTok(receipt.tokens)} {sym} for {receipt.eth.toFixed(5)} ETH.</p>
		</div>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-right: 44px;
	}
	h2 {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.head p {
		margin-top: 2px;
		font-size: 13px;
		color: var(--mut);
	}
	.amount {
		margin: 24px 0 16px;
		text-align: center;
		font-size: 56px;
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}
	.presets .chip {
		justify-content: center;
		height: 44px;
		font-size: 15px;
	}
	.presets .chip:not([aria-pressed='true']) {
		color: var(--ink);
	}
	.presets .chip:disabled {
		opacity: 0.35;
	}
	.rows {
		margin-top: 20px;
		border-radius: var(--r-md);
		border: 1px solid var(--line);
	}
	.rows div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		font-size: 14px;
	}
	.rows div + div {
		border-top: 1px solid var(--line);
	}
	.rows dt {
		color: var(--mut);
	}
	.rows dd {
		font-weight: 600;
		text-align: right;
	}
	.confirm {
		width: 100%;
		margin-top: 16px;
		min-height: 54px;
	}
	.error {
		margin-top: 12px;
		font-size: 13px;
		color: var(--down);
		text-align: center;
	}
	.note {
		margin-top: 12px;
		font-size: 12px;
		color: var(--mut-2);
		text-align: center;
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 32px 0 16px;
		color: var(--lime);
		text-align: center;
	}
	.done :global(svg) {
		animation: check-in 320ms var(--ease-out);
	}
	.done h2,
	.done p {
		animation: rise 240ms var(--ease-out) both;
	}
	.done p {
		animation-delay: 40ms;
	}
	@keyframes check-in {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}
	.done h2 {
		color: var(--ink);
		margin-top: 8px;
	}
	.done p {
		font-size: 14px;
		color: var(--mut);
	}
</style>
