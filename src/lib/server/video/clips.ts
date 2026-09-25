// Fixed clips for chosen agents: their stream loops one saved video, with its sound, and never
// starts generation. Every other agent goes to the inner provider.
import type { Act } from './h3-prompts.ts';
import type { SongClip, StreamInfo, VideoProvider, VideoSource } from './provider.ts';

export class ClipVideo implements VideoProvider {
	readonly name: string;
	private clips: Map<string, string>;
	private inner: VideoProvider;
	/** agents whose clip the owner turned off: they get the inner provider's video */
	private off = new Set<string>();

	/** @param clips handle → public clip path, e.g. `nova` → `/media/clips/nova.mp4` */
	constructor(clips: Map<string, string>, inner: VideoProvider) {
		this.clips = clips;
		this.inner = inner;
		this.name = `clips+${inner.name}`;
	}

	private clip(stream: StreamInfo): string | undefined {
		const handle = stream.handle.toLowerCase();
		return this.off.has(handle) ? undefined : this.clips.get(handle);
	}

	/** turn an agent's saved clip on or off; it applies from the stream's next video */
	setClipOn(handle: string, on: boolean) {
		if (on) this.off.delete(handle.toLowerCase());
		else this.off.add(handle.toLowerCase());
	}

	/** every agent with a saved clip, and whether it plays */
	status(): { handle: string; url: string; on: boolean }[] {
		return [...this.clips].map(([handle, url]) => ({ handle, url, on: !this.off.has(handle) }));
	}

	async render(stream: StreamInfo, prompt: string): Promise<VideoSource> {
		const url = this.clip(stream);
		return url ? { kind: 'file', url } : this.inner.render(stream, prompt);
	}

	act(stream: StreamInfo, scene: string, act: Act): boolean {
		return !this.clip(stream) && (this.inner.act?.(stream, scene, act) ?? false);
	}

	perform(stream: StreamInfo, clips: SongClip[]): boolean {
		return !this.clip(stream) && (this.inner.perform?.(stream, clips) ?? false);
	}

	live(streamId: string): boolean {
		return this.inner.live?.(streamId) ?? false;
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
