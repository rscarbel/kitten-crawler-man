/**
 * What the cellar elf says while guiding the human through the tower drain,
 * spoken in bubbles over the elf as the party reaches each stop. Elves know
 * the drains from the cellars side; they do not set foot in the tower.
 */

import type { SewerGuideStopId } from '../../../map/sewer/sewerLayouts';
import type { BarkLine, NonEmpty } from '../../line';
import { transientSpeaker } from '../../line';

/** The name the guide's lines are attributed to. */
const SEWER_GUIDE_NAME = 'Cellar elf';

const guide = transientSpeaker(SEWER_GUIDE_NAME, 'townsfolkMasculine');

/** The guide's line on reaching each of its stops in the tower drain, in walking order. */
export const SEWER_GUIDE_STOP_LINES = {
  ladder: guide.bark('Stay close. The water down here runs faster than it looks.'),
  spillway: guide.bark(
    'The spillway. Nothing crosses it running full. The wheel in that alcove shuts it.',
  ),
  junction: guide.bark('Rats. Keep your feet out of the channel.'),
  nest: guide.bark(
    'Their nest has choked the sump. The wheel on the north wall opens the pipe over it. Let the water take it.',
  ),
  vault: guide.bark('Ghouls come in from the ruins through the old pipes. Mind them.'),
  cistern: guide.bark(
    'This is as far as I go. The culvert opens into the tower cistern. Elves do not go in there.',
  ),
} as const satisfies Record<SewerGuideStopId, BarkLine>;

/** What the guide says as the water does what the party asked of it. */
export const SEWER_GUIDE_WORK_LINES = {
  spillwayLowered: guide.bark('That is it. Step on the silt, not the green.'),
  nestWashedOut: guide.bark(
    'Gone. Now shut the pipe off with the wheel by the sump. Nobody wades that water.',
  ),
  sumpDrained: guide.bark('Drained, and that nest is gone for good. The way on is open.'),
} as const satisfies Record<string, BarkLine>;

/** What the guide calls back while waiting for a party that has fallen behind. */
export const SEWER_GUIDE_WAITING_BARKS: NonEmpty<BarkLine> = [
  guide.bark('This way.'),
  guide.bark('Over here. Keep up.'),
  guide.bark('Do not wander off down here.'),
];

/** What the guide says when caught by a blow. It cannot be hurt down. */
export const SEWER_GUIDE_HURT_BARKS: NonEmpty<BarkLine> = [
  guide.bark('Not me!'),
  guide.bark('Watch where you swing.'),
];
