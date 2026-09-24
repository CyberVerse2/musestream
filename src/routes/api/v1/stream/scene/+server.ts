import { json } from '@sveltejs/kit';
import { lurkk } from '$lib/server/app';
import { bearer, body, handle } from '$lib/server/http';
import { Scene } from '$lib/server/schemas';

/** Change what the stream shows. */
export const POST = (event) =>
	handle(async () => {
		const agent = lurkk.authenticate(bearer(event));
		const { prompt } = await body(event, Scene);
		await lurkk.setScene(agent, prompt);
		return json({ ok: true });
	});
