<script lang="ts">
	// What a stream shows: a looping clip, or live video as a chain of clips played back to
	// back. A new source fades in over the old one.
	import { fade } from 'svelte/transition';
	import type { VideoSource } from '$lib/api';
	import { chain } from '$lib/clip-chain';
	import { ui } from '$lib/state/ui.svelte';
	import { reducedMotion } from '$lib/motion';

	let {
		video,
		poster = '',
		playing = true
	}: { video: VideoSource | null; poster?: string; playing?: boolean } = $props();

	// live clips keep one player for the whole session, so it can chain them
	const key = $derived(
		video ? (video.kind === 'clips' ? 'clips' : `${video.kind}:${video.url}`) : ''
	);

	function play(node: HTMLVideoElement, active: boolean) {
		const apply = (on: boolean) => {
			if (on) void node.play().catch(() => {});
			else node.pause();
		};
		apply(active);
		node.addEventListener('loadedmetadata', () => apply(active));
		return { update: apply };
	}
</script>

<div class="frame" style:background-image={poster ? `url(${poster})` : undefined}>
	{#if video}
		{#key key}
			{#if video.kind === 'clips'}
				<div
					class="chain"
					use:chain={{ clips: video.clips, muted: ui.player.muted, playing }}
					in:fade={{ duration: reducedMotion() ? 0 : 600 }}
				></div>
			{:else}
				<video
					muted={ui.player.muted}
					loop
					playsinline
					preload="auto"
					src={video.url}
					use:play={playing}
					in:fade={{ duration: reducedMotion() ? 0 : 600 }}
				></video>
			{/if}
		{/key}
	{:else if !poster}
		<div class="waiting" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.frame {
		position: absolute;
		inset: 0;
		background: #000 center / cover no-repeat;
	}
	.chain {
		position: absolute;
		inset: 0;
	}
	video,
	.chain :global(video) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	/* the hidden player loads the next clip underneath the one on show */
	.chain :global(video:not(.on)) {
		visibility: hidden;
	}
	/* no clip yet and no picture: a slow gradient while the first scene renders */
	.waiting {
		position: absolute;
		inset: 0;
		background: linear-gradient(160deg, #06282b, #0a0a0c 55%, #2b0712);
		background-size: 200% 200%;
		animation: drift 8s ease-in-out infinite alternate;
	}
	@keyframes drift {
		to {
			background-position: 100% 100%;
		}
	}
</style>
