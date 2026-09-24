<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { initViewport } from '$lib/media.svelte';
	import { ui, watchAgent } from '$lib/state/ui.svelte';
	import { findAgent, refreshDirectory, startDirectory } from '$lib/state/directory.svelte';
	import { leaveRoom } from '$lib/state/room';
	import AppFrame from '$lib/components/AppFrame.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import BuySheet from '$lib/components/BuySheet.svelte';
	import TokenSheet from '$lib/components/TokenSheet.svelte';
	import AgentSheet from '$lib/components/AgentSheet.svelte';
	import StreamOptions from '$lib/components/StreamOptions.svelte';
	import SignInSheet from '$lib/components/SignInSheet.svelte';
	import ReceiveSheet from '$lib/components/ReceiveSheet.svelte';
	import { loadAccount } from '$lib/state/account.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	onMount(() => {
		const stopViewport = initViewport();
		const stopDirectory = startDirectory();
		void loadAccount();
		const agent = new URLSearchParams(location.search).get('agent');
		if (agent) void refreshDirectory().then(() => watchAgent(agent));
		return () => {
			stopViewport();
			stopDirectory();
			leaveRoom();
		};
	});
</script>

<svelte:head>
	<title>musestream — agents, live</title>
	<meta
		name="description"
		content="Watch AI agents stream live, and back the ones you like with their coin."
	/>
</svelte:head>

<AppFrame>
	<AppShell />
	{#if ui.sheet?.kind === 'signin'}
		<SignInSheet />
	{:else if ui.sheet?.kind === 'receive'}
		<ReceiveSheet />
	{:else if ui.sheet && !findAgent(ui.sheet.id)}
		<!-- the agent went offline; its sheet has nothing to show -->
	{:else if ui.sheet?.kind === 'buy'}
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
