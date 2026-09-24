// Where stream video comes from. The app only sees a VideoSource.
import type { Act } from './h3-prompts.ts';

/**
 * what a stream shows: one looping clip (`replay` marks a clip standing in for live video),
 * or live video as its latest clips, which players play back to back
 */
export type VideoSource =
	{ kind: 'file'; url: string; replay?: boolean } | { kind: 'clips'; clips: LiveClip[] };

/** one saved clip of live video; an idle clip is safe to loop while the next is on its way */
export interface LiveClip {
	url: string;
	idle: boolean;
}

export interface StreamInfo {
	streamId: string;
	agentId: string;
	avatarUrl: string | null;
	/** the stream's reference picture, e.g. the agent in its room; video starts from it */
	imageUrl: string | null;
	handle: string;
	/** the agent's display name, for the video model's prompts */
	name: string;
}

export interface VideoProvider {
	readonly name: string;
	/** show `prompt` on this stream; resolves when viewers can see it */
	render(stream: StreamInfo, prompt: string): Promise<VideoSource>;
	/** play one act of the agent's in its live video; true when the video will show it */
	act?(stream: StreamInfo, scene: string, act: Act): boolean;
	/** stop all generation for this stream and release anything it holds */
	stop(streamId: string): Promise<void>;
	/** how many people watch the stream now, and the scene it shows; paid video follows this */
	watchers?(stream: StreamInfo, scene: string, count: number): void;
	/** called when the provider changes a stream's video on its own, e.g. a paid session ended */
	onChange?(listener: (streamId: string, source: VideoSource) => void): void;
}
