/**
 * The Warden's barks in the fight at the top of the Town Center Tower.
 *
 * The Warden is the Lich. It did not cause the Fraying; it means to undo it,
 * pulling the old city and everyone it lost back through the seam, and the
 * cats in the circle are what hold the seam open. It speaks the way its
 * proclamations read: a civic voice, sure of its right, with no face to show.
 */

import { speakerLines } from '../../line';
import type { BarkLine } from '../../line';

const lich = speakerLines('lich');

/**
 * One bark each, played before the scripted slide that opens a battle phase.
 * The fight is paused for them, and a phase change the player has to read
 * four screens of is a phase change they resent.
 */
export const LICH_FIREWALL_BARK: BarkLine = lich.bark(
  'Stand back. The old city is coming home, and you are standing in its road.',
);

export const LICH_TANTRUM_BARK: BarkLine = lich.bark('Nine. The circle needed NINE.');

export const LICH_RECKONING_BARK: BarkLine = lich.bark(
  'The seam is closing. They were nearly home, and you have shut the door on them.',
);
