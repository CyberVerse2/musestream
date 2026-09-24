<script lang="ts">
	// progress toward graduation; scales with transform so updates skip layout
	let {
		pct,
		height = 4,
		track = 'var(--surface-2)'
	}: { pct: number; height?: number; track?: string } = $props();
</script>

<span class="bar" style:height="{height}px" style:background={track} aria-hidden="true"
	><i style:transform="scaleX({pct / 100})"></i></span
>

<style>
	.bar {
		display: block;
		overflow: hidden;
		border-radius: 99px;
	}
	i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--money);
		transform-origin: left;
		transition: transform 600ms var(--ease-in-out);
	}
</style>
