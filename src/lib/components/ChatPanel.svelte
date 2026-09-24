<script lang="ts">
	import { tick } from 'svelte';
	import { sendChat } from '$lib/simulation/chat';
	import type { Agent } from '$lib/data';
	import { chats } from '$lib/state/chat.svelte';
	import { tokenOf } from '$lib/state/market.svelte';
	import { fmtTok } from '$lib/format';
	import { tradeWallet } from '$lib/identicon';
	import WalletMark from './WalletMark.svelte';
	import { ArrowUp, Eye } from 'phosphor-svelte';

	let { agent }: { agent: Agent } = $props();
	let text = $state('');
	let listEl = $state<HTMLElement | null>(null);
	let pinned = $state(true);
	const msgs = $derived(chats[agent.id] ?? []);
	$effect(() => {
		void msgs.at(-1)?.id;
		if (pinned)
			tick().then(() => {
				if (listEl) listEl.scrollTop = listEl.scrollHeight;
			});
	});
	function send() {
		if (!text.trim()) return;
		sendChat(agent.id, text.trim());
		text = '';
		pinned = true;
	}
</script>

<aside class="chat-panel" aria-label="Live chat">
	<header>
		<h2>Live chat</h2>
		<span><Eye size={14} weight="bold" />{fmtTok(tokenOf(agent.id).viewers)}</span>
	</header>
	<div
		class="chat-list"
		bind:this={listEl}
		onscroll={() => {
			if (listEl) pinned = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
		}}
	>
		{#each msgs as m (m.id)}
			{#if m.cls === 'chat-buy'}
				<div class="message trade">
					<WalletMark seed={tradeWallet(m.text)} size={22} />
					<p>{m.text}</p>
				</div>
			{:else}
				<div class="message" class:you={m.cls === 'chat-you'}>
					{#if m.author === agent.handle}
						<img src={agent.img} alt="" />
					{:else}
						<WalletMark seed={m.author ?? ''} size={22} />
					{/if}
					<p><b>{m.author}</b> {m.text}</p>
				</div>
			{/if}
		{/each}
	</div>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<input
			aria-label="Chat message"
			placeholder="Say something…"
			maxlength="120"
			bind:value={text}
			autocomplete="off"
		/>
		<button aria-label="Send" disabled={!text.trim()}><ArrowUp size={18} weight="bold" /></button>
	</form>
</aside>

<style>
	.chat-panel {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		border-radius: var(--r-lg);
		background: var(--surface);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--line);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
	}
	header span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--mut);
	}
	.chat-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		scrollbar-width: thin;
		scrollbar-color: var(--line-2) transparent;
	}
	.message {
		flex: none;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.message img {
		flex: none;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		object-fit: cover;
	}
	.message p {
		color: var(--ink);
	}
	.message b {
		font-weight: 600;
		color: var(--mut);
		margin-right: 2px;
	}
	.message.you b {
		color: var(--lime);
	}
	.message.trade {
		align-items: center;
		font-size: 12px;
	}
	.message.trade p {
		color: var(--up);
	}
	form {
		display: flex;
		gap: 8px;
		padding: 12px 16px 16px;
	}
	input {
		flex: 1;
		min-width: 0;
		height: 44px;
		padding: 0 14px;
		border-radius: 99px;
		border: 1px solid var(--line);
		background: var(--surface-2);
		font-size: 14px;
	}
	input:focus-visible {
		outline: 1px solid var(--line-2);
	}
	input::placeholder {
		color: var(--mut-2);
	}
	form button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--ink);
		color: var(--bg);
	}
	form button:disabled {
		opacity: 0.3;
		cursor: default;
	}
</style>
