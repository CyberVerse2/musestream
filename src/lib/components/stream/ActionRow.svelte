<script lang="ts">
	import type { Agent } from '$lib/data';
	import { ui, openOptions } from '$lib/state/ui.svelte';
	import { like, sendChat } from '$lib/state/room';
	import { ArrowUp, DotsThree, Gift, Heart } from 'phosphor-svelte';

	let { agent, typing }: { agent: Agent; typing: boolean } = $props();

	/* chat box: a real input at all times, so iOS opens the keyboard on the first tap */
	let text = $state('');
	let input = $state<HTMLInputElement | null>(null);
	function send() {
		const t = text.trim();
		if (!t) return;
		void sendChat(agent.streamId, t);
		text = '';
	}

	/* hearts float up from the like button */
	const HEART_COLORS = ['#ff3b5c', '#b9a6ff', '#d4ff3f', '#ff8ab3'];
	let hearts = $state<{ id: number; x: number; c: string }[]>([]);
	let seq = 0;
	function tapLike() {
		like(agent.id);
		const id = ++seq;
		hearts.push({
			id,
			x: Math.round(Math.random() * 24 - 12),
			c: HEART_COLORS[id % HEART_COLORS.length]!
		});
		setTimeout(() => (hearts = hearts.filter((h) => h.id !== id)), 1500);
	}
</script>

<div class="actions" class:typing>
	<form
		class="compose"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<input
			bind:this={input}
			bind:value={text}
			placeholder="Say something…"
			maxlength="120"
			enterkeyhint="send"
			autocomplete="off"
			aria-label="Chat with {agent.name}"
			onfocus={() => (ui.composing = true)}
			onblur={() => (ui.composing = false)}
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === 'Escape') input?.blur();
			}}
		/>
		{#if typing}
			<!-- pointerdown keeps focus in the input, so the keyboard stays up after sending -->
			<button
				class="send press"
				aria-label="Send"
				disabled={!text.trim()}
				onpointerdown={(e) => e.preventDefault()}><ArrowUp size={18} weight="bold" /></button
			>
		{/if}
	</form>
	{#if !typing}
		<button class="act press" onclick={() => (ui.giftsOpen = true)} aria-label="Send a gift"
			><Gift size={24} /></button
		>
		<button class="act heart press" onclick={tapLike} aria-label="Like"
			><Heart size={24} weight="fill" />
			<span class="hearts" aria-hidden="true">
				{#each hearts as h (h.id)}
					<i style="--x:{h.x}px; color:{h.c}"><Heart size={22} weight="fill" /></i>
				{/each}
			</span>
		</button>
		<button class="act press" onclick={() => openOptions(agent.id)} aria-label="More options"
			><DotsThree size={26} weight="bold" /></button
		>
	{/if}
</div>

<style>
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 44px;
	}
	.compose {
		flex: 1;
		min-width: 0;
		height: 40px;
		display: flex;
		align-items: center;
		padding: 0 4px 0 14px;
		border-radius: 99px;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid transparent;
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		transition:
			background-color 200ms var(--ease-out),
			border-color 200ms var(--ease-out);
	}
	.compose input {
		flex: 1;
		min-width: 0;
		height: 100%;
		background: none;
		border: 0;
		outline: 0;
		/* 16px keeps iOS Safari from zooming the page on focus */
		font-size: 16px;
		color: var(--ink);
	}
	.compose input::placeholder {
		color: rgba(255, 255, 255, 0.7);
	}
	.typing .compose {
		height: 44px;
		background: var(--surface);
		border-color: var(--line-2);
	}
	.typing .compose input::placeholder {
		color: var(--mut-2);
	}
	.send {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--ink);
		color: var(--bg);
		animation: send-in 200ms var(--ease-out);
	}
	.send:disabled {
		opacity: 0.3;
	}
	@keyframes send-in {
		from {
			opacity: 0;
			transform: scale(0.6);
		}
	}
	.act {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		color: #fff;
		filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
	}
	.heart {
		color: var(--live);
	}
	.hearts {
		position: absolute;
		left: 11px;
		bottom: 40px;
		pointer-events: none;
	}
	.hearts i {
		position: absolute;
		left: 0;
		bottom: 0;
		animation: float 1.5s ease-out forwards;
	}
	@keyframes float {
		0% {
			opacity: 0;
			transform: translate(0, 0) scale(0.6);
		}
		15% {
			opacity: 1;
			transform: translate(calc(var(--x) * 0.3), -20px) scale(1.1);
		}
		100% {
			opacity: 0;
			transform: translate(var(--x), -200px) scale(0.9);
		}
	}
</style>
