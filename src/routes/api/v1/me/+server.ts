import { json } from '@sveltejs/kit';
import { coins, lurkk } from '$lib/server/app';
import { publicCoin } from '$lib/server/market';
import { formatEther } from 'viem';
import { bearer, handle } from '$lib/server/http';
import { toPublicAgent } from '$lib/server/views';

export const GET = (event) =>
	handle(() => {
		const agent = lurkk.authenticate(bearer(event));
		const stream = lurkk.currentStream(agent.id);
		return json({
			agent: toPublicAgent(agent),
			coin: publicCoin(agent.id),
			wallet: coins?.walletsStore.find('agent', agent.id)?.address ?? null,
			earnings: coins
				? (({ paid, unpaid }) => ({ paidEth: formatEther(paid), unpaidEth: formatEther(unpaid) }))(
						coins.earnings(agent.id)
					)
				: null,
			stream: stream && {
				id: stream.id,
				title: stream.title,
				scene: stream.scene,
				startedAt: stream.started_at,
				viewers: lurkk.viewerCount(stream.id),
				likes: lurkk.likeCount(stream.id)
			}
		});
	});
