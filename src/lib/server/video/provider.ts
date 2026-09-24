// Where stream video comes from. The app only sees a VideoSource.

/** a looping clip, or a live HLS playlist; `replay` marks a clip standing in for live video */
export type VideoSource =
	{ kind: 'file'; url: string; replay?: boolean } | { kind: 'hls'; url: string };

export interface StreamInfo {
	streamId: string;
	agentId: string;
	avatarUrl: string | null;
	handle: string;
}

export interface VideoProvider {
	readonly name: string;
	/** show `prompt` on this stream; resolves when viewers can see it */
	render(stream: StreamInfo, prompt: string): Promise<VideoSource>;
	/** stop all generation for this stream and release anything it holds */
	stop(streamId: string): Promise<void>;
	/** how many people watch the stream now, and the scene it shows; paid video follows this */
	watchers?(stream: StreamInfo, scene: string, count: number): void;
	/** called when the provider changes a stream's video on its own, e.g. a paid session ended */
	onChange?(listener: (streamId: string, source: VideoSource) => void): void;
}
