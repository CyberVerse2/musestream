// The ETH/USD rate, from Codex (WETH on Ethereum). Cached, and never older than 5 minutes.
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const FRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;

export class EthPrice {
	private apiKey: string | undefined;
	private cached: { usd: number; at: number } | null = null;
	private inflight: Promise<number | null> | null = null;

	constructor(apiKey: string | undefined) {
		this.apiKey = apiKey;
	}

	/** dollars per ETH, or null when no recent price is known */
	async usd(): Promise<number | null> {
		const now = Date.now();
		if (this.cached && now - this.cached.at < FRESH_MS) return this.cached.usd;
		this.inflight ??= this.fetchPrice().finally(() => (this.inflight = null));
		const fresh = await this.inflight;
		if (fresh !== null) return fresh;
		// keep showing a slightly old price rather than none, up to a limit
		return this.cached && now - this.cached.at < STALE_MS ? this.cached.usd : null;
	}

	/** the cached price without waiting, for hot paths */
	peek(): number | null {
		return this.cached && Date.now() - this.cached.at < STALE_MS ? this.cached.usd : null;
	}

	private async fetchPrice(): Promise<number | null> {
		if (!this.apiKey) return null;
		try {
			const res = await fetch('https://graph.codex.io/graphql', {
				method: 'POST',
				headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					query: `{ getTokenPrices(inputs: [{address: "${WETH}", networkId: 1}]) { address priceUsd timestamp } }`
				}),
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) return null;
			const body = (await res.json()) as {
				data?: { getTokenPrices?: { priceUsd?: number; timestamp?: number }[] };
			};
			const price = body.data?.getTokenPrices?.[0]?.priceUsd;
			if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
			this.cached = { usd: price, at: Date.now() };
			return price;
		} catch {
			return null;
		}
	}
}
