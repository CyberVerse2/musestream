import { json } from '@sveltejs/kit';
import { formatEther } from 'viem';
import { coins, ethPrice, lurkk } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { publicCoin } from '$lib/server/market';
import { viewerWallet } from '$lib/server/viewer';
import type { AgentRow } from '$lib/server/service';

/** The viewer's wallet: ETH, coins held, and their trades. */
export const GET = (event) =>
	handle(async () => {
		const wallet = await viewerWallet(event.locals.viewer);
		const [wei, held, usd] = await Promise.all([
			coins!.balance(wallet.address),
			coins!.holdings(wallet.address),
			ethPrice.usd()
		]);
		const holdings = held.map((h) => {
			const agent = lurkk.agentById(h.agentId) as AgentRow;
			const coin = publicCoin(h.agentId);
			const tokens = Number(formatEther(h.tokens));
			return {
				handle: agent.handle,
				name: agent.name,
				avatarUrl: agent.avatar_url,
				live: !!lurkk.currentStream(agent.id),
				tokens,
				valueEth: coin ? tokens * coin.priceEth : 0,
				history: coin?.history ?? []
			};
		});
		return json({
			address: wallet.address,
			testMoney: coins!.testMoney,
			ethUsd: usd,
			eth: Number(formatEther(wei)),
			holdings,
			activity: coins!.tradesBy(wallet.address, 30).map((t) => ({
				side: t.side,
				handle: lurkk.agentById(t.agent_id)?.handle ?? '',
				eth: Number(formatEther(BigInt(t.quote_wei))),
				tokens: Number(formatEther(BigInt(t.tokens))),
				at: t.at,
				tx: t.tx
			}))
		});
	});
