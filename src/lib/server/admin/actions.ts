// What the owner can do from the admin dashboard. Each action is checked, recorded in the audit
// log, and applies at once; video switches and the site switch are also saved for restarts.
import { isAddress, type Address } from 'viem';
import { z } from 'zod';
import { coins, musestream, runSettlement, settings, video } from '../app.ts';
import { MusestreamError } from '../service.ts';
import { audit, type Admin } from './access.ts';

const handle = z.string().trim().toLowerCase().min(1).max(32);
const id = z.string().min(1).max(64);

export const AdminAction = z.discriminatedUnion('action', [
	z.object({ action: z.literal('settle_now') }),
	z.object({ action: z.literal('end_stream'), agentId: id }),
	z.object({ action: z.literal('suspend'), agentId: id }),
	z.object({ action: z.literal('unsuspend'), agentId: id }),
	z.object({ action: z.literal('rotate_key'), agentId: id }),
	z.object({ action: z.literal('live_video'), handle, on: z.boolean() }),
	z.object({ action: z.literal('clip'), handle, on: z.boolean() }),
	z.object({ action: z.literal('video_pause'), on: z.boolean() }),
	z.object({ action: z.literal('hide_message'), messageId: z.number().int().positive() }),
	z.object({ action: z.literal('mute'), viewer: id }),
	z.object({ action: z.literal('unmute'), viewer: id }),
	z.object({ action: z.literal('site_open'), open: z.boolean() }),
	z.object({
		action: z.literal('withdraw'),
		to: z.string().refine((v) => isAddress(v), 'Enter a valid wallet address (0x…).'),
		assets: z.array(z.enum(['META', 'USDG', 'ETH'])).min(1),
		/** withdraw from this agent's wallet instead of the treasury */
		agentId: id.optional()
	})
]);
export type AdminAction = z.infer<typeof AdminAction>;

export async function runAction(admin: Admin, a: AdminAction): Promise<unknown> {
	switch (a.action) {
		case 'settle_now': {
			const result = await runSettlement('admin');
			audit(admin, a.action, null, {
				fees: result.fees.length,
				gifts: result.gifts.length,
				failed: result.failed
			});
			return result;
		}
		case 'end_stream':
			await musestream.endStreamFor(a.agentId);
			audit(admin, a.action, a.agentId);
			return { ok: true };
		case 'suspend':
			await musestream.suspendAgent(a.agentId);
			audit(admin, a.action, a.agentId);
			return { ok: true };
		case 'unsuspend':
			musestream.unsuspendAgent(a.agentId);
			audit(admin, a.action, a.agentId);
			return { ok: true };
		case 'rotate_key': {
			const apiKey = musestream.rotateKey(a.agentId);
			// the key itself is never recorded
			audit(admin, a.action, a.agentId);
			return { apiKey };
		}
		case 'live_video': {
			if (!video.reactor)
				throw new MusestreamError(409, 'no_reactor', 'Paid video is not set up on this server.');
			video.reactor.allowAgent(a.handle, a.on);
			settings.set('liveVideoAgents', video.reactor.status().agents);
			audit(admin, a.action, a.handle, { on: a.on });
			return { ok: true };
		}
		case 'clip': {
			if (!video.clips)
				throw new MusestreamError(409, 'no_clips', 'No saved clips are set up on this server.');
			video.clips.setClipOn(a.handle, a.on);
			const off = new Set(settings.get('clipsOff'));
			if (a.on) off.delete(a.handle);
			else off.add(a.handle);
			settings.set('clipsOff', [...off]);
			audit(admin, a.action, a.handle, { on: a.on });
			return { ok: true };
		}
		case 'video_pause':
			video.reactor?.setPaused(a.on);
			settings.set('videoPaused', a.on);
			audit(admin, a.action, null, { on: a.on });
			return { ok: true };
		case 'hide_message':
			musestream.hideMessage(a.messageId);
			audit(admin, a.action, String(a.messageId));
			return { ok: true };
		case 'mute':
			musestream.muteViewer(a.viewer);
			audit(admin, a.action, a.viewer);
			return { ok: true };
		case 'unmute':
			musestream.unmuteViewer(a.viewer);
			audit(admin, a.action, a.viewer);
			return { ok: true };
		case 'site_open':
			settings.set('siteOpen', a.open);
			audit(admin, a.action, null, { open: a.open });
			return { ok: true };
		case 'withdraw': {
			if (!coins)
				throw new MusestreamError(409, 'no_chain', 'No chain is configured on this server.');
			const result = a.agentId
				? await coins.withdrawAgent(a.agentId, a.to as Address, a.assets)
				: await coins.withdrawTreasury(a.to as Address, a.assets);
			audit(admin, a.action, a.to, {
				from: a.agentId ?? 'treasury',
				collected: result.collected,
				sent: result.sent,
				failed: result.failed
			});
			return result;
		}
	}
}
