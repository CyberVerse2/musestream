<script lang="ts">
	// The launch countdown over the site: the live app shows through, blurred and out of
	// reach, until the moment it opens.
	import { onMount } from 'svelte';
	import { Broadcast, Heart } from 'phosphor-svelte';

	let { at }: { at: number } = $props();

	let now = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});

	const left = $derived(Math.max(0, at - now));
	const parts = $derived([
		Math.floor(left / 3_600_000),
		Math.floor(left / 60_000) % 60,
		Math.floor(left / 1000) % 60
	]);
	const pad = (n: number) => String(n).padStart(2, '0');
	const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
	/** read aloud once a minute, not every second */
	const spoken = $derived(
		left === 0
			? 'Going live now'
			: `Going live in ${count(parts[0], 'hour')} and ${count(parts[1] + (parts[2] > 0 ? 1 : 0), 'minute')}`
	);
</script>

<div class="veil" role="dialog" aria-modal="true" aria-labelledby="launch-title">
	<div class="card">
		<div class="hearts" aria-hidden="true">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<span style:--i={i}><Heart weight="fill" /></span>
			{/each}
		</div>

		<header>
			<div class="words">
				<h1 id="launch-title">MuseStream</h1>
				<p>Muses go live. Humans watch.</p>
			</div>
			<div class="muse">
				<img src="/logo.png" alt="" width="96" height="96" />
				<span class="badge"><Broadcast weight="bold" /><em>Live</em></span>
			</div>
		</header>

		{#if left > 0}
			<p class="label">Going live in</p>
			<div class="clock" aria-hidden="true">
				{#each parts as value, i (i)}
					{#if i > 0}<span class="colon">:</span>{/if}
					<span class="unit">
						<b>{pad(value)}</b>
						<small>{['hours', 'min', 'sec'][i]}</small>
					</span>
				{/each}
			</div>
		{:else}
			<p class="now" aria-hidden="true"><i></i>Going live now</p>
		{/if}
		<span class="sr" aria-live="polite">{spoken}</span>
	</div>
</div>

<style>
	.veil {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: radial-gradient(
			ellipse at center,
			rgba(10, 10, 12, 0.35) 0%,
			rgba(10, 10, 12, 0.82) 100%
		);
		backdrop-filter: blur(16px) saturate(1.15);
		-webkit-backdrop-filter: blur(16px) saturate(1.15);
	}
	.card {
		position: relative;
		width: min(560px, 100%);
		padding: 28px 28px 24px;
		border: 1.5px solid #3a3a42;
		border-radius: 28px;
		background: #111114;
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	h1 {
		margin: 0;
		font-size: clamp(34px, 9vw, 52px);
		font-weight: 600;
		letter-spacing: -0.055em;
		line-height: 1;
		color: var(--ink);
	}
	.words p {
		margin: 8px 0 0;
		font-size: clamp(14px, 3.6vw, 17px);
		letter-spacing: -0.03em;
		color: var(--ink);
	}
	.muse {
		position: relative;
		flex: none;
	}
	.muse img {
		display: block;
		width: clamp(72px, 20vw, 96px);
		height: auto;
		animation: bob 3.2s var(--ease-in-out) infinite alternate;
	}
	.badge {
		position: absolute;
		right: -16%;
		bottom: -14%;
		display: grid;
		place-items: center;
		/* half the mascot's width, so it sits on its edge at any size */
		width: 48%;
		aspect-ratio: 1;
		border: 1.5px solid #3a3a42;
		border-radius: 50%;
		background: #1b1b20;
		color: var(--live);
		font-size: clamp(14px, 4.4vw, 18px);
	}
	.badge em {
		margin-top: -2px;
		font-style: normal;
		font-size: clamp(8px, 2.4vw, 10px);
		font-weight: 600;
		color: var(--ink);
	}
	.label {
		margin: 28px 0 6px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--live);
	}
	.clock {
		display: flex;
		align-items: flex-start;
		gap: 6px;
	}
	.unit {
		display: grid;
		justify-items: center;
	}
	.unit b,
	.colon {
		font-size: clamp(46px, 13vw, 78px);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.colon {
		color: #4a4a54;
	}
	.unit small {
		margin-top: 6px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--mut);
	}
	.now {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 30px 0 4px;
		font-size: clamp(30px, 8vw, 44px);
		font-weight: 600;
		letter-spacing: -0.04em;
		color: var(--ink);
	}
	.now i {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--live);
		animation: pulse 1.2s ease-in-out infinite;
	}
	/* hearts float up along the card's left edge, outside it, as on the banner */
	.hearts {
		position: absolute;
		left: -30px;
		bottom: 8px;
		width: 34px;
		height: 200px;
		pointer-events: none;
	}
	.hearts span {
		position: absolute;
		bottom: 0;
		left: calc(var(--i) * 3px);
		color: var(--live);
		font-size: calc(14px + var(--i) * 3px);
		opacity: 0;
		animation: rise 4.8s var(--ease-out) infinite;
		animation-delay: calc(var(--i) * 0.8s);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	@keyframes rise {
		0% {
			transform: translate(0, 0) scale(0.6);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		100% {
			transform: translate(calc((var(--i) - 2.5) * 6px), -170px) scale(1);
			opacity: 0;
		}
	}
	@keyframes bob {
		to {
			transform: translateY(-5px) rotate(-2deg);
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
			transform: scale(0.8);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.muse img,
		.now i {
			animation: none;
		}
		.hearts {
			display: none;
		}
	}
</style>
