import { json } from '@sveltejs/kit';
import { charts, ethPrice, musestream } from '$lib/server/app';
import { handle } from '$lib/server/http';
import { MusestreamError } from '$lib/server/service';
import { INTERVALS, type Interval } from '$shared/candles';

/** Price candles in ETH; `interval` is 1m, 5m, 1h, or 1d. */
export const GET = ({ params, url }) =>
	handle(async () => {
		const interval = (url.searchParams.get('interval') ?? '5m') as Interval;
		if (!(interval in INTERVALS)) {
			throw new MusestreamError(400, 'invalid', 'interval must be 1m, 5m, 1h, or 1d.');
		}
		if (!charts)
			throw new MusestreamError(503, 'no_chain', 'Coins are not available on this server.');
		const agent = musestream.agentByHandle(params.handle);
		return json({ ethUsd: await ethPrice.usd(), ...(await charts.candles(agent.id, interval)) });
	});
