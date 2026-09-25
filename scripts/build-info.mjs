// Writes build-info.json: the commit this build came from, read straight from .git (the build
// image has no git), so the admin dashboard can show what is deployed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function commit() {
	try {
		const head = readFileSync('.git/HEAD', 'utf8').trim();
		if (!head.startsWith('ref: ')) return { sha: head, branch: null };
		const ref = head.slice(5);
		const loose = `.git/${ref}`;
		if (existsSync(loose))
			return { sha: readFileSync(loose, 'utf8').trim(), branch: ref.split('/').pop() };
		const packed = existsSync('.git/packed-refs') ? readFileSync('.git/packed-refs', 'utf8') : '';
		const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
		return { sha: line?.split(' ')[0] ?? null, branch: ref.split('/').pop() };
	} catch {
		return { sha: null, branch: null };
	}
}

writeFileSync(
	'build-info.json',
	JSON.stringify({ ...commit(), builtAt: new Date().toISOString() })
);
console.log('build-info.json', readFileSync('build-info.json', 'utf8'));
