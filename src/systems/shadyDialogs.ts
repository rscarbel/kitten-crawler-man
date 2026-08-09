/**
 * Dialog scripts for Shady, the hooded man who sells bounties by the notice
 * board. Terse, wry, and giving away nothing about who he is or where his coin
 * comes from — the joke is that nobody in the Over City has ever asked.
 *
 * Pure data; `DungeonScene` owns the pagination and rendering through the
 * shared `QuestDialog`.
 */

import type { DialogPage } from '../ui/QuestDialog';
import type { Difficulty } from '../core/difficultyProfiles';

export type { DialogPage };

const SHADY = 'Shady';

/**
 * The extra line disclosing a non-Normal payout, appended to the offer's last
 * page. Normal has no entry: the reward change is only worth naming where it
 * has actually changed, and Normal is identity.
 */
const DIFFICULTY_PAYOUT_LINES: Partial<Record<Difficulty, string>> = {
  easy: 'Kitten rates: the purse is lighter.',
  hard: 'Nightmare rates: the purse is heavier.',
};

/**
 * The pitch. `onComplete` on the last page is what issues the bounty, so the
 * mark is named here but nothing is committed until the player presses "Take
 * the job" — declining, or backing out with Esc, leaves the board untouched and
 * spawns nothing.
 *
 * The refusal is a button rather than only the Esc key because hearing the offer
 * should not *be* accepting it, and a modal whose only exit is an unadvertised
 * key does not read as a choice.
 *
 * @param difficulty The active difficulty, so the pay page can disclose the
 *   consequence where the contract is actually signed. No selector at the
 *   board itself — one global selector in Settings, per the difficulty
 *   toggle's design: a second control surface here would invite per-bounty
 *   reward-arbitrage toggling.
 */
export function buildBountyOfferDialog(
  name: string,
  typeLabel: string,
  difficulty: Difficulty,
): DialogPage[] {
  const payoutLine = DIFFICULTY_PAYOUT_LINES[difficulty];
  return [
    {
      title: SHADY,
      lines: [
        '...Psst. Down here. Don’t look at me, look at the board. Good. You’re a quick one.',
        'I have work. The kind nobody signs their name to.',
      ],
      button: 'Go on',
    },
    {
      title: SHADY,
      lines: [
        `Word is ${name} ${typeLabel} has been seen out past the tree line. Been making a mess. Somebody upstairs would like it to stop being a mess. That’s all either of us needs to know.`,
      ],
      button: 'And the pay?',
    },
    {
      title: SHADY,
      lines: [
        'Coin. Good coin. Whatever it was carrying, you keep. Kill it, come back, don’t tell anyone we spoke. Off you go.',
        ...(payoutLine === undefined ? [] : [payoutLine]),
      ],
      button: 'Take the job',
      declineButton: 'Walk away',
    },
  ];
}

/** Nothing more to say while the mark is still out there. */
export function buildBountyActiveDialog(name: string): DialogPage[] {
  return [
    {
      title: SHADY,
      lines: [
        `You know who you’re looking for. ${name}. Out there. I don’t hold hands and I don’t give directions. Go and be useful.`,
      ],
      button: 'Leave him to it',
    },
  ];
}

/** The payout. `onComplete` on the last page is what pays the coin. */
export function buildBountyPayoutDialog(name: string, coins: number): DialogPage[] {
  return [
    {
      title: SHADY,
      lines: [
        `${name}. Dead. Huh. Didn’t think you had it in you. No offence. I don’t think anyone has it in them, and I’m usually right.`,
      ],
      button: 'The pay',
    },
    {
      title: SHADY,
      lines: [
        `${coins} coins. Count them somewhere else. Come back when the ache wears off. There’s always another one.`,
        // The echo is the joke; it only lands on a line of its own.
        'There’s always another one.',
      ],
      button: 'Take the coin',
    },
  ];
}

/** The line on the proximity bubble, before the player has spoken to him. */
export const SHADY_PROXIMITY_BUBBLE = '…psst.';
