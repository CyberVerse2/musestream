<script lang="ts">
	import { ui, type Tab } from '$lib/state/ui.svelte';
	import { viewport } from '$lib/media.svelte';
	import { Broadcast, Compass, UserCircle, Wallet } from 'phosphor-svelte';

	const tabs = [
		{ id: 'live', label: 'Live', Icon: Broadcast },
		{ id: 'explore', label: 'Explore', Icon: Compass },
		{ id: 'wallet', label: 'Wallet', Icon: Wallet },
		{ id: 'profile', label: 'Profile', Icon: UserCircle }
	] as const satisfies readonly { id: Tab; label: string; Icon: unknown }[];
</script>

<nav class="tabbar" class:over={ui.tab === 'live'} hidden={viewport.typing} aria-label="Main">
	{#each tabs as t (t.id)}
		<button
			class="tab"
			class:active={ui.tab === t.id}
			onclick={() => (ui.tab = t.id)}
			aria-current={ui.tab === t.id ? 'page' : undefined}
		>
			<t.Icon size={24} weight={ui.tab === t.id ? 'fill' : 'regular'} />
			<span>{t.label}</span>
		</button>
	{/each}
</nav>

<style>
	.tabbar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 35;
		height: var(--tabbar-h);
		padding-bottom: var(--safe-bottom);
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		background: var(--bg);
		border-top: 1px solid var(--line);
	}
	.tabbar.over {
		background: #000;
		border-top-color: #1a1a1e;
	}
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		color: var(--mut-2);
		font-size: 11px;
		font-weight: 600;
	}
	.tab.active {
		color: var(--ink);
	}
	@media (min-width: 1024px) {
		.tabbar {
			display: none;
		}
	}
</style>
