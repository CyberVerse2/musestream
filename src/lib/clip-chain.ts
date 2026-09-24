// Live video as a chain of saved clips, played back to back so it looks like one stream.
import type { LiveClip } from './api';

export interface ChainParams {
	clips: LiveClip[];
	muted: boolean;
	playing: boolean;
}

/**
 * Plays live clips back to back with two video elements: one shows the current clip while
 * the other loads the next, and they swap the moment a clip ends. When no new clip is
 * ready, the last idle clip loops, so the picture never stops. A viewer who joins late
 * starts from the newest clip.
 */
export function chain(node: HTMLDivElement, initial: ChainParams) {
	let params = initial;
	const slots = [0, 1].map(() => {
		const v = document.createElement('video');
		v.playsInline = true;
		v.preload = 'auto';
		node.appendChild(v);
		return v;
	});
	let active = 0;
	let started = false;
	const queue: string[] = [];
	let lastIdle: string | null = null;
	const seen = new Set<string>();
	const idle = new Map<string, boolean>();

	const current = () => slots[active]!;
	const spare = () => slots[1 - active]!;
	const load = (v: HTMLVideoElement, url: string) => {
		if (v.dataset.url === url) return;
		v.dataset.url = url;
		v.src = url;
		v.load();
	};
	const start = (v: HTMLVideoElement) => {
		v.muted = params.muted;
		if (params.playing) void v.play().catch(() => {});
	};
	const show = () => slots.forEach((v, i) => v.classList.toggle('on', i === active));
	const played = (url: string) => {
		if (idle.get(url)) lastIdle = url;
	};
	/** load what comes next into the hidden player, so the swap is instant */
	const prepare = () => {
		const next = queue[0] ?? lastIdle;
		if (next && next !== current().dataset.url) load(spare(), next);
	};

	function advance() {
		const next = queue.shift() ?? lastIdle;
		if (!next) return;
		if (next === current().dataset.url) {
			current().currentTime = 0;
		} else {
			load(spare(), next);
			active = 1 - active;
			current().currentTime = 0;
			spare().pause();
			show();
		}
		start(current());
		played(next);
		prepare();
	}

	function take(clips: LiveClip[]) {
		for (const c of clips) idle.set(c.url, c.idle);
		const fresh = clips.filter((c) => !seen.has(c.url));
		for (const c of fresh) seen.add(c.url);
		if (!started) {
			const newest = clips.at(-1);
			if (!newest) return;
			started = true;
			lastIdle = clips.findLast((c) => c.idle)?.url ?? null;
			load(current(), newest.url);
			start(current());
			show();
			prepare();
			return;
		}
		queue.push(...fresh.map((c) => c.url));
		prepare();
	}

	for (const v of slots) v.addEventListener('ended', () => v === current() && advance());
	take(params.clips);

	return {
		update(next: ChainParams) {
			params = next;
			for (const v of slots) v.muted = params.muted;
			if (params.playing) start(current());
			else current().pause();
			take(params.clips);
		},
		destroy() {
			for (const v of slots) {
				v.pause();
				v.removeAttribute('src');
				v.load();
			}
		}
	};
}
