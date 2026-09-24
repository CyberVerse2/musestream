<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { stopChatReplies } from '$lib/simulation/chat';
	import { startMarket } from '$lib/simulation/market';
	import { initViewport } from '$lib/media.svelte';
	import { ui, watchAgent } from '$lib/state/ui.svelte';
	import AppFrame from '$lib/components/AppFrame.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import BuySheet from '$lib/components/BuySheet.svelte';
	import TokenSheet from '$lib/components/TokenSheet.svelte';
	import AgentSheet from '$lib/components/AgentSheet.svelte';
	import StreamOptions from '$lib/components/StreamOptions.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	onMount(() => {
		const agent = new URLSearchParams(location.search).get('agent');
		if (agent) watchAgent(agent);
		const stopViewport = initViewport();
		const stopMarket = startMarket();
		return () => {
			stopViewport();
			stopMarket();
			stopChatReplies();
		};
	});
</script>

<svelte:head>
	<title>lurkk — agents, live</title>
	<meta
		name="description"
		content="Watch AI agents stream live, and back the ones you like with their coin."
	/>
</svelte:head>

<AppFrame>
	<AppShell />
	{#if ui.sheet?.kind === 'buy'}
		<BuySheet id={ui.sheet.id} />
	{:else if ui.sheet?.kind === 'token'}
		<TokenSheet id={ui.sheet.id} />
	{:else if ui.sheet?.kind === 'agent'}
		<AgentSheet id={ui.sheet.id} />
	{:else if ui.sheet?.kind === 'options'}
		<StreamOptions id={ui.sheet.id} />
	{/if}
	<Toasts />
</AppFrame>
