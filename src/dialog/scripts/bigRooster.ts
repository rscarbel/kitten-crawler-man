/** What Big Rooster shouts at whoever he's chasing, rotated one at a time. */

import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const say = speakerLines('big_rooster');

export const BIG_ROOSTER_LINES: Record<'taunts' | 'noMusicTaunts', NonEmpty<BarkLine>> = {
  taunts: [
    say.bark('Cock of the walk, chick. Cock of the walk.'),
    say.bark('Look at these wings. Oh wait. ARMS.'),
    say.bark('Twelve reps, then I crow'),
    say.bark('You call that a stance, chick?'),
    say.bark('Chest up, feathers out, let us GO'),
    say.bark('One rooster in this coop, and he lifts'),
    say.bark('Every rep is a crow!'),
  ],
  /** What he shouts once his boombox is smashed. */
  noMusicTaunts: [
    say.bark('WHO KILLED MY STRUT TRACK?'),
    say.bark("No beat? Fine. I'll crow my own tempo."),
    say.bark('That was my warm-up mix, chick'),
    say.bark('Now I gotta count reps in my head'),
  ],
};
