import type { Agent } from '../data';
import { directory } from './directory.svelte';

/** which stream the Live feed shows. `instant` skips the swipe motion for long jumps. */
export const feed = $state({ idx: 0, instant: false });

export function lastIdx(): number {
	return Math.max(0, directory.agents.length - 1);
}

/** the stream on screen, or undefined when nobody is live */
export function currentAgent(): Agent | undefined {
	return directory.agents[Math.min(feed.idx, lastIdx())];
}

/** move to a stream with the normal swipe motion */
export function goTo(idx: number) {
	feed.instant = false;
	feed.idx = Math.max(0, Math.min(lastIdx(), idx));
}
export function next() {
	goTo(feed.idx + 1);
}
export function prev() {
	goTo(feed.idx - 1);
}

/** land on an agent's stream directly, without flying through the ones between */
export function jumpTo(id: string) {
	const idx = directory.agents.findIndex((a) => a.id === id);
	if (idx < 0) return;
	feed.instant = true;
	feed.idx = idx;
	requestAnimationFrame(() => requestAnimationFrame(() => (feed.instant = false)));
}
