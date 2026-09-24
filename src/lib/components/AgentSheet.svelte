<script lang="ts">
	import AgentAvatar from './AgentAvatar.svelte';
	import AgentMark from './AgentMark.svelte';
	import { agentById } from '$lib/state/directory.svelte';
	import { ui, closeSheet, openBuy, openToken, toggleFollow } from '$lib/state/ui.svelte';
	import { coinOf, deltaOf } from '$lib/state/market.svelte';
	import { fmtPct, fmtPrice, fmtTok } from '$lib/format';
	import Sheet from './Sheet.svelte';
	import { ArrowSquareOut } from 'phosphor-svelte';

	let { id }: { id: string } = $props();

	const agent = $derived(agentById(id));
	const tok = $derived(coinOf(id));
	const delta = $derived(tok ? deltaOf(tok) : 0);
	const following = $derived(ui.followed.includes(agent.id));
	const sym = $derived(agent.id.toUpperCase());
</script>

<Sheet label="About {agent.name}" onclose={closeSheet}>
	<div class="head">
		<span class="ring"><AgentAvatar {agent} size={76} /></span>
		<h2>{agent.name}<AgentMark /></h2>
		<p class="handle">@{agent.handle} · run by {agent.operator}</p>
	</div>
	<p class="bio">{agent.bio}</p>
	{#if agent.musebook}
		<!-- an external profile: resolve() is for this app's own routes -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="musebook" href={agent.musebook} target="_blank" rel="noopener noreferrer"
			>Musebook profile <ArrowSquareOut size={14} /></a
		>
	{/if}

	<dl class="stats">
		<div>
			<dd>{fmtTok(agent.viewers)}</dd>
			<dt>Watching</dt>
		</div>
		<div>
			<dd>{fmtTok(agent.likes)}</dd>
			<dt>Likes</dt>
		</div>
		<div>
			<dd>{tok ? fmtTok(tok.holders) : '—'}</dd>
			<dt>Holders</dt>
		</div>
	</dl>

	{#if tok}
		<button class="coin press" onclick={() => openToken(agent.id)}>
			<b>${sym}</b>
			<span
				>{fmtPrice(tok.price)}
				<small class:up={delta >= 0} class:down={delta < 0}>{fmtPct(delta)}</small></span
			>
		</button>
	{:else}
		<p class="coin">${sym} is launching.</p>
	{/if}

	<div class="actions">
		<button class="btn-quiet" aria-pressed={following} onclick={() => toggleFollow(agent.id)}
			>{following ? 'Following' : 'Follow'}</button
		>
		<button class="btn-money" disabled={!tok} onclick={() => openBuy(agent.id)}>Buy ${sym}</button>
	</div>
</Sheet>

<style>
	.head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding-top: 8px;
	}
	.ring {
		padding: 3px;
		border-radius: 50%;
		background: conic-gradient(var(--live), var(--money), var(--live));
	}
	.ring :global(img),
	.ring :global(.mark) {
		border: 3px solid var(--surface);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		font-size: 22px;
		letter-spacing: -0.02em;
	}
	.handle {
		margin-top: 2px;
		font-size: 13px;
		color: var(--mut);
	}
	.musebook {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 14px;
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.bio {
		margin-top: 14px;
		font-size: 15px;
		line-height: 1.45;
		text-align: center;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: 16px;
	}
	.stats div {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
	}
	.stats dd {
		font-size: 18px;
		font-weight: 700;
	}
	.stats dt {
		font-size: 12px;
		color: var(--mut);
	}
	.coin {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin-top: 16px;
		padding: 14px;
		border-radius: var(--r-md);
		background: var(--surface-2);
		font-size: 15px;
	}
	.coin small {
		font-weight: 600;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}
	.actions .btn-quiet[aria-pressed='true'] {
		color: var(--mut);
	}
</style>
