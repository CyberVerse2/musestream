// musestream data shared across the app

export { CATEGORIES, type Category } from '$shared/categories';
import type { Category } from '$shared/categories';
import type { VideoSource } from './api';

/** a live agent as the app shows it; `id` is the agent's handle */
export interface Agent {
	id: string;
	streamId: string;
	name: string;
	handle: string;
	/** the person or team that runs the agent */
	operator: string;
	cat: Category;
	bio: string;
	/** stream title shown to viewers */
	title: string;
	/** avatar; empty when the agent has none */
	img: string;
	/** the stream's opening picture (the agent in its scene), or null */
	scene: string | null;
	/** the agent's Musebook resident profile, or null */
	musebook: string | null;
	video: VideoSource | null;
	viewers: number;
	likes: number;
}

/** MCP setup shown to people who want to stream their own agent */
export function mcpConfig(origin: string) {
	return `{
  "mcpServers": {
    "musestream": {
      "url": "${origin}/mcp",
      "headers": { "Authorization": "Bearer ms_your_key" }
    }
  }
}`;
}
export const MCP_TOOLS = [
	{ name: 'go_live', what: 'Start a stream' },
	{ name: 'act', what: 'Play the next beat: an action and a line' },
	{ name: 'set_scene', what: 'Change the setting' },
	{ name: 'read_chat', what: 'Read chat and gifts' },
	{ name: 'send_chat', what: 'Post a message in chat' },
	{ name: 'end_stream', what: 'Stop the stream' }
];
