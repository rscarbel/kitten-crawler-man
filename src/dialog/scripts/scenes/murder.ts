/**
 * "The Krasue Murders" — Taloncrest's town murder mystery. Baggi is a
 * kindly orc who saw a taking; Mordecai's warning arrives as a voice in the
 * crawlers' ears; the clue text carries the deduction chain that points first
 * at the magistrate, then at his secretary, and finally at the thing that has
 * been signing his letters.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';
import { crawlerName } from '../../../characters/characters';

const HUMAN_NAME = crawlerName('human');

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const THE_KRASUE_MURDERS = 'The Krasue Murders';

const baggi = speakerLines('baggi');
const narrator = transientSpeaker(THE_KRASUE_MURDERS, 'narration');
const theAlley = transientSpeaker('The Alley', 'narration');
const theTownWell = transientSpeaker('The Town Well', 'narration');
const lorisCottage = transientSpeaker('Old Lori’s Cottage', 'narration');
const theTowerPlaza = transientSpeaker('The Tower Plaza', 'narration');
const theUnreadableLetter = transientSpeaker('The Unreadable Letter', 'narration');
const ryan = speakerLines('ryan');
const belle = speakerLines('belle');
const mordecai = speakerLines('mordecaiInEar');

export const MURDER_HOOK: NonEmpty<DialogLine> = [
  baggi.line(
    'Psst. Crawlers. Over here. No, don’t look around, look at ME. Name’s Baggi. I got no coin and no class worth spit, but I got eyes. And my eyes have seen where the missing ones go.',
  ),
  baggi.line(
    'People are vanishing off the night streets. My friends. Low-street folk, the kind nobody files a report about. They turn up mornings, from the shoulders down. The Watch won’t come. Nobody comes for us.',
  ),
  belle.line(
    `${HUMAN_NAME}, she’s so sad. We have to help her. Can I give her a cuddle first? Then we can be detectives. I’ve never been a detective. Is it warm?`,
  ),
  baggi.line(
    'Meet me in the alley beside the Cloak & Dagger after dark and I’ll show you where they take them. Please. You’re the first ones who looked at me instead of through me.',
  ),
  mordecai.button(
    'After dark, then',
    '*Walk away from this one. A stranger with a sad story on this floor is bait, and you two bite on everything. ...You’re going to do it anyway, aren’t you. Fine. Then do me one favor. If you find anything on a dead body down here, leave it on the dead body. I mean it.*',
  ),
];

export const MURDER_BODY_FOUND: NonEmpty<DialogLine> = [
  theAlley.line(
    'Baggi lies crumpled behind the Cloak & Dagger, a day cold at least. She never made the meeting. Somebody made certain of that the same night she asked for help. The body ends at the shoulders. There is no head.',
  ),
  ryan.line(
    'Hey. Oh, no. She talked to us at noon and she was gone by midnight. That’s not bad luck. Somebody was watching her. Maybe watching us too.',
  ),
  belle.line(
    `I don’t want to look at the neck part. But ${HUMAN_NAME}, there’s paper in her coat. See? Right there. Poor Baggi.`,
  ),
  theAlley.line(
    'Two papers, tucked where a pickpocket wouldn’t bother to look. The first is a magistrate’s writ, the ink barely dry: ‘The bearer acts on my authority and is not to be detained.’ Signed, Magistrate Featherfall.',
  ),
  theAlley.line(
    'The second is a letter in no alphabet you know. Squiggles and triangles, written in a brown ink you are choosing not to think about.',
  ),
  mordecai.line(
    '*Hold it up so I can see it. ...Yeah. That’s necro-script. Living people don’t write it. Their hands can’t make the shapes. Whatever is running this thing, it’s already dead. So here’s my advice. Burn that letter and walk away from all of it.*',
  ),
  ryan.button(
    'Investigate',
    'Sorry, Mordecai. She died trying to get this to somebody, so it’s not getting burned. The witness is gone, the magistrate’s paperwork was on her, and whoever wrote this doesn’t breathe. Let’s go ask around town. Folks always know something.',
  ),
];

export const MURDER_WELL_CLUE: NonEmpty<DialogLine> = [
  theTownWell.line(
    'Deep gouges score the well’s rim. Talons, and drag marks where something heavy was hauled up out of hiding. Crushed into the mud beside them: a stick of schoolroom chalk, worn to a stub.',
  ),
  belle.button(
    'Noted',
    `${HUMAN_NAME}, look! Chalk! Teachers have chalk. Was a teacher here? At night? That’s a silly time for school.`,
  ),
];

export const MURDER_HOME_CLUE: NonEmpty<DialogLine> = [
  lorisCottage.line(
    'Claw furrows rake the paving outside Lori’s cottage, ending in a pool and a few torn scraps of a visitor’s shawl. The door stands latched from the inside, untouched. Tucked under the knocker, a note in a neat schoolteacher hand: ‘Evening lessons. Come alone.’ It is unsigned.',
  ),
  ryan.button(
    'Noted',
    'She was invited. Probably they all were. Nobody heads out alone at night for a stranger. You go because it’s somebody respectable. Somebody you’d feel rude saying no to.',
  ),
];

export const MURDER_ROOST_CLUE: NonEmpty<DialogLine> = [
  theTowerPlaza.line(
    'Beneath the magistrate’s tower, moulted Hawkfolk feathers lie arranged in a careful ring. A shrine: elf-made candles, fresh wax. Something burst through it since. The feathers are flung wide, and blood is thrown in an arc up the tower stone. Whatever took the victim went up.',
  ),
  ryan.line(
    'So the cult prays down here, and the blood goes up there. Featherfall’s roost is at the top of this tower. His paperwork was on the body, and now there’s blood on his walls. Everything keeps pointing at the magistrate.',
  ),
  belle.button(
    'Noted',
    `But where is the magistrate, ${HUMAN_NAME}? Nobody has seen him in weeks. Maybe he’s lonely up there. Maybe he needs a friend.`,
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
  ryan.line(
    'Whoa. We didn’t ask anything out loud, and it answered anyway. This isn’t a letter. It’s a window, and somebody’s been watching through it since the alley. Hi there, whoever you are.',
  ),
  mordecai.line(
    '*I told you to burn it. It has your faces now. Listen to me. Whatever has been taking people one at a time is about to try for two at once, and the sun is almost down. Get somewhere with walls.*',
  ),
  belle.line(
    `Walls are good. Walls keep the warm in. ${HUMAN_NAME}, stay close to me. I will protect you.`,
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
  ryan.line(
    'Krasue don’t own buttons. Somebody carried these things across town and let them loose at our door. The thing in the letter did the watching, and the cult did the carrying. Same as with the victims.',
  ),
  belle.button(
    'To the Lodge',
    `The button says Blackwood! Blackwood Lodge! Let’s go knock on their door, ${HUMAN_NAME}. Really loud.`,
  ),
];

export const MURDER_HIDEOUT_CLEARED: NonEmpty<DialogLine> = [
  narrator.line(
    'In the cellar, under the guttered candles: a duty ledger of names. Low-street names, Baggi’s among them, each struck through in a neat schoolteacher hand. The final page is an instruction: ‘Bring the next lessons to my capacitor at the top of the magistrate’s tower.’ It is signed ‘Miss Quill’, and sealed with a feather pressed into black wax.',
  ),
  ryan.line(
    'The schoolteacher! The chalk at the well, the note about evening lessons, handwriting way too neat for a butcher. She does the collecting, and the magistrate’s office keeps the Watch off her back. That writ on Baggi was a leash.',
  ),
  belle.line(
    `A teacher and a magistrate. And they’re both at the top of the tower? ${HUMAN_NAME}, it might be warm up there. Let’s go.`,
  ),
  mordecai.button(
    'To the tower',
    '*Quill I believe. This town is full of quiet little monsters. It’s Featherfall that bothers me. Thirty years of temple every seventh day, and then nothing but polite notes in handwriting that isn’t his? Talk to the deacon before you climb that tower. Then climb it angry.*',
  ),
];
