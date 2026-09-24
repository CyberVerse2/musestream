<script lang="ts">
	// Sign in with Google or email; either way the viewer gets a wallet only they control.
	import Sheet from './Sheet.svelte';
	import { api } from '$lib/api';
	import { account } from '$lib/state/account.svelte';
	import { closeSheet } from '$lib/state/ui.svelte';
	import { refreshWallet } from '$lib/state/portfolio.svelte';
	import { showToast } from '$lib/state/notifications.svelte';

	let step = $state<'email' | 'code'>('email');
	let email = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let verification: unknown = null;

	async function run(fn: () => Promise<void>) {
		busy = true;
		error = null;
		try {
			await fn();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong. Try again.';
		} finally {
			busy = false;
		}
	}

	const sendCode = () =>
		run(async () => {
			const cfg = account.config!;
			const dynamic = await import('$lib/wallet/dynamic');
			await dynamic.initDynamic(cfg.dynamicEnvironmentId!, cfg.chainId, cfg.rpcUrl);
			verification = await dynamic.sendCode(email.trim());
			step = 'code';
		});

	const google = () =>
		run(async () => {
			const cfg = account.config!;
			const dynamic = await import('$lib/wallet/dynamic');
			await dynamic.initDynamic(cfg.dynamicEnvironmentId!, cfg.chainId, cfg.rpcUrl);
			// leaves the page; the sign-in finishes when Google sends the viewer back
			await dynamic.signInWithGoogle();
		});

	const verify = () =>
		run(async () => {
			const dynamic = await import('$lib/wallet/dynamic');
			const token = await dynamic.verifyCode(verification as never, code.trim());
			const { address } = await api.signIn(token);
			account.signedInAs = address;
			await refreshWallet();
			showToast('✓', 'Signed in. Your wallet is ready.');
			closeSheet();
		});
</script>

<Sheet label="Sign in" onclose={closeSheet}>
	<h2>Sign in</h2>
	{#if step === 'email'}
		<p class="lede">Signing in creates a wallet that only you control.</p>
		<button class="btn-quiet google" disabled={busy} onclick={google}>
			<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
				<path
					fill="#EA4335"
					d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
				/>
				<path
					fill="#4285F4"
					d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
				/>
				<path
					fill="#FBBC05"
					d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
				/>
				<path
					fill="#34A853"
					d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
				/>
			</svg>
			Continue with Google
		</button>
		<p class="or">or get a code by email</p>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void sendCode();
			}}
		>
			<input
				type="email"
				autocomplete="email"
				placeholder="you@example.com"
				bind:value={email}
				required
				aria-label="Email"
			/>
			<button class="btn-lime" disabled={busy || !email.includes('@')}
				>{busy ? 'Sending…' : 'Send code'}</button
			>
		</form>
	{:else}
		<p class="lede">Enter the code we sent to {email}.</p>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void verify();
			}}
		>
			<input
				inputmode="numeric"
				autocomplete="one-time-code"
				placeholder="123456"
				bind:value={code}
				required
				aria-label="Code"
			/>
			<button class="btn-lime" disabled={busy || code.trim().length < 4}
				>{busy ? 'Checking…' : 'Sign in'}</button
			>
			<button type="button" class="link" onclick={() => (step = 'email')}>Use another email</button>
		</form>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</Sheet>

<style>
	h2 {
		font-size: 20px;
		letter-spacing: -0.02em;
	}
	.lede {
		margin-top: 6px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--mut);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 10px;
	}
	input {
		height: 48px;
		padding: 0 14px;
		border-radius: var(--r-md);
		border: 1px solid var(--line-2);
		background: var(--surface-2);
		/* 16px keeps iOS Safari from zooming the page on focus */
		font-size: 16px;
	}
	.google {
		width: 100%;
		margin-top: 16px;
	}
	.or {
		margin-top: 16px;
		font-size: 13px;
		color: var(--mut);
		text-align: center;
	}
	.link {
		font-size: 14px;
		color: var(--mut);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.error {
		margin-top: 12px;
		font-size: 13px;
		color: var(--down);
	}
</style>
