<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import { api, type CoinDetail } from '$lib/api';
	import { agentById } from '$lib/state/directory.svelte';
	import { holdingOf, refreshWallet, sell, wallet } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { closeSheet, openBuy, openAgent } from '$lib/state/ui.svelte';
	import { coinOf, deltaOf, market } from '$lib/state/market.svelte';
	import { fmtPct, fmtPrice, fmtTok, fmtUsd } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import GradBar from './GradBar.svelte';
	import CandleChart from './CandleChart.svelte';
	import type { Candle, Interval } from '$shared/candles';
	import { Lock } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const sym = $derived(id.toUpperCase());
	const tok = $derived(coinOf(id));
	const agent = $derived(agentById(id));
	const delta = $derived(tok ? deltaOf(tok) : 0);
	const held = $derived(holdingOf(id));
	/** dollars spent on this coin minus dollars taken out, from the viewer's own trades */
	const netCostUsd = $derived.by(() => {
		let usd = 0;
		for (const a of wallet.info?.activity ?? []) {
			if (a.handle === id) usd += a.side === 'buy' ? a.usd : -a.usd;
		}
		return usd;
	});
	const heldValue = $derived(held && tok ? held.tokens * tok.price : 0);
	const heldPnl = $derived(netCostUsd > 0 ? ((heldValue - netCostUsd) / netCostUsd) * 100 : 0);

	let tab = $state<'trades' | 'holders'>('trades');
	let selling = $state(false);
	let busy = $state(false);
	let frac = $state<0.25 | 0.5 | 1>(0.25);
	let detail = $state<CoinDetail | null>(null);

	if (!wallet.loaded) void refreshWallet();

	let interval = $state<Interval>('5m');
	let candles = $state<Candle[]>([]);

	// reload trades, holders, and candles whenever the coin trades
	$effect(() => {
		void market.coins[id]?.history.length;
		void api
			.coin(id)
			.then((d) => (detail = d))
			.catch(() => {});
	});
	$effect(() => {
		void market.coins[id]?.history.length;
		const want = interval;
		void api
			.candles(id, want)
			.then((d) => {
				if (want === interval) candles = d.candles;
			})
			.catch(() => {});
	});

	const me = $derived(wallet.info?.address.toLowerCase());
	const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
	function ago(at: number) {
		const s = Math.max(1, Math.round((Date.now() - at) / 1000));
		if (s < 60) return `${s}s`;
		if (s < 3600) return `${Math.round(s / 60)}m`;
		return `${Math.round(s / 3600)}h`;
	}

	async function doSell() {
		busy = true;
		const res = await sell(id, frac);
		busy = false;
		if (!res) return;
		showToast('✓', `Sold ${fmtTok(Number(res.tokens))} ${sym} for ${fmtUsd(res.usd)}`);
		selling = false;
	}
</script>

<Sheet label="${sym} market" tall onclose={closeSheet}>
	<button class="head press" onclick={() => openAgent(id)}>
		<AgentAvatar {agent} size={44} />
		<span>
			<b>${sym}</b>
			<small>{agent.name}{tok ? ` · ${fmtTok(tok.holders)} holders` : ''}</small>
		</span>
	</button>

	{#if !tok}
		<p class="grad">${sym} is still launching.</p>
	{:else}
		<div class="price">
			<span class="big">{fmtPrice(tok.price)}</span>
			<span class:up={delta >= 0} class:down={delta < 0}>{fmtPct(delta)}</span>
		</div>
		<div class="intervals" role="group" aria-label="Chart range">
			{#each ['1m', '5m', '1h', '1d'] as const as iv (iv)}
				<button class="chip" aria-pressed={interval === iv} onclick={() => (interval = iv)}
					>{iv}</button
				>
			{/each}
		</div>
		<CandleChart {candles} />

		<dl class="facts">
			<div>
				<dt>Market cap</dt>
				<dd>{fmtUsd(tok.marketCap)}</dd>
			</div>
			<div>
				<dt>Watching</dt>
				<dd>{fmtTok(agent.viewers)}</dd>
			</div>
		</dl>

		{#if tok.graduated}
			<p class="grad done">Graduated. ${sym} now trades in its Uniswap pool.</p>
		{:else}
			<div class="grad">
				<div class="grad-row"><span>Graduation</span><b>{tok.graduationPct.toFixed(0)}%</b></div>
				<span class="bar"><GradBar pct={tok.graduationPct} height={6} /></span>
				<p>
					When {fmtTok(tok.graduatesAt)}
					{tok.pair} is in the bonding curve, the coin moves to its Uniswap pool and trades on the open
					market.
				</p>
			</div>
		{/if}

		{#if held}
			<div class="position">
				<span>Your position</span>
				<b>{fmtUsd(heldValue)}</b>
				<small
					>{fmtTok(held.tokens)}
					{sym}{#if netCostUsd > 0}
						· <span class:up={heldPnl >= 0} class:down={heldPnl < 0}>{fmtPct(heldPnl)}</span
						>{/if}</small
				>
			</div>
		{/if}

		{#if selling && held}
			<div class="sell">
				<div class="fracs" role="group" aria-label="Amount to sell">
					{#each [0.25, 0.5, 1] as const as f (f)}
						<button class="chip" aria-pressed={frac === f} onclick={() => (frac = f)}
							>{f * 100}%</button
						>
					{/each}
				</div>
				<div class="actions">
					<button class="btn-quiet" onclick={() => (selling = false)}>Cancel</button>
					<button class="btn-quiet sell-go" disabled={busy} onclick={doSell}
						>{busy ? 'Selling…' : `Sell ${fmtUsd(heldValue * frac)}`}</button
					>
				</div>
			</div>
		{:else}
			<div class="actions">
				<button class="btn-lime" onclick={() => openBuy(id)}>Buy</button>
				<button class="btn-quiet" disabled={!held} onclick={() => (selling = true)}>Sell</button>
			</div>
		{/if}
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
			{#each detail?.trades ?? [] as t (t.tx + t.side)}
				<li>
					<span class="side {t.side}">{t.side === 'buy' ? 'Buy' : 'Sell'}</span>
					<span class="who">{t.trader.toLowerCase() === me ? 'you' : short(t.trader)}</span>
					<span>{fmtUsd(t.usd)}</span>
					<span class="dim">{ago(t.at)}</span>
				</li>
			{:else}
				<li class="empty">No trades yet. The first buyer gets the lowest price.</li>
			{/each}
		{:else}
			{#each detail?.holders ?? [] as h, i (h.trader)}
				<li>
					<span class="rank">{i + 1}</span>
					<span class="who">{h.trader.toLowerCase() === me ? 'you' : short(h.trader)}</span>
					<span>{h.pct.toFixed(2)}%</span>
				</li>
			{:else}
				<li class="empty">Nobody holds ${sym} yet.</li>
			{/each}
		{/if}
	</ul>

	<p class="lock">
		<Lock size={16} />
		<span
			>Launched on Pons. The whole supply started in the bonding curve, with no team allocation. At
			graduation, the liquidity is locked forever.</span
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
	.intervals {
		display: flex;
		gap: 6px;
		margin: 12px 0 8px;
	}
	.intervals .chip {
		height: 28px;
		padding: 0 12px;
		font-size: 13px;
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
	.list li.empty {
		display: block;
		padding: 14px 0;
		color: var(--mut);
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
