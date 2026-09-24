import { sveltekit } from '@sveltejs/kit/vite';
import { sveltePhosphorOptimize } from 'phosphor-svelte/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit(), sveltePhosphorOptimize()],
	// rendered video lands in data/ several times a second while a stream is live
	server: { watch: { ignored: ['**/data/**', '**/video-worker/**'] } },
	// bundle these at startup; found later (the wallet SDK loads on sign-in), they would
	// make Vite re-bundle mid-session and load a second copy of the Svelte runtime
	optimizeDeps: {
		include: [
			'viem',
			'hls.js',
			'@dynamic-labs-sdk/client',
			'@dynamic-labs-sdk/client/waas',
			'@dynamic-labs-sdk/evm',
			'@dynamic-labs-sdk/evm/viem'
		]
	}
});
