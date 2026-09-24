<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import { onDestroy } from 'svelte';
	import { closeSheet } from '$lib/state/ui.svelte';
	import { buy, wallet } from '$lib/state/portfolio.svelte';
	import { tokenOf } from '$lib/state/market.svelte';
	import { SUPPLY } from '$lib/data';
	import { agentById } from '$lib/state/directory.svelte';
	import { quoteBuy } from '$shared/trading';
	import { clamp, fmtCash, fmtPrice, fmtTok } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import { CheckCircle } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const PRESETS = [10, 25, 50, 100];
	let usd = $state(25);
	let receipt = $state<ReturnType<typeof quoteBuy> | null>(null);
	let closeTimer: ReturnType<typeof setTimeout>;
	onDestroy(() => clearTimeout(closeTimer));

	const sym = $derived(id.toUpperCase());
	const agent = $derived(agentById(id));
	const tok = $derived(tokenOf(id));
	const tokens = $derived(quoteBuy(usd, tok.price).tokens);
	const impact = $derived(clamp((usd / (tok.price * SUPPLY * 70)) * 100, 0.1, 12));
	const short = $derived(usd > wallet.cash);

	function confirm() {
		if (receipt || short) return;
		receipt = buy(id, usd);
		if (receipt) closeTimer = setTimeout(closeSheet, 1500);
	}
</script>

<Sheet label="Buy ${sym}" onclose={closeSheet}>
	{#if !receipt}
		<div class="head">
			<AgentAvatar {agent} size={44} />
			<div>
				<h2>Buy ${sym}</h2>
				<p>{fmtPrice(tok.price)} · balance {fmtCash(wallet.cash)}</p>
			</div>
		</div>

		<p class="amount" aria-live="polite">${usd}</p>
		<div class="presets" role="group" aria-label="Amount">
			{#each PRESETS as p (p)}
				<button
					class="chip"
					aria-pressed={usd === p}
					disabled={p > wallet.cash}
					onclick={() => (usd = p)}>${p}</button
				>
			{/each}
		</div>

		<dl class="rows">
			<div>
				<dt>You get</dt>
				<dd>≈ {fmtTok(tokens)} {sym}</dd>
			</div>
			<div>
				<dt>Price impact</dt>
				<dd>{impact.toFixed(1)}%</dd>
			</div>
			<div>
				<dt>Fee</dt>
				<dd>1% · half goes to {agent.name}</dd>
			</div>
		</dl>

		<button class="btn-lime confirm" disabled={short} onclick={confirm}>
			{short ? 'Not enough balance' : `Buy $${usd} of ${sym}`}
		</button>
		<p class="note">
			{tok.graduated
				? 'Demo trade on the open market.'
				: 'Demo trade. The coin graduates to the open market at $100K market cap.'}
		</p>
	{:else}
		<div class="done">
			<CheckCircle size={56} weight="fill" />
			<h2>You bought ${sym}</h2>
			<p>+{fmtTok(receipt.tokens)} {sym} is in your wallet.</p>
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
