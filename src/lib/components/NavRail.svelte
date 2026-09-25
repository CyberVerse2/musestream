<script lang="ts">
	import { ui, watchAgent, type Tab } from '$lib/state/ui.svelte';
	import { currentAgent } from '$lib/state/feed.svelte';
	import { account } from '$lib/state/account.svelte';
	import { directory } from '$lib/state/directory.svelte';
	import AgentAvatar from './AgentAvatar.svelte';
	import { fmtTok } from '$lib/format';
	import { Broadcast, Compass, VideoCamera, Wallet } from 'phosphor-svelte';
	const tabs = [
		{ id: 'live', label: 'Live', Icon: Broadcast },
		{ id: 'explore', label: 'Explore', Icon: Compass },
		{ id: 'wallet', label: 'Wallet', Icon: Wallet },
		{ id: 'golive', label: 'Go live', Icon: VideoCamera }
	] as const satisfies readonly { id: Tab; label: string; Icon: unknown }[];
</script>

<aside class="nav-rail">
	<button class="rail-logo" onclick={() => (ui.tab = 'live')} aria-label="musestream home"
		><img src="/logo.png" alt="" width="36" height="36" />musestream</button
	>
	<nav class="rail-nav" aria-label="Main">
		{#each tabs as tab (tab.id)}
			<button
				class="nav-item"
				class:active={ui.tab === tab.id}
				onclick={() => (ui.tab = tab.id)}
				aria-current={ui.tab === tab.id ? 'page' : undefined}
			>
				<tab.Icon size={22} weight={ui.tab === tab.id ? 'fill' : 'regular'} /><span
					>{tab.label}</span
				>
			</button>
		{/each}
	</nav>
	<div class="directory">
		<h2>Live agents</h2>
		{#each directory.agents as agent (agent.id)}
			<button
				class="agent-link"
				class:selected={ui.tab === 'live' && currentAgent()?.id === agent.id}
				onclick={() => watchAgent(agent.id)}
				aria-label="Watch {agent.name}"
			>
				<span class="pic"><AgentAvatar {agent} size={30} /></span>
				<span class="copy"><b>{agent.name}</b><small>{agent.cat}</small></span>
				<span class="viewers">{fmtTok(agent.viewers)}</span>
			</button>
		{/each}
	</div>
	{#if account.config?.testMoney}<footer>Coins trade with test ETH on a local chain.</footer>{/if}
</aside>

<style>
	.nav-rail {
		width: 248px;
		flex: none;
		height: 100%;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		scrollbar-width: none;
		background: var(--bg);
	}
	.rail-logo {
		display: flex;
		align-items: center;
		gap: 8px;
		align-self: flex-start;
		font-size: 26px;
		line-height: 1;
		font-weight: 700;
		letter-spacing: -0.05em;
		margin: 0 8px 24px;
	}
	.rail-logo img {
		flex: none;
		width: 36px;
		height: 36px;
	}
	.rail-nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		font-size: 16px;
		font-weight: 600;
		color: var(--mut);
		text-align: left;
		transition:
			background-color 150ms ease,
			color 150ms ease;
	}
	.nav-item:hover {
		background: var(--surface);
		color: var(--ink);
	}
	.nav-item.active {
		color: var(--ink);
	}
	.directory {
		margin-top: 24px;
		padding-top: 20px;
		border-top: 1px solid var(--line);
	}
	h2 {
		font-size: 13px;
		font-weight: 600;
		color: var(--mut);
		padding: 0 12px;
		margin-bottom: 8px;
	}
	.agent-link {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 48px;
		padding: 6px 12px;
		border-radius: var(--r-sm);
		text-align: left;
	}
	.agent-link:hover {
		background: var(--surface);
	}
	.agent-link.selected {
		background: var(--surface);
	}
	.pic {
		flex: none;
		padding: 2px;
		border-radius: 50%;
		background: var(--live);
	}
	.pic :global(img),
	.pic :global(.mark) {
		border: 2px solid var(--bg);
	}
	.copy {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.copy b {
		font-size: 14px;
		font-weight: 600;
	}
	.copy small,
	.viewers {
		font-size: 12px;
		color: var(--mut);
	}
	footer {
		margin-top: auto;
		padding: 20px 12px 0;
		font-size: 12px;
		color: var(--mut-2);
	}
</style>
