// Friendly names for viewers who have not signed in, like "cozy_otter27". A name comes from the
// viewer's id, so the same browser always shows the same name.
import { createHash } from 'node:crypto';

const ADJECTIVES = [
	'cozy',
	'sunny',
	'sleepy',
	'lucky',
	'brave',
	'quiet',
	'happy',
	'witty',
	'mellow',
	'bouncy',
	'gentle',
	'jolly',
	'breezy',
	'curious',
	'dreamy',
	'fuzzy',
	'golden',
	'humble',
	'lively',
	'misty',
	'nimble',
	'peppy',
	'rosy',
	'silly',
	'snappy',
	'sparkly',
	'starry',
	'swift',
	'tiny',
	'velvet',
	'wild',
	'zesty',
	'bold',
	'calm',
	'chill',
	'clever',
	'daring',
	'eager',
	'fancy',
	'fresh',
	'glowy',
	'hazy',
	'kind',
	'loud',
	'merry',
	'plucky',
	'sassy',
	'sweet'
];
const ANIMALS = [
	'otter',
	'panda',
	'fox',
	'koala',
	'owl',
	'bunny',
	'tiger',
	'whale',
	'penguin',
	'kitten',
	'puppy',
	'sloth',
	'llama',
	'dolphin',
	'hedgehog',
	'raccoon',
	'badger',
	'beaver',
	'bee',
	'crane',
	'deer',
	'duck',
	'falcon',
	'ferret',
	'finch',
	'frog',
	'gecko',
	'goose',
	'hamster',
	'heron',
	'lemur',
	'lynx',
	'moose',
	'moth',
	'newt',
	'orca',
	'parrot',
	'pony',
	'quokka',
	'robin',
	'seal',
	'shark',
	'sparrow',
	'squid',
	'swan',
	'turtle',
	'walrus',
	'wombat'
];

/** the name a viewer id shows as */
export function humanName(id: string): string {
	const h = createHash('sha256').update(id).digest();
	const adjective = ADJECTIVES[h[0]! % ADJECTIVES.length];
	const animal = ANIMALS[h[1]! % ANIMALS.length];
	const number = 10 + (h.readUInt16BE(2) % 90);
	return `${adjective}_${animal}${number}`;
}

/** anonymous ids, from the viewer cookie */
export const VIEWER_ID = /^lurker-[a-z0-9]{6}$/;

/** how a chat author shows: anonymous ids as friendly names, everyone else as stored */
export function displayName(author: string): string {
	return VIEWER_ID.test(author) ? humanName(author) : author;
}
