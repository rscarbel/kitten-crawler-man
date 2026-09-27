/** What a club dancer yelps when Rosemarie's flicked coin catches her. */

import { transientSpeaker } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const dancer = transientSpeaker('Dancer', 'townsfolk');

export const DANCER_BARKS: NonEmpty<BarkLine> = [
  dancer.bark('Not the eye, Rosemarie!'),
  dancer.bark('OW! That one had an edge on it!'),
  dancer.bark("Rosemarie, I've only got the one good eye left!"),
  dancer.bark('Tip the stage, not my face!'),
  dancer.bark("She's winding up again!"),
  dancer.bark('Every. Single. Night.'),
];
