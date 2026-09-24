import { AGENTS } from '../data';

/** like counts for each live room */
export const live = $state(
	Object.fromEntries(AGENTS.map((a) => [a.id, { likes: Math.round(a.viewers * 2.7) }]))
);

export function like(id: string) {
	const room = live[id];
	if (room) room.likes += 1;
}
