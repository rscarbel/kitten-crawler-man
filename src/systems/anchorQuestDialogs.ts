/**
 * Dialog scripts for "The Anchor is Broken", Madame Voss's voice: a plaza
 * fortune teller on a floor of a dungeon that is also a livestreamed game show.
 * She is a fraud about the mystical and completely straight about the practical,
 * and she knows exactly which half the audience is watching for.
 *
 * Pure data; `AnchorQuestSystem` owns pagination, rendering and the transaction.
 */

import type { DialogPage, DialogReward } from '../ui/QuestDialog';

const VOSS = 'Madame Voss';

/**
 * The reward preview, stated in what it does rather than what it is called.
 * "Wayfinder's Anchor" tells a first-time player nothing about whether three
 * errands are worth walking.
 */
export function buildAnchorReward(xp: number): DialogReward {
  return {
    itemId: 'wayfinders_anchor',
    displayName: "Wayfinder's Anchor",
    lines: [
      'Anywhere in the Over City: sends the party back to the town square.',
      'In the square: sends you back to where you left. One minute between trips.',
    ],
    xp,
  };
}

/** Voss's offer. The last page carries the reward strip and the refusal. */
export function buildOfferDialog(reward: DialogReward): DialogPage[] {
  return [
    {
      title: VOSS,
      lines: [
        'Sit. No, do not pay me yet. The cards are already out and they are being rude about you.',
        '',
        'Ah. Not about you. About the road behind you. You have walked it, what, four times now? Five? The same road. Both ways.',
      ],
      button: 'Go on',
    },
    {
      title: VOSS,
      lines: [
        'There was a stone, once. Long before any of this, before the lights, before the little flying eyes, a wayfinder carried it, and it carried them right back. Anywhere to home. Home to anywhere.',
        '',
        'Then somebody dropped it. Or the management dropped it. The cards are vague, and the management is litigious.',
      ],
      button: 'And now?',
    },
    {
      title: VOSS,
      lines: [
        'Three pieces. Three neighbours, none of whom know what they are sitting on. The tinker has one priced as scrap. Old Hilda has one under a chair leg. The temple has one in the altar, and a rat problem they will want discussing first.',
        '',
        'Bring me all three and I will make it whole. Then you never walk that road again, and I never have to watch you do it.',
      ],
      button: 'Find the shards',
      declineButton: 'Not today',
      reward,
    },
  ];
}

/** Shown when she is asked again with the errand still unfinished. */
export function buildProgressDialog(
  shardsHeld: number,
  shardsRequired: number,
  outstanding: ReadonlyArray<string>,
): DialogPage[] {
  const tally = `${shardsHeld} of ${shardsRequired}.`;
  const lines =
    outstanding.length === 0
      ? [
          `${tally} All of them. Put them on the table and stop looking so pleased. You are about to pay a fee.`,
        ]
      : [`${tally} Still outstanding:`, '', ...outstanding.map((line) => `  ${line}`)];
  return [
    {
      title: VOSS,
      lines: [
        'Back already. Let me guess. You want me to tell you again where the stones are, even though I already told you.',
        '',
        ...lines,
      ],
      button: 'Right',
    },
  ];
}

/** The assembly, once all three are on the table and the fee can be paid. */
export function buildAssemblyDialog(feeCoins: number, reward: DialogReward): DialogPage[] {
  return [
    {
      title: VOSS,
      lines: [
        'All three. Good. Hold them still. No, still. The joining does not care how brave you are.',
        '',
        `My fee is ${feeCoins} coins. Yes, for four seconds of work. You are paying for the thirty years I spent knowing which four seconds.`,
      ],
      button: `Pay ${feeCoins}c`,
      declineButton: 'Keep the coins',
      reward,
    },
    {
      title: VOSS,
      lines: [
        'There. Feel that? That is the stone deciding you are home.',
        '',
        'Out in the city it drags you back to the square. Standing in the square it drags you back where you were. A minute to catch its breath between.',
        '',
        'It will not work underground, it will not work with something snarling at you, and it will absolutely not work in a boss room, so do not embarrass us both.',
      ],
      button: 'Take the stone',
    },
  ];
}

/** She cannot make change, and she will not be doing it on credit. */
export function buildCannotAffordDialog(feeCoins: number): DialogPage[] {
  return [
    {
      title: VOSS,
      lines: [
        `${feeCoins} coins. You have counted twice now and it has not improved. Go and be violent at something with pockets.`,
        '',
        'The shards keep. So does my fee.',
      ],
      button: 'Fine',
    },
  ];
}

// No "questline complete" page on purpose: once the stone exists Voss has
// nothing left to say about it, so consulting her falls through to the card
// reading she was always there to give.

// ── Old Hilda ───────────────────────────────────────────────────────────────
//
// A hedge-witch with no roof-tax, no god and no carpenter. She is not being
// brave about the state of her furniture; she has simply had thirty years to
// stop noticing it, and being asked about it is the annoying part.

const HILDA = 'Old Hilda';

/** Her terms, the first time the party asks about the shard. */
export function buildHildaRequestDialog(
  repairsRequired: number,
  boardsPerRepair: number,
): DialogPage[] {
  return [
    {
      title: HILDA,
      lines: [
        'The grey stone under the chair leg. Aye, that one. It’s been holding that chair level since before your mother was old enough to be rude to anyone.',
        '',
        'You can have it. But you take it and the chair goes over, and then I’m an old woman sat on the floor, and the cards didn’t mention that part, did they.',
      ],
      button: 'What do you want?',
    },
    {
      title: HILDA,
      lines: [
        'Three things in this room are broken. The worktable. The chair it lost its leg arguing with. And a shelf that gave up in the spring, which I’ve been pretending I meant to happen. Put all three right and the shard’s yours. I won’t even charge you for the wood.',
        '',
        `There’s a pile of boards by the door, help yourself. Takes ${boardsPerRepair} to a mend and there’s ${repairsRequired} mends in it, so don’t come back at me short. Go stand at a broken thing. It’ll tell you what it wants.`,
      ],
      button: "I'll do it",
      declineButton: 'Later',
    },
  ];
}

/** Asked again with work outstanding. */
export function buildHildaProgressDialog(
  repairsDone: number,
  repairsRequired: number,
  holdsEnoughBoards: boolean,
): DialogPage[] {
  const tally = `${repairsDone} of ${repairsRequired} mended.`;
  const nudge = holdsEnoughBoards
    ? 'You’ve got the wood on you. Go and stand at one of them.'
    : 'And you’re carrying no wood, which is usually the trouble.';
  return [
    {
      title: HILDA,
      lines: [`${tally} I can count, dearie. I’m old, not blind.`, '', nudge],
      button: 'Right',
    },
  ];
}

/** Everything mended; the shard comes out from under the chair. */
export function buildHildaRewardDialog(): DialogPage[] {
  return [
    {
      title: HILDA,
      lines: [
        'Well. Look at that. A room.',
        '',
        'Here, take it before I get used to the quiet and change my mind. Thirty years under a chair leg and it hasn’t so much as dulled. Whatever that thing is, dearie, it isn’t a rock.',
      ],
      button: 'Take the shard',
    },
  ];
}

// ── Deacon Aviel ────────────────────────────────────────────────────────────
//
// A deacon of a faith that takes donations rather than tithes. He is entirely
// unsentimental about the temple's problems and slightly embarrassed that this
// is one of them.

const AVIEL = 'Deacon Aviel';

/** The altar's shard, and the condition attached to it. */
export function buildAvielRequestDialog(): DialogPage[] {
  return [
    {
      title: AVIEL,
      lines: [
        'The stone set in the altar face. You are the third person this year to ask, and the first two were thieves, so you can understand my hesitation.',
        '',
        'It comes out easily enough. It was never holy. It was here first and we built around it, which is most of theology.',
      ],
      button: 'So?',
    },
    {
      title: AVIEL,
      lines: [
        'So there are rats in my nave, and the congregation has noticed. I cannot bless a room I am apologising for.',
        '',
        'They will not fight you. They will run, and they are quick, and that is the entire difficulty. Clear them out and the shard is yours with my blessing, which I will also throw in free.',
      ],
      button: 'Consider it done',
      declineButton: 'Not now',
    },
  ];
}

/** Asked again with vermin still loose. */
export function buildAvielProgressDialog(verminRemaining: number): DialogPage[] {
  const tally =
    verminRemaining === 1
      ? 'There is one left. I can hear it behind the third pew.'
      : 'There are still a few left, and I can hear all of them.';
  return [
    {
      title: AVIEL,
      lines: [
        tally,
        '',
        'Take your time. The dome has stood eighty years. It can stand another quarter of an hour of this.',
      ],
      button: 'Right',
    },
  ];
}

/** The nave is quiet; the altar gives up its stone. */
export function buildAvielRewardDialog(): DialogPage[] {
  return [
    {
      title: AVIEL,
      lines: [
        'Listen to that. Nothing. Eighty years and I do not think this room has ever once been quiet.',
        '',
        'Take it. It came loose the moment I touched it, which I choose not to think about. Tell Madame Voss the temple says hello, and that we know exactly what she charges.',
      ],
      button: 'Take the shard',
    },
  ];
}
