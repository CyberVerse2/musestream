<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import { onMount } from 'svelte';
	import { findAgent } from '$lib/state/directory.svelte';
	import { holdings, wallet } from '$lib/state/portfolio.svelte';
	import { ui, openToken } from '$lib/state/ui.svelte';
	import { tokenOf } from '$lib/state/market.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { fmtCash, fmtPct, fmtTok } from '$lib/format';
	import { DOWN, UP, sparkline, trendColor } from '$lib/sparkline';
	import { ArrowDownLeft, ArrowUpRight, Copy, Gift } from 'phosphor-svelte';

	const POINTS = 80;

	const rows = $derived(
		Object.entries(holdings)
			.map(([id, h]) => {
				const tok = tokenOf(id);
				const agent = findAgent(id);
				return {
					id,
					// a coin stays in the wallet after its agent stops streaming
					agent: agent ?? { img: '', handle: id, name: `@${id}` },
					live: !!agent,
					h,
					value: h.amt * tok.price,
					pnl: (tok.price / h.cost - 1) * 100,
					hist: tok.hist.slice(-40)
				};
			})
			.sort((a, b) => b.value - a.value)
	);
	const inCoins = $derived(rows.reduce((s, r) => s + r.value, 0));
	const cost = $derived(rows.reduce((s, r) => s + r.h.amt * r.h.cost, 0));
	const pnl = $derived(inCoins - cost);
	const pnlPct = $derived(cost ? (pnl / cost) * 100 : 0);
	const total = $derived(wallet.cash + inCoins);
	const series = $derived.by(() => {
		const out = Array.from({ length: POINTS }, () => wallet.cash);
		for (const [id, h] of Object.entries(holdings)) {
			const hist = tokenOf(id).hist.slice(-POINTS);
			const offset = POINTS - hist.length;
			hist.forEach((p, i) => (out[i + offset]! += h.amt * p));
		}
		return out;
	});
	const seriesUp = $derived(series.at(-1)! >= series[0]!);

	let now = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 15000);
		return () => clearInterval(t);
	});
	function ago(at: number) {
		const s = Math.max(1, Math.round((now - at) / 1000));
		if (s < 60) return 'now';
		if (s < 3600) return `${Math.round(s / 60)}m`;
		return `${Math.round(s / 3600)}h`;
	}
	const short = $derived(`${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`);
	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(wallet.address);
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
			<button class="addr press" onclick={copyAddress} aria-label="Copy wallet address"
				>{short}<Copy size={14} /></button
			>
		</header>

		<div class="hero">
			<p class="label">Total balance</p>
			<p class="total">{fmtCash(total)}</p>
			{#if rows.length}
				<p class="pnl" class:up={pnl >= 0} class:down={pnl < 0}>
					{pnl >= 0 ? '+' : ''}{fmtCash(pnl)} ({fmtPct(pnlPct)}) <span>on your coins</span>
				</p>
			{/if}
			<canvas
				class="chart"
				use:sparkline={{ data: series, color: seriesUp ? UP : DOWN, tail: true }}
			></canvas>
			<div class="split">
				<div><span>Cash</span><b>{fmtCash(wallet.cash)}</b></div>
				<div><span>In coins</span><b>{fmtCash(inCoins)}</b></div>
			</div>
		</div>

		<h2 class="section-title">Coins <small>{rows.length} held</small></h2>
		{#if rows.length}
			<ul class="list">
				{#each rows as r (r.id)}
					<li>
						<button class="row press" onclick={() => openToken(r.id)}>
							<span class="ava"
								><AgentAvatar agent={r.agent} size={40} />{#if r.live}<i class="dot"></i>{/if}</span
							>
							<span class="mid">
								<b>${r.id.toUpperCase()}</b>
								<small
									>{fmtTok(r.h.amt)} · {r.agent.name}{r.live ? ' is live' : ' is offline'}</small
								>
							</span>
							<canvas
								class="spark"
								use:sparkline={{
									data: r.hist,
									color: trendColor(r.pnl),
									fill: false
								}}
							></canvas>
							<span class="end">
								<b>{fmtCash(r.value)}</b>
								<small class:up={r.pnl >= 0} class:down={r.pnl < 0}>{fmtPct(r.pnl)}</small>
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
		{#if wallet.activity.length}
			<ul class="list">
				{#each wallet.activity as a (a.id)}
					{@const agent = findAgent(a.agent) ?? { name: `@${a.agent}` }}
					<li class="row act">
						<span class="ico {a.kind}">
							{#if a.kind === 'buy'}<ArrowDownLeft size={18} weight="bold" />
							{:else if a.kind === 'sell'}<ArrowUpRight size={18} weight="bold" />
							{:else}<Gift size={18} weight="bold" />{/if}
						</span>
						<span class="mid">
							<b
								>{a.kind === 'buy'
									? `Bought $${a.agent.toUpperCase()}`
									: a.kind === 'sell'
										? `Sold $${a.agent.toUpperCase()}`
										: `Gift to ${agent.name}`}</b
							>
							<small
								>{a.kind === 'gift'
									? 'Sent in chat'
									: `${fmtTok(a.tokens)} ${a.agent.toUpperCase()}`}
								· {ago(a.at)}</small
							>
						</span>
						<span class="end"
							><b class:up={a.kind === 'sell'}>{a.kind === 'sell' ? '+' : '−'}{fmtCash(a.usd)}</b
							></span
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="quiet">Your trades and gifts show up here.</p>
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
		grid-template-columns: 1fr 1fr;
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
