<script lang="ts">
	import { toasts } from '$lib/state/notifications.svelte';
	import { drop } from '$lib/motion';
</script>

<div class="toasts" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" in:drop out:drop={{ duration: 160 }}>
			<span aria-hidden="true">{t.icon}</span>{t.text}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: absolute;
		top: calc(var(--safe-top) + 60px);
		left: 16px;
		right: 16px;
		z-index: 100;
		display: grid;
		justify-items: center;
		pointer-events: none;
	}
	/* a new toast replaces the old one in place */
	.toast {
		grid-area: 1 / 1;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		padding: 10px 16px;
		border-radius: 99px;
		background: var(--ink);
		color: var(--bg);
		font-size: 14px;
		font-weight: 600;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
	}
	@media (min-width: 1024px) {
		.toasts {
			top: auto;
			bottom: 24px;
		}
	}
</style>
