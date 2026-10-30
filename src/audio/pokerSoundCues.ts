/**
 * Every sound the poker table makes, by what happened rather than by file.
 *
 * Play sites raise a cue and never name a `SoundId` directly, so when a
 * recording lands it is registered once and swapped in here, and every place
 * that cue fires picks it up. A cue still waiting on its own file borrows the
 * nearest existing sound or stays silent (an empty list); its JSDoc names the
 * files it is waiting for. A `SoundId` is never registered before its file
 * exists. A cue with several takes is rotated through, one take per play.
 */

import type { SoundId } from './sounds';

export const POKER_CUES = {
  /** Waiting for `casino/poker_check_knock_1.mp3` … `_2.mp3`. */
  check: ['casino_blackjack_check'],
  /** Waiting for `casino/poker_fold_muck_1.mp3` … `_3.mp3`. */
  fold: ['casino_deal_card'],
  /** Waiting for `casino/poker_board_flop.mp3`. */
  board_flop: ['casino_deal_four_cards'],
  /** Waiting for `casino/poker_board_card.mp3`; the turn and the river. */
  board_card: ['casino_deal_card'],
  /** Waiting for `casino/poker_all_in_push.mp3`. */
  all_in: ['casino_chips_bet_big'],
  /** Waiting for `casino/poker_pot_sweep.mp3`. */
  pot_sweep: ['casino_chips_stack'],
  /** Waiting for `casino/poker_dealer_button.mp3`. */
  dealer_button: [],
  /** Waiting for `casino/poker_chip_riffle_1.mp3` … `_3.mp3`; a regular's idle fidget. */
  chip_riffle: [],
  /** The action reaches the player. */
  your_turn: ['poker_your_turn'],
  /** Waiting for `casino/poker_table_slam.mp3`; a tilted regular after a bad beat. */
  table_slam: [],
  /** A big all-in pot turned face up for the run-out. */
  rail_ooh: ['poker_rail_ooh_1', 'poker_rail_ooh_2', 'poker_rail_ooh_3'],
  /** A human regular loses a big pot. */
  reaction_groan: [
    'poker_reaction_groan_1',
    'poker_reaction_groan_2',
    'poker_reaction_groan_3',
    'poker_reaction_groan_4',
  ],
  /** A human regular's bluff is shown and wins after the flop. */
  reaction_chuckle: [
    'poker_reaction_chuckle_1',
    'poker_reaction_chuckle_2',
    'poker_reaction_chuckle_3',
    'poker_reaction_chuckle_4',
  ],
  /** A Hawkfolk regular's bluff is shown and wins after the flop: the town's Hawkfolk laugh. */
  hawkfolk_chuckle: ['hawkfolk_laugh_1'],
  deal_card: ['casino_deal_card'],
  bet_small: ['casino_chips_bet_small'],
  bet_big: ['casino_chips_bet_big'],
  cash_out: ['casino_chips_stack'],
  rebuy: ['casino_chips_stack'],
  buy_in: ['purchase_success'],
} as const satisfies Record<string, readonly SoundId[]>;

export type PokerCue = keyof typeof POKER_CUES;

/**
 * The take a cue plays on its `played`th time (counting from zero), or null
 * while it stays silent.
 */
export function pokerCueSound(cue: PokerCue, played = 0): SoundId | null {
  const takes: readonly SoundId[] = POKER_CUES[cue];
  if (takes.length === 0) return null;
  return takes[played % takes.length] ?? null;
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
