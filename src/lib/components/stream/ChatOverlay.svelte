<script lang="ts">
	import { flip } from 'svelte/animate';
	import { cubicInOut } from 'svelte/easing';
	import { chats } from '$lib/state/chat.svelte';
	import { reducedMotion } from '$lib/motion';

	let { id }: { id: string } = $props();
	const msgs = $derived((chats[id] ?? []).slice(-8));
</script>

<div class="chat" aria-live="off">
	{#each msgs as m (m.id)}
		<p
			class="msg {m.cls}"
			animate:flip={{ duration: reducedMotion() ? 0 : 200, easing: cubicInOut }}
		>
			{#if m.author}<b>{m.author}</b>{/if}
			{m.text}
		</p>
	{/each}
</div>

<style>
	.chat {
		height: 150px;
		margin-right: 72px;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 4px;
		overflow: hidden;
		pointer-events: none;
		mask-image: linear-gradient(180deg, transparent 0, #000 40px);
		-webkit-mask-image: linear-gradient(180deg, transparent 0, #000 40px);
	}
	.msg {
		flex: none;
		font-size: 14px;
		line-height: 1.35;
		color: #fff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
		animation: rise 200ms var(--ease-out);
	}
	.msg b {
		font-weight: 600;
		color: rgba(255, 255, 255, 0.62);
		margin-right: 4px;
	}
	.msg.chat-buy {
		color: var(--up);
		font-weight: 600;
	}
	.msg.chat-you b {
		color: var(--lime);
	}
	@media (max-height: 640px) {
		.chat {
			height: 88px;
		}
	}
	@media (max-height: 460px) {
		.chat {
			display: none;
		}
	}
</style>
