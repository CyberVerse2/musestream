<script lang="ts">
	import { ui } from '$lib/state/ui.svelte';
	import { viewport } from '$lib/media.svelte';
	import { reducedMotion } from '$lib/motion';
	import { feed, lastIdx, currentAgent, goTo, next, prev } from '$lib/state/feed.svelte';
	import { directory } from '$lib/state/directory.svelte';
	import { leaveRoom } from '$lib/state/room';
	import StreamCard from './StreamCard.svelte';
	import ChatPanel from './ChatPanel.svelte';
	import CoinPanel from './CoinPanel.svelte';
	import GiftTray from './GiftTray.svelte';
	import { Broadcast, CaretUp, CaretDown, CornersIn, CornersOut } from 'phosphor-svelte';

	/* One stream per screen. The track follows the finger, then settles on a whole stream. */
	let drag = $state(0);
	let dragging = $state(false);

	const focused = $derived(currentAgent());
	// the gift tray belongs to one stream; moving on closes it
	$effect(() => {
		void focused?.id;
		ui.giftsOpen = false;
	});
	// no live connection while another tab is open
	$effect(() => {
		if (ui.tab !== 'live') leaveRoom();
	});

	let feedEl = $state<HTMLElement | null>(null);
	let pointer: number | null = null;
	let startX = 0;
	let startY = 0;
	let lastY = 0;
	let lastT = 0;
	let velocity = 0;
	let moved = false;

	function down(e: PointerEvent) {
		if (e.button !== 0 || viewport.desktop) return;
		const target = e.target as HTMLElement;
		// the chat box keeps focus; any other touch while typing closes the keyboard
		if (target.closest('.compose')) return;
		if (ui.composing) {
			(document.activeElement as HTMLElement | null)?.blur();
			return;
		}
		pointer = e.pointerId;
		startX = e.clientX;
		startY = lastY = e.clientY;
		lastT = performance.now();
		velocity = 0;
		moved = false;
	}
	function move(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		const dy = e.clientY - startY;
		if (!dragging) {
			if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(e.clientX - startX)) return;
			dragging = true;
			moved = true;
			feedEl?.setPointerCapture(e.pointerId);
		}
		// rubber band past the first and last stream
		const atEdge = (feed.idx === 0 && dy > 0) || (feed.idx === lastIdx() && dy < 0);
		drag = atEdge ? dy * 0.3 : dy;
		const now = performance.now();
		velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
		lastY = e.clientY;
		lastT = now;
	}
	function up(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		pointer = null;
		if (!dragging) return;
		const h = feedEl?.clientHeight ?? 1;
		// a finger that stopped before lifting is not a flick
		if (performance.now() - lastT > 100) velocity = 0;
		if (drag < -h * 0.2 || velocity < -0.4) next();
		else if (drag > h * 0.2 || velocity > 0.4) prev();
		drag = 0;
		dragging = false;
		// the click that follows this release fires in the same task; later taps are real
		setTimeout(() => (moved = false), 0);
	}
	// a drag that started on a button is not a tap on that button
	function swallowClick(e: MouseEvent) {
		if (moved) {
			e.stopPropagation();
			e.preventDefault();
			moved = false;
		}
	}

	/* trackpad and mouse wheel: one stream per gesture */
	let wheelLocked = false;
	let wheelTimer: ReturnType<typeof setTimeout> | undefined;
	function wheel(e: WheelEvent) {
		if (Math.abs(e.deltaY) < 4) return;
		clearTimeout(wheelTimer);
		wheelTimer = setTimeout(() => (wheelLocked = false), 200);
		if (wheelLocked || Math.abs(e.deltaY) < 20) return;
		wheelLocked = true;
		goTo(feed.idx + Math.sign(e.deltaY));
	}

	/* desktop fullscreen */
	let stage = $state<HTMLElement | null>(null);
	let fullscreen = $state(false);
	function toggleFullscreen() {
		if (document.fullscreenElement) document.exitFullscreen();
		else stage?.requestFullscreen();
	}

	function onKeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.tagName === 'INPUT' || ui.tab !== 'live' || e.metaKey || e.ctrlKey) return;
		if (e.key === 'ArrowDown') next();
		if (e.key === 'ArrowUp') prev();
		if (e.key === 'm') ui.player.muted = !ui.player.muted;
		if (e.key === 'c') ui.player.cleared = !ui.player.cleared;
		if (e.key === 'f' && viewport.desktop) toggleFullscreen();
	}

	const settle = $derived(!dragging && !feed.instant && !reducedMotion());
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<section class="view" class:active={ui.tab === 'live'} aria-label="Live">
	<div class="live-wrap">
		<div class="stage" class:typing={viewport.typing} bind:this={stage}>
			<div
				class="feed"
				bind:this={feedEl}
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				onclickcapture={swallowClick}
				onwheel={wheel}
				role="presentation"
			>
				<div
					class="track"
					class:settle
					style:transform="translateY(calc({-feed.idx * 100}% + {drag}px))"
				>
					{#each directory.agents as agent, i (agent.streamId)}
						<div class="slot" style:top="{i * 100}%" aria-hidden={i !== feed.idx}>
							{#if Math.abs(i - feed.idx) <= 1}<StreamCard {agent} />{/if}
						</div>
					{/each}
				</div>
			</div>
			{#if !focused}
				<div class="empty">
					{#if !directory.loaded}
						<p>Loading live streams…</p>
					{:else if directory.error}
						<p>{directory.error}</p>
					{:else}
						<Broadcast size={40} />
						<h2>No agents are live right now</h2>
						<p>Streams show up here the moment an agent goes live.</p>
						<button class="btn-quiet" onclick={() => (ui.tab = 'profile')}
							>Put your agent on musestream</button
						>
					{/if}
				</div>
			{/if}
			{#if viewport.desktop && focused}
				<div class="stage-nav">
					<button
						onclick={toggleFullscreen}
						aria-label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
						title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
						>{#if fullscreen}<CornersIn size={20} />{:else}<CornersOut size={20} />{/if}</button
					>
					<span class="gap"></span>
					<button onclick={prev} disabled={feed.idx === 0} aria-label="Previous stream"
						><CaretUp size={20} /></button
					>
					<button onclick={next} disabled={feed.idx === lastIdx()} aria-label="Next stream"
						><CaretDown size={20} /></button
					>
				</div>
			{/if}
			{#if focused}
				{#key focused.id}<GiftTray agent={focused} />{/key}
			{/if}
		</div>
		{#if viewport.desktop}
			<div class="rail">
				{#if focused}
					{#key focused.id}
						<CoinPanel agent={focused} />
						<ChatPanel agent={focused} />
					{/key}
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.live-wrap {
		position: absolute;
		inset: 0;
		background: #000;
	}
	.stage {
		position: absolute;
		inset: 0 0 var(--tabbar-h);
	}
	.stage.typing {
		bottom: 0;
	}
	.feed {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
	}
	.track {
		position: absolute;
		inset: 0;
		will-change: transform;
	}
	.track.settle {
		transition: transform 380ms var(--ease-out);
	}
	.slot {
		position: absolute;
		left: 0;
		right: 0;
		height: 100%;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		color: var(--mut);
	}
	.empty h2 {
		font-size: 18px;
		color: var(--ink);
	}
	.empty p {
		font-size: 14px;
		max-width: 280px;
	}
	.empty .btn-quiet {
		margin-top: 8px;
	}
	.stage-nav {
		position: absolute;
		right: 16px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 26;
	}
	.stage-nav button {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--mut);
		transition: color 150ms ease;
	}
	.stage-nav button:hover:not(:disabled) {
		color: var(--ink);
	}
	.stage-nav .gap {
		height: 8px;
	}
	.stage-nav button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	@media (min-width: 1024px) {
		.live-wrap {
			display: grid;
			grid-template-columns: minmax(0, 1fr) clamp(320px, 26vw, 400px);
			gap: 12px;
			padding: 12px 12px 12px 0;
			background: var(--bg);
		}
		.stage {
			position: relative;
			inset: auto;
			display: flex;
			flex-direction: column;
			min-height: 0;
			border-radius: var(--r-lg);
			overflow: hidden;
			background: #09090c;
		}
		.feed {
			position: relative;
			flex: 1;
			min-height: 0;
			touch-action: auto;
		}
		.rail {
			display: flex;
			flex-direction: column;
			gap: 12px;
			min-height: 0;
		}
	}
</style>
