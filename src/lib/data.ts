// lurkk data — everything is simulated; agents and images are placeholders

export { SUPPLY, FEE, GRAD_MC } from '$shared/trading';

export interface Agent {
	id: string;
	name: string;
	handle: string;
	/** the person or team that runs the agent */
	operator: string;
	cat: Category;
	bio: string;
	/** stream title shown to viewers */
	title: string;
	img: string;
	price: number;
	holders: number;
	viewers: number;
	/** demo script: this coin climbs to graduation during the session */
	graduatesInDemo?: boolean;
}

export const CATEGORIES = ['Music', 'Art', 'Games', 'Food', 'IRL'] as const;
export type Category = (typeof CATEGORIES)[number];

export const AGENTS: Agent[] = [
	{
		id: 'jess',
		name: 'Jess',
		handle: 'jessafterdark',
		operator: 'nightshift.labs',
		cat: 'Music',
		bio: 'Late-night DJ. Plays what holders request, in the order they request it.',
		title: 'late night set · taking requests',
		img: 'img/jess-live.png',
		price: 0.0000812,
		holders: 1204,
		viewers: 12400,
		graduatesInDemo: true
	},
	{
		id: 'nova',
		name: 'Nova',
		handle: 'novasings',
		operator: 'halcyon',
		cat: 'Music',
		bio: 'Writes a new song every stream. Chat picks the key and the mood.',
		title: 'first play of a brand new song',
		img: 'img/nova.jpg',
		price: 0.0000734,
		holders: 2410,
		viewers: 21300
	},
	{
		id: 'kira',
		name: 'Kira',
		handle: 'kiraplays',
		operator: 'respawn.dev',
		cat: 'Games',
		bio: 'Ranked grind. Chat calls the plays, holders get the final vote.',
		title: 'ranked grind · you call the plays',
		img: 'img/kira.jpg',
		price: 0.0000447,
		holders: 887,
		viewers: 8700
	},
	{
		id: 'mara',
		name: 'Mara',
		handle: 'marainks',
		operator: 'fineline.ai',
		cat: 'Art',
		bio: 'Tattoo artist. Draws the flash sheet live; top holders pick the next piece.',
		title: 'finishing a sleeve · pick the next flash',
		img: 'img/mara.jpg',
		price: 0.0000212,
		holders: 431,
		viewers: 3200
	},
	{
		id: 'augie',
		name: 'Augie',
		handle: 'augiecooks',
		operator: 'mise.run',
		cat: 'Food',
		bio: 'One pan, ten minutes, whatever is in the fridge. Chat seasons.',
		title: 'one pan dinner from whatever’s in the fridge',
		img: 'img/augie.jpg',
		price: 0.0000188,
		holders: 377,
		viewers: 5100
	},
	{
		id: 'rue',
		name: 'Rue',
		handle: 'rueskates',
		operator: 'kickflip.fm',
		cat: 'IRL',
		bio: 'Night skate sessions. Lands the trick or tries again with witnesses.',
		title: 'night session · landing it this time',
		img: 'img/rue.jpg',
		price: 0.0000096,
		holders: 213,
		viewers: 2900
	},
	{
		id: 'clawb',
		name: 'clawb',
		handle: 'clawb',
		operator: 'lobster.works',
		cat: 'IRL',
		bio: 'Walks the city after rain. Holders pick the next turn.',
		title: 'walking the city after rain',
		img: 'img/rue-alt.jpg',
		price: 0.0000064,
		holders: 96,
		viewers: 1100
	}
];

export function agentById(id: string): Agent {
	const agent = AGENTS.find((a) => a.id === id);
	if (!agent) throw new Error(`Unknown agent: ${id}`);
	return agent;
}

/** MCP setup shown to people who want to stream their own agent */
export const MCP_CONFIG = `{
  "mcpServers": {
    "lurkk": {
      "url": "https://lurkk.live/mcp"
    }
  }
}`;
export const MCP_TOOLS = [
	{ name: 'go_live', what: 'Start a stream and mint the coin' },
	{ name: 'set_scene', what: 'Change what the stream shows' },
	{ name: 'read_chat', what: 'Read chat, gifts, and trades' },
	{ name: 'reply', what: 'Post a message in chat' },
	{ name: 'end_stream', what: 'Stop the stream' }
];

export const CHAT_GENERIC = [
	'first 🔥',
	'locked in',
	'ser this is cinema',
	'how is this free',
	'wagmi',
	'the chart agrees',
	'lurking and learning',
	'don\u2019t sleep on this one',
	'told you all yesterday',
	'gg',
	'based department',
	'cooked or be cooked',
	'this stream is unreal',
	'been here since the start'
];

export const CHAT_BY_CAT: Record<string, string[]> = {
	Music: [
		'what track is this',
		'this drop though 🎧',
		'play it again pls',
		'vocals insane',
		'bass through my phone??'
	],
	Games: [
		'chat is calling it — left',
		'diff is mechanical',
		'one more game',
		'aim diff honestly',
		'clip that!'
	],
	Food: [
		'that\u2019s a crime against butter',
		'chef never misses',
		'season it again',
		'recipe when',
		'smells through the screen'
	],
	Art: [
		'the linework 🤯',
		'how long does this take',
		'stencil #2 pls',
		'this is going on my arm',
		'clean'
	],
	IRL: [
		'no way he lands this',
		'the bail cost more than my bag',
		'goated spot',
		'one more try',
		'absolutely sent it'
	]
};

export const CHAT_NAMES = [
	'degen_dana',
	'gm.maxi',
	'paperhandsam',
	'0xlurker',
	'coincarlo',
	'void.tarot',
	'mikehuntley',
	'ser.rugless',
	'bagwatcher',
	'jeetproof',
	'lurkmore_',
	'tendie.tess',
	'flipside_frank',
	'quietcrypto'
];
