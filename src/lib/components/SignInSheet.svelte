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
			await dynamic.initDynamic(cfg.dynamicEnvironmentId!, cfg.chainId);
			verification = await dynamic.sendCode(email.trim());
			step = 'code';
		});

	const google = () =>
		run(async () => {
			const cfg = account.config!;
			const dynamic = await import('$lib/wallet/dynamic');
			await dynamic.initDynamic(cfg.dynamicEnvironmentId!, cfg.chainId);
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
		<button class="btn-quiet google" disabled={busy} onclick={google}>Continue with Google</button>
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
