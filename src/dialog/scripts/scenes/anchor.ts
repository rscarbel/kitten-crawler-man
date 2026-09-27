/**
 * "The Anchor is Broken" — Madame Voss's fortune-teller pitch, and the two
 * neighbours who each hold a piece of the stone she wants whole again.
 *
 * Voss is a fraud about the mystical and completely straight about the
 * practical, and she knows exactly which half the audience is watching for.
 * Old Hilda is a hedge-witch with thirty years of practice not noticing her
 * own furniture. Deacon Aviel is unsentimental about the temple's problems
 * and slightly embarrassed that this is one of them.
 */

import { speakerLines } from '../../line';
import type { DialogLine, LineText, NonEmpty } from '../../line';
import type { DialogReward } from '../../request';

const voss = speakerLines('voss');
const hilda = speakerLines('hilda');
const aviel = speakerLines('aviel');

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

// ── Madame Voss ──────────────────────────────────────────────────────────────

export const VOSS_OFFER_INTRO = voss.button(
  'Go on',
  'Sit. No, do not pay me yet. The cards are already out and they are being rude about you. Ah. Not about you. About the road behind you. You have walked it, what, four times now? Five? The same road. Both ways.',
);

export const VOSS_OFFER_HISTORY = voss.button(
  'And now?',
  'There was a stone, once. Long before any of this, before the lights, before the little flying eyes, a wayfinder carried it, and it carried them right back. Anywhere to home. Home to anywhere. Then somebody dropped it. Or the management dropped it. The cards are vague, and the management is litigious.',
);

/** The last beat: `Ending.confirm` carries the accept/decline labels, so this line's own advance is never shown. */
export const VOSS_OFFER_PITCH = voss.line(
  'Three pieces. Three neighbours, none of whom know what they are sitting on. The tinker has one priced as scrap. Old Hilda has one under a chair leg. The temple has one in the altar, and a rat problem they will want discussing first. Bring me all three and I will make it whole. Then you never walk that road again, and I never have to watch you do it.',
);

/** Shown when she is asked again with the errand still unfinished. */
export const VOSS_PROGRESS = voss.fn(
  (a: {
    readonly shardsHeld: number;
    readonly shardsRequired: number;
    readonly outstanding: ReadonlyArray<string>;
  }): LineText => {
    const tally = `${a.shardsHeld} of ${a.shardsRequired}.`;
    const intro =
      'Back already. Let me guess. You want me to tell you again where the stones are, even though I already told you.';
    if (a.outstanding.length === 0) {
      return `${intro} ${tally} All of them. Put them on the table and stop looking so pleased. You are about to pay a fee.`;
    }
    return `${intro} ${tally} Still outstanding: ${a.outstanding.join(', ')}.`;
  },
);

/** The assembly's first beat: `Ending.confirm` again carries the pay/decline labels. */
export const VOSS_ASSEMBLY_OFFER = voss.fn(
  (a: { readonly feeCoins: number }): LineText =>
    `All three. Good. Hold them still. No, still. The joining does not care how brave you are. My fee is ${a.feeCoins} coins. Yes, for four seconds of work. You are paying for the thirty years I spent knowing which four seconds.`,
);

export const VOSS_ASSEMBLY_DONE = voss.button(
  'Take the stone',
  'There. Feel that? That is the stone deciding you are home. Out in the city it drags you back to the square. Standing in the square it drags you back where you were. A minute to catch its breath between. It will not work underground, it will not work with something snarling at you, and it will absolutely not work in a boss room, so do not embarrass us both.',
);

/** She cannot make change, and she will not be doing it on credit. */
export const VOSS_CANNOT_AFFORD = voss.fn(
  (a: { readonly feeCoins: number }): LineText =>
    `${a.feeCoins} coins. You have counted twice now and it has not improved. Go and be violent at something with pockets. The shards keep. So does my fee.`,
);

// No "questline complete" line on purpose: once the stone exists Voss has
// nothing left to say about it, so consulting her falls through to the card
// reading she was always there to give.

// ── Old Hilda ────────────────────────────────────────────────────────────────

export const HILDA_REQUEST_INTRO = hilda.button(
  'What do you want?',
  'The grey stone under the chair leg. Aye, that one. It’s been holding that chair level since before your mother was old enough to be rude to anyone. You can have it. But you take it and the chair goes over, and then I’m an old woman sat on the floor, and the cards didn’t mention that part, did they.',
);

/** The last beat: `Ending.confirm` carries the accept/decline labels, so this line's own advance is never shown. */
export const HILDA_REQUEST_TERMS = hilda.fn(
  (a: { readonly boardsPerRepair: number; readonly repairsRequired: number }): LineText =>
    `Three things in this room are broken. The worktable. The chair it lost its leg arguing with. And a shelf that gave up in the spring, which I’ve been pretending I meant to happen. Put all three right and the shard’s yours. I won’t even charge you for the wood. There’s a pile of boards by the door, help yourself. Takes ${a.boardsPerRepair} to a mend and there’s ${a.repairsRequired} mends in it, so don’t come back at me short. Go stand at a broken thing. It’ll tell you what it wants.`,
);

/** Asked again with work outstanding. */
export const HILDA_PROGRESS = hilda.fn(
  (a: {
    readonly repairsDone: number;
    readonly repairsRequired: number;
    readonly holdsEnoughBoards: boolean;
  }): LineText => {
    const tally = `${a.repairsDone} of ${a.repairsRequired} mended.`;
    const nudge = a.holdsEnoughBoards
      ? 'You’ve got the wood on you. Go and stand at one of them.'
      : 'And you’re carrying no wood, which is usually the trouble.';
    return `${tally} I can count, dearie. I’m old, not blind. ${nudge}`;
  },
);

/** Everything mended; the shard comes out from under the chair. */
export const HILDA_REWARD: NonEmpty<DialogLine> = [
  hilda.button(
    'Take the shard',
    'Well. Look at that. A room. Here, take it before I get used to the quiet and change my mind. Thirty years under a chair leg and it hasn’t so much as dulled. Whatever that thing is, dearie, it isn’t a rock.',
  ),
];

// ── Deacon Aviel ─────────────────────────────────────────────────────────────

export const AVIEL_REQUEST_INTRO = aviel.button(
  'So?',
  'The stone set in the altar face. You are the third person this year to ask, and the first two were thieves, so you can understand my hesitation. It comes out easily enough. It was never holy. It was here first and we built around it, which is most of theology.',
);

/** The last beat: `Ending.confirm` carries the accept/decline labels, so this line's own advance is never shown. */
export const AVIEL_REQUEST_TERMS = aviel.line(
  'So there are rats in my nave, and the congregation has noticed. I cannot bless a room I am apologising for. They will not fight you. They will run, and they are quick, and that is the entire difficulty. Clear them out and the shard is yours with my blessing, which I will also throw in free.',
);

/** Asked again with vermin still loose. */
export const AVIEL_PROGRESS = aviel.fn((a: { readonly verminRemaining: number }): LineText => {
  const tally =
    a.verminRemaining === 1
      ? 'There is one left. I can hear it behind the third pew.'
      : 'There are still a few left, and I can hear all of them.';
  return `${tally} Take your time. The dome has stood eighty years. It can stand another quarter of an hour of this.`;
});

/** The nave is quiet; the altar gives up its stone. */
export const AVIEL_REWARD: NonEmpty<DialogLine> = [
  aviel.button(
    'Take the shard',
    'Listen to that. Nothing. Eighty years and I do not think this room has ever once been quiet. Take it. It came loose the moment I touched it, which I choose not to think about. Tell Madame Voss the temple says hello, and that we know exactly what she charges.',
  ),
];
