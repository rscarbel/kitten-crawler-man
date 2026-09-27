/**
 * The Lich's reveal and its in-fight barks, at the top of the Town Center
 * Tower.
 *
 * Before the reveal the thing talking is credited to `mysteriousVoice` — the
 * party cannot see it, and naming it in the speaker box would hand them the
 * answer a beat before the room does. After it materialises it speaks as
 * `lich`.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const narrator = transientSpeaker('The Krasue Murders', 'narration');
const carl = speakerLines('carl');
const donut = speakerLines('donut');
const mordecai = speakerLines('mordecaiInEar');
const voice = speakerLines('mysteriousVoice');
const lich = speakerLines('lich');

export const LICH_REVEAL: NonEmpty<DialogLine> = [
  narrator.line(
    'Miss Quill drops mid-sentence, and for one long moment her floating pen keeps writing without her, striking one last name from a list. Then it clatters to the boards, and the office is quiet.',
  ),
  carl.line(
    'The magistrate’s a corpse. The secretary ran the harvest. That should be the end of it. So why does this room still feel like somebody’s in it?',
  ),
  voice.line(
    'Because the magistrate keeps his appointments. He signs his letters. He suspects nothing, and he never will. I have seen to it.',
  ),
  voice.line(
    'The teacher believed the souls were for her husband. That enough of them would buy him back whole. Grief will sign anything you put in front of it. It does not read the terms.',
  ),
  donut.line('CARL. THE DEAD THING AT THE DESK IS THE NICE PART OF THIS ROOM.'),
  mordecai.button(
    'Ready weapons',
    '*That’s a lich. The letter, the writs, the harvest. You were never chasing the schoolteacher. You were chasing the thing that holds her leash. Kill it, and don’t count it dead until the fire in that hood goes out.*',
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
