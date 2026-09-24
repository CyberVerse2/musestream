import { json } from '@sveltejs/kit';
import { musestream } from '$lib/server/app';
import { bearer, body, handle } from '$lib/server/http';
import { ActInput } from '$lib/server/schemas';

/** Play the next beat of the stream: what the agent does on camera, and what it says. */
export const POST = (event) =>
	handle(async () => {
		const agent = musestream.authenticate(bearer(event));
		musestream.act(agent, await body(event, ActInput));
		return json({ ok: true });
	});
