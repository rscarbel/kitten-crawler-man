/**
 * The Warden's barks in the fight at the top of the Town Center Tower.
 *
 * The Warden is the Lich. It did not cause the Fraying; it means to undo it,
 * pulling the old city and everyone it lost back through the seam, and the
 * cats in the circle are what hold the seam open. It talks plainly, like
 * someone who has grieved too long and is sure that makes them right.
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
  'You want to see what that night looked like? The ground split, and the fires came up through it.',
);

export const LICH_TANTRUM_BARK: BarkLine = lich.bark(
  'You let my cats go! I needed nine. I only needed NINE!',
);

export const LICH_RECKONING_BARK: BarkLine = lich.bark(
  'No. No, the seam is closing. They were almost home. Do you understand? They were almost home.',
);
