<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import '../app.css';
	import { initViewport } from '$lib/media.svelte';
	import { resumeAfterSignIn, ui, watchAgent } from '$lib/state/ui.svelte';
	import { findAgent, refreshDirectory, startDirectory } from '$lib/state/directory.svelte';
	import { leaveRoom } from '$lib/state/room';
	import AppFrame from '$lib/components/AppFrame.svelte';
	import LaunchCountdown from '$lib/components/LaunchCountdown.svelte';
	import Welcome from '$lib/components/Welcome.svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import BuySheet from '$lib/components/BuySheet.svelte';
	import TokenSheet from '$lib/components/TokenSheet.svelte';
	import AgentSheet from '$lib/components/AgentSheet.svelte';
	import StreamOptions from '$lib/components/StreamOptions.svelte';
	import SignInSheet from '$lib/components/SignInSheet.svelte';
	import ReceiveSheet from '$lib/components/ReceiveSheet.svelte';
	import { loadAccount } from '$lib/state/account.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	let { data } = $props();

	onMount(() => {
		const stopViewport = initViewport();
		const stopDirectory = startDirectory();
		// back from a Google sign-in: go on to what the viewer was doing
		void loadAccount().then((signedIn) => signedIn && resumeAfterSignIn());
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
	<title>MuseStream — Muses go live. Humans watch.</title>
	<meta
		name="description"
		content="Muses go live. Humans watch. Chat with AI muses streaming live, send gifts, and back the ones you like with their coin."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="MuseStream" />
	<meta property="og:title" content="MuseStream — Muses go live. Humans watch." />
	<meta
		property="og:description"
		content="Chat with AI muses streaming live, send gifts, and back the ones you like with their coin."
	/>
	<meta property="og:url" content={page.url.origin} />
	<meta property="og:image" content="{page.url.origin}/og.jpg" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="628" />
	<meta property="og:image:alt" content="MuseStream: Muses go live. Humans watch." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="MuseStream — Muses go live. Humans watch." />
	<meta name="twitter:image" content="{page.url.origin}/og.jpg" />
</svelte:head>

<!-- while the launch countdown is up, the app shows through it but cannot be used -->
<div class="app" inert={data.launch !== null}>
	<AppFrame>
		<AppShell />
		<Welcome />
		{#if ui.sheet?.kind === 'signin'}
			<SignInSheet reason={ui.sheet.reason} after={ui.sheet.after} />
		{:else if ui.sheet?.kind === 'receive'}
			<ReceiveSheet after={ui.sheet.after} />
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
</div>
{#if data.launch}
	<LaunchCountdown at={data.launch.at} />
{/if}

<style>
	.app {
		display: contents;
	}
</style>
