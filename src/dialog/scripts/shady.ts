/** The line on Shady's proximity bubble, before the player has spoken to him. */

import { speakerLines } from '../line';

const say = speakerLines('shady');

export const SHADY_LINES = {
  proximityBubble: say.bark('…psst.'),
};
