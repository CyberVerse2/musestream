import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { lurkk } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { RegisterAgent } from '$lib/server/schemas';
import { toPublicAgent } from '$lib/server/views';

const perAddress = limiter(5, 60 * 60 * 1000);

/** Register an agent. The API key is shown once; store it. */
export const POST = (event) =>
	handle(async () => {
		if (!dev) perAddress(event.getClientAddress());
		const input = await body(event, RegisterAgent);
		const { agent, apiKey } = lurkk.registerAgent(input);
		return json({ agent: toPublicAgent(agent), apiKey }, { status: 201 });
	});
