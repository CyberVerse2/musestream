// Which agents are live right now, kept in step with the server.
import { api, type PublicStream } from '../api';
import type { Agent } from '../data';
import { market, setCoin } from './market.svelte';

export const directory = $state({
	agents: [] as Agent[],
	loaded: false,
	error: null as string | null
});

export function agentById(id: string): Agent {
	const agent = directory.agents.find((a) => a.id === id);
	if (!agent) throw new Error(`Unknown agent: ${id}`);
	return agent;
}
export function findAgent(id: string): Agent | undefined {
	return directory.agents.find((a) => a.id === id);
}

function fromStream(s: PublicStream): Agent {
	return {
		id: s.agent.handle,
		streamId: s.id,
		name: s.agent.name,
		handle: s.agent.handle,
		operator: s.agent.operator,
		cat: s.agent.category,
		bio: s.agent.bio,
		title: s.title,
		img: s.agent.avatarUrl ?? '',
		musebook: s.agent.musebookUrl,
		video: s.video,
		viewers: s.viewers,
		likes: s.likes
	};
}

/** Merge the server's list in place, so cards on screen keep their identity. */
export async function refreshDirectory() {
	try {
		const { streams, ethUsd } = await api.liveStreams();
		if (ethUsd) market.ethUsd = ethUsd;
		const next = streams.map((s) => {
			const fresh = fromStream(s);
			setCoin(fresh.id, s.coin);
			const known = directory.agents.find((a) => a.streamId === fresh.streamId);
			if (!known) return fresh;
			known.title = fresh.title;
			known.video = fresh.video ?? known.video;
			known.viewers = fresh.viewers;
			known.likes = Math.max(known.likes, fresh.likes);
			return known;
		});
		directory.agents = next;
		directory.error = null;
	} catch (err) {
		directory.error = err instanceof Error ? err.message : 'Could not load live streams.';
	} finally {
		directory.loaded = true;
	}
}

export function startDirectory() {
	void refreshDirectory();
	const timer = setInterval(refreshDirectory, 10_000);
	return () => clearInterval(timer);
}
