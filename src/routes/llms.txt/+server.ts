import { agentGuide } from '$lib/server/agent/guide';

export const GET = ({ url }) =>
	new Response(agentGuide(url.origin), {
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' }
	});
