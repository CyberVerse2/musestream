// Server-held wallets for the treasury, agents, and (in development) viewers.
// The rest of the server asks for a viem Account and never sees how keys are kept.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Account, Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { DB } from '../db.ts';

export type OwnerKind = 'treasury' | 'agent' | 'viewer';

export interface WalletRow {
	id: string;
	owner_kind: OwnerKind;
	owner_id: string;
	address: Address;
	provider: string;
	secret: string;
	created_at: number;
}

export interface WalletProvider {
	readonly name: string;
	/** make a new wallet; `secret` is what this provider needs to use it later */
	create(): Promise<{ address: Address; secret: string }>;
	/** a signer for a wallet this provider made */
	account(row: WalletRow): Promise<Account>;
}

/**
 * Keys generated here and stored encrypted (AES-256-GCM) in the database.
 * `key` is 32 bytes; keep it outside the database, in WALLET_ENCRYPTION_KEY.
 */
export class LocalWallets implements WalletProvider {
	readonly name = 'local';
	private key: Buffer;

	constructor(key: Buffer) {
		if (key.length !== 32) throw new Error('The wallet encryption key must be 32 bytes.');
		this.key = key;
	}

	async create() {
		const pk = generatePrivateKey();
		return { address: privateKeyToAccount(pk).address, secret: this.seal(pk) };
	}

	async account(row: WalletRow) {
		return privateKeyToAccount(this.open(row.secret) as `0x${string}`);
	}

	seal(plain: string): string {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, iv);
		const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
		return ['v1', iv, cipher.getAuthTag(), body]
			.map((p) => (typeof p === 'string' ? p : p.toString('base64')))
			.join(':');
	}

	open(sealed: string): string {
		const [version, iv, tag, body] = sealed.split(':');
		if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unknown wallet secret format.');
		const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
		decipher.setAuthTag(Buffer.from(tag, 'base64'));
		return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
			'utf8'
		);
	}
}

/** One wallet per owner, created on first use. */
export class Wallets {
	private db: DB;
	private provider: WalletProvider;
	private now: () => number;

	constructor(db: DB, provider: WalletProvider, now: () => number = Date.now) {
		this.db = db;
		this.provider = provider;
		this.now = now;
	}

	find(kind: OwnerKind, ownerId: string): WalletRow | null {
		return (
			(this.db
				.prepare('SELECT * FROM wallets WHERE owner_kind = ? AND owner_id = ?')
				.get(kind, ownerId) as WalletRow | undefined) ?? null
		);
	}

	async ensure(kind: OwnerKind, ownerId: string): Promise<WalletRow> {
		const found = this.find(kind, ownerId);
		if (found) return found;
		const { address, secret } = await this.provider.create();
		const row: WalletRow = {
			id: randomUUID(),
			owner_kind: kind,
			owner_id: ownerId,
			address,
			provider: this.provider.name,
			secret,
			created_at: this.now()
		};
		// another request may have created it meanwhile; keep whichever landed first
		this.db
			.prepare(
				`INSERT OR IGNORE INTO wallets (id, owner_kind, owner_id, address, provider, secret, created_at)
				 VALUES (@id, @owner_kind, @owner_id, @address, @provider, @secret, @created_at)`
			)
			.run(row);
		return this.find(kind, ownerId)!;
	}

	async account(row: WalletRow): Promise<Account> {
		if (row.provider !== this.provider.name) {
			throw new Error(`Wallet ${row.address} belongs to the "${row.provider}" provider.`);
		}
		return this.provider.account(row);
	}
}
