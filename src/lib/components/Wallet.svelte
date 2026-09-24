<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import { onMount } from 'svelte';
	import { refreshWallet, wallet } from '$lib/state/portfolio.svelte';
	import { ui, openToken, openSignIn, openReceive } from '$lib/state/ui.svelte';
	import { canSignIn } from '$lib/state/account.svelte';
	import { market } from '$lib/state/market.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { fmtCash, fmtPct, fmtTok } from '$lib/format';
	import { DOWN, UP, sparkline, trendColor } from '$lib/sparkline';
	import { ArrowDownLeft, ArrowUpRight, Copy } from 'phosphor-svelte';

	const POINTS = 80;

	// load when the tab opens, and again after trades (portfolio refreshes itself then)
	$effect(() => {
		if (ui.tab === 'wallet') void refreshWallet();
	});

	const info = $derived(wallet.info);
	const rate = $derived(info?.ethUsd ?? market.ethUsd ?? 0);
	/** ETH put into each coin minus ETH taken out, from the viewer's own trades */
	const netCost = $derived.by(() => {
		const out: Record<string, number> = {};
		for (const a of info?.activity ?? [])
			out[a.handle] = (out[a.handle] ?? 0) + (a.side === 'buy' ? a.eth : -a.eth);
		return out;
	});
	const rows = $derived(
		(info?.holdings ?? [])
			.map((h) => {
				const value = h.valueEth * rate;
				const cost = (netCost[h.handle] ?? 0) * rate;
				return {
					...h,
					agent: { img: h.avatarUrl ?? '', handle: h.handle },
					value,
					pnl: cost > 0 ? ((value - cost) / cost) * 100 : 0,
					hist: h.history.length > 1 ? h.history : [0, 0]
				};
			})
			.sort((a, b) => b.value - a.value)
	);
	const ethUsd = $derived((info?.eth ?? 0) * rate);
	const cash = $derived(ethUsd + (info?.usdg ?? 0));
	const inCoins = $derived(rows.reduce((s, r) => s + r.value, 0));
	const cost = $derived(rows.reduce((s, r) => s + Math.max(0, (netCost[r.handle] ?? 0) * rate), 0));
	const pnl = $derived(inCoins - cost);
	const pnlPct = $derived(cost ? (pnl / cost) * 100 : 0);
	const total = $derived(cash + inCoins);
	// balance over the recent price history of each coin held; cash held flat
	const series = $derived.by(() => {
		const out = Array.from({ length: POINTS }, () => cash);
		for (const r of rows) {
			const hist = r.history.slice(-POINTS);
			const offset = POINTS - hist.length;
			hist.forEach((p, i) => (out[i + offset]! += r.tokens * p * rate));
		}
		return out;
	});
	const seriesUp = $derived(series.at(-1)! >= series[0]!);
	// a few trades make a misleading step; draw the line once there is real history
	const showChart = $derived(rows.length > 0 && rows.every((r) => r.history.length >= 20));

	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 15000);
		return () => clearInterval(t);
	});
	function ago(at: number) {
		const sec = Math.max(1, Math.round((now - at) / 1000));
		if (sec < 60) return 'now';
		if (sec < 3600) return `${Math.round(sec / 60)}m`;
		return `${Math.round(sec / 3600)}h`;
	}
	const short = $derived(info ? `${info.address.slice(0, 6)}…${info.address.slice(-4)}` : '');
	async function copyAddress() {
		if (!info) return;
		try {
			await navigator.clipboard.writeText(info.address);
			showToast('✓', 'Address copied');
		} catch {
			showToast('⚠', 'Could not copy the address');
		}
	}
</script>

<section class="view page" class:active={ui.tab === 'wallet'} aria-label="Wallet">
	<div class="page-inner">
		<header class="head">
			<h1 class="page-title">Wallet</h1>
			{#if info}
				<button class="addr press" onclick={copyAddress} aria-label="Copy wallet address"
					>{short}<Copy size={14} /></button
				>
			{/if}
		</header>

		{#if !wallet.loaded}
			<p class="quiet">Loading your wallet…</p>
		{:else if !info}
			<div class="empty">
				<p>{wallet.error ?? 'Your wallet is not available.'}</p>
				<button class="btn-quiet" onclick={() => refreshWallet()}>Try again</button>
			</div>
		{:else}
			<div class="hero">
				<p class="label">
					Total balance{#if info.ownWallet}<span class="test">your wallet</span
						>{:else if info.testMoney}<span class="test">test money</span>{/if}
				</p>
				<p class="total">{fmtCash(total)}</p>
				{#if rows.length && cost > 0}
					<p class="pnl" class:up={pnl >= 0} class:down={pnl < 0}>
						{pnl >= 0 ? '+' : ''}{fmtCash(pnl)} ({fmtPct(pnlPct)}) <span>on your coins</span>
					</p>
				{/if}
				{#if showChart}
					<canvas
						class="chart"
						use:sparkline={{ data: series, color: seriesUp ? UP : DOWN, tail: true }}
					></canvas>
				{/if}
				<div class="split">
					<div><span>Cash</span><b>{fmtCash(info.usdg)}</b><small>USDG</small></div>
					<div><span>In coins</span><b>{fmtCash(inCoins)}</b></div>
					<div>
						<span>Gas</span><b>{fmtCash(ethUsd)}</b><small>{info.eth.toFixed(5)} ETH</small>
					</div>
				</div>
			</div>

			{#if canSignIn()}
				<div class="signin">
					<p>Sign in to trade from a wallet only you control.</p>
					<button class="btn-lime" onclick={openSignIn}>Sign in</button>
				</div>
			{:else if info.ownWallet}
				<button class="btn-lime add" onclick={openReceive}>Add money</button>
			{/if}

			<h2 class="section-title">Coins <small>{rows.length} held</small></h2>
			{#if rows.length}
				<ul class="list">
					{#each rows as r (r.handle)}
						<li>
							<button class="row press" onclick={() => openToken(r.handle)} disabled={!r.live}>
								<span class="ava"
									><AgentAvatar agent={r.agent} size={40} />{#if r.live}<i class="dot"
										></i>{/if}</span
								>
								<span class="mid">
									<b>${r.handle.toUpperCase()}</b>
									<small>{fmtTok(r.tokens)} · {r.name}{r.live ? ' is live' : ' is offline'}</small>
								</span>
								<canvas
									class="spark"
									use:sparkline={{ data: r.hist, color: trendColor(r.pnl), fill: false }}
								></canvas>
								<span class="end">
									<b>{fmtCash(r.value)}</b>
									{#if (netCost[r.handle] ?? 0) > 0}
										<small class:up={r.pnl >= 0} class:down={r.pnl < 0}>{fmtPct(r.pnl)}</small>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="empty">
					<p>You do not hold any coins yet. Buy an agent’s coin from its stream.</p>
					<button class="btn-quiet" onclick={() => (ui.tab = 'live')}>Watch live</button>
				</div>
			{/if}

			<h2 class="section-title">Activity</h2>
			{#if info.activity.length}
				<ul class="list">
					{#each info.activity as a (a.tx + a.side)}
						<li class="row act">
							<span class="ico {a.side}">
								{#if a.side === 'buy'}<ArrowDownLeft size={18} weight="bold" />
								{:else}<ArrowUpRight size={18} weight="bold" />{/if}
							</span>
							<span class="mid">
								<b>{a.side === 'buy' ? 'Bought' : 'Sold'} ${a.handle.toUpperCase()}</b>
								<small>{fmtTok(a.tokens)} {a.handle.toUpperCase()} · {ago(a.at)}</small>
							</span>
							<span class="end"
								><b class:up={a.side === 'sell'}
									>{a.side === 'sell' ? '+' : '−'}{fmtCash(a.eth * rate)}</b
								></span
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="quiet">Your trades show up here.</p>
			{/if}
		{/if}
	</div>
</section>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.addr {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border-radius: 99px;
		background: var(--surface);
		border: 1px solid var(--line);
		font-family: var(--f-mono);
		font-size: 12px;
		color: var(--mut);
	}
	.hero {
		margin-top: 20px;
	}
	.label {
		font-size: 13px;
		color: var(--mut);
	}
	.total {
		margin-top: 2px;
		font-size: 44px;
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 1.05;
	}
	.pnl {
		margin-top: 6px;
		font-size: 14px;
		font-weight: 600;
	}
	.pnl span {
		font-weight: 500;
		color: var(--mut);
	}
	.chart {
		display: block;
		width: 100%;
		height: 120px;
		margin-top: 16px;
	}
	.split {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-top: 12px;
	}
	.split div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.split small {
		font-size: 11px;
		color: var(--mut-2);
	}
	.add {
		width: 100%;
		margin-top: 16px;
	}
	.signin {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 16px;
		padding: 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		font-size: 14px;
		color: var(--mut);
	}
	.test {
		margin-left: 8px;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--agent-soft);
		color: var(--agent);
		font-size: 11px;
		font-weight: 600;
	}
	.split span {
		font-size: 12px;
		color: var(--mut);
	}
	.split b {
		font-size: 17px;
		font-weight: 600;
	}

	.list {
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 64px;
		text-align: left;
	}
	.list li + li {
		border-top: 1px solid var(--line);
	}
	.ava {
		position: relative;
		flex: none;
	}
	.dot {
		position: absolute;
		right: 0;
		bottom: 0;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: var(--live);
		border: 2px solid var(--bg);
	}
	.mid,
	.end {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.mid {
		flex: 1;
		min-width: 0;
	}
	.end {
		align-items: flex-end;
	}
	.row b {
		font-size: 15px;
		font-weight: 600;
	}
	.row small {
		font-size: 12px;
		color: var(--mut);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row small.up {
		color: var(--up);
	}
	.row small.down {
		color: var(--down);
	}
	.spark {
		width: 56px;
		height: 24px;
		flex: none;
	}
	.ico {
		flex: none;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--mut);
	}
	.ico.buy {
		color: var(--lime);
	}
	.ico.gift {
		color: var(--agent);
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		color: var(--mut);
		font-size: 14px;
	}
	.quiet {
		font-size: 14px;
		color: var(--mut);
	}
	@media (max-width: 359px) {
		.spark {
			display: none;
		}
	}
</style>
