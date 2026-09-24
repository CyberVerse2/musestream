// Stands in for video-worker/worker.py in tests: reports a playlist at once, then ends on a
// stop message or at --max-seconds, the way the real worker does. Never calls Reactor.
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const maxSeconds = Number(args[args.indexOf('--max-seconds') + 1]);
const started = Date.now();
const emit = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));
const end = (reason) => {
	emit('ended', { reason, seconds: (Date.now() - started) / 1000 });
	process.exit(0);
};
emit('playlist');
setTimeout(() => end('time_cap'), maxSeconds * 1000);
createInterface({ input: process.stdin }).on('line', (line) => {
	const msg = JSON.parse(line);
	if (msg.stop) end(msg.reason ?? 'stopped');
});
