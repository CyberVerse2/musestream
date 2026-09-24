<script lang="ts">
	import { SUPPLY, type Agent } from '$lib/data';
	import { deltaOf, gradPct, tokenOf } from '$lib/state/market.svelte';
	import { holdings } from '$lib/state/portfolio.svelte';
	import { openBuy, openToken } from '$lib/state/ui.svelte';
	import { fmtPct, fmtPrice, fmtTok, fmtUsd } from '$lib/format';
	import { sparkline, trendColor } from '$lib/sparkline';

	let { agent }: { agent: Agent } = $props();
	const tok = $derived(tokenOf(agent.id));
	const delta = $derived(deltaOf(tok));
	const held = $derived(holdings[agent.id]);
	const sym = $derived(agent.id.toUpperCase());
</script>

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
			<dd>{fmtUsd(tok.price * SUPPLY)}</dd>
		</div>
		<div>
			<dt>{tok.graduated ? 'Status' : 'To graduation'}</dt>
			<dd>{tok.graduated ? 'Open market' : `${gradPct(tok).toFixed(0)}%`}</dd>
		</div>
		<div>
			<dt>You hold</dt>
			<dd>{held ? fmtUsd(held.amt * tok.price) : '—'}</dd>
		</div>
	</dl>
	<button class="btn-lime" onclick={() => openBuy(agent.id)}>Buy ${sym}</button>
</section>

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
