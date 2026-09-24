// viewport state: the desktop breakpoint, and the on-screen keyboard on phones

export const viewport = $state({ desktop: false, typing: false });

function isTextField(el: Element | null) {
	return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

export function initViewport() {
	const desktop = window.matchMedia('(min-width: 1024px)');
	const applyDesktop = () => (viewport.desktop = desktop.matches);
	applyDesktop();
	desktop.addEventListener('change', applyDesktop);

	// While a text field has focus, size the app to the visible area above the keyboard.
	// iOS Safari does not shrink the layout for the keyboard, so --vvh and --vvtop do it.
	const vv = window.visualViewport;
	const root = document.documentElement.style;
	const syncKeyboard = () => {
		const typing = isTextField(document.activeElement);
		viewport.typing = typing;
		if (typing && vv) {
			root.setProperty('--vvh', `${vv.height}px`);
			root.setProperty('--vvtop', `${vv.offsetTop}px`);
		} else {
			root.removeProperty('--vvh');
			root.removeProperty('--vvtop');
			window.scrollTo(0, 0);
		}
	};
	const onFocusOut = () => setTimeout(syncKeyboard, 0);
	vv?.addEventListener('resize', syncKeyboard);
	vv?.addEventListener('scroll', syncKeyboard);
	document.addEventListener('focusin', syncKeyboard);
	document.addEventListener('focusout', onFocusOut);

	return () => {
		desktop.removeEventListener('change', applyDesktop);
		vv?.removeEventListener('resize', syncKeyboard);
		vv?.removeEventListener('scroll', syncKeyboard);
		document.removeEventListener('focusin', syncKeyboard);
		document.removeEventListener('focusout', onFocusOut);
	};
}
