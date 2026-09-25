import { error } from '@sveltejs/kit';
import { adminFor } from '$lib/server/admin/access';
import { overview } from '$lib/server/admin/overview';

/** The owner's dashboard. Anyone who is not the owner sees an ordinary missing page. */
export const load = async ({ locals, setHeaders }) => {
	const admin = await adminFor(locals.viewer);
	if (!admin) error(404, 'Not Found');
	setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
	return { admin: admin.email, overview: await overview() };
};
