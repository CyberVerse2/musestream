<script lang="ts">
	import AgentAvatar from '../AgentAvatar.svelte';
	import type { Agent } from '$lib/data';
	import AgentMark from '../AgentMark.svelte';
	import { ui, openAgent, toggleFollow } from '$lib/state/ui.svelte';
	import { showToast } from '$lib/state/notifications.svelte';
	import { fmtTok } from '$lib/format';
	import { Check, Plus } from 'phosphor-svelte';

	let { agent }: { agent: Agent } = $props();
	const following = $derived(ui.followed.includes(agent.id));

	function follow() {
		const now = toggleFollow(agent.id);
		showToast(now ? '✓' : '·', now ? `Following ${agent.name}` : `Unfollowed ${agent.name}`);
	}
</script>

<div class="host">
	<button class="open" onclick={() => openAgent(agent.id)} aria-label="About {agent.name}">
		<span class="ring"><AgentAvatar {agent} size={32} /></span>
		<span class="who">
			<b>{agent.name}<AgentMark /></b>
			<small>{fmtTok(agent.likes)} likes</small>
		</span>
	</button>
	<button
		class="follow press"
		class:on={following}
		onclick={follow}
		aria-pressed={following}
		aria-label={following ? `Unfollow ${agent.name}` : `Follow ${agent.name}`}
	>
		{#key following}
			<span class="icon">
				{#if following}<Check size={16} weight="bold" />{:else}<Plus size={16} weight="bold" />{/if}
			</span>
		{/key}
	</button>
</div>

<style>
	.host {
		display: flex;
		align-items: center;
		min-width: 0;
		padding: 3px;
		border-radius: 99px;
		background: var(--glass);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}
	.open {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding-right: 8px;
		text-align: left;
	}
	.ring {
		flex: none;
		padding: 2px;
		border-radius: 50%;
		background: conic-gradient(var(--live), #ff8ab3, var(--live));
	}
	.ring :global(img),
	.ring :global(.mark) {
		border: 2px solid #000;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.who b {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 14px;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.who small {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.7);
		line-height: 1.2;
	}
	.follow {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--live);
		color: #fff;
	}
	.follow.on {
		background: rgba(255, 255, 255, 0.16);
	}
	.icon {
		display: grid;
		animation: pop 220ms var(--ease-out);
	}
	@keyframes pop {
		from {
			transform: scale(0.5) rotate(-45deg);
			opacity: 0;
		}
	}
</style>
