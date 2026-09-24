// Stands in for video-worker/worker.py in tests: reports one saved idle clip at once, then ends on a
// stop message or at --max-seconds, the way the real worker does. Never calls Reactor.
// With FAKE_WORKER_LOG set, it appends its arguments and every message it gets to that file.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const maxSeconds = Number(args[args.indexOf('--max-seconds') + 1]);
const started = Date.now();
const log = (entry) =>
	process.env.FAKE_WORKER_LOG &&
	appendFileSync(process.env.FAKE_WORKER_LOG, JSON.stringify(entry) + '\n');
log({ args });
const emit = (event, extra = {}) => console.log(JSON.stringify({ event, ...extra }));
const end = (reason) => {
	emit('ended', { reason, seconds: (Date.now() - started) / 1000 });
	process.exit(0);
};
emit('clip', { file: '00001-idle.mp4', kind: 'idle' });
setTimeout(() => end('time_cap'), maxSeconds * 1000);
createInterface({ input: process.stdin }).on('line', (line) => {
	const msg = JSON.parse(line);
	log(msg);
	if (msg.stop) end(msg.reason ?? 'stopped');
});
