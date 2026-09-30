/**
 * The narration Midge's walk to Wendell's pasture needs. Nobody speaks it:
 * it is what happened, told plainly, so it reads the same whichever crawler
 * was leading her.
 */

import { speakerLines } from '../../line';

const narrator = speakerLines('narrator');

export const MIDGE_ESCORT_NARRATION = {
  /** Midge beaten down on the road: she bolts for Merrit's gate and the escort starts over from there. */
  scaredHome: narrator.line('Midge got scared and ran back home'),
};
