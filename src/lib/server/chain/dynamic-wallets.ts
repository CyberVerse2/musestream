// Dynamic server wallets (MPC). Dynamic holds one key share; musestream stores the other,
// with the wallet metadata, sealed in the wallets table. Neither side can sign alone.
// Signing is slow next to local keys: about 3 seconds per transaction, 6 to 11 to create a wallet.
import type { Account, Chain } from 'viem';
import type { Sealer, WalletProvider, WalletRow } from './wallets.ts';

export interface DynamicOptions {
	environmentId: string;
	apiToken: string;
	/** encrypts the shares Dynamic backs up; keep it with the other secrets */
	walletPassword: string;
	chain: Chain;
	rpcUrl: string;
	sealer: Sealer;
}

type Stored = { walletMetadata: unknown; externalServerKeyShares: unknown[] };

export class DynamicWallets implements WalletProvider {
	readonly name = 'dynamic';
	private o: DynamicOptions;
	private client: Promise<import('@dynamic-labs-wallet/node-evm').DynamicEvmWalletClient> | null =
		null;

	constructor(opts: DynamicOptions) {
		this.o = opts;
	}

	/** loaded on first use, so servers without Dynamic never load its SDK */
	private connect() {
		this.client ??= (async () => {
			const { DynamicEvmWalletClient } = await import('@dynamic-labs-wallet/node-evm');
			const client = new DynamicEvmWalletClient({
				environmentId: this.o.environmentId,
				enableMPCAccelerator: false
			});
			await client.authenticateApiToken(this.o.apiToken);
			return client;
		})();
		return this.client;
	}

	async create() {
		const client = await this.connect();
		const { ThresholdSignatureScheme } = await import('@dynamic-labs-wallet/node');
		const { walletMetadata, externalServerKeyShares } = await client.createWalletAccount({
			thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
			password: this.o.walletPassword,
			backUpToDynamic: true
		});
		const stored: Stored = { walletMetadata, externalServerKeyShares };
		return {
			address: walletMetadata.accountAddress as `0x${string}`,
			secret: this.o.sealer.seal(JSON.stringify(stored))
		};
	}

	async account(row: WalletRow): Promise<Account> {
		const client = await this.connect();
		const stored = JSON.parse(this.o.sealer.open(row.secret)) as Stored;
		const wallet = await client.getWalletClient({
			walletMetadata: stored.walletMetadata as Parameters<
				typeof client.getWalletClient
			>[0]['walletMetadata'],
			externalServerKeyShares: stored.externalServerKeyShares as never,
			password: this.o.walletPassword,
			chain: this.o.chain,
			rpcUrl: this.o.rpcUrl
		});
		return wallet.account;
	}
}
