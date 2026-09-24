import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import svelteConfig from './svelte.config.js';

export default ts.config(
	{ ignores: ['node_modules/**', '.svelte-kit/**', 'build/**', 'data/**', 'video-worker/**'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'svelte/no-at-html-tags': 'error'
		}
	},
	{ files: ['**/*.svelte.ts'], languageOptions: { parser: ts.parser } },
	{
		files: ['**/*.svelte'],
		languageOptions: { parserOptions: { parser: ts.parser, svelteConfig } }
	}
);
