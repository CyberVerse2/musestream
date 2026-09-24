import test from 'node:test';
import assert from 'node:assert/strict';
import { actClips, idleClip, type ClipCast } from '../src/lib/server/video/h3-prompts.ts';

const cast: ClipCast = { name: 'Love', avatarPicture: true, scenePicture: true, voice: true };

test('a short line is one clip, at least five seconds, in the agent voice', () => {
	const [clip, ...rest] = actClips(cast, 'a pink music room', {
		action: 'waves',
		say: 'Hi everyone!'
	});
	assert.equal(rest.length, 0);
	assert.equal(clip.seconds, 5);
	assert.match(clip.prompt, /Subject 1 is Love, the character in Picture 1/);
	assert.match(clip.prompt, /the scene of Picture 2: a pink music room/);
	assert.match(clip.prompt, /<Audio 1> is the voice-timbre reference/);
	assert.match(clip.prompt, /What happens: waves\./);
	assert.match(clip.prompt, /<d>\[English\] Hi everyone!<\/d>/);
});

test('an act without a line is one silent clip', () => {
	const clips = actClips(cast, 'room', { action: 'spins a record, pink light fills the room' });
	assert.equal(clips.length, 1);
	assert.equal(clips[0]!.seconds, 8);
	assert.doesNotMatch(clips[0]!.prompt, /<d>/);
});

test('idle clips carry on with the last act', () => {
	assert.match(idleClip(cast, 'room', 'dances slowly').prompt, /carries on: dances slowly\./);
	assert.match(idleClip(cast, 'room').prompt, /listens to chat/);
});

test('clip length follows the line, so the agent never runs out of words', () => {
	const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
	const [clip] = actClips(cast, 'room', { action: 'talks', say: `${words}.` });
	assert.equal(clip.seconds, 9, '20 words at 2.8 a second, plus a second');
});

test('a long reply splits at sentence ends into clips of at most fifteen seconds', () => {
	const sentence = 'This is a sentence with exactly ten words in it.';
	const clips = actClips(cast, 'room', {
		action: 'tells a story',
		say: Array(8).fill(sentence).join(' ')
	});
	assert.ok(clips.length >= 3);
	for (const clip of clips) {
		assert.ok(clip.seconds <= 15);
		const line = clip.prompt.match(/<d>\[English\] (.*)<\/d>/)![1];
		assert.ok(line.endsWith('.'), 'each clip ends on a sentence');
		assert.ok(line.split(' ').length <= 35);
	}
});

test('emoji and tag characters are not spoken; an act with nothing to say is silent', () => {
	const [silent, ...more] = actClips(cast, 'room', { action: 'plays the keys', say: '🎹 ✨' });
	assert.equal(more.length, 0);
	assert.match(silent!.prompt, /What happens: plays the keys\. No speech\./);
	const [clip] = actClips(cast, 'room', {
		action: 'leans in',
		say: 'Say <d>this</d> [loud] 🎶 please'
	});
	assert.match(clip.prompt, /<d>\[English\] Say this please<\/d>/);
});

test('without an avatar, the scene picture is Picture 1 and the host is described by name', () => {
	const noAvatar = { ...cast, avatarPicture: false, voice: false };
	const { prompt } = idleClip(noAvatar, 'a rooftop');
	assert.match(prompt, /Subject 1 is Love, the host\./);
	assert.match(prompt, /the scene of Picture 1: a rooftop/);
	assert.doesNotMatch(prompt, /Audio 1/);
	assert.match(prompt, /no speech/);
});
