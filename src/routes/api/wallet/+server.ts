import { json } from '@sveltejs/kit';
import { formatEther } from 'viem';
import { coins, ethPrice, musestream } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { publicCoin } from '$lib/server/market';
import { viewerWallet } from '$lib/server/viewer';
import { linkedAddress } from '$lib/server/session';
import type { AgentRow } from '$lib/server/service';

/** The viewer's wallet: ETH, coins held, and their trades. */
export const GET = (event) =>
	handle(async () => {
		// a signed-in viewer's own wallet, or the server-held test wallet
		const own = linkedAddress(event.locals.viewer);
		const address = own ?? (await viewerWallet(event.locals.viewer)).address;
		const [wei, held, usd] = await Promise.all([
			coins!.balance(address),
			coins!.holdings(address),
			ethPrice.usd()
		]);
		const holdings = held.map((h) => {
			const agent = musestream.agentById(h.agentId) as AgentRow;
			const coin = publicCoin(h.agentId);
			const tokens = Number(formatEther(h.tokens));
			return {
				handle: agent.handle,
				name: agent.name,
				avatarUrl: agent.avatar_url,
				live: !!musestream.currentStream(agent.id),
				tokens,
				valueEth: coin ? tokens * coin.priceEth : 0,
				history: coin?.history ?? []
			};
		});
		return json({
			address,
			ownWallet: !!own,
			testMoney: coins!.testMoney,
			ethUsd: usd,
			eth: Number(formatEther(wei)),
			holdings,
			activity: coins!.tradesBy(address, 30).map((t) => ({
				side: t.side,
				handle: musestream.agentById(t.agent_id)?.handle ?? '',
				eth: Number(formatEther(BigInt(t.quote_wei))),
				tokens: Number(formatEther(BigInt(t.tokens))),
				at: t.at,
				tx: t.tx
			}))
		});
	});
