import { account } from './account.svelte';
import { directory } from './directory.svelte';
import { goTo, jumpTo } from './feed.svelte';
export type Tab = 'live' | 'explore' | 'wallet' | 'golive';

/** one sheet at a time: opening any sheet replaces the one before */
export type SheetState =
	| { kind: 'buy'; id: string }
	| { kind: 'token'; id: string }
	| { kind: 'agent'; id: string }
	| { kind: 'options'; id: string }
	| { kind: 'signin'; reason?: string; after?: SheetState }
	| { kind: 'receive'; after?: SheetState };

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

/** true when spending money needs a signed-in wallet the viewer does not have yet */
export function needsSignIn(): boolean {
	const config = account.config;
	return !!config && !config.testMoney && !!config.dynamicEnvironmentId && !account.signedInAs;
}

export function openBuy(id: string) {
	if (!known(id)) return;
	const buy: SheetState = { kind: 'buy', id };
	if (needsSignIn()) askSignIn(`Sign in to buy $${id.toUpperCase()}.`, buy);
	else ui.sheet = buy;
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
export function openSignIn() {
	ui.sheet = { kind: 'signin' };
}
/** sign in first, saying why; `after` opens once the viewer is signed in */
export function askSignIn(reason: string, after?: SheetState) {
	ui.sheet = { kind: 'signin', reason, after };
}
export function openReceive() {
	ui.sheet = { kind: 'receive' };
}
/** go on to what the viewer was doing, e.g. the purchase that needed a sign-in, or close */
export function continueWith(after?: SheetState) {
	ui.sheet = after ?? null;
}

const AFTER_SIGN_IN = 'musestream.afterSignIn';
/** Google sign-in leaves the page, so what comes next is kept until the viewer is back */
export function rememberAfterSignIn(after?: SheetState) {
	try {
		if (after) sessionStorage.setItem(AFTER_SIGN_IN, JSON.stringify(after));
		else sessionStorage.removeItem(AFTER_SIGN_IN);
	} catch {
		// without storage the viewer simply lands back on the stream
	}
}
export function resumeAfterSignIn() {
	try {
		const saved = sessionStorage.getItem(AFTER_SIGN_IN);
		sessionStorage.removeItem(AFTER_SIGN_IN);
		if (saved) continueWith(JSON.parse(saved) as SheetState);
	} catch {
		// nothing saved, or storage is unavailable
	}
}

/** add money, then go on to `after`, e.g. the purchase that needed it */
export function addMoneyFor(after: SheetState) {
	ui.sheet = { kind: 'receive', after };
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
