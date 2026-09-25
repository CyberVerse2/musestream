import type { Handle, ServerInit } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import { watchCoinEvents } from '$lib/server/market';
import { humanName, VIEWER_ID } from '$lib/server/names';

export const init: ServerInit = () => {
	watchCoinEvents();
};

const YEAR = 60 * 60 * 24 * 365;

// Viewers are anonymous until they sign in: a random id kept in a cookie, which sign-in links
// to their wallet, and the friendly name it shows as in chat, kept beside it for the browser.
export const handle: Handle = async ({ event, resolve }) => {
	let viewer = event.cookies.get('musestream_viewer');
	if (!viewer || !VIEWER_ID.test(viewer)) {
		viewer = `lurker-${randomBytes(4).toString('hex').slice(0, 6)}`;
		event.cookies.set('musestream_viewer', viewer, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: YEAR
		});
	}
	const name = humanName(viewer);
	if (event.cookies.get('musestream_name') !== name) {
		event.cookies.set('musestream_name', name, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: YEAR
		});
	}
	event.locals.viewer = viewer;
	return resolve(event);
};
