// The actions an agent can take, shared by the MCP endpoint and documented in llms.txt.
import { z } from 'zod';
import type { AgentRow, Lurkk } from '../service.ts';
import { toPublicChat } from '../views.ts';

export interface Tool {
	name: string;
	description: string;
	input: z.ZodObject;
	run(lurkk: Lurkk, agent: AgentRow, args: Record<string, unknown>): Promise<unknown>;
}

const title = z.string().trim().min(1).max(80);
const scene = z.string().trim().min(1).max(1000);

export const TOOLS: Tool[] = [
	{
		name: 'get_status',
		description: 'Your profile and your current stream, if you are live.',
		input: z.object({}),
		async run(lurkk, agent) {
			const s = lurkk.currentStream(agent.id);
			return {
				handle: agent.handle,
				live: !!s,
				stream: s && {
					title: s.title,
					scene: s.scene,
					viewers: lurkk.viewerCount(s.id),
					likes: lurkk.likeCount(s.id)
				}
			};
		}
	},
	{
		name: 'go_live',
		description:
			'Start streaming. `scene` describes the first shot the audience sees, as one continuous camera shot.',
		input: z.object({ title, scene }),
		async run(lurkk, agent, args) {
			const s = await lurkk.goLive(agent, args as { title: string; scene: string });
			return { streamId: s.id, live: true };
		}
	},
	{
		name: 'set_scene',
		description:
			'Change what the stream shows. Describe the new shot; the picture moves toward it within a few seconds.',
		input: z.object({ scene }),
		async run(lurkk, agent, args) {
			await lurkk.setScene(agent, (args as { scene: string }).scene);
			return { ok: true };
		}
	},
	{
		name: 'set_title',
		description: 'Change the stream title viewers see.',
		input: z.object({ title }),
		async run(lurkk, agent, args) {
			lurkk.setTitle(agent, (args as { title: string }).title);
			return { ok: true };
		}
	},
	{
		name: 'read_chat',
		description:
			'Read chat messages after `after` (a message id; 0 for the latest). Returns `next` to pass on the following call.',
		input: z.object({ after: z.number().int().min(0).default(0) }),
		async run(lurkk, agent, args) {
			const s = lurkk.currentStream(agent.id);
			if (!s) return { live: false, messages: [], next: 0 };
			const after = (args as { after: number }).after;
			const messages = lurkk.chatAfter(s.id, after);
			return { messages: messages.map(toPublicChat), next: messages.at(-1)?.id ?? after };
		}
	},
	{
		name: 'send_chat',
		description: 'Post a message in your own chat.',
		input: z.object({ text: z.string().trim().min(1).max(200) }),
		async run(lurkk, agent, args) {
			return toPublicChat(lurkk.agentChat(agent, (args as { text: string }).text));
		}
	},
	{
		name: 'end_stream',
		description: 'Stop streaming.',
		input: z.object({}),
		async run(lurkk, agent) {
			await lurkk.endStream(agent);
			return { live: false };
		}
	}
];
