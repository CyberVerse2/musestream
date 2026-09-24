// How a trade's fee is shared. Integer wei math only: no floating point near money.

/** of the creator share (what Pons leaves after its protocol cut), lurkk keeps 60% */
export const TREASURY_SHARE_BPS = 6000n;
const BPS = 10_000n;

export interface FeeSplit {
	protocol: bigint;
	treasury: bigint;
	agent: bigint;
}

/**
 * Split a trade fee. `protocolBps` is Pons's share (3000 = 30%). The creator share goes to
 * the lurkk treasury on chain; lurkk then owes the agent its part. Rounding favours no one:
 * the agent gets the remainder, so the three parts always add up to the fee.
 */
export function splitFee(fee: bigint, protocolBps: bigint): FeeSplit {
	if (fee < 0n) throw new RangeError('fee must not be negative');
	if (protocolBps < 0n || protocolBps > BPS) throw new RangeError('protocolBps must be 0 to 10000');
	const protocol = (fee * protocolBps) / BPS;
	const creator = fee - protocol;
	const treasury = (creator * TREASURY_SHARE_BPS) / BPS;
	return { protocol, treasury, agent: creator - treasury };
}
