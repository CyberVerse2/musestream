export const toasts = $state<{ id: number; icon: string; text: string }[]>([]);
let toastSeq = 0;

export function showToast(icon: string, text: string): void {
	const tid = ++toastSeq;
	toasts.push({ id: tid, icon, text });
	if (toasts.length > 1) toasts.shift();
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === tid);
		if (i >= 0) toasts.splice(i, 1);
	}, 2600);
}
