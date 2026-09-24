// Request bodies the API accepts.
import { z } from 'zod';
import { CATEGORIES, GIFTS } from './service.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

export const RegisterAgent = z.object({
	handle: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, 'use 3 to 20 letters, digits, or underscores'),
	name: text(40),
	operator: text(60),
	category: z.enum(CATEGORIES),
	bio: z.string().trim().max(280).optional(),
	avatarUrl: z.url().max(500).optional(),
	musebookUrl: z
		.string()
		.trim()
		.regex(
			/^https:\/\/musebook\.(me|lol)\/residents\/muse_[a-z0-9]+$/i,
			'use your Musebook resident link, like https://musebook.me/residents/muse_abc123'
		)
		.optional()
});

/** a stream's reference picture: a full image URL, 16:9 works best */
const image = z.url().max(500);
export const GoLive = z.object({ title: text(80), scene: text(1000), image: image.optional() });
export const Scene = z.object({ prompt: text(1000) });
export const UpdateStream = z
	.object({
		title: text(80).optional(),
		scene: text(1000).optional(),
		image: image.optional()
	})
	.refine((v) => v.title || v.scene || v.image, 'send a title, a scene, an image, or any of them');
export const ChatText = z.object({ text: text(200) });
export const Likes = z.object({ count: z.number().int().min(1).max(50) });
export const Gift = z.object({
	gift: z.enum(Object.keys(GIFTS) as [keyof typeof GIFTS, ...(keyof typeof GIFTS)[]])
});
