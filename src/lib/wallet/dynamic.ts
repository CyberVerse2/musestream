// A viewer's own wallet through Dynamic: email sign-in, an embedded wallet, and signing.
// Loaded only when the server has a Dynamic environment; nothing here runs otherwise.
//
// Not yet run against a real Dynamic environment. Robinhood Chain (4663) may need to be
// enabled in the Dynamic dashboard before `switchActiveNetwork` accepts it.
import type { TxRequest } from '$shared/tx';

type Sdk = {
	client: typeof import('@dynamic-labs-sdk/client');
	waas: typeof import('@dynamic-labs-sdk/client/waas');
	viem: typeof import('@dynamic-labs-sdk/evm/viem');
	instance: import('@dynamic-labs-sdk/client').DynamicClient;
};

let sdk: Promise<Sdk> | null = null;
let chainId = 4663;

/** start the SDK once per page */
export function initDynamic(environmentId: string, chain: number): Promise<Sdk> {
	chainId = chain;
	sdk ??= (async () => {
		const [client, waas, evm, viem] = await Promise.all([
			import('@dynamic-labs-sdk/client'),
			import('@dynamic-labs-sdk/client/waas'),
			import('@dynamic-labs-sdk/evm'),
			import('@dynamic-labs-sdk/evm/viem')
		]);
		const instance = client.createDynamicClient({
			autoInitialize: false,
			environmentId,
			metadata: { name: 'lurkk' }
		});
		evm.addEvmExtension();
		await client.initializeClient();
		return { client, waas, viem, instance };
	})();
	return sdk;
}

type OtpVerification = Awaited<ReturnType<typeof import('@dynamic-labs-sdk/client').sendEmailOTP>>;

/** step 1: email a one-time code */
export async function sendCode(email: string): Promise<OtpVerification> {
	const { client } = await sdk!;
	return client.sendEmailOTP({ email });
}

/** step 2: check the code, make sure an embedded wallet exists, return the session token */
export async function verifyCode(otpVerification: OtpVerification, code: string): Promise<string> {
	const { client, waas, instance } = await sdk!;
	await client.verifyOTP({ otpVerification, verificationToken: code });
	// creates only the wallets this user is missing; safe to call on every sign-in
	await waas.createWaasWalletAccounts({ chains: waas.getChainsMissingWaasWalletAccounts() });
	if (!instance.token) throw new Error('Signed in, but no session token came back.');
	return instance.token;
}

export async function signOut() {
	if (!sdk) return;
	const { client } = await sdk;
	await client.logout();
}

/** sign and send a transaction from the viewer's wallet; resolves with its hash */
export async function sendFromWallet(tx: TxRequest): Promise<`0x${string}`> {
	const { client, viem } = await sdk!;
	const account = client.getWalletAccounts()[0];
	if (!account) throw new Error('Sign in first.');
	await client.switchActiveNetwork({ walletAccount: account, networkId: String(chainId) });
	const wallet = await viem.createWalletClientForWalletAccount({ walletAccount: account });
	return wallet.sendTransaction({ ...tx, account: wallet.account, chain: wallet.chain });
}
