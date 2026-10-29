/**
 * "The Krasue Murders" — Taloncrest's town murder mystery. Baggi is a
 * kindly orc who saw a taking; Caroline states what the crawlers cannot read
 * for themselves; the clue text carries the deduction chain that points first
 * at the magistrate, then at his secretary, and finally at the thing that has
 * been signing his letters.
 */

import { carolineLines } from '../../caroline';
import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import { crawlerDisplayName } from '../../../characters/characters';

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const THE_KRASUE_MURDERS = 'The Krasue Murders';

const baggi = speakerLines('baggi');
const narrator = transientSpeaker(THE_KRASUE_MURDERS, 'narration');
const theAlley = transientSpeaker('The Alley', 'narration');
const theTownWell = transientSpeaker('The Town Well', 'narration');
const lorisCottage = transientSpeaker('Old Lori’s Cottage', 'narration');
const theTowerPlaza = transientSpeaker('The Tower Plaza', 'narration');
const theUnreadableLetter = transientSpeaker('The Unreadable Letter', 'narration');
const humanCrawler = speakerLines('human_crawler');
const belle = speakerLines('belle');

export const MURDER_HOOK: NonEmpty<DialogLine> = [
  baggi.line(
    'Psst. Crawlers. Over here. No, don’t look around, look at ME. Name’s Baggi. I got no coin and no class worth spit, but I got eyes. And my eyes have seen where the missing ones go.',
  ),
  baggi.line(
    'People are vanishing off the night streets. My friends. Low-street folk, the kind nobody files a report about. They turn up mornings, from the shoulders down. The Watch won’t come. Nobody comes for us.',
  ),
  belle.line(
    () =>
      `${crawlerDisplayName('human')}, she’s so sad. We have to help her. Can I give her a cuddle first? Then we can be detectives. I’ve never been a detective. Is it warm?`,
  ),
  baggi.button(
    'After dark, then',
    'Meet me in the alley beside the Cloak & Dagger after dark and I’ll show you where they take them. Please. You’re the first ones who looked at me instead of through me.',
  ),
];

export const MURDER_BODY_FOUND: NonEmpty<DialogLine> = [
  theAlley.line(
    'Baggi lies crumpled behind the Cloak & Dagger, a day cold at least. She never made the meeting. Somebody made certain of that the same night she asked for help. The body ends at the shoulders. There is no head.',
  ),
  humanCrawler.line(
    'Hey. Oh, no. She talked to us at noon and she was gone by midnight. That’s not bad luck. Somebody was watching her. Maybe watching us too.',
  ),
  belle.line(
    () =>
      `I don’t want to look at the neck part. But ${crawlerDisplayName('human')}, there’s paper in her coat. See? Right there. Poor Baggi.`,
  ),
  theAlley.line(
    'Two papers, tucked where a pickpocket wouldn’t bother to look. The first is a magistrate’s writ, the ink barely dry: ‘The bearer acts on my authority and is not to be detained.’ Signed, Magistrate Featherfall.',
  ),
  theAlley.line(
    'The second is a letter in no alphabet you know. Squiggles and triangles, written in a brown ink you are choosing not to think about.',
  ),
  carolineLines.message(
    'Classification: necro-script. Living hands cannot form its shapes. Its author is dead.',
  ).line,
  humanCrawler.button(
    'Investigate',
    'A dead guy’s pen pal. Great. She died trying to get this to somebody, so we’re seeing it through. The witness is gone, the magistrate’s paperwork was on her, and whoever wrote this doesn’t breathe. Let’s go ask around town. Folks always know something.',
  ),
];

export const MURDER_WELL_CLUE: NonEmpty<DialogLine> = [
  theTownWell.line(
    'Deep gouges score the well’s rim. Talons, and drag marks where something heavy was hauled up out of hiding. Crushed into the mud beside them: a stick of schoolroom chalk, worn to a stub.',
  ),
  belle.button(
    'Noted',
    () =>
      `${crawlerDisplayName('human')}, look! Chalk! Teachers have chalk. Was a teacher here? At night? That’s a silly time for school.`,
  ),
];

export const MURDER_HOME_CLUE: NonEmpty<DialogLine> = [
  lorisCottage.line(
    'Claw furrows rake the paving outside Lori’s cottage, ending in a pool and a few torn scraps of a visitor’s shawl. The door stands latched from the inside, untouched. Tucked under the knocker, a note in a neat schoolteacher hand: ‘Evening lessons. Come alone.’ It is unsigned.',
  ),
  humanCrawler.button(
    'Noted',
    'She was invited. Probably they all were. Nobody heads out alone at night for a stranger. You go because it’s somebody respectable. Somebody you’d feel rude saying no to.',
  ),
];

export const MURDER_ROOST_CLUE: NonEmpty<DialogLine> = [
  theTowerPlaza.line(
    'Chalked on the flagstones at the foot of the wall: an open eye over a cupped hand, ringed with elf-made candles. A shrine, and the wax is fresh. Something burst through it since. The candles are flung wide, and blood is thrown in an arc up the stone above. Whatever took the victim went up.',
  ),
  humanCrawler.line(
    'So the cult prays down here, and the blood goes up there. Featherfall’s roost is at the top of this tower. His paperwork was on the body, and now there’s blood on his walls. Everything keeps pointing at the magistrate.',
  ),
  belle.button(
    'Noted',
    () =>
      `But where is the magistrate, ${crawlerDisplayName('human')}? Nobody has seen him in weeks. Maybe he’s lonely up there. Maybe he needs a friend.`,
  ),
];

/**
 * The letter answers a question nobody asked out loud, and the sun goes down
 * on the same page. One conversation rather than two: the taunt is *why* the
 * night attack happens, and a break between them would let the player read
 * them as unrelated.
 */
export const MURDER_TAUNT_AND_NIGHTFALL: NonEmpty<DialogLine> = [
  theUnreadableLetter.line(
    'The letter in your pack grows warm. The ink crawls, rearranges itself, and settles into plain script, in the same neat schoolteacher hand as the note on Lori’s door: ‘No, you won’t.’',
  ),
  humanCrawler.line(
    'Whoa. We didn’t ask anything out loud, and it answered anyway. This isn’t a letter. It’s a window, and somebody’s been watching through it since the alley. Hi there, whoever you are.',
  ),
  carolineLines.deferredMessage(
    () =>
      `${crawlerDisplayName('human')}. ${crawlerDisplayName('cat')}. The letter is a sensor, and its author has your faces. It has taken people one at a time. Tonight it comes for two at once. Nightfall is close. A position with walls raises your survival.`,
  ).line,
  belle.line(
    () =>
      `Walls are good. Walls keep the warm in. ${crawlerDisplayName('human')}, stay close to me. I will protect you.`,
  ),
  narrator.button(
    'Defend yourselves',
    'The sun drops behind the ruins. Somewhere over the rooftops a wet shriek answers the dusk bell, then a dozen more, closing from every quarter. They are not hunting the town tonight. They are hunting you. Survive it.',
  ),
];

export const MURDER_AFTERMATH: NonEmpty<DialogLine> = [
  narrator.line(
    'The last head bursts in a spray of ichor. Tangled in its trailing hair: a brass button stamped with the Blackwood Barracks crest, and a reek of candle wax and cellar damp.',
  ),
  humanCrawler.line(
    'Krasue don’t own buttons. Somebody carried these things across town and let them loose at our door. The thing in the letter did the watching, and the cult did the carrying. Same as with the victims.',
  ),
  belle.button(
    'To the Lodge',
    () =>
      `The button says Blackwood! Blackwood Lodge! Let’s go knock on their door, ${crawlerDisplayName('human')}. Really loud.`,
  ),
];

export const MURDER_HIDEOUT_CLEARED: NonEmpty<DialogLine> = [
  narrator.line(
    'In the cellar, under the guttered candles: a duty ledger of names. Low-street names, Baggi’s among them, each struck through in a neat schoolteacher hand. The final page is an instruction: ‘Bring the next lessons to my capacitor at the top of the magistrate’s tower.’ It is signed ‘Miss Quill’, and sealed with a feather pressed into black wax.',
  ),
  humanCrawler.line(
    'The schoolteacher! The chalk at the well, the note about evening lessons, handwriting way too neat for a butcher. She does the collecting, and the magistrate’s office keeps the Watch off her back. That writ on Baggi was a leash.',
  ),
  carolineLines.message(
    'Magistrate Featherfall attended the temple every seventh day for thirty years. He has not attended in weeks. Every letter he has sent since is in another hand. The deacon has the record.',
  ).line,
  belle.button(
    'To the tower',
    () =>
      `A teacher and a magistrate. And they’re both at the top of the tower? ${crawlerDisplayName('human')}, it might be warm up there. Let’s go.`,
  ),
];
