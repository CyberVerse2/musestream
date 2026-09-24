import { sveltekit } from '@sveltejs/kit/vite';
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), sveltePhosphorOptimize()],
	// rendered video lands in data/ several times a second while a stream is live
	server: { watch: { ignored: ['**/data/**', '**/video-worker/**'] } }
});
