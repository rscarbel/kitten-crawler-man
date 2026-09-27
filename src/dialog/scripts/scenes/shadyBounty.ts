/**
 * Shady's bounty pitch, the reminder while a mark is out, and the payout —
 * the three conversations `BountySystem` opens off the notice board.
 */

import { speakerLines } from '../../line';
import type { LineText } from '../../line';
import type { Difficulty } from '../../../core/difficultyProfiles';

const say = speakerLines('shady');

/**
 * The extra line disclosing a non-Normal payout, appended to the offer's last
 * page. Normal has no entry: the reward change is only worth naming where it
 * has actually changed, and Normal is identity.
 */
const DIFFICULTY_PAYOUT_LINES: Partial<Record<Difficulty, string>> = {
  easy: 'Kitten rates: the purse is lighter.',
  hard: 'Nightmare rates: the purse is heavier.',
};

export const SHADY_BOUNTY = {
  offerIntro: say.button(
    'Go on',
    '...Psst. Down here. Don’t look at me, look at the board. Good. You’re a quick one. I have work. The kind nobody signs their name to.',
  ),

  offerMark: say.fnButton(
    'And the pay?',
    (a: { readonly name: string; readonly typeLabel: string }): LineText =>
      `Word is ${a.name} ${a.typeLabel} has been seen out past the tree line. Been making a mess. Somebody upstairs would like it to stop being a mess. That’s all either of us needs to know.`,
  ),

  offerPitch: say.fn((a: { readonly difficulty: Difficulty }): LineText => {
    const base =
      'Coin. Good coin. Whatever it was carrying, you keep. Kill it, come back, don’t tell anyone we spoke. Off you go.';
    const payoutLine = DIFFICULTY_PAYOUT_LINES[a.difficulty];
    return payoutLine === undefined ? base : `${base} ${payoutLine}`;
  }),

  active: say.fnButton(
    'Leave him to it',
    (a: { readonly name: string }): LineText =>
      `You know who you’re looking for. ${a.name}. Out there. I don’t hold hands and I don’t give directions. Go and be useful.`,
  ),

  payoutIntro: say.fnButton(
    'The pay',
    (a: { readonly name: string }): LineText =>
      `${a.name}. Dead. Huh. Didn’t think you had it in you. No offence. I don’t think anyone has it in them, and I’m usually right.`,
  ),

  // The echo is the joke; it only lands on a line of its own, so it stays on
  // this page rather than opening a second one.
  payoutCoins: say.fnButton(
    'Take the coin',
    (a: { readonly name: string; readonly coins: number }): LineText =>
      `${a.coins} coins. Count them somewhere else. Come back when the ache wears off. There’s always another one.\nThere’s always another one.`,
  ),
};
