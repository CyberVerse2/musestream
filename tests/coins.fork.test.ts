// Runs against a local fork of Robinhood Chain with the real Pons contracts:
//   anvil --fork-url $ROBINHOOD_RPC_URL --chain-id 4663 --port 8545
//   MUSESTREAM_FORK_RPC=http://127.0.0.1:8545 node --test tests/coins.fork.test.ts
// Skipped when MUSESTREAM_FORK_RPC is not set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPublicClient, http, parseEther } from 'viem';
import { robinhood } from 'viem/chains';
import { openDb } from '../src/lib/server/db.ts';
import { Musestream } from '../src/lib/server/service.ts';
import { Coins } from '../src/lib/server/chain/coins.ts';
import { LocalWallets, Sealer, Wallets } from '../src/lib/server/chain/wallets.ts';
import type { VideoProvider } from '../src/lib/server/video/provider.ts';

const RPC = process.env.MUSESTREAM_FORK_RPC;

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
		const wallets = new Wallets(db, new LocalWallets(new Sealer(randomBytes(32))));
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
			category: 'Talk'
		});

		const coin = await coins.launch(agent);
		assert.equal(coin.status, 'live', coin.error ?? '');
		assert.match(coin.token!, /^0x[0-9a-fA-F]{40}$/);
		assert.ok(coins.view(agent.id)!.priceEth > 0);

		// step past the launch snipe tax window
		await client.request({ method: 'evm_increaseTime' as never, params: [60] as never });
		await client.request({ method: 'evm_mine' as never, params: [] as never });

		const viewer = await wallets.ensure('viewer', 'lurker-test01');
		await coins.topUp(viewer.address, parseEther('2'));
		const before = coins.view(agent.id)!.priceEth;
		const bought = await coins.buy(viewer, agent.id, parseEther('0.5'));
		assert.ok(bought.tokens > 0n);
		assert.ok(coins.view(agent.id)!.priceEth > before, 'buying raises the price');

		const [held] = await coins.holdings(viewer.address);
		assert.equal(held?.agentId, agent.id);
		const sold = await coins.sell(viewer, agent.id, held!.tokens / 2n);
		assert.ok(sold.wei > 0n);

		const trades = coins.recentTrades(agent.id);
		assert.deepEqual(trades.map((t) => t.side).sort(), ['buy', 'sell']);
		assert.equal(coins.view(agent.id)!.holders, 1);

		const fees = coins.earnings(agent.id).unpaid;
		assert.ok(fees > 0n, 'trades owe the agent part of the fee');

		const stream = await musestream.goLive(agent, { title: 't', scene: 's' });
		const treasury = await coins.treasury();
		const giftWei = parseEther('0.01');
		const giftTx = await coins.send(viewer, treasury.address, giftWei);
		musestream.gift(stream.id, viewer.owner_id, 'crown', { tx: giftTx, wei: giftWei });
		const owed = coins.earnings(agent.id);
		assert.equal(owed.unpaid, fees + (giftWei * 7n) / 10n, 'a gift owes the agent 70%');

		const result = await coins.settleFees();
		assert.ok(result.swept >= 1, 'fees moved from the curve to the escrow');
		assert.ok(result.claimedWei > 0n, 'the treasury claimed its escrow balance');
		const agentWallet = wallets.find('agent', agent.id)!;
		assert.equal(
			await coins.balance(agentWallet.address),
			owed.unpaid,
			'the agent got exactly what it was owed'
		);
		assert.equal(coins.earnings(agent.id).unpaid, 0n);
	}
);

test(
	'a viewer wallet can trade with the shared transactions, and sell quotes match the chain',
	{ skip: !RPC },
	async () => {
		const { sellQuote, withSlippage } = await import('../shared/curve.ts');
		const { buyTx, approveTx, sellTx } = await import('../shared/tx.ts');
		const { createWalletClient } = await import('viem');
		const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');
		const { curveAbi } = await import('../src/lib/server/chain/abi.ts');

		const db = openDb(':memory:');
		const musestream = new Musestream(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, new LocalWallets(new Sealer(randomBytes(32))));
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
		const coin = await coins.launch(agent);
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

		await send(buyTx(coin.curve!, parseEther('0.2'), 1n, account.address));
		const [held] = await coins.holdings(account.address);
		assert.ok(held && held.tokens > 0n);

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
		const expected = sellQuote(held!.tokens, { quote, tokens }, feeBps);
		const before = await client.getBalance({ address: account.address });
		await send(approveTx(coin.token!, coin.curve!, held!.tokens));
		await send(sellTx(coin.curve!, held!.tokens, withSlippage(expected, 100n), account.address));
		await coins.sync();
		const sold = coins.recentTrades(agent.id).find((t) => t.side === 'sell')!;
		assert.equal(
			BigInt(sold.quote_wei),
			expected,
			'the shared sell math matches the contract to the wei'
		);
		assert.ok((await client.getBalance({ address: account.address })) > before);
	}
);
