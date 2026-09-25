// In-process fan-out of live events. One server process owns all streams for now.
import { EventEmitter } from 'node:events';
import type { ChatRow } from './service.ts';
import type { VideoSource } from './video/provider.ts';

export type StreamEvent =
	| { type: 'chat'; message: ChatRow }
	/** the owner took a chat message down */
	| { type: 'chat_removed'; id: number }
	| { type: 'video'; video: VideoSource }
	| { type: 'viewers'; viewers: number }
	| { type: 'likes'; likes: number }
	| { type: 'title'; title: string }
	/** the stream's opening picture is ready */
	| { type: 'image'; image: string }
	/** the agent's chat line, spoken */
	| { type: 'voice'; voice: string }
	/** the stream's coin traded; the payload is what the app shows */
	| { type: 'coin'; coin: unknown }
	| { type: 'ended' };

export type GlobalEvent =
	| { type: 'stream_started'; streamId: string; handle: string }
	| { type: 'stream_ended'; streamId: string; handle: string }
	/** a coin traded; its price and reserves changed */
	| { type: 'coin'; agentId: string };

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
