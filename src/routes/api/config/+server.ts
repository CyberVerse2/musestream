import { json } from '@sveltejs/kit';
import { robinhood } from 'viem/chains';
import { coins } from '$lib/server/app';
import { dynamicEnvironmentId, linkedAddress } from '$lib/server/session';

/** What the app needs to sign its own transactions. */
export const GET = async ({ locals }) => {
	const treasury = coins ? (await coins.treasury()).address : null;
	return json({
		chainId: robinhood.id,
		rpcUrl: robinhood.rpcUrls.default.http[0],
		treasury,
		testMoney: coins?.testMoney ?? false,
		dynamicEnvironmentId: dynamicEnvironmentId(),
		signedInAs: linkedAddress(locals.viewer)
	});
};
