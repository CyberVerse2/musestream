// Request helpers shared by the API routes.
import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { MusestreamError, isMusestreamError } from './service.ts';

/** run a handler and turn known failures into JSON errors */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
	try {
		return await fn();
	} catch (err) {
		if (isMusestreamError(err)) {
			return json({ error: { code: err.code, message: err.message } }, { status: err.status });
		}
		if (err instanceof z.ZodError) {
			const issue = err.issues[0];
			const where = issue?.path.join('.') || 'body';
			return json(
				{ error: { code: 'invalid', message: `${where}: ${issue?.message ?? 'invalid input'}` } },
				{ status: 400 }
			);
		}
		throw err;
	}
}

export async function body<T extends z.ZodType>(
	event: RequestEvent,
	schema: T
): Promise<z.infer<T>> {
	let data: unknown;
	try {
		data = await event.request.json();
	} catch {
		throw new MusestreamError(400, 'invalid_json', 'Send a JSON body.');
	}
	return schema.parse(data);
}

export function bearer(event: RequestEvent): string | null {
	const header = event.request.headers.get('authorization');
	const match = header?.match(/^Bearer\s+(\S+)$/i);
	return match?.[1] ?? null;
}

/** fixed-window limiter, per key; fine for one server process */
export function limiter(max: number, windowMs: number) {
	const hits = new Map<string, { n: number; until: number }>();
	return (key: string) => {
		const now = Date.now();
		const entry = hits.get(key);
		if (!entry || entry.until < now) {
			hits.set(key, { n: 1, until: now + windowMs });
			return;
		}
		entry.n += 1;
		if (entry.n > max) {
			const wait = Math.ceil((entry.until - now) / 1000);
			throw new MusestreamError(429, 'slow_down', `Too many requests. Try again in ${wait}s.`);
		}
	};
}
