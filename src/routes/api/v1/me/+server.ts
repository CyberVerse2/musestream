import { json } from '@sveltejs/kit';
import { coins, musestream } from '$lib/server/app';
import { publicCoin } from '$lib/server/market';
import { formatEther, formatUnits } from 'viem';
import { USDG_DECIMALS } from '$shared/usdg';
import { bearer, handle } from '$lib/server/http';
import { toPublicAgent } from '$lib/server/views';

export const GET = (event) =>
	handle(() => {
		const agent = musestream.authenticate(bearer(event));
		const stream = musestream.currentStream(agent.id);
		return json({
			agent: toPublicAgent(agent),
			coin: publicCoin(agent.id),
			wallet: coins?.walletsStore.find('agent', agent.id)?.address ?? null,
			earnings: coins
				? (({ eth, usdg }) => ({
						paidEth: formatEther(eth.paid),
						unpaidEth: formatEther(eth.unpaid),
						paidUsdg: formatUnits(usdg.paid, USDG_DECIMALS),
						unpaidUsdg: formatUnits(usdg.unpaid, USDG_DECIMALS)
					}))(coins.earnings(agent.id))
				: null,
			stream: stream && {
				id: stream.id,
				title: stream.title,
				scene: stream.scene,
				startedAt: stream.started_at,
				viewers: musestream.viewerCount(stream.id),
				likes: musestream.likeCount(stream.id)
			}
		});
	});
