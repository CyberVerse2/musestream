<script lang="ts">
	// Candlestick chart for a coin, drawn on canvas. Prices arrive in ETH and show in dollars.
	import type { Candle } from '$shared/candles';
	import { UP, DOWN } from '$lib/sparkline';

	let { candles, ethUsd }: { candles: Candle[]; ethUsd: number | null } = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	const height = 160;

	$effect(() => {
		const node = canvas;
		if (!node || !width || !candles.length) return;
		const rate = ethUsd ?? 1;
		const dpr = window.devicePixelRatio || 1;
		node.width = Math.round(width * dpr);
		node.height = Math.round(height * dpr);
		const g = node.getContext('2d');
		if (!g) return;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, width, height);

		let lo = Infinity;
		let hi = -Infinity;
		for (const c of candles) {
			lo = Math.min(lo, c.low * rate);
			hi = Math.max(hi, c.high * rate);
		}
		if (hi - lo < hi * 1e-6) {
			// a flat stretch: give it some room instead of dividing by zero
			hi = hi * 1.01 || 1;
			lo = lo * 0.99;
		}
		const pad = 8;
		const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
		const step = width / candles.length;
		const body = Math.max(1, Math.min(10, step * 0.62));

		candles.forEach((c, i) => {
			const x = i * step + step / 2;
			const up = c.close >= c.open;
			g.strokeStyle = g.fillStyle = up ? UP : DOWN;
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(x, y(c.high * rate));
			g.lineTo(x, y(c.low * rate));
			g.stroke();
			const top = y(Math.max(c.open, c.close) * rate);
			const bottom = y(Math.min(c.open, c.close) * rate);
			g.fillRect(x - body / 2, top, body, Math.max(1, bottom - top));
		});
	});
</script>

<div class="chart" bind:clientWidth={width}>
	{#if candles.length}
		<canvas bind:this={canvas} style:height="{height}px" aria-label="Price chart"></canvas>
	{:else}
		<p style:height="{height}px">No trades in this range yet.</p>
	{/if}
</div>

<style>
	.chart {
		width: 100%;
	}
	canvas {
		display: block;
		width: 100%;
	}
	p {
		display: grid;
		place-items: center;
		font-size: 13px;
		color: var(--mut);
	}
</style>
