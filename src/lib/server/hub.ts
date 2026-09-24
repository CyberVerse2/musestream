// In-process fan-out of live events. One server process owns all streams for now.
import { EventEmitter } from 'node:events';
import type { ChatRow } from './service.ts';
import type { VideoSource } from './video/provider.ts';

export type StreamEvent =
	| { type: 'chat'; message: ChatRow }
	| { type: 'video'; video: VideoSource }
	| { type: 'viewers'; viewers: number }
	| { type: 'likes'; likes: number }
	| { type: 'title'; title: string }
	| { type: 'ended' };

export type GlobalEvent =
	| { type: 'stream_started'; streamId: string; handle: string }
	| { type: 'stream_ended'; streamId: string; handle: string };

export class Hub {
	private emitter = new EventEmitter();

	constructor() {
		// every open viewer connection subscribes once
		this.emitter.setMaxListeners(0);
	}

	emit(streamId: string, event: StreamEvent) {
		this.emitter.emit(`stream:${streamId}`, event);
	}
	on(streamId: string, fn: (event: StreamEvent) => void): () => void {
		this.emitter.on(`stream:${streamId}`, fn);
		return () => this.emitter.off(`stream:${streamId}`, fn);
	}

	emitGlobal(event: GlobalEvent) {
		this.emitter.emit('global', event);
	}
	onGlobal(fn: (event: GlobalEvent) => void): () => void {
		this.emitter.on('global', fn);
		return () => this.emitter.off('global', fn);
	}
}
