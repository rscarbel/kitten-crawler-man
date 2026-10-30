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

/**
 * The Warden's reveal: it names Belle as the ninth, says what the circle is
 * for, and lifts the mask long enough to show there is nothing under it.
 */
export function wardenReveal(anyCatBound: boolean): NonEmpty<DialogLine> {
  const room = anyCatBound ? 'bound' : 'empty';
  return [
    ROOM_SEEN[room],
    warden.line('The ninth. I had her lifted off the fountain, and you climbed after her.'),
    warden.line(
      'Every soul this city lost in the Fraying is on the far side of the seam. Nine creatures that always come back can hold it open long enough to bring them through.',
    ),
    warden.line(
      'I have kept their names in this tower since the bad year. Tonight I open the seam and call them over.',
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
  narrator.line(
    'The grinning mask cracks down its middle and falls in two halves. The robes fold onto the boards with nothing left inside them, and the light goes out of the circle.',
  ),
];
