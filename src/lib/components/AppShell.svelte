<script lang="ts">
	import { viewport } from '$lib/media.svelte';
	import TabBar from './TabBar.svelte';
	import NavRail from './NavRail.svelte';
	import LiveFeed from './LiveFeed.svelte';
	import Explore from './Explore.svelte';
	import Wallet from './Wallet.svelte';
	import Profile from './Profile.svelte';
</script>

<main class="app-body">
	{#if viewport.desktop}
		<NavRail />
	{/if}
	<div class="views">
		<LiveFeed />
		<Explore />
		<Wallet />
		<Profile />
	</div>
</main>
<TabBar />
