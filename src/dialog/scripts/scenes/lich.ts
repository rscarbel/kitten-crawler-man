/**
 * The Lich's reveal and its in-fight barks, at the top of the Town Center
 * Tower.
 *
 * Before the reveal the thing talking is credited to `mysteriousVoice` — the
 * party cannot see it, and naming it in the speaker box would hand them the
 * answer a beat before the room does. After it materialises it speaks as
 * `lich`.
 */

import { carolineLines } from '../../caroline';
import { speakerLines, transientSpeaker } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';
import { crawlerName } from '../../../characters/characters';

const HUMAN_NAME = crawlerName('human');

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const narrator = transientSpeaker('The Krasue Murders', 'narration');
const ryan = speakerLines('ryan');
const belle = speakerLines('belle');
const voice = speakerLines('mysteriousVoice');
const lich = speakerLines('lich');

export const LICH_REVEAL: NonEmpty<DialogLine> = [
  narrator.line(
    'Miss Quill drops mid-sentence, and for one long moment her floating pen keeps writing without her, striking one last name from a list. Then it clatters to the boards, and the office is quiet.',
  ),
  ryan.line(
    'Okay. The magistrate’s a corpse, the secretary ran the harvest, case closed. So why does this room still feel like somebody’s in it? Hello?',
  ),
  voice.line(
    'Because the magistrate keeps his appointments. He signs his letters. He suspects nothing, and he never will. I have seen to it.',
  ),
  voice.line(
    'The teacher believed the souls were for her husband. That enough of them would buy him back whole. Grief will sign anything you put in front of it. It does not read the terms.',
  ),
  carolineLines.message(
    'Classification: lich. It wrote the letter, the writs and the harvest orders. Miss Quill was its instrument. It is not dead until the fire in its hood is out.',
  ).line,
  belle.button(
    'Ready weapons',
    `${HUMAN_NAME}, the room got cold. I don’t like this voice. It’s not a cuddly voice.`,
  ),
];

/**
 * One bark each, played over the scripted slide that opens a battle phase.
 * The fight is paused for them, and a phase change the player has to read
 * four screens of is a phase change they resent.
 */
export const LICH_FIREWALL_BARK: BarkLine = lich.bark(
  'Enough. Stand at the back of the office, and wait to be seen.',
);

export const LICH_TANTRUM_BARK: BarkLine = lich.bark('You were told to WAIT.');

export const LICH_RECKONING_BARK: BarkLine = lich.bark(
  'No more appointments. The office is closed.',
);
