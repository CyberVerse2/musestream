// The wallet a viewer trades and gifts with.
import { coins } from './app.ts';
import { MusestreamError } from './service.ts';
import type { WalletRow } from './chain/wallets.ts';
import { linkedAddress } from './session.ts';

/**
 * On a local fork, each viewer gets a server-held wallet with free test ETH and USDG.
 * With real money, viewers must hold their own keys (Dynamic wallets), so this refuses.
 */
export async function viewerWallet(viewer: string): Promise<WalletRow> {
	if (!coins) throw new MusestreamError(503, 'no_chain', 'Coins are not available on this server.');
	if (linkedAddress(viewer)) {
		throw new MusestreamError(
			409,
			'own_wallet',
			'You signed in with your own wallet; it signs your trades.'
		);
	}
	if (!coins.testMoney) {
		throw new MusestreamError(501, 'connect_wallet', 'Sign in to trade from your own wallet.');
	}
	const isNew = !coins.walletsStore.find('viewer', viewer);
	const row = await coins.walletsStore.ensure('viewer', viewer);
	// test money once, when the wallet is made, so balances show what trades and gifts cost
	if (isNew) {
		await coins.topUp(row.address, 10n ** 18n);
		await coins.topUpUsdg(row.address, 100_000_000n); // $100
	}
	return row;
}
