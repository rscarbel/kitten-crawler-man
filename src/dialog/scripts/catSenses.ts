/**
 * What is said when something only Belle can perceive comes within her reach:
 * her own bark over her head (`CatSenseCue`), and the one-time narrator box
 * that explains how to use it.
 */

import { crawlerDisplayName } from '../../characters/characters';
import { speakerLines } from '../line';
import type { BarkLine, DialogLine, NonEmpty } from '../line';

const belle = speakerLines('belle');
const narrator = speakerLines('narrator');

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

export interface CatSenseExplainerInputs {
  /** How the player switches crawlers, worded for their input as a sentence opening: "Press Tab". */
  readonly switchHow: string;
  /** Whether the human is the one being steered, so the box says to switch first. */
  readonly humanSteered: boolean;
}

/** The one-time explainer, shown the first time a cat sense comes into reach in a run. */
export function catSenseExplainer(inputs: CatSenseExplainerInputs): NonEmpty<DialogLine> {
  const cat = crawlerDisplayName('cat');
  const notice = `${cat} can sense something here that only she can perceive. Scent trails and ward lines show only while you play as her, and her portrait glows while one is near.`;
  const alongTheScent =
    'her along the scent and stop on its strongest patch: she puts her nose down and sniffs it. Ward lines glow for her where they cross the floor.';
  const howTo = inputs.humanSteered
    ? `${inputs.switchHow} to switch to ${cat}. Then walk ${alongTheScent}`
    : `Walk ${alongTheScent}`;
  return [narrator.line([notice, howTo])];
}
