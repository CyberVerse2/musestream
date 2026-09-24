<script lang="ts">
	import type { Agent } from '$lib/data';
	import { seedChat } from '$lib/simulation/chat';
	import { ui } from '$lib/state/ui.svelte';
	import { like } from '$lib/state/live.svelte';
	import { tokenOf } from '$lib/state/market.svelte';
	import { currentAgent } from '$lib/state/feed.svelte';
	import { fmtTok } from '$lib/format';
	import HostPill from './stream/HostPill.svelte';
	import ChatOverlay from './stream/ChatOverlay.svelte';
	import CoinCard from './stream/CoinCard.svelte';
	import ActionRow from './stream/ActionRow.svelte';
	import { Eye, Heart, SpeakerHigh, SpeakerSlash } from 'phosphor-svelte';

	let { agent }: { agent: Agent } = $props();

	const tok = $derived(tokenOf(agent.id));
	const typing = $derived(ui.composing && currentAgent().id === agent.id);

	$effect(() => seedChat(agent.id));

	/* double-tap the stream to like it; a single tap brings back a cleared screen */
	let bursts = $state<{ id: number; x: number; y: number }[]>([]);
	let seq = 0;
	let lastTap = { t: 0, x: 0, y: 0 };
	function tapMedia(e: MouseEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX - box.left;
		const y = e.clientY - box.top;
		const now = performance.now();
		const double = now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40;
		lastTap = { t: double ? 0 : now, x, y };
		if (double) {
			like(agent.id);
			const id = ++seq;
			bursts.push({ id, x, y });
			setTimeout(() => (bursts = bursts.filter((b) => b.id !== id)), 700);
		} else if (ui.player.cleared) {
			ui.player.cleared = false;
		}
	}
</script>

<article
	class="stream-card"
	class:typing
	class:cleared={ui.player.cleared}
	aria-label="{agent.name}, live"
>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="media" onclick={tapMedia}>
		<img src={agent.img} alt="" />
		<div class="shade"></div>
		{#each bursts as b (b.id)}
			<i class="burst" style="left:{b.x}px; top:{b.y}px" aria-hidden="true"
				><Heart size={96} weight="fill" /></i
			>
		{/each}
	</div>
	{#if ui.player.cleared}
		<p class="clear-hint" aria-live="polite">Tap to show controls</p>
	{/if}

	<header class="top">
		<HostPill {agent} />
		<div class="room">
			<span class="live-badge">LIVE</span>
			<span class="viewers"><Eye size={14} weight="bold" />{fmtTok(tok.viewers)}</span>
			<button
				class="sound press"
				onclick={() => (ui.player.muted = !ui.player.muted)}
				aria-label={ui.player.muted ? 'Turn sound on (M)' : 'Turn sound off (M)'}
				aria-pressed={!ui.player.muted}
			>
				{#if ui.player.muted}<SpeakerSlash size={16} weight="bold" />{:else}<SpeakerHigh
						size={16}
						weight="bold"
					/>{/if}
			</button>
		</div>
	</header>

	<p class="title">{agent.title}</p>

	<div class="dock">
		<ChatOverlay id={agent.id} />
		{#if !typing}<CoinCard id={agent.id} />{/if}
		<ActionRow {agent} {typing} />
	</div>
</article>

<style>
	.stream-card {
		position: relative;
		height: 100%;
		overflow: hidden;
		background: #000;
	}
	.media {
		position: absolute;
		inset: 0;
	}
	.media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.shade {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			180deg,
			rgba(0, 0, 0, 0.55) 0%,
			transparent 22%,
			transparent 48%,
			rgba(0, 0, 0, 0.75) 100%
		);
		transition:
			background-color 200ms var(--ease-out),
			opacity 200ms var(--ease-out);
	}

	/* ---- top ---- */
	.top {
		position: absolute;
		top: calc(var(--safe-top) + 10px);
		left: 10px;
		right: 10px;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.room {
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.room .live-badge {
		height: 24px;
		padding: 0 8px;
	}
	.viewers {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 8px;
		border-radius: 6px;
		background: var(--glass);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		font-size: 12px;
		font-weight: 600;
	}
	.sound {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		margin-left: 2px;
		border-radius: 50%;
		background: var(--glass);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}
	.title {
		position: absolute;
		top: calc(var(--safe-top) + 58px);
		left: 14px;
		right: 64px;
		z-index: 4;
		pointer-events: none;
		font-size: 13px;
		font-weight: 500;
		line-height: 1.35;
		color: rgba(255, 255, 255, 0.9);
		text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	/* ---- bottom: chat, coin, actions ---- */
	.dock {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 8;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 0 10px 10px;
	}

	/* typing: the chat box sits on the keyboard, the video dims, trading steps aside */
	.typing .shade {
		background-color: rgba(0, 0, 0, 0.35);
	}

	/* clear screen: only the stream stays */
	.top,
	.title,
	.dock {
		transition: opacity 200ms var(--ease-out);
	}
	.cleared .top,
	.cleared .title,
	.cleared .dock {
		opacity: 0;
		pointer-events: none;
	}
	.cleared .shade {
		opacity: 0;
	}
	.clear-hint {
		position: absolute;
		left: 50%;
		bottom: 24px;
		z-index: 9;
		padding: 8px 14px;
		border-radius: 99px;
		background: var(--glass);
		font-size: 13px;
		font-weight: 600;
		pointer-events: none;
		transform: translateX(-50%);
		animation: hint 2.4s var(--ease-out) forwards;
	}
	@keyframes hint {
		0% {
			opacity: 0;
		}
		10%,
		75% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* double-tap heart: pops at the finger, then drifts up and fades */
	.burst {
		position: absolute;
		z-index: 6;
		margin: -48px 0 0 -48px;
		color: var(--live);
		pointer-events: none;
		filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.35));
		animation: burst 700ms var(--ease-out) forwards;
	}
	@keyframes burst {
		0% {
			opacity: 0;
			transform: scale(0.6) rotate(-12deg);
		}
		25% {
			opacity: 1;
			transform: scale(1.1) rotate(-12deg);
		}
		40% {
			transform: scale(1) rotate(-12deg);
		}
		100% {
			opacity: 0;
			transform: translateY(-60px) scale(0.9) rotate(-12deg);
		}
	}

	/* phone landscape: one row of controls */
	@media (max-height: 460px) {
		.title {
			display: none;
		}
		.dock {
			flex-direction: row;
			align-items: center;
		}
		.dock > :global(*) {
			flex: 1;
			min-width: 0;
		}
	}

	@media (min-width: 1024px) {
		.stream-card {
			container-type: size;
			background: #09090c;
		}
		.media {
			left: 50%;
			right: auto;
			width: min(100%, calc(100cqh * 9 / 16));
			transform: translateX(-50%);
		}
		/* overlays sit on the 9:16 video, not the letterbox around it */
		.top,
		.title {
			--edge: max(16px, calc(50% - 100cqh * 9 / 32 + 12px));
		}
		.top {
			top: 16px;
			left: var(--edge);
			right: var(--edge);
		}
		.title {
			top: 66px;
			left: calc(var(--edge) + 4px);
			right: var(--edge);
		}
		.dock {
			display: none;
		}
	}
</style>
