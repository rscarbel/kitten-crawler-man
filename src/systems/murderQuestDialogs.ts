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
      'Psst. Crawlers. Here — no, don’t look around, look at ME.',
      'Name’s GumGum. I got no coin and no class worth spit,',
      'but I got eyes, and my eyes seen something bad.',
    ],
    button: 'Continue',
  },
  {
    title: GUMGUM,
    lines: [
      'People are going missing off the night streets. My friends.',
      'They turn up after — but only from the shoulders down.',
      'The Watch won’t come. Nobody comes for us.',
      'Meet me behind the Sunken Stump after dark. Please.',
    ],
    button: 'Continue',
  },
  {
    title: 'Mordecai (in your ear)',
    lines: [
      '"Walk away. A street tout with a sob story on this floor',
      'is bait, and you two are exactly the kind of fish that',
      'bites. ...You’re going to bite anyway, aren’t you."',
    ],
    button: 'We’ll think about it',
  },
];

export const BODY_FOUND_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Alley',
    lines: [
      'GumGum lies crumpled behind the pub, a day cold at least.',
      'Whatever he saw, someone made certain he’d never tell it.',
      'The body ends at the shoulders. There is no head.',
    ],
    button: 'Continue',
  },
  {
    title: NARRATOR,
    lines: [
      'New quest: The Krasue Murders. Something is harvesting the',
      'Over City’s forgotten — and making monsters of them.',
      'The trail starts here. Check the town well, Old Hilda’s',
      'cottage, and the plaza beneath the magistrate’s tower.',
    ],
    button: 'Investigate',
  },
];

export const WELL_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Town Well',
    lines: [
      'Deep gouges score the well’s rim — talons, and drag marks',
      'where something was hauled up out of hiding. Crushed into',
      'the mud: a stick of schoolroom chalk. Odd litter for a well.',
    ],
    button: 'Noted',
  },
];

export const HOME_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Old Hilda’s Cottage',
    lines: [
      'Hilda’s door hangs open. Her bed is unslept-in, her mirror',
      'draped with a sheet. On the table, a note in prim, perfect',
      'penmanship: "Evening lessons. Come alone." It is unsigned.',
    ],
    button: 'Noted',
  },
];

export const ROOST_CLUE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'The Tower Plaza',
    lines: [
      'Beneath the magistrate’s tower, moulted skyfowl feathers',
      'are arranged in a careful ring — a shrine. Elf-made candles,',
      'fresh wax. Someone down here worships the "angels" above...',
      'and Magistrate Featherfall suspects nothing at all.',
    ],
    button: 'Noted',
  },
];

export const NIGHT_FALLS_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The sun drops behind the ruins. Somewhere over the rooftops',
      'a wet shriek answers the dusk bell — then a dozen more.',
      'The hunt has come to the streets tonight. Survive it.',
    ],
    button: 'Defend the town',
  },
];

export const AFTERMATH_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The last head bursts in a spray of ichor. Tangled in its',
      'trailing hair: a brass button stamped with the Blackwood',
      'Barracks crest. The cult has a nest — and you have an address.',
    ],
    button: 'To the Barracks',
  },
];

export const HIDEOUT_CLEARED_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: NARRATOR,
    lines: [
      'The letter from the Barracks names the schoolteacher.',
      'Miss Quill. Her "capacitor" waits at the top of the',
      'magistrate’s tower — climb it, and end the murders.',
    ],
    button: 'To the tower',
  },
];
