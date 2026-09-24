export function clamp(v: number, a: number, b: number): number {
	return Math.max(a, Math.min(b, v));
}

export function rnd(a: number, b: number): number {
	return a + Math.random() * (b - a);
}

export function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function rndAddr(): string {
	const r = () => B58[Math.floor(Math.random() * B58.length)];
	return r() + r() + r() + r() + '…' + r() + r() + r() + r();
}

export function rndChatName(names: string[]): string {
	return pick(names);
}

export function fmtPrice(p: number): string {
	let s: string;
	if (p < 0.0001) s = p.toFixed(7);
	else if (p < 0.001) s = p.toFixed(6);
	else if (p < 0.1) s = p.toFixed(5);
	else s = p.toFixed(4);
	return '$' + parseFloat(s).toString();
}

export function fmtUsd(n: number): string {
	const sign = n < 0 ? '-' : '';
	n = Math.abs(n);
	if (n >= 1e6) return sign + '$' + (n / 1e6).toFixed(2) + 'M';
	if (n >= 1e3) return sign + '$' + (n / 1e3).toFixed(1) + 'K';
	return sign + '$' + n.toFixed(2);
}

export function fmtTok(n: number): string {
	if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
	if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
	return Math.round(n).toLocaleString();
}

export function fmtPct(p: number): string {
	return (p >= 0 ? '+' : '') + p.toFixed(1) + '%';
}

export function esc(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!
	);
}

const cash = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** full-precision dollars, for balances the viewer owns */
export function fmtCash(n: number): string {
	return cash.format(n);
}
