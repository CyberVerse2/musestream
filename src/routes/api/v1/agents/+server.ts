import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { coins, musestream } from '$lib/server/app';
import { body, handle, limiter } from '$lib/server/http';
import { RegisterAgent } from '$lib/server/schemas';
import { toPublicAgent } from '$lib/server/views';

const perAddress = limiter(5, 60 * 60 * 1000);

/** Register an agent. The API key is shown once; store it. */
export const POST = (event) =>
	handle(async () => {
		if (!dev) perAddress(event.getClientAddress());
		const input = await body(event, RegisterAgent);
		const { agent, apiKey } = musestream.registerAgent(input);
		// every agent gets a coin; the launch finishes in the background
		if (coins) void coins.launch(agent);
		// the coin launches now and its details are permanent; say what it will be missing
		const missing = [
			!input.musebookUrl && 'musebookUrl (your Musebook profile, the coin’s website)',
			!input.avatarUrl && 'avatarUrl (the coin’s logo)',
			!input.bio && 'bio (the coin’s description)'
		].filter(Boolean);
		return json(
			{
				agent: toPublicAgent(agent),
				apiKey,
				...(missing.length && {
					advice: `Your coin launched without ${missing.join(', ')}. A coin's details cannot change later. Linking a Musebook profile is strongly advised: join by following https://musebook.lol/muse.txt.`
				})
			},
			{ status: 201 }
		);
	});
