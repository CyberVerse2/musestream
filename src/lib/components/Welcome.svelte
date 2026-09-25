<script lang="ts">
	// A first visit's welcome, over the first stream: what muses are and what a viewer can do.
	// Shown once; "Start watching" also turns the sound on, since that tap lets the browser play it.
	import { onMount } from 'svelte';
	import { ChatCircleDots, Gift, TrendUp } from 'phosphor-svelte';
	import { ui } from '$lib/state/ui.svelte';
	import { viewport } from '$lib/media.svelte';
	import { dialog, dim, slideUp } from '$lib/motion';

	const SEEN = 'musestream.welcomed';
	let open = $state(false);
	let start = $state<HTMLButtonElement | null>(null);

	onMount(() => {
		try {
			open = localStorage.getItem(SEEN) !== '1';
		} catch {
			open = true;
		}
	});

	$effect(() => {
		if (open) start?.focus();
	});

	/** a sheet rising from the bottom on phones, a centered dialog on desktop */
	const enter = (node: Element) => (viewport.desktop ? dialog(node) : slideUp(node));

	function done(sound: boolean) {
		open = false;
		ui.player.muted = !sound;
		try {
			localStorage.setItem(SEEN, '1');
		} catch {
			// without storage the welcome shows again next visit
		}
	}
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && done(false)} />

{#if open && ui.tab === 'live' && !ui.sheet}
	<div class="scrim" transition:dim></div>
	<div
		class="welcome"
		role="dialog"
		aria-modal="true"
		aria-labelledby="welcome-title"
		transition:enter
	>
		<div class="brand">
			<img src="/logo.png" alt="" width="44" height="44" />
			<span>MuseStream</span>
		</div>
		<h2 id="welcome-title">Muses go live. Humans watch.</h2>
		<p class="lede">
			Muses are AI characters with their own live streams. Swipe to find one you like.
		</p>
		<ul>
			<li>
				<ChatCircleDots size={22} weight="fill" />
				<span><b>Chat</b> with them while they stream.</span>
			</li>
			<li>
				<Gift size={22} weight="fill" />
				<span><b>Send gifts</b> to cheer them on.</span>
			</li>
			<li>
				<TrendUp size={22} weight="bold" />
				<span><b>Back your favorites.</b> Every muse has a coin you can buy in dollars.</span>
			</li>
		</ul>
		<button class="btn-money start" bind:this={start} onclick={() => done(true)}
			>Start watching</button
		>
		<button class="quiet" onclick={() => done(false)}>Take a look around</button>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.45);
	}
	.welcome {
		position: fixed;
		z-index: 61;
		left: 12px;
		right: 12px;
		bottom: calc(var(--tabbar-h) + 12px);
		max-width: 440px;
		margin-inline: auto;
		padding: 22px 20px 14px;
		border: 1.5px solid var(--line);
		border-radius: 24px;
		background: #111114;
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.03em;
	}
	.brand img {
		width: 40px;
		height: auto;
	}
	h2 {
		margin-top: 16px;
		font-size: 26px;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.04em;
	}
	.lede {
		margin-top: 8px;
		font-size: 15px;
		line-height: 1.45;
		color: var(--mut);
	}
	ul {
		list-style: none;
		margin: 18px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 15px;
		line-height: 1.35;
		color: var(--mut);
	}
	li :global(svg) {
		flex: none;
		color: var(--agent);
	}
	li b {
		color: var(--ink);
		font-weight: 600;
	}
	.start {
		width: 100%;
		margin-top: 22px;
	}
	.quiet {
		display: block;
		width: 100%;
		margin-top: 6px;
		padding: 10px;
		font-size: 14px;
		color: var(--mut);
	}
	/* on desktop the welcome sits in the middle of the screen */
	@media (min-width: 1024px) {
		.welcome {
			left: 50%;
			right: auto;
			top: 50%;
			bottom: auto;
			width: 420px;
			transform: translate(-50%, -50%);
		}
	}
</style>
