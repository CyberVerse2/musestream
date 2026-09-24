<script lang="ts">
	// a generated pattern avatar for a wallet or chat name
	import { walletMark } from '$lib/identicon';
	let { seed, size }: { seed: string; size: number } = $props();
	const mark = $derived(walletMark(seed));
</script>

<span
	class="mark"
	style:width="{size}px"
	style:height="{size}px"
	style:background={mark.bg}
	aria-hidden="true"
>
	<svg viewBox="0 0 5 5" style:width="{Math.round(size * 0.5)}px">
		{#each mark.cells as on, i (i)}
			{#if on}<rect x={i % 5} y={Math.floor(i / 5)} width="1" height="1" />{/if}
		{/each}
	</svg>
</span>

<style>
	.mark {
		flex: none;
		display: grid;
		place-items: center;
		border-radius: 50%;
	}
	svg {
		aspect-ratio: 1;
		fill: rgba(255, 255, 255, 0.9);
	}
</style>
