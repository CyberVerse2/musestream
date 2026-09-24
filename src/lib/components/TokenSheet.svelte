<script lang="ts">
	import { agentById, SUPPLY } from '$lib/data';
	import { holdings, sell } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { closeSheet, openBuy, openAgent } from '$lib/state/ui.svelte';
	import { deltaOf, gradPct, tokenOf } from '$lib/state/market.svelte';
	import { sampleHolders, sampleTrades } from '$lib/simulation/fixtures';
	import { fmtPct, fmtPrice, fmtTok, fmtUsd } from '$lib/format';
	import { sparkline, trendColor } from '$lib/sparkline';
	import Sheet from './Sheet.svelte';
	import GradBar from './GradBar.svelte';
	import { Lock } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const sym = $derived(id.toUpperCase());
	const tok = $derived(tokenOf(id));
	const agent = $derived(agentById(id));
	const delta = $derived(deltaOf(tok));
	const held = $derived(holdings[id]);
	const heldPnl = $derived(held ? (tok.price / held.cost - 1) * 100 : 0);

	let tab = $state<'trades' | 'holders'>('trades');
	let selling = $state(false);
	let frac = $state(0.25);

	const trades = sampleTrades(8);
	const holders = sampleHolders(5);

	function doSell() {
		const receipt = sell(id, frac);
		if (!receipt) return;
		showToast('✓', `Sold ${fmtTok(receipt.tokens)} ${sym} for ${fmtUsd(receipt.usd)}`);
		selling = false;
	}
</script>

<Sheet label="${sym} market" tall onclose={closeSheet}>
	<button class="head press" onclick={() => openAgent(id)}>
		<img src={agent.img} alt="" />
		<span>
			<b>${sym}</b>
			<small>{agent.name} · {fmtTok(tok.holders)} holders</small>
		</span>
	</button>

	<div class="price">
		<span class="big">{fmtPrice(tok.price)}</span>
		<span class:up={delta >= 0} class:down={delta < 0}>{fmtPct(delta)} · 1m</span>
	</div>
	<canvas class="chart" use:sparkline={{ data: tok.hist.slice(-80), color: trendColor(delta) }}
	></canvas>

	<dl class="facts">
		<div>
			<dt>Market cap</dt>
			<dd>{fmtUsd(tok.price * SUPPLY)}</dd>
		</div>
		<div>
			<dt>Watching</dt>
			<dd>{fmtTok(tok.viewers)}</dd>
		</div>
	</dl>

	{#if tok.graduated}
		<p class="grad done">Graduated. ${sym} trades on the open market.</p>
	{:else}
		<div class="grad">
			<div class="grad-row"><span>Graduation</span><b>{gradPct(tok).toFixed(0)}%</b></div>
			<span class="bar"><GradBar pct={gradPct(tok)} height={6} /></span>
			<p>At $100K market cap, the coin leaves the bonding curve and trades on the open market.</p>
		</div>
	{/if}

	{#if held}
		<div class="position">
			<span>Your position</span>
			<b>{fmtUsd(held.amt * tok.price)}</b>
			<small
				>{fmtTok(held.amt)}
				{sym} ·
				<span class:up={heldPnl >= 0} class:down={heldPnl < 0}>{fmtPct(heldPnl)}</span></small
			>
		</div>
	{/if}

	{#if selling && held}
		<div class="sell">
			<div class="fracs" role="group" aria-label="Amount to sell">
				{#each [0.25, 0.5, 1] as f (f)}
					<button class="chip" aria-pressed={frac === f} onclick={() => (frac = f)}
						>{f * 100}%</button
					>
				{/each}
			</div>
			<div class="actions">
				<button class="btn-quiet" onclick={() => (selling = false)}>Cancel</button>
				<button class="btn-quiet sell-go" onclick={doSell}
					>Sell {fmtUsd(held.amt * frac * tok.price)}</button
				>
			</div>
		</div>
	{:else}
		<div class="actions">
			<button class="btn-lime" onclick={() => openBuy(id)}>Buy</button>
			<button class="btn-quiet" disabled={!held} onclick={() => (selling = true)}>Sell</button>
		</div>
	{/if}

	<div class="tabs" role="tablist">
		<button role="tab" aria-selected={tab === 'trades'} onclick={() => (tab = 'trades')}
			>Trades</button
		>
		<button role="tab" aria-selected={tab === 'holders'} onclick={() => (tab = 'holders')}
			>Holders</button
		>
	</div>
	<ul class="list">
		{#if tab === 'trades'}
			{#each trades as t, i (i)}
				<li>
					<span class="side {t.side}">{t.side === 'buy' ? 'Buy' : 'Sell'}</span>
					<span class="who">{t.who}</span>
					<span>{t.amt}</span>
					<span class="dim">{t.time}</span>
				</li>
			{/each}
		{:else}
			<li>
				<span class="rank">1</span><span class="who"
					>{agent.operator} <em>operator · locked</em></span
				><span>8.0%</span>
			</li>
			{#each holders as h, i (i)}
				<li>
					<span class="rank">{i + 2}</span><span class="who">{h.who}</span><span>{h.pct}%</span>
				</li>
			{/each}
			<li>
				<span class="rank">·</span><span class="who">you</span><span
					>{held ? ((held.amt / SUPPLY) * 100).toFixed(2) + '%' : '—'}</span
				>
			</li>
		{/if}
	</ul>

	<p class="lock">
		<Lock size={16} />
		<span
			>{agent.operator} holds 8% of supply. It unlocks monthly over 12 months, and 41% is still locked.</span
		>
	</p>
</Sheet>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding-right: 44px;
		text-align: left;
	}
	.head img {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		object-fit: cover;
	}
	.head span {
		display: flex;
		flex-direction: column;
	}
	.head b {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.head small {
		font-size: 13px;
		color: var(--mut);
	}
	.price {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin-top: 18px;
		font-size: 14px;
		font-weight: 600;
	}
	.big {
		font-size: 32px;
		font-weight: 700;
		letter-spacing: -0.03em;
	}
	.chart {
		display: block;
		width: 100%;
		height: 140px;
		margin-top: 12px;
	}
	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}
	.facts div {
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: var(--surface-2);
	}
	dt {
		font-size: 12px;
		color: var(--mut);
	}
	dd {
		font-size: 16px;
		font-weight: 600;
	}
	.grad {
		margin-top: 12px;
		padding: 12px;
		border-radius: var(--r-md);
		border: 1px solid var(--line);
		font-size: 13px;
	}
	.grad.done {
		color: var(--lime);
	}
	.grad-row {
		display: flex;
		justify-content: space-between;
	}
	.grad-row b {
		color: var(--lime);
	}
	.bar {
		display: block;
		margin: 8px 0;
	}
	.grad p {
		color: var(--mut);
		line-height: 1.45;
	}
	.position {
		display: grid;
		grid-template-columns: 1fr auto;
		margin-top: 12px;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--lime-soft);
		font-size: 13px;
	}
	.position b {
		grid-row: span 2;
		align-self: center;
		font-size: 18px;
	}
	.position small {
		color: var(--mut);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}
	.actions .btn-quiet:disabled {
		opacity: 0.4;
	}
	.sell {
		margin-top: 12px;
	}
	.fracs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.fracs .chip {
		justify-content: center;
		height: 44px;
	}
	.sell-go {
		color: var(--down);
		border-color: rgba(255, 90, 110, 0.4);
	}
	.tabs {
		display: flex;
		gap: 20px;
		margin-top: 24px;
		border-bottom: 1px solid var(--line);
	}
	.tabs button {
		padding: 10px 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--mut);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button[aria-selected='true'] {
		color: var(--ink);
		border-color: var(--ink);
	}
	.list {
		list-style: none;
	}
	.list li {
		display: grid;
		grid-template-columns: 40px 1fr auto auto;
		gap: 12px;
		align-items: center;
		min-height: 44px;
		font-size: 13px;
		border-bottom: 1px solid var(--line);
	}
	.side {
		font-weight: 700;
	}
	.side.buy {
		color: var(--up);
	}
	.side.sell {
		color: var(--down);
	}
	.who {
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--mut);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who em {
		font-family: var(--f-ui);
		font-style: normal;
		color: var(--agent);
	}
	.rank {
		color: var(--mut-2);
	}
	.dim {
		color: var(--mut-2);
		min-width: 28px;
		text-align: right;
	}
	.lock {
		display: flex;
		gap: 10px;
		margin-top: 16px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--mut);
	}
	.lock :global(svg) {
		flex: none;
		margin-top: 2px;
	}
</style>
