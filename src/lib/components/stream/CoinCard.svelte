<script lang="ts">
	import { SUPPLY } from '$lib/data';
	import { openBuy, openToken } from '$lib/state/ui.svelte';
	import { deltaOf, gradPct, tokenOf } from '$lib/state/market.svelte';
	import { fmtPrice, fmtUsd } from '$lib/format';
	import { sparkline, trendColor } from '$lib/sparkline';
	import GradBar from '../GradBar.svelte';

	let { id }: { id: string } = $props();
	const tok = $derived(tokenOf(id));
	const delta = $derived(deltaOf(tok));
	const sym = $derived(id.toUpperCase());
</script>

<div class="coin">
	<button class="open press" onclick={() => openToken(id)} aria-label="${sym} market">
		<span class="id">
			<b>${sym}</b>
			<span class="px">
				{fmtPrice(tok.price)}
				<span class:up={delta >= 0} class:down={delta < 0}
					>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</span
				>
			</span>
		</span>
		<canvas
			class="spark"
			use:sparkline={{ data: tok.hist.slice(-40), color: trendColor(delta), fill: false }}
		></canvas>
		<span class="mc"><small>mcap</small>{fmtUsd(tok.price * SUPPLY)}</span>
		{#if !tok.graduated}
			<span class="grad"
				><GradBar pct={gradPct(tok)} height={2} track="rgba(255,255,255,0.1)" /></span
			>
		{/if}
	</button>
	<button class="buy press" onclick={() => openBuy(id)}>Buy</button>
</div>

<style>
	.coin {
		display: flex;
		gap: 8px;
	}
	.open {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 52px;
		padding: 0 12px;
		overflow: hidden;
		border-radius: var(--r-md);
		background: var(--glass);
		border: 1px solid rgba(255, 255, 255, 0.08);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		text-align: left;
	}
	.id {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.id b {
		font-size: 15px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.px {
		font-size: 12px;
		color: rgba(255, 255, 255, 0.8);
		white-space: nowrap;
	}
	.px span {
		margin-left: 4px;
		font-weight: 600;
	}
	.spark {
		flex: 1;
		min-width: 30px;
		max-width: 90px;
		height: 24px;
		margin-left: auto;
	}
	.mc {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-size: 13px;
		font-weight: 600;
	}
	.mc small {
		font-size: 10px;
		font-weight: 500;
		color: var(--mut);
	}
	.grad {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
	}
	.grad :global(.bar) {
		border-radius: 0;
	}
	.buy {
		flex: none;
		width: 76px;
		border-radius: var(--r-md);
		background: var(--lime);
		color: var(--lime-ink);
		font-size: 16px;
		font-weight: 700;
	}
</style>
