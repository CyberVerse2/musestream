import { env } from '$env/dynamic/private';

/**
 * The launch countdown: `LAUNCH_AT` (an ISO time) turns it on for the hosts in
 * `LAUNCH_HOSTS`. It stays up past zero until `LAUNCH_AT` is removed.
 *
 * The host comes from the request's own headers: with `ORIGIN` set, `url` always names
 * the one origin, whichever domain the visitor used.
 */
export const load = ({ request }) => {
	const at = env.LAUNCH_AT ? Date.parse(env.LAUNCH_AT) : NaN;
	const hosts = (env.LAUNCH_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase());
	const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '')
		.split(',')[0]!
		.trim()
		.replace(/:\d+$/, '')
		.toLowerCase();
	if (Number.isNaN(at) || !hosts.includes(host)) return { launch: null };
	return { launch: { at } };
};
