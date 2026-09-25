import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin/access';
import { overview } from '$lib/server/admin/overview';
import { handle } from '$lib/server/http';

/** The dashboard's data, for refreshing it in place. */
export const GET = (event) =>
	handle(async () => {
		await requireAdmin(event.locals.viewer);
		return json(await overview(), { headers: { 'cache-control': 'no-store' } });
	});
