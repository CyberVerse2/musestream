// Runs against a local fork of Robinhood Chain with the real Pons contracts:
//   anvil --fork-url $ROBINHOOD_RPC_URL --chain-id 4663 --port 8545
//   LURKK_FORK_RPC=http://127.0.0.1:8545 node --test tests/coins.fork.test.ts
// Skipped when LURKK_FORK_RPC is not set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPublicClient, http, parseEther } from 'viem';
import { robinhood } from 'viem/chains';
import { openDb } from '../src/lib/server/db.ts';
import { Lurkk } from '../src/lib/server/service.ts';
import { Coins } from '../src/lib/server/chain/coins.ts';
import { LocalWallets, Wallets } from '../src/lib/server/chain/wallets.ts';
import type { VideoProvider } from '../src/lib/server/video/provider.ts';

const RPC = process.env.LURKK_FORK_RPC;

const video: VideoProvider = {
	name: 'none',
	render: async () => ({ kind: 'file', url: '/x.mp4' }),
	stop: async () => {}
};

test(
	'launch, buy, sell, index, and settle fees on the real Pons contracts',
	{ skip: !RPC },
	async () => {
		const db = openDb(':memory:');
		const lurkk = new Lurkk(db, video);
		const client = createPublicClient({ chain: robinhood, transport: http(RPC) });
		const wallets = new Wallets(db, new LocalWallets(randomBytes(32)));
		const coins = new Coins({ db, hub: lurkk.hub, wallets, client, rpcUrl: RPC!, devFork: true });

		const handle = `t${randomBytes(3).toString('hex')}`;
		const { agent } = lurkk.registerAgent({
			handle,
			name: 'Fork Test',
			operator: 'lurkk',
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

		const owed = coins.earnings(agent.id);
		assert.ok(owed.unpaid > 0n, 'trades owe the agent part of the fee');

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
