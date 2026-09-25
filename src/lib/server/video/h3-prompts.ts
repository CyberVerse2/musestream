// Clip prompts for Reactor's H3 Reference model, which plays a queue of 5 to 15 second clips.
// Each clip names its references by position: the agent's avatar is Picture 1, the stream's
// scene picture comes after it, and the agent's voice sample is Audio 1.

export const MIN_CLIP_SECONDS = 5;
export const MAX_CLIP_SECONDS = 15;
/** speaking pace in the clips, used to fit a clip's length to its line */
const WORDS_PER_SECOND = 2.8;
/** the most words one clip can speak and still end on time */
const MAX_CLIP_WORDS = Math.floor((MAX_CLIP_SECONDS - 1) * WORDS_PER_SECOND);

export interface ClipCast {
	name: string;
	/** the reference pictures sent, in this order: the avatar, then the scene picture */
	avatarPicture: boolean;
	scenePicture: boolean;
	/** a voice sample is sent */
	voice: boolean;
}

export interface Clip {
	prompt: string;
	seconds: number;
}

function opening({ name, avatarPicture, scenePicture, voice }: ClipCast, scene: string): string {
	const scenePictureNo = avatarPicture ? 2 : 1;
	return [
		avatarPicture
			? `Subject 1 is ${name}, the character in Picture 1; keep their exact look, colors, and outfit.`
			: `Subject 1 is ${name}, the host.`,
		voice ? '<Audio 1> is the voice-timbre reference for <Subject 1> (S1).' : '',
		scenePicture
			? `The setting is the scene of Picture ${scenePictureNo}: ${scene}.`
			: `The setting: ${scene}.`,
		'Vertical live-stream shot, the host facing the camera.'
	]
		.filter(Boolean)
		.join(' ');
}

/** one beat of the agent's stream: what it does on camera, and what it says, if anything */
export interface Act {
	action: string;
	say?: string;
}

/** a silent beat that plays about this long */
const SILENT_SECONDS = 8;

/**
 * what plays between the agent's acts: it carries on with the last one, silent, or with none
 * yet, listens to chat
 */
export function idleClip(cast: ClipCast, scene: string, action?: string): Clip {
	const doing = action ? plain(action) : '';
	return {
		prompt:
			`${opening(cast, scene)} ` +
			(doing
				? `<Subject 1> (S1) carries on: ${doing}.`
				: '<Subject 1> (S1) listens to chat with small natural movements and gentle reactions.') +
			' Mouth closed, no speech.',
		seconds: 6
	};
}

/** text the model reads as plain words: no emoji, and none of its own tag characters */
function plain(text: string): string {
	return text
		.replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
		.replace(/<[^>]*>|\[[^\]]*\]/g, ' ')
		.replace(/[<>[\]]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** split a line into pieces short enough for one clip each, at sentence ends where possible */
function pieces(text: string): string[] {
	const sentences =
		text
			.match(/[^.!?]+[.!?]*/g)
			?.map((s) => s.trim())
			.filter(Boolean) ?? [];
	const out: string[] = [];
	let current: string[] = [];
	const flush = () => {
		if (current.length) out.push(current.join(' '));
		current = [];
	};
	for (const sentence of sentences) {
		const words = sentence.split(' ');
		if (current.length + words.length > MAX_CLIP_WORDS) flush();
		// a sentence too long for one clip is cut at the word limit
		while (words.length > MAX_CLIP_WORDS) out.push(words.splice(0, MAX_CLIP_WORDS).join(' '));
		current.push(...words);
	}
	flush();
	return out;
}

/** the clips that play an act, in order; a spoken line longer than one clip spans several */
export function actClips(cast: ClipCast, scene: string, act: Act): Clip[] {
	const action = plain(act.action).replace(/[.!?]+$/, '');
	const lines = act.say ? pieces(plain(act.say)) : [];
	if (!lines.length) {
		return [
			{
				prompt: `${opening(cast, scene)} What happens: ${action}. No speech.`,
				seconds: SILENT_SECONDS
			}
		];
	}
	return lines.map((line, i) => {
		const words = line.split(' ').length;
		// a second of lead-in and room to finish; a clip longer than its line fills the rest
		// with invented words
		const seconds = Math.min(
			MAX_CLIP_SECONDS,
			Math.max(MIN_CLIP_SECONDS, Math.ceil(words / WORDS_PER_SECOND + 1))
		);
		return {
			prompt:
				`${opening(cast, scene)} ${i === 0 ? 'What happens' : 'Still'}: ${action}. ` +
				`<Subject 1> (S1) says, <d>[English] ${line}</d> Then <Subject 1> (S1) hums softly along to ` +
				'the music with closed lips, no more words.',
			seconds
		};
	});
}

/**
 * one slice of a song the agent sings: the slice is the clip's reference audio, and H3 moves
 * the agent's lips in time with its vocals. `words` are the lyrics sung in the slice, if any.
 */
export function songClip(cast: ClipCast, scene: string, words: string, seconds: number): Clip {
	const sung = plain(words);
	return {
		prompt:
			`${opening({ ...cast, voice: false }, scene)} <Audio 1> is the song <Subject 1> (S1) sings. ` +
			(sung
				? '<Subject 1> (S1) sings it to the camera, lips exactly in time with the vocals of ' +
					`<Audio 1>, swaying to the music: <d>[English] ${sung}</d> `
				: '<Subject 1> (S1) sways and bobs along to the music of <Audio 1>, smiling, mouth ' +
					'closed between lines. ') +
			'The music of <Audio 1> plays.',
		seconds
	};
}
