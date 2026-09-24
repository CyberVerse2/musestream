// Dollar prices: the ETH/USD rate from Codex (WETH on Ethereum), and each coin pair's rate.
// Cached, and never older than 5 minutes.
import type { Pair } from '../../../../shared/pairs.ts';

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

/**
 * Dollars per unit of a coin's pair, for showing prices. ETH comes from Codex; META from its
 * USDG market on Uniswap, which is where viewers' trades actually swap.
 */
export class PairPrices {
	private eth: EthPrice;
	private quote: (pair: Pair, pairIn: boolean, amountIn: bigint) => Promise<bigint>;
	private cached = new Map<Pair['symbol'], { usd: number; at: number }>();

	constructor(
		eth: EthPrice,
		quote: (pair: Pair, pairIn: boolean, amountIn: bigint) => Promise<bigint>
	) {
		this.eth = eth;
		this.quote = quote;
	}

	async usd(pair: Pair): Promise<number | null> {
		if (pair.native) return this.eth.usd();
		const hit = this.cached.get(pair.symbol);
		if (hit && Date.now() - hit.at < FRESH_MS) return hit.usd;
		try {
			// the USDG one whole unit of the pair sells for now; USDG has 6 decimals
			const usdg = await this.quote(pair, true, 10n ** BigInt(pair.decimals));
			const usd = Number(usdg) / 1e6;
			this.cached.set(pair.symbol, { usd, at: Date.now() });
			return usd;
		} catch {
			return hit && Date.now() - hit.at < STALE_MS ? hit.usd : null;
		}
	}

	/** the cached price without waiting, for hot paths */
	peek(pair: Pair): number | null {
		if (pair.native) return this.eth.peek();
		const hit = this.cached.get(pair.symbol);
		return hit && Date.now() - hit.at < STALE_MS ? hit.usd : null;
	}
}
