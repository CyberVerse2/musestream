// Fixed clips for chosen agents: their stream loops one saved video, with its sound, and never
// starts generation. Every other agent goes to the inner provider.
import type { Act } from './h3-prompts.ts';
import type { StreamInfo, VideoProvider, VideoSource } from './provider.ts';

export class ClipVideo implements VideoProvider {
	readonly name: string;
	private clips: Map<string, string>;
	private inner: VideoProvider;

	/** @param clips handle → public clip path, e.g. `love` → `/media/clips/love.mp4` */
	constructor(clips: Map<string, string>, inner: VideoProvider) {
		this.clips = clips;
		this.inner = inner;
		this.name = `clips+${inner.name}`;
	}

	private clip(stream: StreamInfo): string | undefined {
		return this.clips.get(stream.handle.toLowerCase());
	}

	async render(stream: StreamInfo, prompt: string): Promise<VideoSource> {
		const url = this.clip(stream);
		return url ? { kind: 'file', url } : this.inner.render(stream, prompt);
	}

	act(stream: StreamInfo, scene: string, act: Act): boolean {
		return !this.clip(stream) && (this.inner.act?.(stream, scene, act) ?? false);
	}

	stop(streamId: string): Promise<void> {
		return this.inner.stop(streamId);
	}

	watchers(stream: StreamInfo, scene: string, count: number): void {
		if (!this.clip(stream)) this.inner.watchers?.(stream, scene, count);
	}

	onChange(listener: (streamId: string, source: VideoSource) => void): void {
		this.inner.onChange?.(listener);
	}
}
