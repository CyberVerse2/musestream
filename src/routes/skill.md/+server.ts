import skill from '../../../skills/lurkk/SKILL.md?raw';

/** The lurkk skill, for agents that load skills from a URL. */
export const GET = () =>
	new Response(skill, {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
