/**
 * "The Krasue Murders" — the Over City's town murder mystery. GumGum is a
 * street elf who saw a taking; Mordecai's warning arrives as a voice in the
 * crawlers' ears; the clue text carries the deduction chain that points first
 * at the magistrate, then at his secretary, and finally at the thing that has
 * been signing his letters.
 *
 * Donut's lines are ALL CAPS everywhere, without exception — it is her single
 * most recognizable voice trait, and a lowercase line reads as a different
 * character.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { DialogLine, NonEmpty } from '../../line';

/** The murder mystery's own header, for a narration page with no more specific location to name. */
const THE_KRASUE_MURDERS = 'The Krasue Murders';

const gumgum = speakerLines('gumgum');
const narrator = transientSpeaker(THE_KRASUE_MURDERS, 'narration');
const theAlley = transientSpeaker('The Alley', 'narration');
const theTownWell = transientSpeaker('The Town Well', 'narration');
const hildasCottage = transientSpeaker('Old Hilda’s Cottage', 'narration');
const theTowerPlaza = transientSpeaker('The Tower Plaza', 'narration');
const theUnreadableLetter = transientSpeaker('The Unreadable Letter', 'narration');
const carl = speakerLines('carl');
const donut = speakerLines('donut');
const mordecai = speakerLines('mordecaiInEar');

export const MURDER_HOOK: NonEmpty<DialogLine> = [
  gumgum.line(
    'Psst. Crawlers. Over here. No, don’t look around, look at ME. Name’s GumGum. I got no coin and no class worth spit, but I got eyes. And my eyes have seen where the missing ones go.',
  ),
  gumgum.line(
    'People are vanishing off the night streets. My friends. Low-street folk, the kind nobody files a report about. They turn up mornings, from the shoulders down. The Watch won’t come. Nobody comes for us.',
  ),
  donut.line(
    'CARL. THIS POOR WOMAN NEEDS OUR HELP. ALSO, I HAVE ALWAYS WANTED TO BE A DETECTIVE. I HAVE THE CHEEKBONES FOR IT. THE PRINCESS POSSE IS TAKING THE CASE.',
  ),
  gumgum.line(
    'Meet me in the alley beside the Desperado Club after dark and I’ll show you where they take them. Please. You’re the first ones who looked at me instead of through me.',
  ),
  mordecai.button(
    'After dark, then',
    '*Walk away from this one. A stranger with a sad story on this floor is bait, and you two bite on everything. ...You’re going to do it anyway, aren’t you. Fine. Then do me one favor. If you find anything on a dead body down here, leave it on the dead body. I mean it.*',
  ),
];

export const MURDER_BODY_FOUND: NonEmpty<DialogLine> = [
  theAlley.line(
    'GumGum lies crumpled behind the Desperado Club, a day cold at least. She never made the meeting. Somebody made certain of that the same night she asked for help. The body ends at the shoulders. There is no head.',
  ),
  carl.line(
    'She talked to us at noon and she was dead by midnight. That’s not bad luck. Somebody was watching her. Or watching us.',
  ),
  donut.line(
    'I AM NOT LOOKING AT THE NECK PART, CARL. I AM LOOKING AT HER COAT. THERE IS PAPER STICKING OUT OF HER COAT. DETECTIVES NOTICE THINGS LIKE THAT.',
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
  carl.button(
    'Investigate',
    'She died trying to hand somebody this. I’m not burning it. Okay. The one witness is dead, the magistrate’s paperwork was on her body, and whoever wrote this doesn’t breathe. Let’s go find out what the town knows.',
  ),
];

export const MURDER_WELL_CLUE: NonEmpty<DialogLine> = [
  theTownWell.line(
    'Deep gouges score the well’s rim. Talons, and drag marks where something heavy was hauled up out of hiding. Crushed into the mud beside them: a stick of schoolroom chalk, worn to a stub.',
  ),
  donut.button(
    'Noted',
    'CHALK, CARL. WHO BRINGS CHALK TO A WELL? TEACHERS, THAT’S WHO. TEACHERS AND MURDERERS. AND I AM STARTING TO WONDER IF THAT IS ONE PERSON.',
  ),
];

export const MURDER_HOME_CLUE: NonEmpty<DialogLine> = [
  hildasCottage.line(
    'Claw furrows rake the paving outside Hilda’s cottage, ending in a pool and a few torn scraps of a visitor’s shawl. The door stands latched from the inside, untouched. Tucked under the knocker, a note in a neat schoolteacher hand: ‘Evening lessons. Come alone.’ It is unsigned.',
  ),
  carl.button(
    'Noted',
    'She was invited. They all were, probably. Nobody goes out alone at night to meet a stranger. You go because it’s somebody respectable. Somebody you’d feel stupid saying no to.',
  ),
];

export const MURDER_ROOST_CLUE: NonEmpty<DialogLine> = [
  theTowerPlaza.line(
    'Beneath the magistrate’s tower, moulted skyfowl feathers lie arranged in a careful ring. A shrine: elf-made candles, fresh wax. Something burst through it since. The feathers are flung wide, and blood is thrown in an arc up the tower stone. Whatever took the victim went up.',
  ),
  carl.line(
    'So the cult prays down here, and the blood goes up there. Featherfall’s roost is at the top of this tower. His paperwork was on the body, and now there’s blood on his walls. Everything keeps coming back to the magistrate.',
  ),
  donut.button(
    'Noted',
    'THEN WHERE IS HE, CARL? NOBODY HAS SEEN HIM IN WEEKS. EVEN VILLAINS TAKE CURTAIN CALLS. ESPECIALLY VILLAINS, ACTUALLY.',
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
    'The letter in your pack grows warm. The ink crawls, rearranges itself, and settles into plain script, in the same neat schoolteacher hand as the note on Hilda’s door: ‘No, you won’t.’',
  ),
  carl.line(
    'We didn’t ask anything out loud. It answered anyway. This thing isn’t a letter. It’s a window, and somebody has been on the other side of it since the alley.',
  ),
  mordecai.line(
    '*I told you to burn it. It has your faces now. Listen to me. Whatever has been taking people one at a time is about to try for two at once, and the sun is almost down. Get somewhere with walls.*',
  ),
  donut.line(
    'GOOD. LET THEM COME, CARL. I HAVE BEEN PRACTICING MY DETECTIVE FACE, AND ALSO MY LASERS.',
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
  carl.line(
    'Krasue don’t own buttons. Somebody hauled these things across town and let them loose at our door. The thing in the letter did the watching, and the cult did the carrying. Same as with the victims.',
  ),
  donut.button(
    'To the Lodge',
    'THEN THE CULT HAS AN ADDRESS, CARL. BLACKWOOD LODGE. WE ARE GOING TO GO KNOCK VERY, VERY LOUDLY.',
  ),
];

export const MURDER_HIDEOUT_CLEARED: NonEmpty<DialogLine> = [
  narrator.line(
    'In the cellar, under the guttered candles: a duty ledger of names. Low-street names, GumGum’s among them, each struck through in a neat schoolteacher hand. The final page is an instruction: ‘Bring the next lessons to my capacitor at the top of the magistrate’s tower.’ It is signed ‘Miss Quill’, and sealed with a feather pressed into black wax.',
  ),
  carl.line(
    'The schoolteacher. The chalk at the well, the note about evening lessons, handwriting too neat for a butcher. She does the collecting, and the magistrate’s office keeps the Watch off her back. That writ on GumGum’s body was a leash.',
  ),
  donut.line(
    'A TEACHER AND A MAGISTRATE, CARL. IT IS A CONSPIRACY. AND SINCE BOTH OF THEM ARE AT THE TOP OF THAT TOWER, I PLAN TO MAKE AN EXTREMELY DRAMATIC ENTRANCE.',
  ),
  mordecai.button(
    'To the tower',
    '*Quill I believe. This town is full of quiet little monsters. It’s Featherfall that bothers me. Thirty years of temple every seventh day, and then nothing but polite notes in handwriting that isn’t his? Talk to the deacon before you climb that tower. Then climb it angry.*',
  ),
];
