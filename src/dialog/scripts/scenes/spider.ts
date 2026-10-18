/**
 * Pest Control's dialog: Dr. Moult's explanation, which `SpiderQuestSystem`
 * opens when a crawler talks to him at the hallway mouth or walks past him into
 * the hallway, and Mordecai's message that follows it.
 */

import { speakerLines } from '../../line';

const say = speakerLines('scientist');
const mordecaiMessage = speakerLines('mordecaiMessage');

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

export const MORDECAI_MESSAGE = {
  warning: mordecaiMessage.line(
    "Hey kid. Listen, I wouldn't recommend following. You don't need to help him to get to the stairwell, and if you do get involved, I guarantee you this will be very dangerous and probably result in you being splattered along the dungeon floor. Your call though, there's always a reward for completing dungeon quests.",
  ),
};
