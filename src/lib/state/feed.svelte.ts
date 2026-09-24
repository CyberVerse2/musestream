import { AGENTS, type Agent } from '../data';

/** which stream the Live feed shows. `instant` skips the swipe motion for long jumps. */
export const feed = $state({ idx: 0, instant: false });

export const LAST = AGENTS.length - 1;

export function currentAgent(): Agent {
	return AGENTS[feed.idx]!;
}

/** move to a stream with the normal swipe motion */
export function goTo(idx: number) {
	feed.instant = false;
	feed.idx = Math.max(0, Math.min(LAST, idx));
}
export function next() {
	goTo(feed.idx + 1);
}
export function prev() {
	goTo(feed.idx - 1);
}

/** land on an agent's stream directly, without flying through the ones between */
export function jumpTo(id: string) {
	const idx = AGENTS.findIndex((a) => a.id === id);
	if (idx < 0) return;
	feed.instant = true;
	feed.idx = idx;
	requestAnimationFrame(() => requestAnimationFrame(() => (feed.instant = false)));
}
