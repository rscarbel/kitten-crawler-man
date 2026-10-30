/**
 * What Belle says over her head (`CatSenseCue`) when something only she can
 * perceive comes within her reach. How to use it is the senses explainer's
 * job (`catSensesExplainer.ts`).
 */

import { speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const belle = speakerLines('belle');

/** Belle noticing something, said each time it comes into her reach (after the first). */
export const CAT_SENSE_BARKS: NonEmpty<BarkLine> = [
  belle.bark('Hold on. I smell something.'),
  belle.bark('Ooh. My whiskers are tingling.'),
  belle.bark('Wait! My nose says over here.'),
  belle.bark('Something is here. My ears can tell.'),
  belle.bark('Sniff sniff. Interesting!'),
];

/** Belle's first notice in a run, which says plainly what she wants. */
export const CAT_SENSE_FIRST_BARK = {
  /** The human is being steered: she asks to be switched to. */
  whileHumanSteered: belle.bark('I can smell something only I can! Switch to me!'),
  /** She is already being steered: she says to follow her nose. */
  whileCatSteered: belle.bark('I can smell something only I can! Let me follow my nose.'),
} as const satisfies Record<string, BarkLine>;
