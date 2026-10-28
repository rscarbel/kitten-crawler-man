/**
 * Pest Control's dialog: Dr. Moult's explanation, which `SpiderQuestSystem`
 * opens when a crawler talks to him at the hallway mouth or walks past him into
 * the hallway, and Caroline's warning that follows it.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { carolineLines } from '../../caroline';
import { speakerLines } from '../../line';

const say = speakerLines('scientist');

export const SCIENTIST = {
  /** Shouted after a crawler who walked into the hallway before hearing him out. */
  waitStop: say.line("Wait! Wait, don't go in there!"),
  explanation: say.line([
    "Oh thank goodness, a crawler. Dr. Ignatius Moult, Xenobiology. Well, what's left of it.",
    "My experiments have gotten... out of control. The life machines in my lab won't stop printing egg sacs, and the things inside them are getting bigger.",
    'I should shut it all down from the terminal, but the system has locked me out. Security lockdown. My own password!',
    'You look like you know your way around a lock. Please. The lab is at the end of this hallway.',
  ]),
};

export const CAROLINE_SPIDER_WARNING = carolineLines.deferredMessage(
  () =>
    `${crawlerDisplayName('human')}. This quest is optional: the stairwell does not require it. The lab ahead is classified high risk. Completion is rewarded.`,
);
