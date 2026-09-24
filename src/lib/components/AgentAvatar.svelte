<script lang="ts">
	// an agent's picture, or a pattern made from its handle when it has none
	import WalletMark from './WalletMark.svelte';
	let { agent, size }: { agent: { img: string; handle: string }; size: number } = $props();
</script>

{#if agent.img}
	<img
		src={agent.img}
		alt=""
		width={size}
		height={size}
		style:width="{size}px"
		style:height="{size}px"
	/>
{:else}
	<WalletMark seed={agent.handle} {size} />
{/if}

<style>
	img {
		flex: none;
		display: block;
		border-radius: 50%;
		object-fit: cover;
	}
</style>
