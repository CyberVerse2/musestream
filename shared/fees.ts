// How trade fees and gifts are shared. Integer wei math only: no floating point near money.

/** of the creator share (what Pons leaves after its protocol cut), musestream keeps 60% */
export const TREASURY_SHARE_BPS = 6000n;
/** of each gift, the agent gets 70% and musestream keeps 30% */
export const GIFT_AGENT_SHARE_BPS = 7000n;
const BPS = 10_000n;

export interface FeeSplit {
	protocol: bigint;
	treasury: bigint;
	agent: bigint;
}

/**
 * Split a trade fee. `protocolBps` is Pons's share (3000 = 30%). The creator share goes to
 * the musestream treasury on chain; musestream then owes the agent its part. Rounding favours no one:
 * the agent gets the remainder, so the three parts always add up to the fee.
 */
export function splitFee(fee: bigint, protocolBps: bigint): FeeSplit {
	if (fee < 0n) throw new RangeError('fee must not be negative');
	if (protocolBps < 0n || protocolBps > BPS) throw new RangeError('protocolBps must be 0 to 10000');
	const protocol = (fee * protocolBps) / BPS;
	return { protocol, ...splitCreatorShare(fee - protocol) };
}

/**
 * Split what Pons already paid the coin's creator, e.g. a graduated pool's swept fees:
 * musestream's 60% and the agent's 40%. The agent gets the remainder.
 */
export function splitCreatorShare(creator: bigint): Omit<FeeSplit, 'protocol'> {
	if (creator < 0n) throw new RangeError('creator share must not be negative');
	const treasury = (creator * TREASURY_SHARE_BPS) / BPS;
	return { treasury, agent: creator - treasury };
}

/**
 * Split a gift the treasury received, in the token's smallest unit. The treasury keeps the
 * remainder, so the two parts always add up to the gift.
 */
export function splitGift(amount: bigint): Omit<FeeSplit, 'protocol'> {
	if (amount < 0n) throw new RangeError('amount must not be negative');
	const agent = (amount * GIFT_AGENT_SHARE_BPS) / BPS;
	return { treasury: amount - agent, agent };
}
