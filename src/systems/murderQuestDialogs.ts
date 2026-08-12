/**
 * Dialog scripts for "The Krasue Murders" — the Over City's town murder
 * mystery. GumGum is a street elf who saw a taking; Mordecai's warning arrives
 * as a voice in the crawlers' ears; the clue text carries the deduction chain
 * that points first at the magistrate, then at his secretary, and finally at
 * the thing that has been signing his letters. Pure data;
 * MurderMysteryQuestSystem and QuillConfrontationSystem own pagination.
 *
 * Donut's lines are ALL CAPS everywhere, without exception — it is her single
 * most recognizable voice trait, and a lowercase line reads as a different
 * character.
 */

import type { DialogPage } from '../ui/QuestDialog';

const GUMGUM = 'GumGum';
const NARRATOR = 'The Krasue Murders';
const CARL = 'Carl';
const DONUT = 'Donut';
const MORDECAI = 'Mordecai (in your ear)';
const QUILL = 'Miss Quill';
/**
 * The Lich is never named in a dialog title. The party cannot see the thing
 * talking, and naming it in the heading would hand them the answer a beat
 * before the room does.
 */
const LICH = 'A voice from everywhere';

export const HOOK_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: GUMGUM,
    lines: [
      'Psst. Crawlers. Over here. No, don’t look around, look at ME. Name’s GumGum. I got no coin and no class worth spit, but I got eyes. And my eyes have seen where the missing ones go.',
    ],
    button: 'Continue',
  },
  {
    title: GUMGUM,
    lines: [
      'People are vanishing off the night streets. My friends. Low-street folk, the kind nobody files a report about. They turn up mornings, from the shoulders down. The Watch won’t come. Nobody comes for us.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'CARL. THIS POOR WOMAN NEEDS OUR HELP. ALSO, I HAVE ALWAYS WANTED TO BE A DETECTIVE. I HAVE THE CHEEKBONES FOR IT. THE PRINCESS POSSE IS TAKING THE CASE.',
    ],
    button: 'Continue',
  },
  {
    title: GUMGUM,
    lines: [
      'Meet me in the alley beside the Desperado Club after dark and I’ll show you where they take them. Please. You’re the first ones who looked at me instead of through me.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Walk away from this one. A stranger with a sad story on this floor is bait, and you two bite on everything. ...You’re going to do it anyway, aren’t you. Fine. Then do me one favor. If you find anything on a dead body down here, leave it on the dead body. I mean it.*',
    ],
    button: 'After dark, then',
  },
];

export const BODY_FOUND_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Alley',
    lines: [
      'GumGum lies crumpled behind the Desperado Club, a day cold at least. She never made the meeting. Somebody made certain of that the same night she asked for help. The body ends at the shoulders. There is no head.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'She talked to us at noon and she was dead by midnight. That’s not bad luck. Somebody was watching her. Or watching us.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'I AM NOT LOOKING AT THE NECK PART, CARL. I AM LOOKING AT HER COAT. THERE IS PAPER STICKING OUT OF HER COAT. DETECTIVES NOTICE THINGS LIKE THAT.',
    ],
    button: 'Continue',
  },
  {
    title: 'The Alley',
    lines: [
      'Two papers, tucked where a pickpocket wouldn’t bother to look. The first is a magistrate’s writ, the ink barely dry: ‘The bearer acts on my authority and is not to be detained.’ Signed, Magistrate Featherfall.',
    ],
    button: 'Continue',
  },
  {
    title: 'The Alley',
    lines: [
      'The second is a letter in no alphabet you know. Squiggles and triangles, written in a brown ink you are choosing not to think about.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Hold it up so I can see it. ...Yeah. That’s necro-script. Living people don’t write it. Their hands can’t make the shapes. Whatever is running this thing, it’s already dead. So here’s my advice. Burn that letter and walk away from all of it.*',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'She died trying to hand somebody this. I’m not burning it. Okay. The one witness is dead, the magistrate’s paperwork was on her body, and whoever wrote this doesn’t breathe. Let’s go find out what the town knows.',
    ],
    button: 'Investigate',
  },
];

export const WELL_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Town Well',
    lines: [
      'Deep gouges score the well’s rim. Talons, and drag marks where something heavy was hauled up out of hiding. Crushed into the mud beside them: a stick of schoolroom chalk, worn to a stub.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'CHALK, CARL. WHO BRINGS CHALK TO A WELL? TEACHERS, THAT’S WHO. TEACHERS AND MURDERERS. AND I AM STARTING TO WONDER IF THAT IS ONE PERSON.',
    ],
    button: 'Noted',
  },
];

export const HOME_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Old Hilda’s Cottage',
    lines: [
      'Claw furrows rake the paving outside Hilda’s cottage, ending in a pool and a few torn scraps of a visitor’s shawl. The door stands latched from the inside, untouched. Tucked under the knocker, a note in a neat schoolteacher hand: ‘Evening lessons. Come alone.’ It is unsigned.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'She was invited. They all were, probably. Nobody goes out alone at night to meet a stranger. You go because it’s somebody respectable. Somebody you’d feel stupid saying no to.',
    ],
    button: 'Noted',
  },
];

export const ROOST_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Tower Plaza',
    lines: [
      'Beneath the magistrate’s tower, moulted skyfowl feathers lie arranged in a careful ring. A shrine: elf-made candles, fresh wax. Something burst through it since. The feathers are flung wide, and blood is thrown in an arc up the tower stone. Whatever took the victim went up.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'So the cult prays down here, and the blood goes up there. Featherfall’s roost is at the top of this tower. His paperwork was on the body, and now there’s blood on his walls. Everything keeps coming back to the magistrate.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'THEN WHERE IS HE, CARL? NOBODY HAS SEEN HIM IN WEEKS. EVEN VILLAINS TAKE CURTAIN CALLS. ESPECIALLY VILLAINS, ACTUALLY.',
    ],
    button: 'Noted',
  },
];

/**
 * The letter answers a question nobody asked out loud, and the sun goes down on
 * the same page. One dialog rather than two: the taunt is *why* the night
 * attack happens, and a page break between them would let the player read them
 * as unrelated.
 */
export const TAUNT_AND_NIGHTFALL_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Unreadable Letter',
    lines: [
      'The letter in your pack grows warm. The ink crawls, rearranges itself, and settles into plain script, in the same neat schoolteacher hand as the note on Hilda’s door: ‘No, you won’t.’',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'We didn’t ask anything out loud. It answered anyway. This thing isn’t a letter. It’s a window, and somebody has been on the other side of it since the alley.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*I told you to burn it. It has your faces now. Listen to me. Whatever has been taking people one at a time is about to try for two at once, and the sun is almost down. Get somewhere with walls.*',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'GOOD. LET THEM COME, CARL. I HAVE BEEN PRACTICING MY DETECTIVE FACE, AND ALSO MY LASERS.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'The sun drops behind the ruins. Somewhere over the rooftops a wet shriek answers the dusk bell, then a dozen more, closing from every quarter. They are not hunting the town tonight. They are hunting you. Survive it.',
    ],
    button: 'Defend yourselves',
  },
];

export const AFTERMATH_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The last head bursts in a spray of ichor. Tangled in its trailing hair: a brass button stamped with the Blackwood Barracks crest, and a reek of candle wax and cellar damp.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'Krasue don’t own buttons. Somebody hauled these things across town and let them loose at our door. The thing in the letter did the watching, and the cult did the carrying. Same as with the victims.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'THEN THE CULT HAS AN ADDRESS, CARL. BLACKWOOD LODGE. WE ARE GOING TO GO KNOCK VERY, VERY LOUDLY.',
    ],
    button: 'To the Lodge',
  },
];

export const HIDEOUT_CLEARED_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'In the cellar, under the guttered candles: a duty ledger of names. Low-street names, GumGum’s among them, each struck through in a neat schoolteacher hand. The final page is an instruction: ‘Bring the next lessons to my capacitor at the top of the magistrate’s tower.’ It is signed ‘Miss Quill’, and sealed with a feather pressed into black wax.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'The schoolteacher. The chalk at the well, the note about evening lessons, handwriting too neat for a butcher. She does the collecting, and the magistrate’s office keeps the Watch off her back. That writ on GumGum’s body was a leash.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'A TEACHER AND A MAGISTRATE, CARL. IT IS A CONSPIRACY. AND SINCE BOTH OF THEM ARE AT THE TOP OF THAT TOWER, I PLAN TO MAKE AN EXTREMELY DRAMATIC ENTRANCE.',
    ],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*Quill I believe. This town is full of quiet little monsters. It’s Featherfall that bothers me. Thirty years of temple every seventh day, and then nothing but polite notes in handwriting that isn’t his? Talk to the deacon before you climb that tower. Then climb it angry.*',
    ],
    button: 'To the tower',
  },
];

/**
 * The optional look at the magistrate before the room explains itself. Written
 * so it costs the player nothing to skip: it says what is in front of them and
 * asks the question the reveal answers, rather than carrying anything the quest
 * depends on.
 */
export const FEATHERFALL_EXAMINE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Carl',
    lines: [
      'The magistrate hasn’t moved since we came up the stairs. He hasn’t moved in a long time — the ink in that well is a solid brick and his sash is grey with dust.',
      '',
      '"He’s been dead for weeks. Then who has been signing the magistrate’s letters?"',
    ],
    button: 'Back away',
  },
];

/**
 * Arriving at the top of the tower, before the Quill fight opens. The room is
 * held for it: the last page is what puts a boss on the field.
 */
export const QUILL_OFFICE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Top Floor',
    lines: [
      'The magistrate’s office is spotless. The ledgers are current. The ink is fresh. At the great desk by the north wall, someone sits very still in the gloom. Between you and the desk, at a tidy secretary’s station, perches an elderly skyfowl in spectacles, pen scratching away as though two armed crawlers walk in every day.',
    ],
    button: 'Continue',
  },
  {
    title: QUILL,
    lines: [
      'You are not in the appointment ledger. The magistrate sees petitioners on the seventh day. You may leave your names with me. I keep excellent records.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'We’re done with appointments. People are dying in the low streets, your cult burned down last night, and your name is signed at the bottom of their duty ledger. Where’s Featherfall?',
    ],
    button: 'Continue',
  },
  {
    title: QUILL,
    lines: [
      'The magistrate is at his desk, where he has always been. He is simply particular about visitors. As am I.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'CARL. THE BIRD AT THE BIG DESK HAS NOT MOVED SINCE WE CAME IN. OR BLINKED. OR BREATHED. I HAVE WORKED WITH SOME VERY WOODEN ACTORS, CARL, AND THAT IS NOT AN ACTOR.',
    ],
    button: 'Continue',
  },
  {
    title: QUILL,
    lines: [
      'Hm. It was the chalk, I suppose. Or the note. I did tell her to come alone. Witnesses make everything so untidy. Well. You have interrupted years of careful work, children, and I am afraid the syllabus does not allow for interruptions. Mr. Remex? Ring the bell.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'The thing beside the desk unfolds. A skyfowl shape with no feathers left, eyes like black glass, something pale steaming off it like heat off a summer road. It does not want to be here. It does what she says anyway.',
    ],
    button: 'Ready weapons',
  },
];

/**
 * The reveal. The voice is not attributed on purpose — see {@link LICH}.
 */
export const LICH_REVEAL_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'Miss Quill drops mid-sentence, and for one long moment her floating pen keeps writing without her, striking one last name from a list. Then it clatters to the boards, and the office is quiet.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'The magistrate’s a corpse. The secretary ran the harvest. That should be the end of it. So why does this room still feel like somebody’s in it?',
    ],
    button: 'Continue',
  },
  {
    title: LICH,
    lines: [
      'Because the magistrate keeps his appointments. He signs his letters. He suspects nothing, and he never will. I have seen to it.',
    ],
    button: 'Continue',
  },
  {
    title: LICH,
    lines: [
      'The teacher believed the souls were for her husband. That enough of them would buy him back whole. Grief will sign anything you put in front of it. It does not read the terms.',
    ],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: ['CARL. THE DEAD THING AT THE DESK IS THE NICE PART OF THIS ROOM.'],
    button: 'Continue',
  },
  {
    title: MORDECAI,
    lines: [
      '*That’s a lich. The letter, the writs, the harvest. You were never chasing the schoolteacher. You were chasing the thing that holds her leash. Kill it, and don’t count it dead until the fire in that hood goes out.*',
    ],
    button: 'Ready weapons',
  },
];

/**
 * The Lich's own name, used only once the party can see the thing talking.
 * Before that it is {@link LICH} — see the note there.
 */
const THE_LICH = 'The Lich';

/**
 * One line each, played over the scripted slide that opens a battle phase.
 * Single pages on purpose: the fight is paused for them, and a phase change the
 * player has to read four screens of is a phase change they resent.
 */
export const LICH_FIREWALL_BARK: ReadonlyArray<DialogPage> = [
  {
    title: THE_LICH,
    lines: ['Enough. Stand at the back of the office, and wait to be seen.'],
    button: 'Continue',
  },
];

export const LICH_TANTRUM_BARK: ReadonlyArray<DialogPage> = [
  {
    title: THE_LICH,
    lines: ['You were told to WAIT.'],
    button: 'Continue',
  },
];

export const LICH_RECKONING_BARK: ReadonlyArray<DialogPage> = [
  {
    title: THE_LICH,
    lines: ['No more appointments. The office is closed.'],
    button: 'Continue',
  },
];

/**
 * Played on the Lich's death, before `finishConfrontation` arms the Doomsday
 * chain — the containment clock is wall-clock, so it must not start ticking
 * under a dialog the player is still reading.
 */
export const VICTORY_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The robe folds over nothing and settles on the boards. The seal at its belt, Featherfall’s seal, cracks down the middle. Somewhere beneath the floorboards, something enormous begins, very slowly, to wake.',
    ],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: ['For GumGum. Somebody looked.'],
    button: 'Continue',
  },
  {
    title: DONUT,
    lines: [
      'AND THE PRINCESS POSSE HAS CLOSED THE CASE, CARL. I WILL BE ACCEPTING AWARDS SHORTLY.',
    ],
    button: 'It’s not over',
  },
];
