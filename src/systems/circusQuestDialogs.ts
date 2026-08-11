/**
 * Dialog scripts for "The Show Must Go On", Tsarina Signet's voice per the
 * book: theatrical, imperious, calculating, with the grief underneath.
 * Pure data; CircusQuestSystem owns pagination and rendering.
 */

import type { DialogPage } from '../ui/QuestDialog';

export type { DialogPage };

const SIGNET = 'Tsarina Signet';

export const INTRO_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      "Well. Crawlers. On their bellies in the weeds, spying on my husband's circus. How bold. How stupid.",
      'Stand up. You will be of use.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Mold Lions approach. The mangy things can smell an audience. Hold them off while I finish this casting.',
      'And do try to bleed somewhere convenient. The ink drinks better warm.',
    ],
    button: 'Defend her',
  },
];

export function buildRitualFailedDialog(mongoPresent: boolean): DialogPage[] {
  const suretyLines = mongoPresent
    ? [
        'So you will help me end it. As surety, your little beast comes with me. He will not be harmed... so long as you do exactly as I say.',
      ]
    : [
        'So you will help me end it. Refuse, and I promise you will never leave these grounds. Signet does not ask twice.',
      ];
  return [
    {
      title: SIGNET,
      lines: [
        "Useless. The lions' blood is ash. The casting needs more than vermin.",
        '...Sit. Listen. I will tell you the story of Signet the Bastard, and Grimaldi, the man I loved.',
      ],
      button: 'Listen',
    },
    {
      title: SIGNET,
      lines: [
        "Redstone Grimaldi. A dwarf. Ringmaster of the great and wonderful Grimaldi's Traveling Circus. When the high elves wanted me dead, he took me in. He gave me a stage, a family, a name worth keeping.",
        'Later, much later, we married.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        "Then came Scolopendra's poison cloud. My family did not die. Worse. It folded my Grimaldi into a vine, and the vine keeps them all, puppets on green strings, playing forever to empty seats.",
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: suretyLines,
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'There is a bear. Heather. The crowds adored her. What shuffles in her skin now is not her. Though somewhere in there, deep, deep down, there is a spark of the old Heather.',
        'Hers is old circus blood. It will fuel my ink where yours failed. Kill her gently, if you can. Then return to me.',
      ],
      button: 'Hunt Heather',
    },
  ];
}

export const HEATHER_RETURN_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: ['It is done? ...Good.', 'Do not tell me how she looked at the end. Do not.'],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Watch now, crawlers. Every mark on my skin is a debt owed to me, and tonight I call them all in. My ink will walk beside you.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'We clear the grounds act by act. The sideshows first. Leave the big top for last.',
      'My husband is waiting, and I would have him see me coming.',
    ],
    button: 'Begin the assault',
  },
];

const CARL = 'Carl';
const GRIMALDI = 'Grimaldi';

/** The potion the tent's last act is performed with, granted so it cannot be missing. */
const BIGTOP_POTION_REWARD = {
  itemId: 'health_potion',
  displayName: 'Health Potion',
  lines: ['Drink it to close your wounds.', 'Or pour it over something that needs closing more.'],
  xp: 0,
} as const;

export const BIGTOP_READY_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'The grounds are clear. Only the big top remains, and I will not set foot in it. Not while he is in there wearing that shape.',
      'The tent is trapped end to end. Grimaldi never did put on a show without a floor that opened.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Take this. You will want it, and I think — I think you will find a use for it I have not the stomach to name.',
      'Go. Finish the show.',
    ],
    button: 'Enter the Big Top',
    reward: BIGTOP_POTION_REWARD,
  },
];

/**
 * What the tent tells the party when a vent catches one of them.
 *
 * One page, and the button closes it — the maze has already put both crawlers
 * back at their flaps by the time it is read, so there is nothing here to agree
 * to. It exists to explain the jump, which would otherwise read as the room
 * having gone wrong rather than as the price of standing in fire.
 */
export const BIGTOP_BURNOUT_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: 'Burned',
    lines: [
      'You were badly burned and passed out. You awake to find yourself at the beginning of this maze once again.',
    ],
    button: 'Get up',
  },
];

/**
 * The cure, inside the tent. One page per speaker turn, played straight through
 * from the moment the potion lands on him.
 */
export const GRIMALDI_CURE_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: CARL,
    lines: ["Signet is your daughter, I don't want to kill you but I can't let you hurt her."],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['Mmmm. errrrr. how dooo yooou knooow thaaat?'],
    button: 'Continue',
  },
  {
    title: CARL,
    lines: [
      'Scolopendra changed you and all these lands long ago. Many died, and many, like yourself, were permanently changed. I need you to remember who you were and stop sending your armies to kill people, including Signet.',
    ],
    button: 'Continue',
  },
  {
    title: GRIMALDI,
    lines: ['Mmmm. errrr. okaaay...'],
    button: 'Continue',
  },
];

/**
 * The resolution, outside the tent, played the instant the party is set down at
 * the door. Signet's line comes first because she has been standing out here
 * assuming the worst since they went in.
 */
export function buildResolutionDialog(mongoKidnapped: boolean): DialogPage[] {
  const pages: DialogPage[] = [
    {
      title: SIGNET,
      lines: ['Is it over? Did you kill him?'],
      button: 'Continue',
    },
    {
      title: `${GRIMALDI} (from within the tent)`,
      lines: [
        "It is me, my daughter. I don't remember everything, but I recognize you now. I don't know how I couldn't before. I am so sorry for all the trouble I've caused.",
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: ['Father!'],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: ['You have saved him, and me. Thank you.'],
      button: mongoKidnapped ? 'Continue' : 'Finish',
    },
  ];
  if (mongoKidnapped) {
    pages.push({
      title: SIGNET,
      lines: [
        'And your beast is returned, as promised. He bit three of my tattoos and slept through the rest of it.',
        'Signet does not forget her debts, crawlers.',
      ],
      button: 'Finish',
    });
  }
  return pages;
}
