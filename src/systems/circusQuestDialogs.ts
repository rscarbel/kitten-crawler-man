/**
 * Dialog scripts for "The Show Must Go On" — Tsarina Signet's voice per the
 * book: theatrical, imperious, calculating, with the grief underneath.
 * Pure data; CircusQuestSystem owns pagination and rendering.
 */

export interface DialogPage {
  title: string;
  lines: string[];
  /** Label for the advance button on this page. */
  button: string;
}

const SIGNET = 'Tsarina Signet';

export const INTRO_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'Well. Crawlers. On their bellies in the weeds,',
      "spying on my husband's circus. How bold. How stupid.",
      'Stand up. You will be of use.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Mold Lions approach — the mangy things can smell an audience.',
      'Hold them off while I finish this casting.',
      'And do try to bleed somewhere convenient.',
      'The ink drinks better warm.',
    ],
    button: 'Defend her',
  },
];

export function buildRitualFailedDialog(mongoPresent: boolean): DialogPage[] {
  const suretyLines = mongoPresent
    ? [
        'So you will help me end it. As surety — your little beast',
        'comes with me. He will not be harmed... so long as you do',
        'exactly as I say.',
      ]
    : [
        'So you will help me end it. Refuse, and I promise you will',
        'never leave these grounds. Signet does not ask twice.',
      ];
  return [
    {
      title: SIGNET,
      lines: [
        "Useless. The lions' blood is ash — the casting needs more",
        'than vermin. ...Sit. Attend. I will tell you the story of',
        'Signet the Bastard, and Grimaldi — the man she loved.',
      ],
      button: 'Listen',
    },
    {
      title: SIGNET,
      lines: [
        'Redstone Grimaldi. A dwarf. Ringmaster of the great and',
        "wonderful Grimaldi's Traveling Circus. When the high elves",
        'wanted me dead, he took me in. He gave me a stage, a family,',
        'a name worth keeping. Later — much later — we married.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        "Then came Scolopendra's poison cloud. My family did not die.",
        'Worse. It folded my Grimaldi into a vine, and the vine keeps',
        'them all — puppets on green string, playing forever to',
        'empty seats.',
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
        'There is a bear. Heather. The crowds adored her. What',
        'shuffles in her skin now is not her — though somewhere in',
        'there, deep deep down, there is a spark of the old Heather.',
        'Her blood is old circus blood. It will fuel my ink where',
        'yours failed. Kill her gently, if you can. Then return to me.',
      ],
      button: 'Hunt Heather',
    },
  ];
}

export const HEATHER_RETURN_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: ['It is done? ...Good.', 'Do not tell me how she looked at the end.'],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'Watch now, crawlers. Every mark on my skin is a debt owed',
      'to me, and tonight I call them all in. My ink will walk',
      'beside you.',
    ],
    button: 'Continue',
  },
  {
    title: SIGNET,
    lines: [
      'We clear the grounds act by act — the sideshows first.',
      'Leave the big top for last. My husband is waiting,',
      'and I would have him see me coming.',
    ],
    button: 'Begin the assault',
  },
];

export const BIGTOP_READY_DIALOG: ReadonlyArray<DialogPage> = [
  {
    title: SIGNET,
    lines: [
      'The grounds are clear. Only the big top remains.',
      'The trunk hides behind its roots — cut them all,',
      'and the vine can finally die. Go. End the show.',
    ],
    button: 'Continue',
  },
];

export function buildResolutionDialog(mongoKidnapped: boolean): DialogPage[] {
  const beastLine = mongoKidnapped ? 'Your beast is returned, as promised.' : '';
  return [
    {
      title: SIGNET,
      lines: [
        "So falls the great and wonderful Grimaldi's Traveling",
        'Circus. Applaud, crawlers. He always loved the applause.',
      ],
      button: 'Continue',
    },
    {
      title: SIGNET,
      lines: [
        'My husband is at rest, and our family with him. The show,',
        'at long last, is over.',
        beastLine,
        'And crawlers — Signet does not forget her debts.',
      ].filter((line) => line.length > 0),
      button: 'Finish',
    },
  ];
}
