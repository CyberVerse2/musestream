<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'phosphor-svelte';
	import { viewport } from '$lib/media.svelte';
	import { dialog, dim, reducedMotion, slideUp } from '$lib/motion';

	let {
		label,
		onclose,
		tall = false,
		children
	}: { label: string; onclose: () => void; tall?: boolean; children: Snippet } = $props();

	/* swipe down on the handle to close */
	let sheet = $state<HTMLElement | null>(null);
	let dragY = $state(0);
	let dragging = $state(false);
	let startY = 0;
	let lastY = 0;
	let lastT = 0;
	let velocity = 0;

	function down(e: PointerEvent) {
		if (viewport.desktop) return;
		dragging = true;
		startY = lastY = e.clientY;
		lastT = performance.now();
		velocity = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		const dy = e.clientY - startY;
		// full travel downward, heavy resistance upward
		dragY = dy > 0 ? dy : dy * 0.15;
		const now = performance.now();
		velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
		lastY = e.clientY;
		lastT = now;
	}
	function up() {
		if (!dragging) return;
		dragging = false;
		const height = sheet?.offsetHeight ?? 1;
		if (dragY > height * 0.3 || velocity > 0.5) onclose();
		else dragY = 0;
	}

	function sheetMotion(node: Element) {
		if (viewport.desktop) return dialog(node);
		return slideUp(node, { from: dragY });
	}
	const dimOpacity = $derived(sheet && dragY > 0 ? 1 - dragY / sheet.offsetHeight : 1);
	const snapBack = $derived(!dragging && !reducedMotion());
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') onclose();
	}}
/>

<div
	class="dim"
	style:opacity={dimOpacity}
	onclick={onclose}
	aria-hidden="true"
	in:dim|global
	out:dim|global={{ duration: 220 }}
></div>
<div
	class="sheet"
	class:tall
	class:snap={snapBack}
	style:transform={dragY && !viewport.desktop ? `translateY(${dragY}px)` : undefined}
	role="dialog"
	aria-modal="true"
	aria-label={label}
	bind:this={sheet}
	in:sheetMotion|global
	out:sheetMotion|global
>
	<div
		class="handle"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		aria-hidden="true"
	>
		<span class="grab"></span>
	</div>
	<button class="close press" onclick={onclose} aria-label="Close"
		><X size={18} weight="bold" /></button
	>
	<div class="body">
		{@render children()}
	</div>
</div>

<style>
	.dim {
		position: absolute;
		inset: 0;
		z-index: 48;
		background: rgba(0, 0, 0, 0.55);
	}
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		max-height: min(88%, 88dvh);
		background: var(--surface);
		border-top: 1px solid var(--line);
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		will-change: transform;
	}
	.sheet.snap {
		transition: transform 300ms var(--ease-out);
	}
	.handle {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 32px;
		z-index: 1;
		display: flex;
		justify-content: center;
		padding-top: 8px;
		touch-action: none;
		cursor: grab;
	}
	.sheet.tall {
		height: min(88%, 88dvh);
	}
	.grab {
		width: 36px;
		height: 4px;
		border-radius: 99px;
		background: var(--line-2);
	}
	.close {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--mut);
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: none;
		padding: 32px 18px calc(24px + var(--safe-bottom));
	}
	.body::-webkit-scrollbar {
		display: none;
	}
	@media (min-width: 1024px) {
		.sheet {
			left: 50%;
			top: 50%;
			bottom: auto;
			width: 440px;
			max-height: 84%;
			border: 1px solid var(--line);
			border-radius: var(--r-lg);
			transform: translate(-50%, -50%);
			box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
		}
		.sheet.tall {
			height: min(84%, 720px);
		}
		.handle {
			display: none;
		}
		.body {
			padding-top: 24px;
		}
	}
</style>
