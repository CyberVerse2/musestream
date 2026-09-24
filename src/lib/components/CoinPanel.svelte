<script lang="ts">
	import type { Agent } from '$lib/data';
	import { coinOf, deltaOf } from '$lib/state/market.svelte';
	import { holdingOf } from '$lib/state/portfolio.svelte';
	import { openBuy, openToken } from '$lib/state/ui.svelte';
	import { fmtPct, fmtPrice, fmtTok, fmtUsd } from '$lib/format';
	import { sparkline, trendColor } from '$lib/sparkline';

	let { agent }: { agent: Agent } = $props();
	const tok = $derived(coinOf(agent.id));
	const delta = $derived(tok ? deltaOf(tok) : 0);
	const held = $derived(holdingOf(agent.id));
	const sym = $derived(agent.id.toUpperCase());
</script>

{#if !tok}
	<section class="coin-panel" aria-label="${sym}">
		<p class="waiting"><b>${sym}</b> The coin is launching.</p>
	</section>
{:else}
	<section class="coin-panel" aria-label="${sym}">
		<button class="head press" onclick={() => openToken(agent.id)}>
			<span>
				<b>${sym}</b>
				<small>{fmtTok(tok.holders)} holders</small>
			</span>
			<span class="px">
				{fmtPrice(tok.price)}
				<small class:up={delta >= 0} class:down={delta < 0}>{fmtPct(delta)}</small>
			</span>
		</button>
		<canvas use:sparkline={{ data: tok.hist.slice(-80), color: trendColor(delta) }}></canvas>
		<dl>
			<div>
				<dt>Market cap</dt>
				<dd>{fmtUsd(tok.marketCap)}</dd>
			</div>
			<div>
				<dt>{tok.graduated ? 'Status' : 'To graduation'}</dt>
				<dd>{tok.graduated ? 'Open market' : `${tok.graduationPct.toFixed(0)}%`}</dd>
			</div>
			<div>
				<dt>You hold</dt>
				<dd>{held ? fmtUsd(held.tokens * tok.price) : '—'}</dd>
			</div>
		</dl>
		<button class="btn-lime" onclick={() => openBuy(agent.id)}>Buy ${sym}</button>
	</section>
{/if}

<style>
	.coin-panel {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border-radius: var(--r-lg);
		background: var(--surface);
	}
	.waiting {
		font-size: 14px;
		color: var(--mut);
	}
	.waiting b {
		color: var(--ink);
		margin-right: 6px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		text-align: left;
	}
	.head span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.head b {
		font-size: 18px;
		letter-spacing: -0.02em;
	}
	.head small {
		font-size: 12px;
		color: var(--mut);
	}
	.px {
		align-items: flex-end;
		font-size: 15px;
		font-weight: 600;
	}
	.px small {
		font-weight: 600;
	}
	canvas {
		width: 100%;
		height: 64px;
	}
	dl {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	dt {
		font-size: 11px;
		color: var(--mut);
	}
	dd {
		font-size: 14px;
		font-weight: 600;
		margin-top: 2px;
	}
</style>
