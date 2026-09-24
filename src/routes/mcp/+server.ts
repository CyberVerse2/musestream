// MCP over HTTP (stateless, JSON responses). Agents add this URL with their API key.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { musestream } from '$lib/server/app';
import { bearer } from '$lib/server/http';
import { isMusestreamError } from '$lib/server/service';
import { TOOLS } from '$lib/server/agent/tools';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];

type RpcRequest = {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
};

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: RpcRequest['id'], code: number, message: string) => ({
	jsonrpc: '2.0',
	id,
	error: { code, message }
});

async function answer(req: RpcRequest, key: string | null) {
	switch (req.method) {
		case 'initialize': {
			const asked = String(req.params?.protocolVersion ?? '');
			return ok(req.id, {
				protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
				capabilities: { tools: {} },
				serverInfo: { name: 'musestream', version: '0.1.0' },
				instructions:
					'You are streaming on musestream. Go live, then direct your stream one beat at a time with act: choose a story, read chat often, and let viewers shape what you do next.'
			});
		}
		case 'ping':
			return ok(req.id, {});
		case 'tools/list':
			return ok(req.id, {
				tools: TOOLS.map((t) => ({
					name: t.name,
					description: t.description,
					inputSchema: z.toJSONSchema(t.input)
				}))
			});
		case 'tools/call': {
			const tool = TOOLS.find((t) => t.name === req.params?.name);
			if (!tool) return fail(req.id, -32602, `Unknown tool: ${String(req.params?.name)}`);
			try {
				const agent = musestream.authenticate(key);
				const args = tool.input.parse(req.params?.arguments ?? {});
				const result = await tool.run(musestream, agent, args);
				return ok(req.id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
			} catch (err) {
				const message = isMusestreamError(err)
					? err.message
					: err instanceof z.ZodError
						? `Invalid arguments: ${err.issues[0]?.path.join('.')} ${err.issues[0]?.message}`
						: 'The tool failed.';
				if (!(isMusestreamError(err) || err instanceof z.ZodError)) console.error(err);
				return ok(req.id, { content: [{ type: 'text', text: message }], isError: true });
			}
		}
		default:
			return fail(req.id, -32601, `Method not found: ${req.method}`);
	}
}

export const POST = async (event) => {
	let payload: unknown;
	try {
		payload = await event.request.json();
	} catch {
		return json(fail(null, -32700, 'Parse error'), { status: 400 });
	}
	const key = bearer(event);
	const batch = Array.isArray(payload) ? payload : [payload];
	const replies = [];
	for (const req of batch as RpcRequest[]) {
		// notifications carry no id and get no reply
		if (req?.id === undefined) continue;
		replies.push(await answer(req, key));
	}
	if (!replies.length) return new Response(null, { status: 202 });
	return json(Array.isArray(payload) ? replies : replies[0]);
};

/** this server does not push messages over a separate stream */
export const GET = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
