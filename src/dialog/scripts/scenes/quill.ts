/**
 * Miss Quill's half of "The Krasue Murders" finale, in the magistrate's
 * office at the top of the Town Center Tower.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import { crawlerDisplayName } from '../../../characters/characters';

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const THE_KRASUE_MURDERS = 'The Krasue Murders';

const narrator = transientSpeaker(THE_KRASUE_MURDERS, 'narration');
const theTopFloor = transientSpeaker('The Top Floor', 'narration');
const humanCrawler = speakerLines('human_crawler');
const belle = speakerLines('belle');
const quill = speakerLines('quill');

/**
 * The optional look at the magistrate before the room explains itself. Costs
 * the player nothing to skip: it says what is in front of them and asks the
 * question the reveal answers, rather than carrying anything the quest
 * depends on.
 */
export const QUILL_FEATHERFALL_EXAMINE: NonEmpty<DialogLine> = [
  narrator.line(
    'The magistrate hasn’t moved since you came up the stairs. He hasn’t moved in a long time — the ink in that well is a solid brick and his sash is grey with dust.',
  ),
  humanCrawler.button(
    'Back away',
    'Oh, buddy. You’ve been dead for weeks. So who has been signing the magistrate’s letters?',
  ),
];

/**
 * Arriving at the top of the tower, before the Quill fight opens. The room is
 * held for it: the last line is what puts a boss on the field.
 */
export const QUILL_OFFICE: NonEmpty<DialogLine> = [
  theTopFloor.line(
    'The magistrate’s office is spotless. The ledgers are current. The ink is fresh. At the great desk by the north wall, someone sits very still in the gloom. Between you and the desk, at a tidy secretary’s station, perches an elderly Hawkfolk in spectacles, pen scratching away as though two armed crawlers walk in every day.',
  ),
  quill.line(
    'You are not in the appointment ledger. The magistrate sees petitioners on the seventh day. You may leave your names with me. I keep excellent records.',
  ),
  humanCrawler.line(
    'Love the filing system, honestly. But people are dying in the low streets, your cult burned down last night, and your name is signed at the bottom of their duty ledger. Where’s Featherfall?',
  ),
  quill.line(
    'The magistrate is at his desk, where he has always been. He is simply particular about visitors. As am I.',
  ),
  belle.line(
    () =>
      `${crawlerDisplayName('human')}? The bird at the big desk hasn’t moved. Or blinked. Or breathed. I think he’s really cold. Should I sit on his lap?`,
  ),
  quill.line(
    'Hm. It was the chalk, I suppose. Or the note. I did tell her to come alone. Witnesses make everything so untidy. Well. You have interrupted years of careful work, children, and I am afraid the syllabus does not allow for interruptions. Mr. Remex? Ring the bell.',
  ),
  narrator.button(
    'Ready weapons',
    'The thing beside the desk unfolds. A Hawkfolk shape with no feathers left, eyes like black glass, something pale steaming off it like heat off a summer road. It does not want to be here. It does what she says anyway.',
  ),
];

/** Played on the Lich's death, before the Doomsday chain arms — the containment clock is wall-clock, so it must not start ticking under a dialog the player is still reading. */
export const QUILL_VICTORY: NonEmpty<DialogLine> = [
  narrator.line(
    'The robe folds over nothing and settles on the boards. The seal at its belt, Featherfall’s seal, cracks down the middle. Somewhere beneath the floorboards, something enormous begins, very slowly, to wake.',
  ),
  humanCrawler.line('That one was for Baggi. Somebody looked.'),
  belle.button(
    'It’s not over',
    () =>
      `We did it, ${crawlerDisplayName('human')}. Baggi would be happy. Can we have a nap now? The floor is rumbling...`,
  ),
];
