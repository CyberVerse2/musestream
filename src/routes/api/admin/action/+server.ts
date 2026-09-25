import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin/access';
import { AdminAction, runAction } from '$lib/server/admin/actions';
import { body, handle } from '$lib/server/http';

/** Run one owner action from the dashboard. */
export const POST = (event) =>
	handle(async () => {
		const admin = await requireAdmin(event.locals.viewer);
		const action = await body(event, AdminAction);
		const result = await runAction(admin, action);
		return json(result, {
			headers: { 'cache-control': 'no-store' }
		});
	});
