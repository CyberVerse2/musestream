import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/lib/server/db.ts';
import { Hub } from '../src/lib/server/hub.ts';
import { Coins } from '../src/lib/server/chain/coins.ts';
import { LocalWallets, Sealer, Wallets } from '../src/lib/server/chain/wallets.ts';
import { randomBytes } from 'node:crypto';

test('while another server holds the payout lease, settlement skips and touches nothing', async () => {
	const db = openDb(':memory:');
	db.prepare("INSERT INTO leases (name, holder, until) VALUES ('settle', 'other-server', ?)").run(
		Date.now() + 60_000
	);
	const coins = new Coins({
		db,
		hub: new Hub(),
		wallets: new Wallets(db, new LocalWallets(new Sealer(randomBytes(32)))),
		// any chain call would throw: the skip must happen before one
		client: new Proxy(
			{},
			{ get: () => () => Promise.reject(new Error('no chain calls')) }
		) as never,
		rpcUrl: 'http://unused',
		devFork: false
	});
	const result = await coins.settleFees();
	assert.equal(result.skipped, true);
});
