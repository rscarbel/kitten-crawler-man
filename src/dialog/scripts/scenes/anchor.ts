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

//  Madame Voss

export const VOSS_OFFER_INTRO = voss.button(
  'Go on',
  "Come dear children; sit and listen to this old woman. Don't be shy, I'm not here to take your money, I'm here to tell you a story. A story about a stone imbued with great power, who's lost pieces have been turning up in this very town the past few weeks.",
);

export const VOSS_OFFER_HISTORY = voss.line(
  "Long before this to town was settled, before a brick had been laid or a drop of ale spilled, there was a sorceress who made her home in the woods right here. She lived peacefully, and would guide lost travelers through the forest, warding against the dangers that lurk within. However, in this world, no kindness or good deed goes unpunished. Word of her powers and deeds spread to neighboring towns and villages, and the words found quarter with the greed of one man who sought to have some of her power for himself. He pretended to be a weary traveler who could take not one step further without rest. He begged the sorceress for a place to lay and regain his strength and she offered him protection through the night. When she was preparing him a meal that evening, he stepped away to relieve himself, taking a sick from the fire for light. Not two minutes later, he raced back to their camp and in a frenzy relayed that he lost his footing and set ablaze to the forest floor and could not put it out. The sorceress, not interested in moving their camp rushed in the dark, departed to put out the flame before it could rage out of control. She sealed the flame with a spell until it was quenched. When she returned to camp, she found the traveler had gone missing. Fled in the night, robing her of any possession he could find. Most was useless to him, but he had taken a stone which she had laid years of work imbuing her good will towards travelers and her kindness into. It remembers any location for which its wielder has shown kindness and for which they have great significance in. It allowed near instant travel to such locations. It was named Wayfinder's Anchor, because it can bring you to the places that are most dear no matter how far you are. The sorceress was hurt deeply by the betrayal. She was not naive to believe that no one would ever take advantage of her kindness, but she weighed the cost of betrayal worth the purchase of the joy, safety, and freedom it bought for many. Instead of abandoning her commitment to help travelers thorough these woods, she laid down a spell of sabotage against the stone. When her casting was complete, the stone shattered, so that it would be of no use to anyone without magically repairing it. She did not see that stone again, but she made sure a thief in the night would not benefit from his betrayal.",
);

/** The last beat: `Ending.confirm` carries the accept/decline labels, so this line's own advance is never shown. */
export const VOSS_OFFER_PITCH = voss.line(
  "My cards tell me that the all pieces of this stone have returned home. They are here, in these city walls. Funny how that works; the magic is so powerful that the pieces of the broken stone all still found themselves in the very place they were so deeply attached to. I suppose the name Wayfinder's Anchor came about. It has come to be that one piece was dropped at Old Hilda's by a visitor. The temple recieved another as an offering. The third I saw changing hands at the market stall just here next to me. Bring me all three parts and I am one of few remaining people left who know how to invoke the magic to restore it.",
);

/** Shown when she is asked again with the errand still unfinished. */
export const VOSS_PROGRESS = voss.fn(
  (a: {
    readonly shardsHeld: number;
    readonly shardsRequired: number;
    readonly outstanding: ReadonlyArray<string>;
  }): LineText => {
    const tally = `${a.shardsHeld} of ${a.shardsRequired}.`;
    const intro = 'Back already. Let me guess. You want me to tell you again where the stones are.';
    if (a.outstanding.length === 0) {
      return `${intro} ${tally} You have all of them. Put them on the table.`;
    }
    return `${intro} ${tally} Still remaining: ${a.outstanding.join(', ')}.`;
  },
);

/** The assembly's first beat: `Ending.confirm` again carries the pay/decline labels. */
export const VOSS_ASSEMBLY_OFFER = voss.fn(
  (a: { readonly feeCoins: number }): LineText =>
    `All three. Magnificent. If you would, please show this poor old woman the same kindness that went into this stone to begin with. It was made with the magic of warmth towards a stranger, and your act is the needed piece to bring these back together. ${a.feeCoins} coins will do.`,
);

export const VOSS_ASSEMBLY_DONE = voss.button(
  'Take the stone',
  'There. Incredible! Feel that? That warmth is the stone at home; this very town square lays on top of the same clearing in the woods that the sorceress once lived. If you use this when you are out in the wild, it will bring you back here, where it is anchored. It cannot be used in rapid succession, and there are spells that can block it, but it should help you travel around much faster.',
);

export const VOSS_CANNOT_AFFORD = voss.fn(
  (a: { readonly feeCoins: number }): LineText =>
    `${a.feeCoins} coins. You don't seem to have enough my dear. Come back to me once you have the coin for this..`,
);

// ── Old Hilda

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
