/**
 * Tito's patter, keyed by the beat that triggers it.
 *
 * Tito runs the Desperado Club's Wheel of Fortune: a croupier whose smile is a
 * size too big for his face and whose wheel is very obviously rigged. He never
 * admits it. The harder the wheel bites, the louder he swears the game is one
 * hundred percent on the up-and-up — that denial is the joke, so every red
 * landing, the stab and the robbery lean on it hardest. He is smarm, not
 * menace: he enjoys the player's bad luck the way a host enjoys a ratings spike.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const say = speakerLines('tito');

export type TitoTrigger =
  | 'greet'
  | 'free_spin_greet'
  | 'bet_up'
  | 'bet_down'
  | 'spin'
  | 'land_red'
  | 'land_good'
  | 'land_spin_again'
  | 'stab'
  | 'robbed'
  | 'pet'
  | 'big_gold'
  | 'nothing'
  | 'idle'
  | 'leave';

export const TITO_LINES = {
  greet: [
    say.bark('"Step right up, my friend! Tito\'s wheel. One hundred percent on the up-and-up."'),
    say.bark('"Ah, a crawler with taste! The wheel has been waiting for you specifically."'),
    say.bark('"Welcome, welcome. Ignore the stains. The stains are decorative."'),
    say.bark('"You read the warning? Lawyers. Pay them no mind. Spin the wheel."'),
  ],
  free_spin_greet: [
    say.bark(
      '"A free spin! Somebody taped over my Nothing. Tito does not know who. Tito is furious."',
    ),
    say.bark('"On the house, my friend. The tape? Maintenance. Very temporary maintenance."'),
    say.bark('"Free spin! Do not touch the tape. Tito will be taking that tape back."'),
  ],
  bet_up: [
    say.bark('"Bigger bet, friendlier wheel. That is just mathematics, my friend."'),
    say.bark('"Look at that! The wheel likes you more already."'),
    say.bark('"A high roller! The viewers adore a high roller."'),
    say.bark('"More coins, less red. Tito is very fair. Very, very fair."'),
  ],
  bet_down: [
    say.bark('"Cautious. Smart. Boring, but smart."'),
    say.bark('"Fewer coins? Okay. The red wedges missed you anyway."'),
    say.bark('"Saving it for later? There is no later. Only the wheel."'),
  ],
  spin: [
    say.bark('"Round and round she goes! Tito does not touch anything. See? Hands up."'),
    say.bark('"Here we go! Nobody breathe on it. Breathing is cheating."'),
    say.bark('"Spinning! Totally random. Randomly totally random."'),
    say.bark('"And away! The suspense, it kills you. Sometimes literally."'),
  ],
  land_red: [
    say.bark('"Ooh, red. Bad luck! One hundred percent on the up-and-up, I promise."'),
    say.bark('"Red! The wheel decides, not Tito. Tito is a humble servant."'),
    say.bark('"Ah, so close! Rigged? Tito is insulted. Deeply. Spin again?"'),
    say.bark('"Red again? Statistically very normal. I had a guy check it. Me. I checked it."'),
    say.bark('"Unlucky! Totally above board. The board is right there. Look at it."'),
  ],
  land_good: [
    say.bark('"A winner! You see? Honest wheel. Tell your friends. Tell the viewers."'),
    say.bark('"Congratulations! Tito is so happy for you. Look at his face. Happy."'),
    say.bark('"Ha! The wheel giveth. Remember that when it taketh."'),
    say.bark('"A prize! Proof, my friend. Proof it is not rigged."'),
  ],
  land_spin_again: [
    say.bark('"Spin again! Free of charge. Tito is generous to a fault."'),
    say.bark('"Ooh, the wheel wants another look at you. Again!"'),
    say.bark('"A free spin! Do not say Tito never gave you anything."'),
  ],
  stab: [
    say.bark('"Stabbed! It says so right on the wedge. Rules are rules, my friend."'),
    say.bark('"Nothing personal! The wheel said stomach. Tito only follows the wheel."'),
    say.bark('"There. Clean in, clean out. Completely on the up-and-up."'),
    say.bark('"Ah, do not look at me like that. I wiped the knife first. Mostly."'),
  ],
  robbed: [
    say.bark('"Robbed! Tito will take good care of this. Very legitimate business."'),
    say.bark('"Half your coins! It is in the rules. I wrote the rules. Fairly."'),
    say.bark('"Thank you for your contribution to the Tito retirement fund."'),
    say.bark('"Not robbery, my friend. Redistribution. Up-and-up, all of it."'),
  ],
  pet: [
    say.bark('"A new pet! She bites, she kicks, she moos. Congratulations."'),
    say.bark('"A cow! An attack cow! Do not ask where Tito keeps it."'),
    say.bark('"Your new best friend! No refunds. She does not do refunds either."'),
  ],
  big_gold: [
    say.bark('"Gold! So much gold! Tito is weeping. These are happy tears. Mostly."'),
    say.bark('"Look at it pour! Proof the wheel is honest. Please spend it here."'),
    say.bark('"Ha! The house loses! The house will remember this."'),
  ],
  nothing: [
    say.bark('"Oh. Oh no. The Nothing. Tito did warn you. Twice. In red."'),
    say.bark('"The Nothing! Well. It was nice knowing you. Briefly."'),
    say.bark('"Ah. That one. One hundred percent on the up-and-up, my friend. Goodbye."'),
  ],
  idle: [
    say.bark('"The wheel gets lonely, you know. Spin it. Make it happy."'),
    say.bark('"No pressure. Tito can wait. Tito is paid by the hour. Spin."'),
    say.bark('"You are thinking too much. Thinking never won anything here."'),
    say.bark('"Psst. Tito hears the next one is a winner. Do not tell anyone."'),
  ],
  leave: [
    say.bark('"Leaving already? The wheel will remember your face."'),
    say.bark('"Come back soon! Tito saves your spot. And your coins, if you leave any."'),
    say.bark('"Goodbye, my friend! Up-and-up, always. Tell the viewers."'),
  ],
} as const satisfies Record<TitoTrigger, NonEmpty<BarkLine>>;

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
export function pickTitoLine(
  trigger: TitoTrigger,
  lastLine: string | null,
  random: () => number = Math.random,
): string {
  const pool = TITO_LINES[trigger];
  const fresh = pool.filter((line) => line.paragraphs[0] !== lastLine);
  const candidates = freshOrFallback(fresh, pool);
  return pickLine(candidates, random() * candidates.length).paragraphs[0];
}
