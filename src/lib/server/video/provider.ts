// Where stream video comes from. The app only sees a VideoSource.

/** a looping clip, or a live HLS playlist */
export type VideoSource = { kind: 'file'; url: string } | { kind: 'hls'; url: string };

export interface VideoProvider {
	readonly name: string;
	/** show `prompt` on this stream; resolves when viewers can see it */
	render(
		stream: { streamId: string; avatarUrl: string | null; handle: string },
		prompt: string
	): Promise<VideoSource>;
	/** stop all generation for this stream and release anything it holds */
	stop(streamId: string): Promise<void>;
	/** called when the provider changes a stream's video on its own, e.g. a paid session ended */
	onChange?(listener: (streamId: string, source: VideoSource) => void): void;
}
