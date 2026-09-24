// Checks a real-money setup before it goes live. Reads only: it sends no transaction, creates
// no wallet, and changes no file. Run with the production environment:
//
//   npm run preflight
//
// Exits 1 if any check fails. Warnings do not fail it, but read them.
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, formatEther, http, parseEther, type Address } from 'viem';
import { robinhood } from 'viem/chains';
import { PONS_FACTORY, factoryAbi } from '../src/lib/server/chain/abi.ts';
import { USDG } from '../shared/usdg.ts';
import {
	PERMIT2,
	POOL_MANAGER,
	PONS_MEME_HOOK,
	STATE_VIEW,
	UNIVERSAL_ROUTER,
	V4_QUOTER
} from '../shared/v4.ts';

const env = process.env;
let failed = 0;
const ok = (what: string) => console.log(`  ✓ ${what}`);
const warn = (what: string) => console.log(`  ! ${what}`);
const fail = (what: string) => {
	failed++;
	console.log(`  ✗ ${what}`);
};
const section = (name: string) => console.log(`\n${name}`);

section('Mode');
if (env.CHAIN_MODE === 'live') ok('CHAIN_MODE is live');
else fail(`CHAIN_MODE is "${env.CHAIN_MODE ?? ''}"; real money needs "live"`);

section('Chain');
const rpcUrl = env.CHAIN_RPC_URL;
const client = rpcUrl ? createPublicClient({ chain: robinhood, transport: http(rpcUrl) }) : null;
if (!client) fail('CHAIN_RPC_URL is not set');
else {
	const chainId = await client.getChainId().catch(() => null);
	if (chainId === robinhood.id) ok(`CHAIN_RPC_URL reaches Robinhood Chain (${chainId})`);
	else fail(`CHAIN_RPC_URL reaches chain ${chainId ?? 'nothing'}, not ${robinhood.id}`);
	if (/127\.0\.0\.1|localhost/.test(rpcUrl!)) fail('CHAIN_RPC_URL points at this machine, a fork');

	const contracts: [string, Address][] = [
		['Pons factory', PONS_FACTORY],
		['Pons pool hook', PONS_MEME_HOOK],
		['USDG', USDG],
		['Uniswap PoolManager', POOL_MANAGER],
		['Uniswap Universal Router', UNIVERSAL_ROUTER],
		['Uniswap V4Quoter', V4_QUOTER],
		['Uniswap StateView', STATE_VIEW],
		['Permit2', PERMIT2]
	];
	for (const [name, address] of contracts) {
		const code = await client.getCode({ address }).catch(() => undefined);
		if (code && code !== '0x') ok(`${name} is deployed at ${address}`);
		else fail(`${name} has no code at ${address}`);
	}
	const launchFee = await client
		.readContract({ address: PONS_FACTORY, abi: factoryAbi, functionName: 'launchFee' })
		.catch(() => null);
	if (launchFee !== null) ok(`Pons launch fee is ${formatEther(launchFee)} ETH per coin`);
	else fail('could not read the Pons launch fee');
	const hookBps = await client
		.readContract({
			address: PONS_MEME_HOOK,
			abi: [
				{
					type: 'function',
					name: 'protocolFeeShareBps',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ type: 'uint256' }]
				}
			] as const,
			functionName: 'protocolFeeShareBps'
		})
		.catch(() => null);
	if (hookBps === 3000n) ok("Pons keeps 30% of pool fees, as musestream's split assumes");
	else fail(`Pons's pool fee share is ${hookBps ?? 'unreadable'}, not the 30% the split assumes`);
}

section('Wallets');
const key = env.WALLET_ENCRYPTION_KEY;
if (key && Buffer.from(key, 'base64').length === 32) ok('WALLET_ENCRYPTION_KEY is 32 bytes');
else fail('WALLET_ENCRYPTION_KEY is missing or not 32 bytes of base64');
const provider = env.WALLET_PROVIDER ?? 'local';
if (provider === 'dynamic') {
	const missing = ['DYNAMIC_ENVIRONMENT_ID', 'DYNAMIC_API_TOKEN', 'DYNAMIC_WALLET_PASSWORD'].filter(
		(k) => !env[k]
	);
	if (missing.length) fail(`WALLET_PROVIDER=dynamic needs ${missing.join(', ')}`);
	else ok('server wallets are Dynamic wallets; keep DYNAMIC_WALLET_PASSWORD backed up');
} else {
	warn('server wallets are local keys in the database; back up the database and the key');
}

const dbFile = join(env.MUSESTREAM_DATA_DIR ?? 'data', 'musestream.db');
const minTreasury = parseEther(env.PREFLIGHT_MIN_TREASURY_ETH ?? '0.02');
if (!existsSync(dbFile)) {
	warn(`no database at ${dbFile}; the treasury wallet is created on first start, then fund it`);
} else {
	const db = new Database(dbFile, { readonly: true, fileMustExist: true });
	const treasury = db
		.prepare("SELECT address, provider FROM wallets WHERE owner_kind = 'treasury'")
		.get() as { address: Address; provider: string } | undefined;
	if (!treasury) warn('no treasury wallet yet; it is created on first start, then fund it');
	else {
		if (treasury.provider === provider) ok(`treasury ${treasury.address} uses ${provider}`);
		else
			fail(
				`treasury ${treasury.address} belongs to "${treasury.provider}", but WALLET_PROVIDER is "${provider}"`
			);
		if (client) {
			const balance = await client.getBalance({ address: treasury.address });
			if (balance >= minTreasury) ok(`treasury holds ${formatEther(balance)} ETH`);
			else
				fail(
					`treasury holds ${formatEther(balance)} ETH; fund it with at least ${formatEther(minTreasury)} ETH for launch gas`
				);
		}
	}
	const leftovers = db
		.prepare("SELECT COUNT(*) AS n FROM wallets WHERE provider != ? AND owner_kind != 'viewer'")
		.get(provider) as { n: number };
	if (leftovers.n) fail(`${leftovers.n} server wallets belong to another provider and cannot sign`);
	db.close();
}
const cap = env.TREASURY_DAILY_SPEND_ETH ?? '0.05';
ok(`the treasury spends at most ${cap} ETH a day on gas (TREASURY_DAILY_SPEND_ETH)`);

section('Viewer sign-in (Dynamic)');
const envId = env.DYNAMIC_ENVIRONMENT_ID;
if (!envId || !env.DYNAMIC_API_TOKEN) {
	fail('DYNAMIC_ENVIRONMENT_ID and DYNAMIC_API_TOKEN are needed: live mode has no test wallets');
} else {
	const settings = (await fetch(
		`https://app.dynamicauth.com/api/v0/sdk/${envId}/settings?sdkVersion=ClientSDK%2F1.34.1`
	)
		.then((r) => r.json())
		.catch(() => null)) as {
		environmentName?: string;
		chains?: { name: string; networks: { networkId: number; enabled: boolean }[] }[];
		sdk?: { socialSignIn?: { providers?: { provider: string }[] } };
	} | null;
	if (!settings) fail("could not read the Dynamic environment's settings");
	else {
		if (settings.environmentName === 'live') ok('Dynamic environment is Live');
		else warn(`Dynamic environment is "${settings.environmentName}"; use Live for real users`);
		const evm = settings.chains?.find((c) => c.name === 'evm');
		if (evm?.networks.some((n) => n.networkId === robinhood.id && n.enabled))
			ok('Robinhood Chain is enabled in Dynamic');
		else fail('Robinhood Chain (4663) is not enabled in Dynamic');
		const social = settings.sdk?.socialSignIn?.providers?.map((p) => p.provider) ?? [];
		if (social.includes('google')) ok('Google sign-in is on');
		else warn('Google sign-in is off; viewers can still sign in with an emailed code');
	}
}

section('Paid video');
if ((env.VIDEO_PROVIDER ?? 'mock') !== 'reactor') {
	ok('paid video is off (VIDEO_PROVIDER is not reactor)');
} else {
	if (!env.REACTOR_API_KEY) fail('VIDEO_PROVIDER=reactor needs REACTOR_API_KEY');
	const agents = (env.REACTOR_AGENTS ?? '').split(',').filter((a) => a.trim());
	const daily = Number(env.REACTOR_DAILY_SECONDS ?? 600);
	const perDay = agents.length * daily * 0.0097;
	ok(
		`${agents.length} agents may use paid video, ${daily}s each a day: at most $${perDay.toFixed(2)} a day`
	);
}

console.log(failed ? `\n${failed} check(s) failed. Do not go live.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
