<script lang="ts">
	// What a stream shows: a looping clip, or live video from a playlist.
	// A new source fades in over the old one.
	import { fade } from 'svelte/transition';
	import type { VideoSource } from '$lib/api';
	import { ui } from '$lib/state/ui.svelte';
	import { reducedMotion } from '$lib/motion';

	let {
		video,
		poster = '',
		playing = true
	}: { video: VideoSource | null; poster?: string; playing?: boolean } = $props();

	const key = $derived(video ? `${video.kind}:${video.url}` : '');

	type Hls = import('hls.js').default;

	/** attach a source to a <video>; live playlists use hls.js where the browser lacks HLS */
	function source(node: HTMLVideoElement, src: VideoSource) {
		let hls: Hls | null = null;
		let gone = false;
		if (src.kind === 'file' || node.canPlayType('application/vnd.apple.mpegurl')) {
			node.src = src.url;
		} else {
			void import('hls.js').then(({ default: HlsJs }) => {
				if (gone || !HlsJs.isSupported()) return;
				hls = new HlsJs({ liveSyncDurationCount: 2, lowLatencyMode: false });
				hls.loadSource(src.url);
				hls.attachMedia(node);
			});
		}
		return {
			destroy() {
				gone = true;
				hls?.destroy();
			}
		};
	}

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
			<video
				muted={ui.player.muted}
				loop={video.kind === 'file'}
				playsinline
				preload="auto"
				use:source={video}
				use:play={playing}
				in:fade={{ duration: reducedMotion() ? 0 : 600 }}
			></video>
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
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	/* no clip yet and no picture: a slow gradient while the first scene renders */
	.waiting {
		position: absolute;
		inset: 0;
		background: linear-gradient(160deg, #1c1535, #0b2a30 55%, #2a0d22);
		background-size: 200% 200%;
		animation: drift 8s ease-in-out infinite alternate;
	}
	@keyframes drift {
		to {
			background-position: 100% 100%;
		}
	}
</style>
