<script lang="ts">
	// The owner's dashboard: money health first, then settlement, revenue, agents, streams and
	// chat, paid video, viewers, and the system. It refreshes itself every 20 seconds.
	import '../../app.css';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Overview = PageData['overview'];
	/** the latest data: from the page load, then from each refresh */
	let fresh = $state<Overview | null>(null);
	const o = $derived(fresh ?? data.overview);
	let loading = $state(false);
	let busy = $state<string | null>(null);
	let notice = $state<{ ok: boolean; text: string } | null>(null);
	let newKey = $state<{ handle: string; key: string } | null>(null);
	let now = $state(Date.now());

	const EXPLORER = 'https://robinhoodchain.blockscout.com';
	const SECTIONS = [
		['money', 'Money'],
		['settlement', 'Settlement'],
		['revenue', 'Revenue'],
		['agents', 'Agents'],
		['streams', 'Streams & chat'],
		['video', 'Paid video'],
		['viewers', 'Viewers'],
		['system', 'System']
	] as const;

	async function refresh() {
		loading = true;
		try {
			const res = await fetch('/api/admin/overview');
			if (res.ok) fresh = (await res.json()) as Overview;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const poll = setInterval(() => void refresh(), 20_000);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	/** run an owner action, after a confirmation when `confirmText` is given */
	async function act(body: Record<string, unknown>, confirmText?: string) {
		if (confirmText && !window.confirm(confirmText)) return null;
		busy = JSON.stringify(body);
		notice = null;
		try {
			const res = await fetch('/api/admin/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			const out = (await res.json().catch(() => ({}))) as {
				error?: { message: string };
				apiKey?: string;
			};
			if (!res.ok) {
				notice = { ok: false, text: out.error?.message ?? `Failed (${res.status})` };
				return null;
			}
			notice = { ok: true, text: 'Done.' };
			await refresh();
			return out;
		} catch (err) {
			notice = { ok: false, text: err instanceof Error ? err.message : 'Failed' };
			return null;
		} finally {
			busy = null;
		}
	}
	const isBusy = (body: Record<string, unknown>) => busy === JSON.stringify(body);

	/** flip a switch; if it is cancelled or fails, the box goes back */
	async function toggle(
		box: HTMLInputElement,
		body: Record<string, unknown>,
		confirmText?: string
	) {
		const wanted = box.checked;
		const done = await act(body, confirmText);
		if (!done) box.checked = !wanted;
	}

	async function settleNow() {
		const out = (await act(
			{ action: 'settle_now' },
			'Run fee settlement now? Agent wallets claim their fees and send the treasury its share, on chain.'
		)) as { fees?: unknown[]; failed?: { error: string }[] } | null;
		if (out)
			notice = {
				ok: !out.failed?.length,
				text: out.failed?.length
					? `Settlement ran with ${out.failed.length} failure(s): ${out.failed.map((f) => f.error).join('; ')}`
					: `Settlement ran: ${out.fees?.length ?? 0} coin(s) paid.`
			};
	}

	async function rotate(agentId: string, handle: string) {
		const out = (await act(
			{ action: 'rotate_key', agentId },
			`Make a new API key for @${handle}? The current key stops working at once, so the agent must be given the new one.`
		)) as { apiKey?: string } | null;
		if (out?.apiKey) newKey = { handle, key: out.apiKey };
	}

	/* ---------- withdraw ---------- */
	let withdrawTo = $state('');
	let withdrawAssets = $state<Record<'META' | 'USDG' | 'ETH', boolean>>({
		META: true,
		USDG: true,
		ETH: true
	});
	let withdrawn = $state<{
		to: string;
		sent: { asset: string; amount: string; tx: string }[];
		failed: { asset: string; error: string }[];
	} | null>(null);
	const withdrawValid = $derived(/^0x[0-9a-fA-F]{40}$/.test(withdrawTo.trim()));

	async function withdraw() {
		const to = withdrawTo.trim();
		const assets = (['META', 'USDG', 'ETH'] as const).filter((a) => withdrawAssets[a]);
		if (!withdrawValid || !assets.length) return;
		const eth = assets.includes('ETH')
			? '\n\nETH included: the treasury is left without gas, so settlement, coin launches and viewer gas top-ups stop until it is refilled.'
			: '';
		const out = (await act(
			{ action: 'withdraw', to, assets },
			`Send the treasury's entire ${assets.join(', ')} balance to\n${to}?\n\nThis cannot be undone. Check the address.${eth}`
		)) as typeof withdrawn;
		if (!out) return;
		withdrawn = out;
		notice = {
			ok: !out.failed.length,
			text: out.failed.length
				? `Sent ${out.sent.length}, failed ${out.failed.length}: ${out.failed.map((f) => `${f.asset}: ${f.error}`).join('; ')}`
				: out.sent.length
					? `Sent ${out.sent.map((s) => `${s.amount} ${s.asset}`).join(', ')}.`
					: 'Nothing to send: those balances are empty.'
		};
	}

	/* ---------- formatting ---------- */
	const n = (v: number | null | undefined, digits = 4) =>
		v === null || v === undefined
			? '—'
			: v.toLocaleString('en-US', { maximumFractionDigits: digits });
	const usd = (v: number | null | undefined) =>
		v === null || v === undefined
			? '—'
			: v.toLocaleString('en-US', {
					style: 'currency',
					currency: 'USD',
					maximumFractionDigits: v < 1 ? 4 : 2
				});
	const inUsd = (amount: number | null | undefined, symbol: 'ETH' | 'META' | 'USDG') => {
		const rate = o.money?.usd[symbol];
		return amount === null || amount === undefined || !rate ? null : amount * rate;
	};
	const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
	function ago(at: number | null | undefined) {
		if (!at) return '—';
		const s = Math.max(0, Math.round((now - at) / 1000));
		if (s < 60) return `${s}s ago`;
		if (s < 3600) return `${Math.round(s / 60)}m ago`;
		if (s < 86400) return `${Math.round(s / 3600)}h ago`;
		return `${Math.round(s / 86400)}d ago`;
	}
	const time = (at: number) =>
		new Date(at).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	function duration(ms: number) {
		const h = Math.floor(ms / 3_600_000);
		const m = Math.floor(ms / 60_000) % 60;
		return h ? `${h}h ${m}m` : `${m}m`;
	}
	function runSummary(result: unknown) {
		const r = result as {
			fees?: { toTreasury: string; pair: string }[];
			gifts?: unknown[];
			failed?: { agentId: string; error: string }[];
			skipped?: boolean;
			error?: string;
		};
		if (r.error) return r.error;
		if (r.skipped) return 'Skipped: another process was settling';
		const parts = [];
		if (r.fees?.length) parts.push(`${r.fees.length} coin(s) paid`);
		if (r.gifts?.length) parts.push(`${r.gifts.length} gift payout(s)`);
		if (r.failed?.length) parts.push(r.failed.map((f) => f.error).join('; '));
		return parts.join(' · ') || 'Nothing to settle';
	}

	/* ---------- warnings ---------- */
	const warnings = $derived.by(() => {
		const out: string[] = [];
		const m = o.money;
		if (m && m.held.eth !== null && m.held.eth < 0.005)
			out.push(`Treasury gas is low: ${n(m.held.eth, 5)} ETH.`);
		if (m?.daysLeft !== null && m?.daysLeft !== undefined && m.daysLeft < 3)
			out.push(`Treasury gas lasts about ${n(m.daysLeft, 1)} more day(s) at last week's spend.`);
		for (const [name, error] of Object.entries(o.errors))
			out.push(`The ${name} section could not load: ${error}`);
		if (o.settlement && !o.settlement.on)
			out.push('Fee settlement is off on this server: FEE_SETTLE is not "on".');
		if (o.settlement?.on) {
			const last = o.settlement.runs[0];
			if (last && !last.ok) out.push(`The last fee settlement (${ago(last.at)}) had failures.`);
			const hour = o.settlement.everyMinutes * 60_000;
			if (!last || now - last.at > hour * 2.5)
				out.push(
					`No fee settlement has run for ${last ? ago(last.at).replace(' ago', '') : 'a while'}.`
				);
		}
		if (o.system?.health.rpc && !o.system.health.rpc.ok)
			out.push('The chain RPC is not answering.');
		if (o.system?.health.dynamic && !o.system.health.dynamic.ok)
			out.push('Dynamic (sign-in) is not answering.');
		if (o.video?.reactor?.paused) out.push('Paid live video is paused.');
		if (o.system?.countdown.showing)
			out.push('The launch countdown is showing: the site is closed.');
		const hourErrors = (o.system?.logs ?? []).filter(
			(l) => l.level === 'error' && now - l.at < 3_600_000
		).length;
		if (hourErrors) out.push(`${hourErrors} server error(s) in the last hour.`);
		return out;
	});
</script>

<svelte:head>
	<title>Admin · MuseStream</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="admin">
	<header class="top">
		<div class="brand">
			<img src="/logo.png" alt="" width="32" height="32" />
			<div>
				<h1>MuseStream admin</h1>
				<p>{data.admin} · updated {ago(o.at)}</p>
			</div>
		</div>
		<button class="btn-quiet" disabled={loading} onclick={refresh}
			>{loading ? 'Refreshing…' : 'Refresh'}</button
		>
	</header>

	<nav class="jump" aria-label="Sections">
		{#each SECTIONS as [id, label] (id)}<a href="#{id}">{label}</a>{/each}
	</nav>

	{#if notice}
		<p class="notice" class:bad={!notice.ok} role="status">{notice.text}</p>
	{/if}

	{#if newKey}
		<div class="key" role="alert">
			<p><b>New API key for @{newKey.handle}.</b> It is shown only now; give it to the agent.</p>
			<code>{newKey.key}</code>
			<div class="row">
				<button class="btn-money" onclick={() => navigator.clipboard.writeText(newKey!.key)}
					>Copy key</button
				>
				<button class="btn-quiet" onclick={() => (newKey = null)}>Done</button>
			</div>
		</div>
	{/if}

	{#if warnings.length}
		<ul class="warnings" aria-label="Needs attention">
			{#each warnings as w (w)}<li>{w}</li>{/each}
		</ul>
	{/if}

	<!-- ============ MONEY ============ -->
	<section id="money">
		<h2>Money</h2>
		{#if o.money}
			{@const m = o.money}
			<div class="cards">
				<div class="card">
					<span>Treasury gas</span>
					<b>{n(m.held.eth, 5)} ETH</b>
					<small
						>{usd(inUsd(m.held.eth, 'ETH'))} · {m.daysLeft === null
							? 'no spend yet'
							: `about ${n(m.daysLeft, 1)} days left`}</small
					>
				</div>
				<div class="card">
					<span>Treasury META</span>
					<b>{n(m.held.meta, 5)}</b>
					<small>{usd(inUsd(m.held.meta, 'META'))} · fee shares from coins</small>
				</div>
				<div class="card">
					<span>Treasury USDG</span>
					<b>{usd(m.held.usdg)}</b>
					<small>gifts received, before agents' shares</small>
				</div>
				<div class="card">
					<span>Gas spent today</span>
					<b>{n(m.gasSpentToday, 5)} / {n(m.gasCapPerDay, 3)} ETH</b>
					<div class="bar">
						<i style:width="{Math.min(100, (m.gasSpentToday / m.gasCapPerDay) * 100)}%"></i>
					</div>
					<small>{m.topupsToday.count} viewer gas top-up(s) today</small>
				</div>
			</div>
			<p class="meta">
				Treasury <a href="{EXPLORER}/address/{m.treasury}" target="_blank" rel="noopener"
					>{m.treasury}</a
				>
				· ETH {usd(m.usd.ETH)} · META {usd(m.usd.META)}
			</p>
			<form
				class="withdraw"
				onsubmit={(e) => {
					e.preventDefault();
					void withdraw();
				}}
			>
				<h3>Withdraw from the treasury</h3>
				<p class="meta">Sends the treasury's whole balance of each asset you tick.</p>
				<label class="field">
					<span>To wallet</span>
					<input
						bind:value={withdrawTo}
						placeholder="0x…"
						autocomplete="off"
						spellcheck="false"
						aria-invalid={withdrawTo.trim() !== '' && !withdrawValid}
					/>
				</label>
				<div class="row">
					{#each ['META', 'USDG', 'ETH'] as const as asset (asset)}
						<label class="check"
							><input type="checkbox" bind:checked={withdrawAssets[asset]} />
							{asset}</label
						>
					{/each}
				</div>
				<button
					class="btn-money"
					disabled={!withdrawValid ||
						!Object.values(withdrawAssets).some(Boolean) ||
						busy?.includes('"withdraw"')}
					>{busy?.includes('"withdraw"') ? 'Sending…' : 'Withdraw'}</button
				>
				{#if withdrawn?.sent.length}
					<ul class="sent">
						{#each withdrawn.sent as s (s.tx)}
							<li>
								{s.amount}
								{s.asset} ·
								<a href="{EXPLORER}/tx/{s.tx}" target="_blank" rel="noopener"
									>{s.tx.slice(0, 10)}…</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</form>
		{:else if o.errors.money}
			<p class="unavailable">Could not load this section: {o.errors.money}</p>
		{:else}
			<p class="quiet">No chain is configured on this server.</p>
		{/if}
	</section>

	<!-- ============ SETTLEMENT ============ -->
	<section id="settlement">
		{#if o.settlement}
			<div class="head">
				<h2>Fee settlement</h2>
				<button
					class="btn-money"
					disabled={!o.settlement.on || isBusy({ action: 'settle_now' })}
					onclick={settleNow}
					>{isBusy({ action: 'settle_now' }) ? 'Settling…' : 'Settle now'}</button
				>
			</div>
			<p class="meta">
				{o.settlement.on
					? `Runs every ${o.settlement.everyMinutes} minutes.`
					: 'Off on this server: only the server with FEE_SETTLE=on settles.'} Last run: {o
					.settlement.runs[0]
					? `${ago(o.settlement.runs[0].at)}, ${o.settlement.runs[0].ok ? 'ok' : 'with failures'}`
					: 'none recorded yet'}.
			</p>
			<div class="table">
				<table>
					<thead
						><tr
							><th>Coin</th><th>Pair</th><th>In curve</th><th>Claimable</th><th>Owed to treasury</th
							><th>Pays out from</th></tr
						></thead
					>
					<tbody>
						{#each o.settlement.coins as c (c.agentId)}
							<tr>
								<td>${c.handle.toUpperCase()}</td>
								<td>{c.pair}</td>
								<td>{n(c.inCurve, 6)}</td>
								<td>{n(c.claimable, 6)}</td>
								<td
									><b>{n(c.owedToTreasury, 6)}</b>
									<small>{usd(inUsd(c.owedToTreasury, c.pair))}</small></td
								>
								<td>{n(c.payoutMin, 6)}</td>
							</tr>
						{:else}
							<tr><td colspan="6" class="quiet">No live coins.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if o.settlement.retired.length}
				<h3>Retired coins</h3>
				<p class="meta">
					Settlement no longer collects these; fees left in their curves stay there.
				</p>
				<div class="table">
					<table>
						<thead><tr><th>Coin</th><th>Pair</th><th>Retired</th><th>Fees in curve</th></tr></thead>
						<tbody>
							{#each o.settlement.retired as r (r.token)}
								<tr>
									<td
										>${r.handle.toUpperCase()}
										<a href="{EXPLORER}/token/{r.token}" target="_blank" rel="noopener"
											>{short(r.token)}</a
										></td
									>
									<td>{r.pair}</td>
									<td>{time(r.retiredAt)}</td>
									<td>{n(r.inCurve, 6)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			<h3>Recent runs</h3>
			<ul class="runs">
				{#each o.settlement.runs as r (r.id)}
					<li class:bad={!r.ok}>
						<span class="dot"></span>
						<span class="when">{time(r.at)}</span>
						<span class="who">{r.trigger === 'admin' ? 'by you' : 'scheduled'}</span>
						<span class="what">{runSummary(r.result)}</span>
					</li>
				{:else}
					<li class="quiet">No runs recorded yet. They appear here from the next deploy on.</li>
				{/each}
			</ul>
		{:else}
			<h2>Fee settlement</h2>
			<p class="unavailable">Could not load this section: {o.errors.settlement}</p>
		{/if}
	</section>

	<!-- ============ REVENUE ============ -->
	<section id="revenue">
		{#if o.revenue}
			<h2>Revenue</h2>
			<div class="cards">
				{#each ['META', 'ETH', 'USDG'] as const as sym (sym)}
					{@const t = o.revenue.totals[sym]}
					<div class="card">
						<span>{sym === 'USDG' ? 'Gift shares (USDG)' : `Trading fees (${sym})`}</span>
						<b>{sym === 'USDG' ? usd(t.collected) : `${n(t.collected, 6)} ${sym}`}</b>
						<small
							>collected · {usd(inUsd(t.collected, sym))}
							{#if t.owed > 0}· {sym === 'USDG' ? usd(t.owed) : n(t.owed, 6)} owed{/if}</small
						>
					</div>
				{/each}
			</div>
			<div class="split">
				<div>
					<h3>Last 14 days</h3>
					<div class="table">
						<table>
							<thead
								><tr><th>Day</th><th>META</th><th>ETH</th><th>USDG</th><th>≈ USD</th></tr></thead
							>
							<tbody>
								{#each [...o.revenue.byDay].reverse() as d (d.day)}
									<tr>
										<td>{d.day}</td>
										<td>{n(d.META, 6)}</td>
										<td>{n(d.ETH, 6)}</td>
										<td>{usd(d.USDG)}</td>
										<td
											>{usd((inUsd(d.META, 'META') ?? 0) + (inUsd(d.ETH, 'ETH') ?? 0) + d.USDG)}</td
										>
									</tr>
								{:else}
									<tr><td colspan="5" class="quiet">No revenue yet.</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
				<div>
					<h3>By agent</h3>
					<div class="table">
						<table>
							<thead><tr><th>Agent</th><th>META</th><th>ETH</th><th>USDG</th></tr></thead>
							<tbody>
								{#each o.revenue.byAgent as a (a.handle)}
									<tr
										><td>@{a.handle}</td><td>{n(a.META, 6)}</td><td>{n(a.ETH, 6)}</td><td
											>{usd(a.USDG)}</td
										></tr
									>
								{:else}
									<tr><td colspan="4" class="quiet">No revenue yet.</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		{:else}
			<h2>Revenue</h2>
			<p class="unavailable">Could not load this section: {o.errors.revenue}</p>
		{/if}
	</section>

	<!-- ============ AGENTS ============ -->
	<section id="agents">
		{#if o.agents}
			<h2>Agents <small>{o.agents.length}</small></h2>
			<div class="agents">
				{#each o.agents as a (a.id)}
					<article class="agent" class:suspended={a.suspended_at}>
						<header>
							{#if a.avatar_url}<img src={a.avatar_url} alt="" width="44" height="44" />{/if}
							<div>
								<h3>
									{a.name} <span>@{a.handle}</span>
									{#if a.live}<em class="live-badge">LIVE</em>{/if}
									{#if a.suspended_at}<em class="tag bad">Suspended</em>{/if}
								</h3>
								<p>
									{a.operator} · {a.category} · joined {time(a.created_at)}
									{#if a.musebook_url}
										<!-- an external profile, not an app route -->
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
										· <a href={a.musebook_url} target="_blank" rel="noopener">Musebook</a>
									{/if}
								</p>
							</div>
						</header>

						{#if a.live}
							<p class="line">
								Live “{a.live.title}” · {a.live.viewers} watching · for {duration(
									now - a.live.startedAt
								)}
							</p>
						{/if}

						<dl class="facts">
							{#if a.coin}
								<div>
									<dt>Coin</dt>
									<dd>
										<a href="{EXPLORER}/token/{a.coin.token}" target="_blank" rel="noopener"
											>${a.handle.toUpperCase()}</a
										>
										· {a.coin.pair} pair · {a.coin.creatorTaxPct}% tax
									</dd>
								</div>
								<div>
									<dt>Market cap</dt>
									<dd>
										{n(a.coin.marketCap, 4)}
										{a.coin.pair} · {usd(inUsd(a.coin.marketCap, a.coin.pair))}
									</dd>
								</div>
								<div>
									<dt>Curve</dt>
									<dd>
										{a.coin.graduated
											? 'Graduated to its pool'
											: `${n(a.coin.graduationPct, 1)}% to graduation`}
										· {a.coin.holders} holders
									</dd>
								</div>
							{:else}
								<div>
									<dt>Coin</dt>
									<dd>none yet</dd>
								</div>
							{/if}
							{#if a.wallet}
								<div>
									<dt>Wallet</dt>
									<dd>
										<a href="{EXPLORER}/address/{a.wallet.address}" target="_blank" rel="noopener"
											>{short(a.wallet.address)}</a
										>
										· {n(a.wallet.eth, 5)} ETH · {n(a.wallet.meta, 5)} META
									</dd>
								</div>
							{/if}
							{#if a.earnings}
								<div>
									<dt>Earned</dt>
									<dd>
										{n(a.earnings.META.paid, 6)} META paid{#if a.earnings.META.owed}, {n(
												a.earnings.META.owed,
												6
											)} owed{/if}
										· {usd(a.earnings.USDG.paid)} gifts{#if a.earnings.USDG.owed}, {usd(
												a.earnings.USDG.owed
											)} owed{/if}
									</dd>
								</div>
							{/if}
							<div>
								<dt>API key</dt>
								<dd>{a.key_created_at ? `issued ${time(a.key_created_at)}` : 'none active'}</dd>
							</div>
						</dl>

						<div class="switches">
							{#if a.video.liveAllowed !== null}
								<label>
									<input
										type="checkbox"
										checked={a.video.liveAllowed}
										disabled={!!busy}
										onchange={(e) =>
											toggle(
												e.currentTarget,
												{ action: 'live_video', handle: a.handle, on: e.currentTarget.checked },
												e.currentTarget.checked
													? `Allow @${a.handle} paid live video? It costs about $0.75 a minute while people watch.`
													: undefined
											)}
									/>
									Paid live video
								</label>
							{/if}
							{#if a.video.clip}
								<label>
									<input
										type="checkbox"
										checked={a.video.clip.on}
										disabled={!!busy}
										onchange={(e) =>
											toggle(e.currentTarget, {
												action: 'clip',
												handle: a.handle,
												on: e.currentTarget.checked
											})}
									/>
									Loop saved clip
								</label>
							{/if}
						</div>

						<div class="actions">
							{#if a.live}
								<button
									class="btn-quiet"
									disabled={!!busy}
									onclick={() =>
										act(
											{ action: 'end_stream', agentId: a.id },
											`End @${a.handle}'s stream now? Viewers are sent back to the feed.`
										)}>End stream</button
								>
							{/if}
							{#if a.suspended_at}
								<button
									class="btn-quiet"
									disabled={!!busy}
									onclick={() => act({ action: 'unsuspend', agentId: a.id })}>Unsuspend</button
								>
							{:else}
								<button
									class="btn-quiet danger"
									disabled={!!busy}
									onclick={() =>
										act(
											{ action: 'suspend', agentId: a.id },
											`Suspend @${a.handle}? Its API key stops working, its stream ends, and it cannot go live until you unsuspend it. Its coin keeps trading on chain.`
										)}>Suspend</button
								>
							{/if}
							<button class="btn-quiet" disabled={!!busy} onclick={() => rotate(a.id, a.handle)}
								>New API key</button
							>
						</div>
					</article>
				{:else}
					<p class="quiet">No agents yet.</p>
				{/each}
			</div>
		{:else}
			<h2>Agents</h2>
			<p class="unavailable">Could not load this section: {o.errors.agents}</p>
		{/if}
	</section>

	<!-- ============ STREAMS & CHAT ============ -->
	<section id="streams">
		{#if o.streams}
			<h2>Streams & chat</h2>
			<div class="table">
				<table>
					<thead
						><tr
							><th>Stream</th><th>Watching</th><th>Likes</th><th>Chat (5 min)</th><th
								>Gifts today</th
							><th>Video</th><th>Live for</th></tr
						></thead
					>
					<tbody>
						{#each o.streams.live as s (s.streamId)}
							<tr>
								<td><b>@{s.handle}</b> <small>{s.title}</small></td>
								<td>{s.viewers}</td>
								<td>{s.likes}</td>
								<td>{s.chatLast5Min}</td>
								<td>{s.giftsToday.count} · {usd(s.giftsToday.usd)}</td>
								<td>{s.video ?? '—'}</td>
								<td>{duration(now - s.startedAt)}</td>
							</tr>
						{:else}
							<tr><td colspan="7" class="quiet">Nobody is live.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>

			<h3>Recent viewer chat</h3>
			<ul class="chat">
				{#each o.streams.recentChat as m (m.id)}
					<li class:hidden={m.hidden}>
						<span class="when">{ago(m.at)}</span>
						<span class="where">@{m.handle}</span>
						<b>{m.name}</b>
						<span class="text">{m.kind === 'gift' ? `sent ${m.text}` : m.text}</span>
						<span class="ops">
							{#if m.hidden}<em>hidden</em>{:else}
								<button
									disabled={!!busy}
									onclick={() => act({ action: 'hide_message', messageId: m.id })}>Hide</button
								>
							{/if}
							{#if m.muted}<em>muted</em>{:else}
								<button
									disabled={!!busy}
									onclick={() =>
										act(
											{ action: 'mute', viewer: m.viewer },
											`Mute ${m.name}? They can still watch, but not chat.`
										)}>Mute</button
								>
							{/if}
						</span>
					</li>
				{:else}
					<li class="quiet">No viewer chat yet.</li>
				{/each}
			</ul>

			{#if o.streams.muted.length}
				<h3>Muted viewers</h3>
				<ul class="chat">
					{#each o.streams.muted as v (v.viewer)}
						<li>
							<b>{v.name}</b>
							<span class="text">muted {ago(v.mutedAt)}</span>
							<span class="ops"
								><button
									disabled={!!busy}
									onclick={() => act({ action: 'unmute', viewer: v.viewer })}>Unmute</button
								></span
							>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<h2>Streams & chat</h2>
			<p class="unavailable">Could not load this section: {o.errors.streams}</p>
		{/if}
	</section>

	<!-- ============ PAID VIDEO ============ -->
	<section id="video">
		{#if o.video}
			<div class="head">
				<h2>Paid video</h2>
				{#if o.video.reactor}
					{#if o.video.reactor.paused}
						<button
							class="btn-money"
							disabled={!!busy}
							onclick={() => act({ action: 'video_pause', on: false })}>Resume paid video</button
						>
					{:else}
						<button
							class="btn-quiet danger"
							disabled={!!busy}
							onclick={() =>
								act(
									{ action: 'video_pause', on: true },
									'Stop all paid video now? Running sessions end, and streams show their saved clip or placeholder.'
								)}>Stop all paid video</button
						>
					{/if}
				{/if}
			</div>
			<div class="cards">
				<div class="card">
					<span>Provider</span><b>{o.video.provider}</b>
					<small
						>{o.video.reactor
							? `${o.video.reactor.paused ? 'paused' : 'running'} · up to ${o.video.reactor.maxSessions} session(s)`
							: 'no paid video'}</small
					>
				</div>
				<div class="card">
					<span>Spent today</span><b>{usd(o.video.todayUsd)}</b>
					<small>at {usd(o.video.usdPerSecond)} a second</small>
				</div>
				<div class="card">
					<span>Spent this month</span><b>{usd(o.video.monthUsd)}</b>
					<small>{n(o.video.monthSeconds / 60, 1)} minutes</small>
				</div>
				<div class="card">
					<span>Allowed agents</span>
					<b
						>{o.video.reactor?.agents.length
							? o.video.reactor.agents.map((h) => '@' + h).join(', ')
							: 'none'}</b
					>
					<small>{Math.round(o.video.dailySecondsPerAgent / 60)} min a day each</small>
				</div>
			</div>
			{#if o.video.reactor?.sessions.length}
				<h3>Running now</h3>
				<ul class="chat">
					{#each o.video.reactor.sessions as s (s.streamId)}
						<li>
							<b>@{s.handle}</b><span class="text"
								>for {duration(now - s.startedAt)} · {s.clips} clip(s)</span
							>
						</li>
					{/each}
				</ul>
			{/if}
			{#if o.video.today.length}
				<h3>Used today</h3>
				{#each o.video.today as u (u.handle)}
					<div class="usage">
						<span>@{u.handle}</span>
						<div class="bar">
							<i style:width="{Math.min(100, (u.seconds / o.video.dailySecondsPerAgent) * 100)}%"
							></i>
						</div>
						<small
							>{n(u.seconds / 60, 1)} / {Math.round(o.video.dailySecondsPerAgent / 60)} min</small
						>
					</div>
				{/each}
			{/if}
			{#if o.video.clips.length}
				<p class="meta">
					Saved clips: {o.video.clips
						.map((c) => `@${c.handle} (${c.on ? 'on' : 'off'})`)
						.join(', ')}. Switch them per agent above.
				</p>
			{/if}
		{:else}
			<h2>Paid video</h2>
			<p class="unavailable">Could not load this section: {o.errors.video}</p>
		{/if}
	</section>

	<!-- ============ VIEWERS ============ -->
	<section id="viewers">
		{#if o.viewers}
			<h2>Viewers</h2>
			<div class="cards">
				<div class="card"><span>Watching now</span><b>{o.viewers.watchingNow}</b></div>
				<div class="card">
					<span>Signed-in accounts</span><b>{o.viewers.signedInAccounts}</b>
					<small>{o.viewers.newAccountsToday} new today</small>
				</div>
				<div class="card">
					<span>Chatting today</span><b>{o.viewers.chattersToday}</b>
					<small>{o.viewers.messagesToday} messages</small>
				</div>
				<div class="card">
					<span>Traders</span><b>{o.viewers.traders}</b><small>wallets that traded a coin</small>
				</div>
				<div class="card">
					<span>Gifts</span><b>{usd(o.viewers.gifts.usd)}</b>
					<small>{o.viewers.gifts.count} paid · {usd(o.viewers.gifts.todayUsd)} today</small>
				</div>
				<div class="card">
					<span>Gas top-ups</span><b>{o.viewers.gasTopups.count}</b>
					<small>{n(o.viewers.gasTopups.eth, 5)} ETH in total</small>
				</div>
			</div>
		{:else}
			<h2>Viewers</h2>
			<p class="unavailable">Could not load this section: {o.errors.viewers}</p>
		{/if}
	</section>

	<!-- ============ SYSTEM ============ -->
	<section id="system">
		{#if o.system}
			<h2>System</h2>
			<div class="cards">
				<div class="card">
					<span>Deployed</span>
					<b
						>{#if o.system.build.sha}<a
								href="https://github.com/CyberVerse2/musestream/commit/{o.system.build.sha}"
								target="_blank"
								rel="noopener">{o.system.build.sha.slice(0, 7)}</a
							>{:else}unknown{/if}</b
					>
					<small
						>{o.system.build.builtAt ? `built ${ago(Date.parse(o.system.build.builtAt))}` : ''} · up
						{duration(now - o.system.startedAt)}</small
					>
				</div>
				<div class="card">
					<span>Chain RPC</span>
					<b class:bad={!o.system.health.rpc?.ok}
						>{o.system.health.rpc ? (o.system.health.rpc.ok ? 'OK' : 'Down') : 'none'}</b
					>
					<small
						>{o.system.health.rpc?.ok
							? `block ${o.system.health.rpc.value} · ${o.system.health.rpc.ms} ms`
							: (o.system.health.rpc?.error ?? '')}</small
					>
				</div>
				<div class="card">
					<span>Dynamic sign-in</span>
					<b class:bad={!o.system.health.dynamic?.ok}
						>{o.system.health.dynamic ? (o.system.health.dynamic.ok ? 'OK' : 'Down') : 'off'}</b
					>
					<small>{o.system.walletProvider} wallets · {o.system.chainMode ?? 'no chain'}</small>
				</div>
				<div class="card">
					<span>Launch countdown</span>
					<b>{o.system.countdown.showing ? 'Showing' : 'Site open'}</b>
					<small
						>{o.system.countdown.launchAt
							? `set for ${time(o.system.countdown.launchAt)} on ${o.system.countdown.hosts.join(', ')}`
							: 'no countdown set'}</small
					>
					{#if o.system.countdown.launchAt}
						{#if o.system.countdown.siteOpen}
							<button
								class="btn-quiet"
								disabled={!!busy}
								onclick={() =>
									act(
										{ action: 'site_open', open: false },
										'Close the site again? Visitors see the countdown.'
									)}>Show countdown</button
							>
						{:else}
							<button
								class="btn-money"
								disabled={!!busy}
								onclick={() =>
									act(
										{ action: 'site_open', open: true },
										'Open MuseStream to everyone now? The countdown disappears for all visitors.'
									)}>Open the site</button
							>
						{/if}
					{/if}
				</div>
			</div>

			<h3>Recent warnings and errors</h3>
			<ul class="logs">
				{#each o.system.logs as l, i (i)}
					<li class:bad={l.level === 'error'}>
						<span class="when">{ago(l.at)}</span>
						<pre>{l.text}</pre>
					</li>
				{:else}
					<li class="quiet">Nothing since the server started.</li>
				{/each}
			</ul>

			<h3>Admin actions</h3>
			<ul class="chat">
				{#each o.system.audit as a (a.id)}
					<li>
						<span class="when">{time(a.at)}</span>
						<b>{a.action}</b>
						<span class="text">{a.target ?? ''} {a.detail ?? ''}</span>
					</li>
				{:else}
					<li class="quiet">No admin actions yet.</li>
				{/each}
			</ul>
		{:else}
			<h2>System</h2>
			<p class="unavailable">Could not load this section: {o.errors.system}</p>
		{/if}
	</section>
</div>

<style>
	/* the app itself is a fixed full screen; the dashboard is an ordinary scrolling page */
	:global(html:has(.admin)),
	:global(body:has(.admin)) {
		overflow: auto;
		height: auto;
	}
	.admin {
		max-width: 1180px;
		margin: 0 auto;
		padding: 20px 16px 80px;
		color: var(--ink);
		font-size: 14px;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.brand img {
		width: 32px;
		height: auto;
	}
	h1 {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.brand p,
	.meta,
	.quiet,
	small {
		color: var(--mut);
	}
	.brand p {
		font-size: 12px;
	}
	.top .btn-quiet,
	.head .btn-quiet,
	.head .btn-money {
		min-height: 36px;
		padding: 0 14px;
		font-size: 13px;
	}
	.jump {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		gap: 6px;
		overflow-x: auto;
		margin: 16px -16px 0;
		padding: 10px 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}
	.jump a {
		flex: none;
		padding: 6px 12px;
		border-radius: 99px;
		background: var(--surface);
		border: 1px solid var(--line);
		font-size: 13px;
		font-weight: 600;
		color: var(--mut);
	}
	.notice {
		margin-top: 14px;
		padding: 10px 14px;
		border-radius: var(--r-md);
		background: var(--money-soft);
		color: var(--money);
	}
	.notice.bad,
	.warnings li {
		background: var(--agent-soft);
		color: var(--agent);
	}
	.key {
		margin-top: 14px;
		padding: 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--money);
	}
	.key code {
		display: block;
		margin: 10px 0;
		padding: 10px;
		border-radius: var(--r-sm);
		background: var(--bg);
		font-family: var(--f-mono);
		word-break: break-all;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.warnings {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.warnings li {
		padding: 10px 14px;
		border-radius: var(--r-md);
		font-weight: 600;
	}
	section {
		margin-top: 36px;
		scroll-margin-top: 64px;
	}
	h2 {
		font-size: 18px;
		letter-spacing: -0.01em;
	}
	h2 small {
		font-size: 13px;
		font-weight: 500;
	}
	h3 {
		margin-top: 20px;
		font-size: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.meta {
		margin-top: 8px;
		font-size: 12px;
		word-break: break-all;
	}
	a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 10px;
		margin-top: 12px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.card > span {
		font-size: 12px;
		color: var(--mut);
	}
	.card b {
		font-size: 20px;
		letter-spacing: -0.02em;
		word-break: break-word;
	}
	.card small {
		font-size: 12px;
	}
	.card button {
		margin-top: 8px;
		min-height: 34px;
		font-size: 13px;
	}
	.withdraw {
		display: grid;
		gap: 10px;
		margin-top: 16px;
		padding: 14px;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.12));
		border-radius: 14px;
		max-width: 520px;
	}
	.withdraw h3 {
		font-size: 15px;
	}
	.withdraw .field {
		display: grid;
		gap: 4px;
		font-size: 12px;
	}
	.withdraw input:not([type='checkbox']) {
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 13px;
		padding: 9px 10px;
		border-radius: 10px;
		border: 1px solid var(--line, rgba(255, 255, 255, 0.18));
		background: transparent;
		color: inherit;
	}
	.withdraw input[aria-invalid='true'] {
		border-color: var(--agent);
	}
	.withdraw .row {
		display: flex;
		gap: 16px;
	}
	.withdraw .check {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13px;
	}
	.withdraw .btn-money {
		justify-self: start;
	}
	.sent {
		font-size: 13px;
		display: grid;
		gap: 4px;
	}
	.bad,
	.unavailable {
		color: var(--agent);
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		background: var(--line);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--money);
	}
	.table {
		margin-top: 12px;
		overflow-x: auto;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th,
	td {
		padding: 9px 12px;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		font-weight: 600;
		color: var(--mut);
		background: var(--surface);
	}
	tr:last-child td {
		border-bottom: none;
	}
	td small {
		margin-left: 4px;
	}
	.split {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 16px;
	}
	.runs,
	.chat,
	.logs {
		list-style: none;
		margin: 10px 0 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.runs li,
	.chat li,
	.logs li {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
		font-size: 13px;
	}
	.runs li:last-child,
	.chat li:last-child,
	.logs li:last-child {
		border-bottom: none;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--money);
		align-self: center;
	}
	.runs li.bad .dot {
		background: var(--agent);
	}
	.when {
		flex: none;
		width: 92px;
		font-size: 12px;
		color: var(--mut);
	}
	.who,
	.where {
		flex: none;
		font-size: 12px;
		color: var(--mut);
	}
	.what,
	.text {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.chat li.hidden {
		opacity: 0.5;
	}
	.chat li.hidden .text {
		text-decoration: line-through;
	}
	.ops {
		flex: none;
		display: flex;
		gap: 6px;
	}
	.ops button {
		padding: 3px 10px;
		border-radius: var(--r-sm);
		background: var(--surface);
		border: 1px solid var(--line);
		font-size: 12px;
		font-weight: 600;
	}
	.ops em {
		font-size: 12px;
		font-style: normal;
		color: var(--mut);
	}
	.logs pre {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-family: var(--f-mono);
		font-size: 12px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.agents {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.agent {
		padding: 16px;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.agent.suspended {
		border-color: var(--agent);
	}
	.agent header {
		display: flex;
		gap: 12px;
	}
	.agent header img {
		flex: none;
		border-radius: 50%;
		object-fit: cover;
	}
	.agent h3 {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 16px;
	}
	.agent h3 span {
		font-weight: 500;
		color: var(--mut);
	}
	.agent header p {
		margin-top: 2px;
		font-size: 12px;
		color: var(--mut);
	}
	.tag {
		padding: 2px 6px;
		border-radius: 5px;
		font-size: 11px;
		font-style: normal;
		font-weight: 700;
		background: var(--agent-soft);
	}
	.line {
		margin-top: 10px;
		font-size: 13px;
	}
	.facts {
		display: grid;
		gap: 6px;
		margin-top: 12px;
		font-size: 13px;
	}
	.facts div {
		display: grid;
		grid-template-columns: 88px 1fr;
		gap: 8px;
	}
	.facts dt {
		color: var(--mut);
	}
	.switches {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		margin-top: 12px;
		font-size: 13px;
	}
	.switches label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}
	.actions button {
		min-height: 34px;
		padding: 0 12px;
		font-size: 13px;
	}
	.danger {
		color: var(--agent);
	}
	.usage {
		display: grid;
		grid-template-columns: 100px 1fr 110px;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
		font-size: 13px;
	}
</style>
