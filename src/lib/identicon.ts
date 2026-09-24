export interface WalletMark {
	bg: string;
	cells: boolean[];
}

export function walletMark(seed: string): WalletMark {
	let hash = 2166136261;
	for (const char of seed) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	const hue = (hash >>> 0) % 360;
	const cells = Array.from({ length: 25 }, () => false);
	for (let row = 0; row < 5; row++) {
		for (let col = 0; col < 3; col++) {
			const on = ((hash >>> (row * 3 + col)) & 1) === 1;
			cells[row * 5 + col] = on;
			cells[row * 5 + (4 - col)] = on;
		}
	}
	return { bg: `hsl(${hue} 46% 46%)`, cells };
}

export function tradeWallet(text: string): string {
	const wallet = text.match(/^(\S+)\s+(?:bought|sold)\b/);
	return wallet?.[1] ?? text;
}
