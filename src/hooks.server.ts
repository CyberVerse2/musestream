import type { Handle } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';

// Viewers are anonymous until wallets arrive: a random name kept in a cookie.
export const handle: Handle = async ({ event, resolve }) => {
	let viewer = event.cookies.get('lurkk_viewer');
	if (!viewer || !/^lurker-[a-z0-9]{6}$/.test(viewer)) {
		viewer = `lurker-${randomBytes(4).toString('hex').slice(0, 6)}`;
		event.cookies.set('lurkk_viewer', viewer, {
			path: '/',
			httpOnly: false,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
	}
	event.locals.viewer = viewer;
	return resolve(event);
};
