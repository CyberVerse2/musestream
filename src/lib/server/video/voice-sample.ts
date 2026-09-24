// A short recording of an agent's voice. The video model hears it as the host's voice
// reference, so the agent sounds the same in every clip. Made once per agent with Fish Audio,
// then kept on disk.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FISH_TTS = 'https://api.fish.audio/v1/tts';

export class VoiceSamples {
	private apiKey: string;
	private voiceId: string;
	private dir: string;

	/** @param voiceId the Fish Audio voice every agent's sample is spoken in */
	constructor(apiKey: string, voiceId: string, mediaDir: string) {
		this.apiKey = apiKey;
		this.voiceId = voiceId;
		this.dir = join(mediaDir, 'voice-samples');
	}

	/** the agent's voice sample on disk, or null when it cannot be made */
	async sample(agentId: string, name: string): Promise<string | null> {
		const file = join(this.dir, `${agentId}-${this.voiceId}.wav`);
		if (existsSync(file)) return file;
		try {
			const res = await fetch(FISH_TTS, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					'Content-Type': 'application/json',
					model: 's2-pro'
				},
				body: JSON.stringify({
					text:
						`Hi, I'm ${name}. Thanks for hanging out with me on my stream tonight. ` +
						'Tell me what you want to hear, and we can chat for a while.',
					reference_id: this.voiceId,
					format: 'wav'
				}),
				signal: AbortSignal.timeout(30_000)
			});
			if (!res.ok) {
				console.error(`voice sample failed (${res.status})`);
				return null;
			}
			mkdirSync(this.dir, { recursive: true });
			writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
			renameSync(`${file}.part`, file);
			return file;
		} catch (err) {
			console.error('voice sample failed:', err);
			return null;
		}
	}
}
