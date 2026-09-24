<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Agent } from '$lib/data';
	import { ui } from '$lib/state/ui.svelte';
	import { payGift, refreshWallet, spendableUsd, wallet } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { fmtCash } from '$lib/format';
	import { viewport } from '$lib/media.svelte';
	import { dim, slideUp } from '$lib/motion';
	import { X } from 'phosphor-svelte';

	let { agent }: { agent: Agent } = $props();
	const gifts = [
		{ id: 'lurk', name: 'Lurk', usd: 1 },
		{ id: 'gg', name: 'GG', usd: 2 },
		{ id: 'spark', name: 'Spark', usd: 5 },
		{ id: 'banger', name: 'Banger', usd: 10 },
		{ id: 'crown', name: 'Crown', usd: 25 },
		{ id: 'moon', name: 'Moon', usd: 50 }
	] as const;
	type GiftChoice = (typeof gifts)[number];
	let active = $state<GiftChoice | null>(null);
	let combo = $state(0);
	let sequence = $state(0);
	let timer: ReturnType<typeof setTimeout> | undefined;
	onMount(() => {
		// Warm the effect assets so a first send does not animate an unloaded image.
		for (const id of [...gifts.map((gift) => gift.id), 'rocket']) {
			const image = new Image();
			image.src = `/img/gifts/${id}.webp`;
		}
	});

	// the tray shows the balance, so load the wallet when it opens
	$effect(() => {
		if (ui.giftsOpen && !wallet.loaded) void refreshWallet();
	});

	function send(gift: GiftChoice) {
		if (wallet.info && gift.usd > spendableUsd()) {
			showToast('⚠', `Not enough balance for ${gift.name}`);
			return;
		}
		payGift(agent.streamId, gift.id, gift.usd).catch((err: unknown) =>
			showToast('⚠', err instanceof Error ? err.message : 'Gift not sent')
		);
		combo = active?.id === gift.id ? combo + 1 : 1;
		active = gift;
		sequence += 1;
		clearTimeout(timer);
		timer = setTimeout(() => {
			active = null;
			combo = 0;
		}, 3200);
	}
	onDestroy(() => clearTimeout(timer));
</script>

<div class="gift-feedback" role="status" aria-live="polite" aria-atomic="true">
	{#if active}
		<span>You sent {active.name} to {agent.name}{combo > 1 ? ` ×${combo}` : ''}</span>
	{/if}
</div>
{#if active}
	{#key sequence}
		<div class="gift-effect {active.id}" aria-hidden="true">
			{#if active.id === 'spark'}
				<svg class="electric-branches" viewBox="0 0 400 700" preserveAspectRatio="none">
					<path
						pathLength="1"
						d="M390 490 372 420 390 360 366 310 382 240 365 180 385 90 M378 400 344 375 355 330 M374 277 344 244 354 206 M10 610 28 545 12 490 34 418 20 352 33 285 M27 545 58 508 49 470 M24 375 52 338 46 300"
					/>
				</svg>
			{/if}
			<div class="gift-art">
				{#if active.id === 'moon'}
					<div class="rocket">
						<img src="/img/gifts/rocket.webp" alt="" /><span class="rocket-trail"></span>
					</div>
				{/if}
				<img class="hero" src="/img/gifts/{active.id}.webp" alt="" />
				{#if active.id === 'gg' || active.id === 'crown'}
					{#each Array.from({ length: 12 }) as _, i (i)}<i class="particle" style="--i:{i}"
						></i>{/each}
				{/if}
				{#if active.id === 'banger'}
					{#each [0, 1, 2] as i (i)}<i class="ring" style="--i:{i}"></i>{/each}
				{/if}
			</div>
			{#if combo > 1}<span class="combo">×{combo}</span>{/if}
		</div>
	{/key}
{/if}

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') ui.giftsOpen = false;
	}}
/>
{#if ui.giftsOpen && !viewport.desktop}
	<div
		class="gift-scrim"
		onclick={() => (ui.giftsOpen = false)}
		aria-hidden="true"
		transition:dim={{ duration: 240 }}
	></div>
{/if}
{#if viewport.desktop || ui.giftsOpen}
	<section
		class="gift-tray"
		aria-label="Send a gift"
		in:slideUp={{ duration: viewport.desktop ? 0 : 240 }}
		out:slideUp={{ duration: viewport.desktop ? 0 : 200 }}
	>
		<header class="gift-head">
			<span
				>Send {agent.name} a gift {#if wallet.info}<small>Balance {fmtCash(spendableUsd())}</small
					>{/if}</span
			>
			<button class="gift-close" onclick={() => (ui.giftsOpen = false)} aria-label="Close gifts"
				><X size={18} /></button
			>
		</header>
		<div class="gift-options">
			{#each gifts as gift (gift.id)}
				<button
					class="gift-option press"
					class:chosen={active?.id === gift.id}
					onclick={() => send(gift)}
					aria-label="Send {gift.name}, ${gift.usd}"
				>
					<img
						class="gift-icon"
						src="/img/gifts/{gift.id}-thumb.webp"
						alt=""
						width="64"
						height="64"
					/>
					<span class="gift-name">{gift.name}</span>
					<span class="gift-price">${gift.usd}</span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<style>
	.gift-tray {
		flex: none;
		display: flex;
		align-items: center;
		margin: 6px 8px 8px;
		padding: 8px 6px 10px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.gift-options {
		display: flex;
		flex: 1;
		width: 100%;
		min-width: 0;
		justify-content: space-evenly;
		align-items: flex-start;
	}
	.gift-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1 1 0;
		max-width: 88px;
		min-width: 0;
		gap: 5px;
		padding: 2px 0;
		border-radius: 7px;
	}
	.gift-option.chosen .gift-name {
		color: var(--lime);
	}
	.gift-option:focus-visible {
		outline: 2px solid var(--lime);
		outline-offset: 2px;
	}
	.gift-icon {
		display: block;
		width: 52px;
		height: 48px;
		object-fit: contain;
		transition: transform 180ms ease;
	}
	@media (hover: hover) and (pointer: fine) {
		.gift-option:hover .gift-name {
			color: var(--lime);
		}
		.gift-option:hover .gift-icon {
			transform: translateY(-3px) rotate(-6deg);
		}
	}
	.gift-name {
		font-size: 12px;
		line-height: 16px;
		color: var(--ink);
	}
	.gift-price {
		font-size: 11px;
		line-height: 14px;
		color: var(--mut);
	}
	.gift-head,
	.gift-scrim {
		display: none;
	}
	.gift-feedback {
		position: absolute;
		z-index: 30;
		bottom: 120px;
		left: 50%;
		transform: translateX(-50%);
		pointer-events: none;
		max-width: 90%;
		width: max-content;
	}
	.gift-feedback span {
		display: block;
		padding: 8px 14px;
		border-radius: 30px;
		background: #15151ee8;
		color: #f4f4f7;
		font-size: 12px;
	}
	.gift-effect {
		position: absolute;
		inset: 0 0 110px;
		z-index: 29;
		pointer-events: none;
		overflow: hidden;
		animation: effect-life 3.2s both;
	}
	.gift-art {
		position: absolute;
		left: 50%;
		bottom: 55px;
		width: 180px;
		height: 180px;
		margin-left: -90px;
		display: grid;
		place-items: center;
	}
	.hero {
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 5px 18px #0008);
	}
	.combo {
		position: absolute;
		bottom: 70px;
		left: calc(50% + 82px);
		font-size: 32px;
		color: var(--lime);
		font-weight: 800;
		transform: rotate(-12deg);
	}
	.lurk .hero {
		animation: peek 3.2s both;
	}
	.gg .hero {
		animation: bounce-in 650ms both;
	}
	.particle {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 7px;
		height: 12px;
		background: #dfff67;
		border-radius: 2px;
		transform: rotate(calc(var(--i) * 30deg));
		animation: scatter 1.4s ease-out both;
	}
	.particle:nth-child(odd) {
		background: #b098ff;
	}
	.spark .gift-art {
		left: auto;
		right: 8px;
		bottom: 28%;
		width: 110px;
		height: 150px;
	}
	.spark .hero {
		animation: electric 650ms ease-out 3;
		filter: drop-shadow(0 0 24px #e4ff63);
	}
	.ring {
		position: absolute;
		inset: 16px;
		border: 2px solid #dfff67;
		border-radius: 50%;
		animation: ripple 1.6s calc(var(--i) * 250ms) ease-out infinite;
	}
	.electric-branches {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: none;
		stroke: #e5ff87;
		stroke-width: 2;
		filter: drop-shadow(0 0 7px #caff47);
	}
	.electric-branches path {
		stroke-dasharray: 1;
		animation: branch-pulse 1.4s ease-out 2;
	}
	.banger .gift-art {
		animation: speaker-drop 600ms cubic-bezier(0.2, 0.8, 0.3, 1.2) both;
	}
	.banger .hero {
		animation: thump 480ms 600ms ease-in-out 5;
	}
	.crown .gift-art {
		bottom: auto;
		top: 0;
		left: 48px;
		width: 76px;
		height: 76px;
		margin-left: -38px;
	}
	.crown .hero {
		animation: crown-in 1.1s 200ms both;
		filter: drop-shadow(0 0 18px #ffc94f88);
	}
	.crown .particle {
		background: #ffd65a;
		width: 5px;
		height: 5px;
		animation: assemble 1.1s ease-in both;
	}
	.moon .gift-art {
		bottom: auto;
		top: 20%;
	}
	.moon .hero {
		animation: moon-glow 3.2s both;
	}
	.rocket {
		position: absolute;
		width: 120px;
		height: 160px;
		animation: launch 1.6s cubic-bezier(0.5, 0, 0.8, 0.4) both;
	}
	.rocket img {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.rocket-trail {
		position: absolute;
		top: 75%;
		left: 44%;
		width: 12%;
		height: 180px;
		background: linear-gradient(#fff7b0, #dfff6790 25%, transparent);
		filter: blur(5px);
		transform-origin: top;
		animation: trail 350ms alternate infinite;
	}
	@keyframes trail {
		to {
			transform: scaleX(0.65);
			opacity: 0.6;
		}
	}
	@keyframes speaker-drop {
		from {
			transform: translateY(-100px) rotate(-12deg);
			opacity: 0;
		}
		to {
			transform: translateY(0) rotate(0);
			opacity: 1;
		}
	}
	@keyframes branch-pulse {
		0% {
			stroke-dashoffset: 1;
			opacity: 0;
		}
		40% {
			stroke-dashoffset: 0;
			opacity: 0.8;
		}
		100% {
			stroke-dashoffset: -0.4;
			opacity: 0;
		}
	}
	@keyframes assemble {
		0% {
			opacity: 0;
			transform: rotate(calc(var(--i) * 30deg)) translateY(-65px);
		}
		30% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: rotate(calc(var(--i) * 30deg)) translateY(-12px);
		}
	}
	@keyframes effect-life {
		0% {
			opacity: 0;
		}
		8%,
		80% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
	@keyframes peek {
		0% {
			transform: translateY(160px);
		}
		20%,
		45%,
		65% {
			transform: translateY(0) scaleY(1);
		}
		50% {
			transform: scaleY(0.1);
		}
		100% {
			transform: translateY(160px);
		}
	}
	@keyframes bounce-in {
		0% {
			transform: scale(0.1) rotate(-20deg);
		}
		65% {
			transform: scale(1.25) rotate(8deg);
		}
		100% {
			transform: scale(1) rotate(-6deg);
		}
	}
	@keyframes scatter {
		from {
			opacity: 1;
			transform: rotate(calc(var(--i) * 30deg)) translateY(0);
		}
		to {
			opacity: 0;
			transform: rotate(calc(var(--i) * 30deg)) translateY(-115px) rotate(120deg);
		}
	}
	@keyframes electric {
		0%,
		100% {
			transform: scale(0.8) rotate(-12deg);
			opacity: 0.5;
		}
		45% {
			transform: scale(1.2) rotate(8deg);
			opacity: 1;
		}
	}
	@keyframes ripple {
		from {
			transform: scale(0.6);
			opacity: 0.7;
		}
		to {
			transform: scale(3);
			opacity: 0;
		}
	}
	@keyframes thump {
		50% {
			transform: scale(1.18) rotate(-8deg);
		}
	}
	@keyframes crown-in {
		from {
			opacity: 0;
			transform: translateY(-30px) scale(0.3) rotate(-25deg);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1) rotate(-10deg);
		}
	}
	@keyframes launch {
		from {
			transform: translate(-45px, 75vh) rotate(8deg);
		}
		to {
			transform: translate(45px, -40vh) rotate(8deg);
		}
	}
	@keyframes moon-glow {
		0%,
		30% {
			opacity: 0;
			transform: scale(0.5);
		}
		55%,
		100% {
			opacity: 1;
			transform: scale(1.2);
			filter: drop-shadow(0 0 40px #fce3a9);
		}
	}
	@media (max-width: 1023px) {
		.gift-scrim {
			display: block;
			position: absolute;
			inset: 0;
			z-index: 30;
		}
		.gift-tray {
			flex-direction: column;
			align-items: stretch;
			position: absolute;
			left: 0;
			right: 0;
			bottom: 0;
			margin: 0;
			padding: 4px 8px 12px;
			border-radius: 16px 16px 0 0;
			border-top: 1px solid var(--line);
			background: var(--surface);
			z-index: 31;
			will-change: transform;
		}
		.gift-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0 0 4px 8px;
			font-size: 14px;
			font-weight: 600;
		}
		.gift-head small {
			margin-left: 6px;
			font-size: 12px;
			font-weight: 500;
			color: var(--mut);
		}
		.gift-close {
			width: 44px;
			height: 44px;
			display: grid;
			place-items: center;
			color: var(--mut);
		}
		.gift-options {
			display: grid;
			grid-template-columns: repeat(6, 1fr);
		}
		.gift-option {
			max-width: none;
			padding: 6px 0;
		}
		.gift-option:active {
			background: var(--surface-2);
		}
		.gift-icon {
			width: 44px;
			height: 44px;
		}
		.gift-effect {
			bottom: 170px;
		}
		.gift-feedback {
			bottom: 182px;
		}
		.crown .gift-art {
			left: 32px;
		}
	}
	@media (max-width: 359px) {
		.gift-options {
			grid-template-columns: repeat(3, 1fr);
			row-gap: 4px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.gift-effect,
		.gift-effect * {
			animation: none !important;
		}
		.gift-effect .particle,
		.gift-effect .ring,
		.electric-branches,
		.rocket {
			display: none;
		}
		.gift-icon,
		.gift-option {
			transition: none;
		}
	}
</style>
