import { env } from '$env/dynamic/private';

/**
 * The launch countdown: `LAUNCH_AT` (an ISO time) turns it on for the hosts in
 * `LAUNCH_HOSTS`. It stays up past zero until `LAUNCH_AT` is removed.
 */
export const load = ({ url }) => {
	const at = env.LAUNCH_AT ? Date.parse(env.LAUNCH_AT) : NaN;
	const hosts = (env.LAUNCH_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase());
	if (Number.isNaN(at) || !hosts.includes(url.hostname.toLowerCase())) return { launch: null };
	return { launch: { at } };
};
