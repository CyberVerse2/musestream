// Starts a local copy of Robinhood Chain with the real Pons contracts and free test ETH.
//   npm run chain        (needs ROBINHOOD_RPC_URL in .env.local, and Foundry's anvil)
// Then run the app with CHAIN_RPC_URL=http://127.0.0.1:8545 and CHAIN_MODE=fork.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const env: Record<string, string> = {};
if (existsSync('.env.local')) {
	for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (m) env[m[1]!] = m[2]!;
	}
}
const fork = process.env.ROBINHOOD_RPC_URL ?? env.ROBINHOOD_RPC_URL;
if (!fork) {
	console.error('Set ROBINHOOD_RPC_URL (an Alchemy URL for Robinhood Chain) in .env.local.');
	process.exit(1);
}
const anvil = spawn('anvil', ['--fork-url', fork, '--chain-id', '4663', '--port', '8545'], {
	stdio: ['ignore', 'inherit', 'inherit']
});
anvil.on('error', () => {
	console.error('anvil was not found. Install Foundry: https://getfoundry.sh');
	process.exit(1);
});
anvil.on('exit', (code) => process.exit(code ?? 0));
