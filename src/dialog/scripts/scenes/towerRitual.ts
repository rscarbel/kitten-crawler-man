/**
 * The top of the tower: the Warden behind its mask, the carrier who comes in
 * through the observatory, and the Warden's fall.
 *
 * The box credits it as "The Warden" throughout, even once the mask is off:
 * that is all the town has ever called it.
 */

import { carolineLines } from '../../caroline';
import { speakerLines, transientSpeaker } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';
import type { AvielChoice } from '../../../core/quests/missingCatsProgress';

const narrator = speakerLines('narrator');
const belle = speakerLines('belle');
const aviel = speakerLines('aviel');
const warden = transientSpeaker('The Warden', 'townsfolk');
const roostHawk = transientSpeaker('High Roost hawk', 'townsfolkHawkfolk');

/** What the room looks like when the party comes up into it, by whether any cat is still bound. */
const ROOM_SEEN = {
  bound: narrator.line(
    'The circle under the observatory window is lit. Round it stand stone pillars, and in the light of each one a cat sits as still as a painting. In the middle of the circle waits a figure in the Warden’s robes, its face a white mask carved into a grin.',
  ),
  empty: narrator.line(
    'The circle under the observatory window is lit, and the pillars round it stand dark and empty. In the middle of the circle waits a figure in the Warden’s robes, its face a white mask carved into a grin.',
  ),
} as const;

const CAROLINE_INTEL = {
  bound: carolineLines.message(
    'Classification: lich. It is the Warden. While any pillar is lit, the circle shields it. Belle, stand at a lit pillar to unbind its cat.',
  ).line,
  empty: carolineLines.message(
    'Classification: lich. It is the Warden. No pillar holds a cat, so the circle does not shield it.',
  ).line,
} as const;

/** Why the Warden wants Belle, by whether its other cats are still bound or were let out of their cages. */
const NINE_CATS = {
  bound: warden.line(
    'But it closes again the moment I let go. Something has to hold it open. A cat always comes back, so a cat can hold it. It takes nine. Yours makes nine.',
  ),
  empty: warden.line(
    "But it closes again the moment I let go. Something has to hold it open. A cat always comes back, so a cat can hold it. It takes nine. You let the others out of their cages. They'll come back. Cats do. I'll start with yours.",
  ),
} as const;

/**
 * The Warden's reveal: it names Belle as the ninth, says what the circle is
 * for, and lifts the mask long enough to show there is nothing under it.
 */
export function wardenReveal(anyCatBound: boolean): NonEmpty<DialogLine> {
  const room = anyCatBound ? 'bound' : 'empty';
  return [
    ROOM_SEEN[room],
    warden.line(
      'There she is. The ninth cat. I had her carried up here, and you followed her, just like I knew you would.',
    ),
    warden.line(
      "When the ground split under this city, everyone who fell with it ended up somewhere else. They aren't dead. They're on the other side of a seam, and I can open it.",
    ),
    NINE_CATS[room],
    warden.line(
      "I've kept every one of their names in this tower since that night. Tonight I bring them home. Don't get in my way.",
    ),
    narrator.line(
      'The Warden lifts the grinning mask away. There is no face behind it, only green fire burning in an empty hood. It settles the mask back over the fire.',
    ),
    CAROLINE_INTEL[room],
    belle.line('It puts a face on just to grin at people.'),
  ];
}

/** Said as the carrier comes in through the observatory window, by whoever the party's choice sent. */
export const CARRIER_ARRIVES = {
  kept: aviel.bark('I owe you a carry. Hold still, little one, and I will lift you out.'),
  exposed: roostHawk.bark('The Roost sent me in the deacon’s place. Hold still, little one.'),
} as const satisfies Record<AvielChoice, BarkLine>;

/** The Warden falls: the mask cracks, and the circle goes dark. */
export const WARDEN_FALLS: NonEmpty<DialogLine> = [
  warden.line('I kept every name. I only wanted them home.'),
  narrator.line(
    'The grinning mask cracks down its middle and falls in two halves. The robes fold onto the boards with nothing left inside them, and the light goes out of the circle.',
  ),
];
