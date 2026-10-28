/**
 * Donald's patter, keyed by the beat that triggers it.
 *
 * Donald runs the Cloak & Dagger's Wheel of Fortune: a croupier whose smile is a
 * size too big for his face and whose wheel is very obviously rigged. He never
 * admits it. The harder the wheel bites, the louder he swears the game is one
 * hundred percent on the up-and-up — that denial is the joke, so every red
 * landing and the robbery lean on it hardest. He is smarm, not
 * menace: he enjoys the player's bad luck the way a croupier enjoys a long losing streak.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import type { PetWords } from '../../core/party/petNames';

const say = speakerLines('donald');

export type DonaldTrigger =
  | 'greet'
  | 'free_spin_greet'
  | 'bet_up'
  | 'bet_down'
  | 'spin'
  | 'land_red'
  | 'land_good'
  | 'land_spin_again'
  | 'robbed'
  | 'pet'
  | 'big_gold'
  | 'permanent_death'
  | 'idle'
  | 'leave';

export const DONALD_LINES = {
  greet: [
    say.bark('"Step right up, my friend! Donald\'s wheel. One hundred percent on the up-and-up."'),
    say.bark('"Ah, a crawler with taste! The wheel has been waiting for you specifically."'),
    say.bark('"Welcome, welcome. Ignore the stains. The stains are decorative."'),
    say.bark('"You read the warning? Lawyers. Pay them no mind. Spin the wheel."'),
  ],
  free_spin_greet: [
    say.bark(
      '"A free spin! Somebody taped over the big red one. Donald does not know who. Donald is furious."',
    ),
    say.bark('"On the house, my friend. The tape? Maintenance. Very temporary maintenance."'),
    say.bark('"Free spin! Do not touch the tape. Donald will be taking that tape back."'),
  ],
  bet_up: [
    say.bark('"Bigger bet, friendlier wheel. That is just mathematics, my friend."'),
    say.bark('"Look at that! The wheel likes you more already."'),
    say.bark('"A high roller! The house adores a high roller."'),
    say.bark('"More coins, less red. Donald is very fair. Very, very fair."'),
  ],
  bet_down: [
    say.bark('"Cautious. Smart. Boring, but smart."'),
    say.bark('"Fewer coins? Okay. The red wedges missed you anyway."'),
    say.bark('"Saving it for later? There is no later. Only the wheel."'),
  ],
  spin: [
    say.bark('"Round and round she goes! Donald does not touch anything. See? Hands up."'),
    say.bark('"Here we go! Nobody breathe on it. Breathing is cheating."'),
    say.bark('"Spinning! Totally random. Randomly totally random."'),
    say.bark('"And away! The suspense, it kills you. Sometimes literally."'),
  ],
  land_red: [
    say.bark('"Ooh, red. Bad luck! One hundred percent on the up-and-up, I promise."'),
    say.bark('"Red! The wheel decides, not Donald. Donald is a humble servant."'),
    say.bark('"Ah, so close! Rigged? Donald is insulted. Deeply. Spin again?"'),
    say.bark('"Red again? Statistically very normal. I had a guy check it. Me. I checked it."'),
    say.bark('"Unlucky! Totally above board. The board is right there. Look at it."'),
  ],
  land_good: [
    say.bark('"A winner! You see? Honest wheel. Tell your friends. Tell everyone."'),
    say.bark('"Congratulations! Donald is so happy for you. Look at his face. Happy."'),
    say.bark('"Ha! The wheel giveth. Remember that when it taketh."'),
    say.bark('"A prize! Proof, my friend. Proof it is not rigged."'),
  ],
  land_spin_again: [
    say.bark('"Spin again! Free of charge. Donald is generous to a fault."'),
    say.bark('"Ooh, the wheel wants another look at you. Again!"'),
    say.bark('"A free spin! Do not say Donald never gave you anything."'),
  ],
  robbed: [
    say.bark('"Robbed! Donald will take good care of this. Very legitimate business."'),
    say.bark('"Half your coins! It is in the rules. I wrote the rules. Fairly."'),
    say.bark('"Thank you for your contribution to the Donald retirement fund."'),
    say.bark('"Not robbery, my friend. Redistribution. Up-and-up, all of it."'),
  ],
  big_gold: [
    say.bark('"Gold! So much gold! Donald is weeping. These are happy tears. Mostly."'),
    say.bark('"Look at it pour! Proof the wheel is honest. Please spend it here."'),
    say.bark('"Ha! The house loses! The house will remember this."'),
  ],
  permanent_death: [
    say.bark('"Oh. Oh no. Permanent Death. Donald did warn you. Twice. In red."'),
    say.bark('"Permanent Death! Well. It was nice knowing you. Briefly."'),
    say.bark('"Ah. That one. One hundred percent on the up-and-up, my friend. Goodbye."'),
  ],
  idle: [
    say.bark('"The wheel gets lonely, you know. Spin it. Make it happy."'),
    say.bark('"No pressure. Donald can wait. Donald is paid by the hour. Spin."'),
    say.bark('"You are thinking too much. Thinking never won anything here."'),
    say.bark('"Psst. Donald hears the next one is a winner. Do not tell anyone."'),
  ],
  leave: [
    say.bark('"Leaving already? The wheel will remember your face."'),
    say.bark('"Come back soon! Donald saves your spot. And your coins, if you leave any."'),
    say.bark('"Goodbye, my friend! Up-and-up, always. Tell your friends."'),
  ],
} as const satisfies Record<Exclude<DonaldTrigger, 'pet'>, NonEmpty<BarkLine>>;

/** His patter as the wheel hands over the attack cow, who may already have a name. */
function donaldPetLines(cow: PetWords): NonEmpty<BarkLine> {
  return [
    say.bark('"A new pet! She bites, she kicks, she moos. Congratulations."'),
    say.bark(`"A cow! ${cow.opening}! Do not ask where Donald keeps it."`),
    say.bark('"Your new best friend! No refunds. She does not do refunds either."'),
  ];
}

/** Every line Donald may say for `trigger`. */
export function donaldLinesFor(trigger: DonaldTrigger, cow: PetWords): NonEmpty<BarkLine> {
  return trigger === 'pet' ? donaldPetLines(cow) : DONALD_LINES[trigger];
}

/** `fresh`, as a `NonEmpty` pool, or `fallback` when filtering left nothing. */
function freshOrFallback(
  fresh: readonly BarkLine[],
  fallback: NonEmpty<BarkLine>,
): NonEmpty<BarkLine> {
  if (fresh.length === 0) return fallback;
  const [first, ...rest] = fresh;
  return [first, ...rest];
}

/**
 * A random line for `trigger` that is not `lastLine`, so the same words never
 * fire twice running. `random` returns a value in [0, 1); review fixtures pass
 * a seeded one so their frames repeat.
 */
export function pickDonaldLine(
  trigger: DonaldTrigger,
  lastLine: string | null,
  cow: PetWords,
  random: () => number = Math.random,
): string {
  const pool = donaldLinesFor(trigger, cow);
  const fresh = pool.filter((line) => line.paragraphs[0] !== lastLine);
  const candidates = freshOrFallback(fresh, pool);
  return pickLine(candidates, random() * candidates.length).paragraphs[0];
}
