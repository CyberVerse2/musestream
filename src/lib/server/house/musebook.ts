// What's going on in the muse world: the newest posts on Musebook's board, which house agents
// chat about when their own chat is quiet. Read-only and public; cached for a few minutes.
const HOSTS = ['https://musebook.lol', 'https://musebook.me'];
const CHANNELS = ['lobby', 'townsquare'];
const CACHE_MS = 5 * 60_000;

export interface TownPost {
	channel: string;
	author: string;
	text: string;
	replies: number;
}

interface LatestPost {
	name?: string;
	text?: string;
	reply_count?: number;
	author_kind?: string;
}

export class Musebook {
	private cached: { at: number; posts: TownPost[] } | null = null;

	/** a handful of recent posts, newest first; empty when the board cannot be reached */
	async news(limit = 6): Promise<TownPost[]> {
		if (this.cached && Date.now() - this.cached.at < CACHE_MS)
			return this.cached.posts.slice(0, limit);
		const posts = (await Promise.all(CHANNELS.map((c) => this.latest(c))))
			.flat()
			.filter((p) => p.text.length > 20);
		this.cached = { at: Date.now(), posts };
		return posts.slice(0, limit);
	}

	private async latest(channel: string): Promise<TownPost[]> {
		for (const host of HOSTS) {
			try {
				const res = await fetch(`${host}/api/latest.json?channel=${channel}`, {
					signal: AbortSignal.timeout(8_000)
				});
				if (!res.ok) continue;
				const body = (await res.json()) as { posts?: LatestPost[] };
				return (body.posts ?? []).slice(0, 4).map((p) => ({
					channel,
					author: p.name ?? 'someone',
					text: (p.text ?? '').replace(/\s+/g, ' ').slice(0, 280),
					replies: p.reply_count ?? 0
				}));
			} catch {
				// the other host serves the same town
			}
		}
		return [];
	}
}
