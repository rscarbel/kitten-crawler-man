/**
 * The scientist's plea for help — the offer `SpiderQuestSystem` opens when a
 * crawler first reaches him in the lab.
 */

import { speakerLines } from '../../line';

const say = speakerLines('scientist');

export const SCIENTIST = {
  labRequest: say.line(
    'Oh! A visitor. Please, I need your help — my experiments went terribly wrong. The life machines keep printing egg sacs and dropping them on my floor! Get to the terminal computer and shut them down before this gets worse!',
  ),
};
