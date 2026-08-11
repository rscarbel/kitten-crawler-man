/**
 * Dialog scripts for "The Krasue Murders" — the Over City's town murder
 * mystery. GumGum is a jittery street elf with too many debts; Mordecai's
 * warning arrives as a voice in the crawlers' ears; the clue text carries the
 * investigation. Pure data; MurderMysteryQuestSystem owns pagination.
 */

import type { DialogPage } from '../ui/QuestDialog';

const GUMGUM = 'GumGum';
const NARRATOR = 'The Krasue Murders';

export const HOOK_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: GUMGUM,
    lines: [
      'Psst. Crawlers. Here. No, don’t look around, look at ME. Name’s GumGum. I got no coin and no class worth spit, but I got eyes, and my eyes seen something bad.',
    ],
    button: 'Continue',
  },
  {
    title: GUMGUM,
    lines: [
      'People are going missing off the night streets. My friends. They turn up after, but only from the shoulders down. The Watch won’t come. Nobody comes for us. Meet me in the alley beside the Desperado Club after dark. Please.',
    ],
    button: 'Continue',
  },
  {
    title: 'Mordecai (in your ear)',
    lines: [
      '"Walk away. A street tout with a sob story on this floor is bait, and you two are exactly the kind of fish that bites. ...You’re going to bite anyway, aren’t you."',
    ],
    button: 'We’ll think about it',
  },
];

export const BODY_FOUND_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Alley',
    lines: [
      'GumGum lies crumpled in the alley beside the Desperado Club, a day cold at least. Whatever she saw, someone made certain she’d never tell it. The body ends at the shoulders. There is no head.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'Something is harvesting the Over City’s forgotten (the ones nobody files a report about) and making monsters out of them. She was going to tell you where. Now you get to find out the slow way.',
      '',
      'The trail starts here. Try the town well, Old Hilda’s cottage, and the plaza beneath the magistrate’s tower.',
    ],
    button: 'Investigate',
  },
];

export const WELL_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Town Well',
    lines: [
      'Deep gouges score the well’s rim: talons, and drag marks where something was hauled up out of hiding. Crushed into the mud: a stick of schoolroom chalk. Odd litter for a well.',
    ],
    button: 'Noted',
  },
];

export const HOME_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Old Hilda’s Cottage',
    lines: [
      'Claw furrows rake the paving outside Hilda’s cottage, ending in a pool and a few torn scraps of unfamiliar cloth — a visitor’s shawl, by the weave, nothing from Hilda’s own wardrobe. Whatever waited by her gate did not carry its catch far before it stopped to feed.',
      '',
      'Her door stands latched from the inside, untouched — whoever came calling never reached it. Tucked under the knocker, a note in prim, perfect penmanship. "Evening lessons. Come alone." It is unsigned.',
    ],
    button: 'Noted',
  },
];

export const ROOST_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Tower Plaza',
    lines: [
      'Beneath the magistrate’s tower, moulted skyfowl feathers were arranged in a careful ring. A shrine — elf-made candles, fresh wax. Something burst through it since: the feathers are flung wide, blood is thrown in an arc up the tower stone, and a loop of gut lies where the candles stood.',
      '',
      'Someone down here worships the "angels" above... and Magistrate Featherfall suspects nothing at all.',
    ],
    button: 'Noted',
  },
];

export const NIGHT_FALLS_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The sun drops behind the ruins. Somewhere over the rooftops a wet shriek answers the dusk bell, then a dozen more. The hunt has come to the streets tonight. Survive it.',
    ],
    button: 'Defend the town',
  },
];

export const AFTERMATH_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The last head bursts in a spray of ichor. Tangled in its trailing hair: a brass button stamped with the Blackwood Barracks crest. The cult has a nest. And now you have an address.',
    ],
    button: 'To the Barracks',
  },
];

export const HIDEOUT_CLEARED_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The letter from the Barracks names the schoolteacher. Miss Quill. Her "capacitor" waits at the top of the magistrate’s tower. Climb it, and end the murders.',
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
 * The reveal, one page per speaker. The middle voice is not attributed on
 * purpose — the party cannot see the thing talking yet, and naming it in the
 * title would hand them the answer a beat before the room does.
 */
export const LICH_REVEAL_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Carl',
    lines: ['"The magistrate... he’s a corpse. He’s been dead this whole time."'],
    button: 'Continue',
  },
  {
    title: 'A voice from everywhere',
    lines: [
      '"Dead? The magistrate keeps his appointments. He signs his letters. He suspects nothing. I have seen to it."',
    ],
    button: 'Continue',
  },
  {
    title: 'Donut',
    lines: ['"Carl. The dead thing at the desk is the *nice* part of this room."'],
    button: 'Ready weapons',
  },
];
