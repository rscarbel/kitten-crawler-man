/** What the Juicer shouts at whoever he's chasing, rotated one at a time. */

import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const say = speakerLines('juicer');

export const JUICER_LINES: Record<'taunts' | 'noMusicTaunts', NonEmpty<BarkLine>> = {
  taunts: [
    say.bark('Bro'),
    say.bark('I need a spot, bro'),
    say.bark("Excuses don't lose calories"),
    say.bark('What are you doing, bro?'),
    say.bark('Release the beast'),
    say.bark('Come at me, bro'),
    say.bark('Stop it, bro'),
  ],
  /** What he shouts once his boombox is smashed. */
  noMusicTaunts: [
    say.bark("I CAN'T HEAR MY PUMP-UP MUSIC, BRO"),
    say.bark("Who touches a man's playlist?"),
    say.bark('That was my PR mix, bro'),
    say.bark('Now I have to count my own reps'),
  ],
};
