// A viewer's own wallet through Dynamic: email or Google sign-in, an embedded wallet, and signing.
// Loaded only when the server has a Dynamic environment; nothing here runs otherwise.
//
// Robinhood Chain (4663) must be enabled in the Dynamic dashboard for `switchActiveNetwork`.
import type { TxRequest } from '$shared/tx';

type Sdk = {
	client: typeof import('@dynamic-labs-sdk/client');
	viem: typeof import('@dynamic-labs-sdk/evm/viem');
	instance: import('@dynamic-labs-sdk/client').DynamicClient;
};

let sdk: Promise<Sdk> | null = null;
let chainId = 4663;
let rpcUrl = '';

/**
 * Start the SDK once per page. `rpc` is where the viewer's transactions go: the chain the
 * server reads, which in development is a local fork, not the public network Dynamic knows.
 */
export function initDynamic(environmentId: string, chain: number, rpc: string): Promise<Sdk> {
	chainId = chain;
	rpcUrl = rpc;
	sdk ??= (async () => {
		const [client, evm, viem] = await Promise.all([
			import('@dynamic-labs-sdk/client'),
			import('@dynamic-labs-sdk/evm'),
			import('@dynamic-labs-sdk/evm/viem')
		]);
		const instance = client.createDynamicClient({
			autoInitialize: false,
			environmentId,
			metadata: { name: 'musestream' }
		});
		evm.addEvmExtension();
		await client.initializeClient();
		return { client, viem, instance };
	})();
	return sdk;
}

const evmAccount = (client: Sdk['client']) =>
	client.getWalletAccounts().find((a) => a.chain === 'EVM');

/**
 * The signed-in wallet's address once Dynamic has restored its session in this browser, or null
 * when that session has ended. Dynamic restores it a moment after the page loads.
 */
export async function walletAddress(): Promise<string | null> {
	if (!sdk) return null;
	const { client } = await sdk;
	for (let i = 0; i < 10 && !evmAccount(client); i++) {
		await new Promise((r) => setTimeout(r, 300));
	}
	return evmAccount(client)?.address ?? null;
}

type OtpVerification = Awaited<ReturnType<typeof import('@dynamic-labs-sdk/client').sendEmailOTP>>;

/** step 1: email a one-time code */
export async function sendCode(email: string): Promise<OtpVerification> {
	const { client } = await sdk!;
	return client.sendEmailOTP({ email });
}

/** step 2: check the code; returns the session token */
export async function verifyCode(otpVerification: OtpVerification, code: string): Promise<string> {
	const { client } = await sdk!;
	await client.verifyOTP({ otpVerification, verificationToken: code });
	return afterSignIn();
}

/** leave for Google; the browser comes back to this page and `finishRedirect` completes it */
export async function signInWithGoogle(): Promise<void> {
	const { client } = await sdk!;
	await client.signInWithSocialRedirect({
		provider: 'google',
		redirectUrl: `${window.location.origin}${window.location.pathname}`
	});
}

/** on page load: if we came back from Google, finish signing in and return the token */
export async function finishRedirect(): Promise<string | null> {
	const { client } = await sdk!;
	const url = new URL(window.location.href);
	if (!(await client.detectSocialRedirectUrl({ url }))) return null;
	await client.completeSocialRedirect({ url });
	// drop the OAuth parameters so a reload does not try to finish it twice
	client.clearSocialRedirectParams();
	return afterSignIn();
}

/**
 * every sign-in ends here: wait for the embedded wallet, return the session token.
 * Dynamic creates the wallet itself during sign-up; creating it again here needs step-up auth.
 */
async function afterSignIn(): Promise<string> {
	const { client, instance } = await sdk!;
	for (let i = 0; i < 30 && !evmAccount(client); i++) {
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!evmAccount(client))
		throw new Error('Signed in, but your wallet is not ready yet. Try again in a moment.');
	if (!instance.token) throw new Error('Signed in, but no session token came back.');
	return instance.token;
}

export async function signOut() {
	if (!sdk) return;
	const { client } = await sdk;
	await client.logout();
}

/**
 * Sign a transaction with the viewer's wallet, send it to the app's RPC, and wait until it
 * lands; resolves with its hash. Dynamic signs; the broadcast does not go through Dynamic's
 * network settings.
 */
export async function sendFromWallet(tx: TxRequest): Promise<`0x${string}`> {
	const { client, viem } = await sdk!;
	const walletAccount = evmAccount(client);
	if (!walletAccount) throw new Error('Your sign-in expired. Sign in again.');
	await client.switchActiveNetwork({ walletAccount, networkId: String(chainId) });
	const dynamicWallet = await viem.createWalletClientForWalletAccount({ walletAccount });
	const { createWalletClient, http } = await import('viem');
	const wallet = createWalletClient({
		account: dynamicWallet.account,
		chain: dynamicWallet.chain,
		transport: http(rpcUrl)
	});
	const hash = await wallet.sendTransaction({
		...tx,
		account: wallet.account,
		chain: wallet.chain
	});
	const { createPublicClient } = await import('viem');
	const receipt = await createPublicClient({
		chain: wallet.chain,
		transport: http(rpcUrl)
	}).waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') throw new Error('The transaction was reverted.');
	return hash;
}
