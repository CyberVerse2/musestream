// Runs against a local fork of Robinhood Chain with the real Pons contracts:
//   anvil --fork-url $ROBINHOOD_RPC_URL --chain-id 4663 --port 8545
//   MUSESTREAM_FORK_RPC=http://127.0.0.1:8545 node --test tests/coins.fork.test.ts
// Skipped when MUSESTREAM_FORK_RPC is not set. With MUSESTREAM_FORK_WALLETS=dynamic, the server
// wallets are Dynamic server wallets (needs the DYNAMIC_* variables; run with --env-file=.env.local).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPublicClient, erc20Abi, http, parseEther, parseEventLogs } from 'viem';
import { robinhood } from 'viem/chains';
import { openDb } from '../src/lib/server/db.ts';
import { Musestream } from '../src/lib/server/service.ts';
import { Coins } from '../src/lib/server/chain/coins.ts';
import { usdgFromCents } from '../shared/usdg.ts';
import { PONS_MEME_HOOK, ponsHookAbi } from '../shared/v4.ts';
import { ETH_PAIR, META_PAIR } from '../shared/pairs.ts';
import { splitFee } from '../shared/fees.ts';
import {
	LocalWallets,
	Sealer,
	Wallets,
	type WalletProvider
} from '../src/lib/server/chain/wallets.ts';
import type { VideoProvider } from '../src/lib/server/video/provider.ts';

const RPC = process.env.MUSESTREAM_FORK_RPC;

/** how much META a transaction moved to `to` */
async function metaSentTo(
	client: ReturnType<typeof createPublicClient>,
	hash: `0x${string}`,
	to: string
): Promise<bigint> {
	const receipt = await client.getTransactionReceipt({ hash });
	return parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
		.filter(
			(l) =>
				l.address.toLowerCase() === META_PAIR.address.toLowerCase() &&
				l.args.to.toLowerCase() === to.toLowerCase()
		)
		.reduce((sum, l) => sum + l.args.value, 0n);
}

async function walletProvider(): Promise<WalletProvider> {
	const sealer = new Sealer(randomBytes(32));
	if (process.env.MUSESTREAM_FORK_WALLETS !== 'dynamic') return new LocalWallets(sealer);
	// loaded by path: the test type check leaves out the Dynamic SDK, which needs bundler resolution
	const path = '../src/lib/server/chain/dynamic-wallets.ts';
	const { DynamicWallets } = (await import(path)) as {
		DynamicWallets: new (opts: Record<string, unknown>) => WalletProvider;
	};
	return new DynamicWallets({
		environmentId: process.env.DYNAMIC_ENVIRONMENT_ID!,
		apiToken: process.env.DYNAMIC_API_TOKEN!,
		walletPassword: process.env.DYNAMIC_WALLET_PASSWORD!,
		chain: robinhood,
		rpcUrl: RPC!,
		sealer
	});
}

const video: VideoProvider = {
	name: 'none',
	render: async () => ({ kind: 'file', url: '/x.mp4' }),
	stop: async () => {}
};

test(
	'launch, buy, sell, index, and settle fees and gifts on the real Pons contracts',
	{ skip: !RPC },
	async () => {
		const db = openDb(':memory:');
		const musestream = new Musestream(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, await walletProvider());
		const coins = new Coins({
			db,
			hub: musestream.hub,
			wallets,
			client,
			rpcUrl: RPC!,
			devFork: true
		});

		const handle = `t${randomBytes(3).toString('hex')}`;
		const { agent } = musestream.registerAgent({
			handle,
			name: 'Fork Test',
			operator: 'musestream',
			category: 'Talk',
			musebookUrl: 'https://musebook.me/residents/muse_byt12z7f0j'
		});

		// new coins launch against META, with a 1% creator tax
		const coin = await coins.launch(agent);
		assert.equal(coin.status, 'live', coin.error ?? '');
		assert.match(coin.token!, /^0x[0-9a-fA-F]{40}$/);
		assert.equal(coins.view(agent.id)!.pair.symbol, 'META');
		assert.equal(coins.coinFor(agent.id)!.creator_tax_bps, 100);
		assert.ok(coins.view(agent.id)!.price > 0);
		const agentWallet = wallets.find('agent', agent.id)!;
		const launchTx = await client.getTransaction({ hash: coin.launch_tx! });
		assert.equal(
			launchTx.from.toLowerCase(),
			agentWallet.address.toLowerCase(),
			'the agent launched'
		);

		// step past the launch snipe tax window
		await client.request({ method: 'evm_increaseTime' as never, params: [60] as never });
		await client.request({ method: 'evm_mine' as never, params: [] as never });

		const viewer = await wallets.ensure('viewer', 'lurker-test01');
		await coins.topUp(viewer.address, parseEther('0.01'));
		await coins.topUpUsdg(viewer.address, usdgFromCents(200_000));
		const before = coins.view(agent.id)!.price;
		// $1,000 of USDG, swapped to META on Uniswap, then spent on the curve
		const bought = await coins.buy(viewer, agent.id, usdgFromCents(100_000));
		assert.ok(bought.tokens > 0n);
		assert.ok(coins.view(agent.id)!.price > before, 'buying raises the price');
		const [firstHolding] = await coins.holdings(viewer.address);
		assert.ok(
			firstHolding!.tokens >= bought.tokens &&
				firstHolding!.tokens <= (bought.tokens * 101n) / 100n,
			'the buy delivered what the mirrored curve math quoted'
		);

		const [held] = await coins.holdings(viewer.address);
		assert.equal(held?.agentId, agent.id);
		const usdgBeforeSale = await coins.usdgBalance(viewer.address);
		const sold = await coins.sell(viewer, agent.id, held!.tokens / 2n);
		assert.ok(sold.usdg > 0n);
		assert.ok(
			(await coins.usdgBalance(viewer.address)) > usdgBeforeSale,
			'the sale paid out in USDG'
		);
		const gasReserve = 600_000n * (await client.getGasPrice()) * 2n;
		assert.ok(
			(await coins.balance(viewer.address)) <= gasReserve,
			'no more ETH than the gas reserve stayed behind'
		);

		const trades = coins.recentTrades(agent.id);
		assert.deepEqual(trades.map((t) => t.side).sort(), ['buy', 'sell']);
		assert.equal(coins.view(agent.id)!.holders, 1);

		// the agent earns its share of the fee and of the creator tax, in META
		const feeOnly = trades.reduce(
			(sum, t) => sum + splitFee(BigInt(t.fee_amount), 3000n).agent,
			0n
		);
		assert.ok(
			coins.earnings(agent.id).meta.unpaid > feeOnly,
			'the creator tax adds to the agent’s share'
		);
		const treasuryShare = (
			db.prepare('SELECT treasury_amount FROM fee_ledger').all() as { treasury_amount: string }[]
		).reduce((sum, r) => sum + BigInt(r.treasury_amount), 0n);

		// a $25 gift in USDG, checked on chain as a viewer's own wallet would have sent it
		const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
		const treasury = await coins.treasury();
		const gift = usdgFromCents(2500);
		await coins.topUpUsdg(viewer.address, gift);
		const giftTx = await coins.sendUsdg(viewer, treasury.address, gift);
		await coins.verifyUsdgPayment(giftTx, viewer.address, treasury.address, gift);
		await assert.rejects(
			coins.verifyUsdgPayment(giftTx, viewer.address, treasury.address, gift + 1n),
			/does not pay/
		);
		musestream.gift(stream.id, viewer.owner_id, 'crown', { tx: giftTx, amount: gift });
		assert.equal(coins.earnings(agent.id).usdg.unpaid, 17_500_000n, 'a gift owes the agent 70%');

		const usdgBefore = await coins.usdgBalance(agentWallet.address);
		const result = await coins.settleFees();
		assert.deepEqual(result.failed, []);
		const [settled] = result.fees;
		assert.ok(settled!.swept > 0n, 'the agent swept fees from its curve into the escrow');
		assert.ok(settled!.claimed > 0n, 'the agent claimed its escrow balance');
		assert.equal(settled!.pair, 'META');
		assert.equal(
			await metaSentTo(client, settled!.tx!, treasury.address),
			treasuryShare,
			'musestream got exactly its 60% share, in META'
		);
		assert.equal(
			(await coins.usdgBalance(agentWallet.address)) - usdgBefore,
			17_500_000n,
			'the agent got its gift share in USDG'
		);
		const after = coins.earnings(agent.id);
		assert.equal(after.meta.unpaid + after.usdg.unpaid, 0n);
	}
);

test(
	'an ETH-paired coin trades with the shared transactions, and buy and sell quotes match the chain',
	{ skip: !RPC },
	async () => {
		const { buyQuote, sellQuote, withSlippage } = await import('../shared/curve.ts');
		const { buyTx, approveTx, sellTx } = await import('../shared/tx.ts');
		const { createWalletClient } = await import('viem');
		const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
		const { curveAbi } = await import('../src/lib/server/chain/abi.ts');

		const db = openDb(':memory:');
		const musestream = new Musestream(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, await walletProvider());
		const coins = new Coins({
			db,
			hub: musestream.hub,
			wallets,
			client,
			rpcUrl: RPC!,
			devFork: true
		});
		const { agent } = musestream.registerAgent({
			handle: `v${randomBytes(3).toString('hex')}`,
			name: 'V',
			operator: 'o',
			category: 'Talk'
		});
		// coins launched before META pairing trade against ETH, like Love's
		const coin = await coins.launch(agent, ETH_PAIR);
		const taxBps = BigInt(coins.coinFor(agent.id)!.creator_tax_bps);
		await client.request({ method: 'evm_increaseTime' as never, params: [60] as never });
		await client.request({ method: 'evm_mine' as never, params: [] as never });

		// a wallet the server knows nothing about, like a viewer's Dynamic wallet
		const account = privateKeyToAccount(generatePrivateKey());
		await coins.topUp(account.address, parseEther('1'));
		const wallet = createWalletClient({ account, chain: robinhood, transport: http(RPC) });
		const send = async (tx: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }) => {
			const hash = await wallet.sendTransaction(tx);
			const r = await client.waitForTransactionReceipt({ hash });
			assert.equal(r.status, 'success');
		};

		const reserves = await client.readContract({
			address: coin.curve!,
			abi: curveAbi,
			functionName: 'getReserves'
		});
		const fee = await client.readContract({
			address: coin.curve!,
			abi: curveAbi,
			functionName: 'feeBps'
		});
		const quotedBuy = buyQuote(
			parseEther('0.2'),
			{ quote: reserves[0], tokens: reserves[1] },
			fee,
			taxBps
		);
		await send(buyTx(coin.curve!, parseEther('0.2'), 1n, account.address, true));
		const [held] = await coins.holdings(account.address);
		assert.equal(held!.tokens, quotedBuy, 'the shared buy math matches the contract to the wei');

		const [quote, tokens] = await client.readContract({
			address: coin.curve!,
			abi: curveAbi,
			functionName: 'getReserves'
		});
		const feeBps = await client.readContract({
			address: coin.curve!,
			abi: curveAbi,
			functionName: 'feeBps'
		});
		const expected = sellQuote(held!.tokens, { quote, tokens }, feeBps, taxBps);
		const before = await client.getBalance({ address: account.address });
		await send(approveTx(coin.token!, coin.curve!, held!.tokens));
		await send(sellTx(coin.curve!, held!.tokens, withSlippage(expected, 100n), account.address));
		await coins.sync();
		const sold = coins.recentTrades(agent.id).find((t) => t.side === 'sell')!;
		assert.equal(
			BigInt(sold.quote_amount),
			expected,
			'the shared sell math matches the contract to the wei'
		);
		assert.ok((await client.getBalance({ address: account.address })) > before);
	}
);

test(
	'a graduated coin trades on its Uniswap pool, and musestream collects 60% of its pool fees',
	{ skip: !RPC },
	async () => {
		const { poolId } = await import('../shared/v4.ts');
		const db = openDb(':memory:');
		const musestream = new Musestream(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, await walletProvider());
		const coins = new Coins({
			db,
			hub: musestream.hub,
			wallets,
			client,
			rpcUrl: RPC!,
			devFork: true
		});
		const { agent } = musestream.registerAgent({
			handle: `p${randomBytes(3).toString('hex')}`,
			name: 'Pool',
			operator: 'o',
			category: 'Talk'
		});
		const coin = await coins.launch(agent);
		await client.request({ method: 'evm_increaseTime' as never, params: [120] as never });
		await client.request({ method: 'evm_mine' as never, params: [] as never });

		// buying past the curve's threshold (about 13.57 META) graduates the coin into its pool
		const whale = await wallets.ensure('viewer', 'lurker-whale');
		await coins.topUp(whale.address, parseEther('0.1'));
		await coins.topUpUsdg(whale.address, usdgFromCents(2_000_000));
		for (const usd of [530_000, 530_000, 400_000])
			await coins.buy(whale, agent.id, usdgFromCents(usd));
		const view = coins.view(agent.id)!;
		assert.equal(view.graduated, true);
		assert.ok(view.price > 0, 'a graduated coin is priced from its pool');

		// a viewer buys and sells on the pool through the Universal Router
		const viewer = await wallets.ensure('viewer', 'lurker-pool');
		await coins.topUp(viewer.address, parseEther('0.01'));
		await coins.topUpUsdg(viewer.address, usdgFromCents(200_000));
		// one router transaction: USDG to META to the coin
		const bought = await coins.buy(viewer, agent.id, usdgFromCents(100_000));
		assert.ok(bought.tokens > 0n);
		const held = await coins.tokenBalance(agent.id, viewer.address);
		assert.ok(
			held >= (bought.tokens * 97n) / 100n,
			'the buy delivered what was quoted, less slippage'
		);
		// pool swaps carry no curve fee; the whale's buy past the threshold may also land in the pool
		const trades = coins.recentTrades(agent.id).filter((t) => t.fee_amount === '0');
		assert.ok(
			trades.some(
				(t) => t.side === 'buy' && t.trader.toLowerCase() === viewer.address.toLowerCase()
			),
			"pool swaps are recorded as the sender's trades"
		);

		// a buy takes the hook fee in the coin; only Pons's sweeper can convert and sweep that
		const operator = await client.readContract({
			address: PONS_MEME_HOOK,
			abi: [
				{
					type: 'function',
					name: 'feeSweepOperator',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ type: 'address' }]
				}
			] as const,
			functionName: 'feeSweepOperator'
		});
		await client.request({
			method: 'anvil_impersonateAccount' as never,
			params: [operator] as never
		});
		await coins.topUp(operator, parseEther('1'));
		const { createWalletClient } = await import('viem');
		const ponsSweeper = createWalletClient({
			account: operator,
			chain: robinhood,
			transport: http(RPC)
		});
		const sweep = await ponsSweeper.writeContract({
			address: PONS_MEME_HOOK,
			abi: ponsHookAbi,
			functionName: 'sweepPoolFees',
			// converting coin fees to ETH needs a nonzero minimum
			args: [poolId(coin.token!, META_PAIR), 1n, 0n]
		});
		await client.waitForTransactionReceipt({ hash: sweep });
		await coins.sync();
		const swept = db.prepare('SELECT creator_amount, treasury_amount FROM pool_fees').all() as {
			creator_amount: string;
			treasury_amount: string;
		}[];
		assert.equal(swept.length, 1, 'the indexer recorded the pool fee sweep');

		// a sale takes the fee in ETH, which the agent's own wallet may sweep
		const usdgBeforeSale = await coins.usdgBalance(viewer.address);
		const sold = await coins.sell(viewer, agent.id, held / 2n);
		assert.ok(sold.usdg > 0n);
		assert.ok(
			(await coins.usdgBalance(viewer.address)) > usdgBeforeSale,
			'the sale paid out in USDG'
		);
		const gasReserve = 600_000n * (await client.getGasPrice()) * 2n;
		assert.ok(
			(await coins.balance(viewer.address)) <= gasReserve,
			'no more ETH than the gas reserve stayed behind'
		);
		const treasury = await coins.treasury();
		const result = await coins.settleFees();
		assert.deepEqual(result.failed, []);
		const settled = result.fees.find((f) => f.agentId === agent.id)!;
		const recorded = db.prepare('SELECT treasury_amount FROM pool_fees').all() as {
			treasury_amount: string;
		}[];
		assert.equal(recorded.length, 2, 'the agent swept its pool itself');
		const curveShare = (
			db.prepare('SELECT treasury_amount FROM fee_ledger').all() as { treasury_amount: string }[]
		).reduce((sum, r) => sum + BigInt(r.treasury_amount), 0n);
		const poolShare = recorded.reduce((sum, r) => sum + BigInt(r.treasury_amount), 0n);
		assert.equal(
			await metaSentTo(client, settled.tx!, treasury.address),
			curveShare + poolShare,
			'musestream got 60% of curve and pool fees, in META'
		);
		assert.equal(coins.earnings(agent.id).meta.unpaid, 0n);
	}
);

test(
	'the treasury stops funding launches and gas top-ups at its daily spending limit',
	{ skip: !RPC },
	async () => {
		const db = openDb(':memory:');
		const musestream = new Musestream(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, await walletProvider());
		// real-money rules on the fork: the treasury pays gas, capped at 0.001 ETH a day
		const coins = new Coins({
			db,
			hub: musestream.hub,
			wallets,
			client,
			rpcUrl: RPC!,
			devFork: false,
			treasuryDailyWei: parseEther('0.001')
		});
		const treasury = await coins.treasury();
		await client.request({
			method: 'anvil_setBalance' as never,
			params: [treasury.address, '0x8AC7230489E80000'] as never
		});
		const { agent } = musestream.registerAgent({
			handle: `c${randomBytes(3).toString('hex')}`,
			name: 'Cap',
			operator: 'o',
			category: 'Talk'
		});
		const coin = await coins.launch(agent);
		assert.equal(coin.status, 'failed');
		assert.match(coin.error ?? '', /spending limit/);

		// a gas top-up comes from the treasury and counts against the same limit
		const viewer = '0x000000000000000000000000000000000000bEEF';
		const tx = await coins.sendGas(viewer, parseEther('0.0004'));
		const sent = await client.getTransaction({ hash: tx! });
		assert.equal(sent.from.toLowerCase(), treasury.address.toLowerCase());
		assert.equal(sent.value, parseEther('0.0004'));
		await assert.rejects(coins.sendGas(viewer, parseEther('0.0007')), /spending limit/);
	}
);
