/**
 * Every sound the poker table makes, by what happened rather than by file.
 *
 * Play sites raise a cue and never name a `SoundId` directly, so when a
 * recording lands it is registered once and swapped in here, and every place
 * that cue fires picks it up. A cue still waiting on its own file borrows the
 * nearest existing sound or stays silent (`null`); its JSDoc names the files it
 * is waiting for. A `SoundId` is never registered before its file exists.
 */

import type { SoundId } from '../../../audio/sounds';

export const POKER_CUES = {
  /** Waiting for `casino/poker_check_knock_1.mp3` … `_2.mp3`. */
  check: 'casino_blackjack_check',
  /** Waiting for `casino/poker_fold_muck_1.mp3` … `_3.mp3`. */
  fold: 'casino_deal_card',
  /** Waiting for `casino/poker_board_flop.mp3`. */
  board_flop: 'casino_deal_four_cards',
  /** Waiting for `casino/poker_board_card.mp3`; the turn and the river. */
  board_card: 'casino_deal_card',
  /** Waiting for `casino/poker_all_in_push.mp3`. */
  all_in: 'casino_chips_bet_big',
  /** Waiting for `casino/poker_pot_sweep.mp3`. */
  pot_sweep: 'casino_chips_stack',
  /** Waiting for `casino/poker_dealer_button.mp3`. */
  dealer_button: null,
  /** Waiting for `casino/poker_chip_riffle_1.mp3` … `_3.mp3`; a regular's idle fidget. */
  chip_riffle: null,
  /** Waiting for `casino/poker_your_turn.mp3`. */
  your_turn: null,
  /** Waiting for `casino/poker_table_slam.mp3`; a tilted regular after a bad beat. */
  table_slam: null,
  /** Waiting for `casino/poker_rail_ooh.mp3`; a big all-in pot revealed at showdown. */
  rail_ooh: null,
  /** Waiting for `casino/poker_reaction_groan_1.mp3` … `_2.mp3`; a human regular loses big. */
  reaction_groan: null,
  /** Waiting for `casino/poker_reaction_chuckle_1.mp3` … `_2.mp3`; a human regular wins or shows a bluff. */
  reaction_chuckle: null,
  deal_card: 'casino_deal_card',
  bet_small: 'casino_chips_bet_small',
  bet_big: 'casino_chips_bet_big',
  cash_out: 'casino_chips_stack',
  rebuy: 'casino_chips_stack',
  buy_in: 'purchase_success',
} as const satisfies Record<string, SoundId | null>;

export type PokerCue = keyof typeof POKER_CUES;

/** The sound a cue plays today, or null while it stays silent. */
export function pokerCueSound(cue: PokerCue): SoundId | null {
  return POKER_CUES[cue];
}

const SHUFFLE_SOUNDS = [
  'casino_shuffle_1',
  'casino_shuffle_2',
] as const satisfies readonly SoundId[];

/** The pre-deal riffle, alternating recordings hand to hand so back-to-back shuffles never sound looped. */
export function shuffleSound(handNumber: number): SoundId {
  const index = Math.abs(Math.trunc(handNumber)) % SHUFFLE_SOUNDS.length;
  return SHUFFLE_SOUNDS[index] ?? SHUFFLE_SOUNDS[0];
}

/**
 * A wager this many big blinds or larger lands as a heavy stack; anything
 * smaller is a few chips tossed in. Measured against the blind rather than in
 * coins so every tier sounds the same for the same kind of bet.
 */
export const BIG_BET_BIG_BLINDS = 10;

/** Which chip sound a bet, call or raise of `amount` plays at a table with this big blind. */
export function betChipsCue(amount: number, bigBlind: number): 'bet_small' | 'bet_big' {
  const bigBlinds = bigBlind > 0 ? amount / bigBlind : 0;
  return bigBlinds >= BIG_BET_BIG_BLINDS ? 'bet_big' : 'bet_small';
}
