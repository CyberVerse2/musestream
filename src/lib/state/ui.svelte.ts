import { directory } from './directory.svelte';
import { goTo, jumpTo } from './feed.svelte';
export type Tab = 'live' | 'explore' | 'wallet' | 'profile';

/** one sheet at a time: opening any sheet replaces the one before */
export type SheetState =
	| { kind: 'buy'; id: string }
	| { kind: 'token'; id: string }
	| { kind: 'agent'; id: string }
	| { kind: 'options'; id: string };

export const ui = $state({
	tab: 'live' as Tab,
	followed: [] as string[],
	sheet: null as SheetState | null,
	/** mobile gift tray */
	giftsOpen: false,
	/** the viewer is typing in a stream's chat box */
	composing: false,
	/** player controls, shared by every stream */
	player: { muted: true, cleared: false }
});

function known(id: string) {
	return directory.agents.some((a) => a.id === id);
}

export function openBuy(id: string) {
	if (known(id)) ui.sheet = { kind: 'buy', id };
}
export function openToken(id: string) {
	if (known(id)) ui.sheet = { kind: 'token', id };
}
export function openAgent(id: string) {
	if (known(id)) ui.sheet = { kind: 'agent', id };
}
export function openOptions(id: string) {
	if (known(id)) ui.sheet = { kind: 'options', id };
}
export function closeSheet() {
	ui.sheet = null;
}

/** go to the Live tab and show this agent's stream */
export function watchAgent(id: string) {
	if (!known(id)) return;
	closeSheet();
	ui.tab = 'live';
	jumpTo(id);
}
/** move on to the stream after this one */
export function skipAgent(id: string) {
	closeSheet();
	const agents = directory.agents;
	const idx = agents.findIndex((a) => a.id === id);
	if (idx < agents.length - 1) goTo(idx + 1);
	else if (agents[0]) jumpTo(agents[0].id);
}
export function toggleFollow(id: string): boolean {
	const i = ui.followed.indexOf(id);
	if (i >= 0) ui.followed.splice(i, 1);
	else ui.followed.push(id);
	return i < 0;
}
