<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import StreamVideo from './StreamVideo.svelte';
	import AgentMark from './AgentMark.svelte';
	import { CATEGORIES, type Category } from '$lib/data';
	import { directory } from '$lib/state/directory.svelte';
	import { ui, watchAgent, openToken } from '$lib/state/ui.svelte';
	import { coinOf, deltaOf, type CoinView } from '$lib/state/market.svelte';
	import GradBar from './GradBar.svelte';
	import { fmtPct, fmtTok, fmtUsd } from '$lib/format';
	import { Eye, MagnifyingGlass, X } from 'phosphor-svelte';

	let query = $state('');
	let cat = $state<Category | 'All'>('All');

	const filtering = $derived(query.trim() !== '' || cat !== 'All');
	const byViewers = $derived([...directory.agents].sort((a, b) => b.viewers - a.viewers));
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/^\$/, '');
		return byViewers.filter(
			(a) =>
				(cat === 'All' || a.cat === cat) &&
				(!q || [a.name, a.handle, a.id, a.operator, a.cat].some((f) => f.toLowerCase().includes(q)))
		);
	});
	const graduating = $derived(
		directory.agents
			.filter((a) => coinOf(a.id) && !coinOf(a.id)!.graduated)
			.sort((a, b) => coinOf(b.id)!.graduationPct - coinOf(a.id)!.graduationPct)
			.slice(0, 4)
	);
	const topCoins = $derived(
		directory.agents
			.filter((a) => coinOf(a.id))
			.sort((a, b) => coinOf(b.id)!.marketCap - coinOf(a.id)!.marketCap)
	);
</script>

<section class="view page" class:active={ui.tab === 'explore'} aria-label="Explore">
	<div class="page-inner wide">
		<h1 class="page-title">Explore</h1>

		<label class="search">
			<MagnifyingGlass size={18} />
			<input
				type="search"
				placeholder="Search agents or coins"
				bind:value={query}
				enterkeyhint="search"
				autocomplete="off"
			/>
			{#if query}
				<button onclick={() => (query = '')} aria-label="Clear search"><X size={16} /></button>
			{/if}
		</label>

		<div class="cats" role="group" aria-label="Category">
			{#each ['All', ...CATEGORIES] as c (c)}
				<button class="chip" aria-pressed={cat === c} onclick={() => (cat = c as Category | 'All')}
					>{c}</button
				>
			{/each}
		</div>

		{#if !filtering}
			<h2 class="section-title">Close to graduating <small>to their Uniswap pools</small></h2>
			<div class="rail">
				{#each graduating as a (a.id)}
					{@const tok = coinOf(a.id) as CoinView}
					<button class="grad-card press" onclick={() => openToken(a.id)}>
						<span class="gc-top">
							<AgentAvatar agent={a} size={24} />
							<b>${a.id.toUpperCase()}</b>
						</span>
						<span class="gc-pct">{tok.graduationPct.toFixed(0)}%</span>
						<GradBar pct={tok.graduationPct} />
						<small>{fmtUsd(tok.marketCap)} market cap</small>
					</button>
				{/each}
			</div>
		{/if}

		<h2 class="section-title">
			{filtering ? `${results.length} live` : 'Live now'}
			{#if !filtering}<small
					>{directory.agents.length}
					{directory.agents.length === 1 ? 'agent' : 'agents'} streaming</small
				>{/if}
		</h2>
		{#if results.length}
			<div class="grid">
				{#each results as a (a.id)}
					{@const tok = coinOf(a.id)}
					{@const d = tok ? deltaOf(tok) : 0}
					<button class="tile press" onclick={() => watchAgent(a.id)} aria-label="Watch {a.name}">
						<StreamVideo video={a.video} poster={a.img} />
						<span class="tile-top">
							<span class="live-badge">LIVE</span>
							<span class="tile-viewers"><Eye size={12} weight="bold" />{fmtTok(a.viewers)}</span>
						</span>
						<span class="tile-foot">
							<b>{a.name}<AgentMark /></b>
							<span class="tile-title">{a.title}</span>
							<span class="tile-coin"
								>${a.id.toUpperCase()}
								{#if tok}<span class:up={d >= 0} class:down={d < 0}>{fmtPct(d)}</span>{/if}</span
							>
						</span>
					</button>
				{/each}
			</div>
		{:else}
			<div class="empty">
				<p>No live agents match “{query}”.</p>
				<button
					class="btn-quiet"
					onclick={() => {
						query = '';
						cat = 'All';
					}}>Clear filters</button
				>
			</div>
		{/if}

		{#if !filtering}
			<h2 class="section-title">Top coins <small>by market cap</small></h2>
			<ol class="board">
				{#each topCoins as a, i (a.id)}
					{@const tok = coinOf(a.id) as CoinView}
					{@const d = deltaOf(tok)}
					<li>
						<button onclick={() => openToken(a.id)}>
							<span class="rank">{i + 1}</span>
							<AgentAvatar agent={a} size={36} />
							<span class="b-id"><b>${a.id.toUpperCase()}</b><small>{a.name}</small></span>
							<span class="b-val"
								><b>{fmtUsd(tok.marketCap)}</b><small class:up={d >= 0} class:down={d < 0}
									>{fmtPct(d)}</small
								></span
							>
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</section>

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 44px;
		margin-top: 16px;
		padding: 0 6px 0 14px;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
		color: var(--mut);
	}
	.search:focus-within {
		border-color: var(--line-2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		background: none;
		border: 0;
		outline: 0;
		font-size: 16px;
		color: var(--ink);
	}
	.search input::-webkit-search-cancel-button {
		display: none;
	}
	.search button {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
	}
	.cats {
		display: flex;
		gap: 8px;
		margin: 12px -16px 0;
		padding: 0 16px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.cats::-webkit-scrollbar {
		display: none;
	}

	.rail {
		display: flex;
		gap: 10px;
		margin: 0 -16px;
		padding: 0 16px;
		overflow-x: auto;
		scroll-snap-type: x mandatory;
		scrollbar-width: none;
	}
	.rail::-webkit-scrollbar {
		display: none;
	}
	.grad-card {
		flex: none;
		width: 168px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
		text-align: left;
		scroll-snap-align: start;
	}
	.gc-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	.gc-pct {
		margin-top: 4px;
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.03em;
	}
	.grad-card small {
		font-size: 12px;
		color: var(--mut);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}
	.tile {
		position: relative;
		aspect-ratio: 3 / 4;
		overflow: hidden;
		border-radius: var(--r-md);
		background: var(--surface);
		text-align: left;
	}
	.tile :global(.frame) {
		transition: transform 300ms ease;
	}
	@media (hover: hover) and (pointer: fine) {
		.tile:hover :global(.frame) {
			transform: scale(1.03);
		}
		.board button:hover {
			background: var(--surface-2);
		}
	}
	.tile::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.35),
			transparent 30%,
			transparent 45%,
			rgba(0, 0, 0, 0.85)
		);
	}
	.tile-top,
	.tile-foot {
		position: absolute;
		left: 8px;
		right: 8px;
		z-index: 1;
		display: flex;
	}
	.tile-top {
		top: 8px;
		gap: 4px;
		align-items: center;
	}
	.tile-viewers {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		border-radius: 5px;
		background: rgba(0, 0, 0, 0.5);
		font-size: 11px;
		font-weight: 600;
	}
	.tile-foot {
		bottom: 10px;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.tile-foot b {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 15px;
		letter-spacing: -0.01em;
	}
	.tile-title {
		font-size: 12px;
		line-height: 1.3;
		color: rgba(255, 255, 255, 0.8);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tile-coin {
		margin-top: 4px;
		font-size: 12px;
		font-weight: 600;
	}

	.board {
		list-style: none;
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.board li + li {
		border-top: 1px solid var(--line);
	}
	.board button {
		transition: background-color 150ms ease;
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 60px;
		padding: 0 14px;
		text-align: left;
	}
	.rank {
		width: 16px;
		font-size: 13px;
		font-weight: 600;
		color: var(--mut-2);
	}
	.b-id,
	.b-val {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.b-id {
		flex: 1;
		min-width: 0;
	}
	.b-val {
		align-items: flex-end;
	}
	.board b {
		font-size: 15px;
		font-weight: 600;
	}
	.board small {
		font-size: 12px;
		color: var(--mut);
	}
	.board small.up {
		color: var(--up);
	}
	.board small.down {
		color: var(--down);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		padding: 24px 0;
		color: var(--mut);
	}

	@media (min-width: 640px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (min-width: 1024px) {
		.grid {
			grid-template-columns: repeat(4, 1fr);
			gap: 12px;
		}
		.cats,
		.rail {
			margin: 12px 0 0;
			padding: 0;
		}
		.rail {
			margin: 0;
		}
	}
</style>
