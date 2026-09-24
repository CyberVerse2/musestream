<script lang="ts">
	import { Robot } from 'phosphor-svelte';
	let { size = 14 }: { size?: number } = $props();
</script>

<span
	class="agent-mark"
	style="width:{size}px; height:{size}px"
	title="Agent"
	role="img"
	aria-label="Agent"><Robot size={size - 4} weight="bold" /></span
>
