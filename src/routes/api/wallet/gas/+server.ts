import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { formatEther } from 'viem';
import { coins, db } from '$lib/server/app';
import { handle, limiter } from '$lib/server/http';
import { MusestreamError } from '$lib/server/service';
import { linkedAccount } from '$lib/server/session';

const perViewer = limiter(5, 60 * 1000);

/**
 * Gas for a signed-in viewer's own wallet: the treasury sends a little ETH so the wallet can
 * pay network fees for its gifts, sales, and approvals. The wallet then sends its own
 * transactions; musestream never moves the viewer's money.
 *
 * Limits: signed-in viewers only, one top-up per account per UTC day, only to a wallet that
 * holds USDG or a coin and is low on ETH, and within the treasury's daily spending limit.
 */
export const POST = (event) =>
	handle(async () => {
		perViewer(event.locals.viewer);
		if (!coins)
			throw new MusestreamError(503, 'no_chain', 'Coins are not available on this server.');
		const account = linkedAccount(event.locals.viewer);
		if (!account) throw new MusestreamError(401, 'sign_in', 'Sign in to get gas for your wallet.');

		// enough gas for a few gifts, sales, and approvals at twice today's gas price
		const amount = BigInt(env.GAS_TOPUP_GAS ?? '600000') * (await coins.gasPrice()) * 2n;
		const [balance, usdg, held] = await Promise.all([
			coins.balance(account.address),
			coins.usdgBalance(account.address),
			coins.holdings(account.address)
		]);
		// half a top-up still pays for a few transactions
		if (balance >= amount / 2n) return json({ sent: false, reason: 'has_gas' });
		if (usdg === 0n && held.length === 0) {
			throw new MusestreamError(
				409,
				'empty_wallet',
				'Add USDG or ETH to your wallet first. Gas top-ups are for wallets that hold money.'
			);
		}

		// reserve today's top-up before sending, so two requests cannot both send
		const day = new Date().toISOString().slice(0, 10);
		const reserved = db
			.prepare(
				`INSERT OR IGNORE INTO gas_topups (user_id, day, address, wei, at) VALUES (?, ?, ?, ?, ?)`
			)
			.run(account.userId, day, account.address, amount.toString(), Date.now());
		if (!reserved.changes) {
			throw new MusestreamError(
				429,
				'topped_up_today',
				'You already got gas today. Add a little ETH to your wallet, or try again tomorrow.'
			);
		}
		try {
			const tx = await coins.sendGas(account.address, amount);
			db.prepare('UPDATE gas_topups SET tx = ? WHERE user_id = ? AND day = ?').run(
				tx,
				account.userId,
				day
			);
			return json({ sent: true, eth: formatEther(amount), tx });
		} catch (err) {
			db.prepare('DELETE FROM gas_topups WHERE user_id = ? AND day = ?').run(account.userId, day);
			throw err;
		}
	});
