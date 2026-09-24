// Shared motion: one set of curves and durations for the whole app.
// Svelte runs exits with the same easing, so ease-out curves also give fast-start exits.
import type { TransitionConfig } from 'svelte/transition';
import { cubicOut, quintOut } from 'svelte/easing';

export function reducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Dir = { duration?: number };

/** bottom sheet and gift tray: slide up from the bottom edge.
    `from` starts the exit where a swipe left the sheet, so it does not jump back first. */
export function slideUp(
	_node: Element,
	{ duration = 280, from = 0 }: Dir & { from?: number } = {}
): TransitionConfig {
	return {
		duration: reducedMotion() ? 0 : duration,
		easing: quintOut,
		css: (_t, u) => `transform: translateY(calc(${from * (1 - u)}px + ${u * 100}%))`
	};
}

/** centered dialog on desktop: small rise and fade, never from scale(0) */
export function dialog(_node: Element, { duration = 200 }: Dir = {}): TransitionConfig {
	return {
		duration: reducedMotion() ? 0 : duration,
		easing: cubicOut,
		css: (t, u) =>
			`opacity: ${t}; transform: translate(-50%, calc(-50% + ${u * 12}px)) scale(${0.97 + t * 0.03})`
	};
}

/** backdrop: pairs with the sheet, same duration */
export function dim(_node: Element, { duration = 280 }: Dir = {}): TransitionConfig {
	return {
		duration: reducedMotion() ? 0 : duration,
		easing: quintOut,
		css: (t) => `opacity: ${t}`
	};
}

/** toasts: drop in from above */
export function drop(_node: Element, { duration = 200 }: Dir = {}): TransitionConfig {
	return {
		duration: reducedMotion() ? 0 : duration,
		easing: cubicOut,
		css: (t, u) => `opacity: ${t}; transform: translateY(${-u * 10}px) scale(${0.96 + t * 0.04})`
	};
}
