/**
 * Blackjack rules as pure functions — no state, no rendering, no deck.
 *
 * House rules: the dealer stands on all 17 (including soft 17),
 * naturals pay 3:2, no split / insurance / surrender.
 */

import type { Card, Rank } from './Deck';

export const ACE_LOW = 1;
export const ACE_HIGH = 11;
export const BLACKJACK_TOTAL = 21;
export const DEALER_STANDS_ON = 17;
export const FACE_CARD_VALUE = 10;
export const NATURAL_HAND_SIZE = 2;

/** The bump from counting one ace high instead of low. */
const ACE_PROMOTION = ACE_HIGH - ACE_LOW;

const RANK_VALUES: Record<Rank, number> = {
  A: ACE_LOW,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': FACE_CARD_VALUE,
  J: FACE_CARD_VALUE,
  Q: FACE_CARD_VALUE,
  K: FACE_CARD_VALUE,
};

export interface HandValue {
  readonly total: number;
  /** True when an ace is still counted as 11 — the hand can absorb a bust. */
  readonly soft: boolean;
}

/** The card's value with every ace counted low; `handValue` promotes one if it fits. */
export function cardValue(card: Card): number {
  return RANK_VALUES[card.rank];
}

/** True for the ten-value ranks, which is what makes a natural with an ace. */
export function isTenValue(card: Card): boolean {
  return card.rank !== 'A' && RANK_VALUES[card.rank] === FACE_CARD_VALUE;
}

/**
 * Every ace counts 1, then exactly one is promoted to 11 if that keeps the hand
 * at or under 21. Promoting a second ace could never help — two high aces are
 * already 22.
 */
export function handValue(cards: ReadonlyArray<Card>): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += RANK_VALUES[card.rank];
    if (card.rank === 'A') aces++;
  }
  if (aces > 0 && total + ACE_PROMOTION <= BLACKJACK_TOTAL) {
    return { total: total + ACE_PROMOTION, soft: true };
  }
  return { total, soft: false };
}

export function isBust(cards: ReadonlyArray<Card>): boolean {
  return handValue(cards).total > BLACKJACK_TOTAL;
}

/** 21 on the first two cards — the only hand that pays 3:2. */
export function isNaturalBlackjack(cards: ReadonlyArray<Card>): boolean {
  return cards.length === NATURAL_HAND_SIZE && handValue(cards).total === BLACKJACK_TOTAL;
}

/** S17: the dealer draws below 17 and stands on everything from 17 up, soft or hard. */
export function dealerShouldHit(cards: ReadonlyArray<Card>): boolean {
  return handValue(cards).total < DEALER_STANDS_ON;
}

export type RoundOutcome =
  { kind: 'player_blackjack' } | { kind: 'player_win' } | { kind: 'dealer_win' } | { kind: 'push' };

const PLAYER_BLACKJACK: RoundOutcome = { kind: 'player_blackjack' };
const PLAYER_WIN: RoundOutcome = { kind: 'player_win' };
const DEALER_WIN: RoundOutcome = { kind: 'dealer_win' };
const PUSH: RoundOutcome = { kind: 'push' };

export function settleRound(
  playerCards: ReadonlyArray<Card>,
  dealerCards: ReadonlyArray<Card>,
): RoundOutcome {
  const playerNatural = isNaturalBlackjack(playerCards);
  const dealerNatural = isNaturalBlackjack(dealerCards);
  if (playerNatural && dealerNatural) return PUSH;
  if (playerNatural) return PLAYER_BLACKJACK;
  if (dealerNatural) return DEALER_WIN;

  // A bust loses even against a dealer who would also have busted — the player
  // acts first, so the hand is already dead by the time the dealer draws.
  if (isBust(playerCards)) return DEALER_WIN;
  if (isBust(dealerCards)) return PLAYER_WIN;

  const player = handValue(playerCards).total;
  const dealer = handValue(dealerCards).total;
  if (player > dealer) return PLAYER_WIN;
  if (player < dealer) return DEALER_WIN;
  return PUSH;
}

export const BLACKJACK_NUMERATOR = 3;
export const BLACKJACK_DENOMINATOR = 2;
export const EVEN_MONEY = 1;

/**
 * Coins returned to the player, stake included — so a push pays back the stake
 * and a loss pays nothing.
 *
 * A 3:2 payout on an odd stake lands on a half coin (25 → 37.5). A real table
 * settles that with a half chip; the game has only whole coins, so the winnings
 * round down.
 */
export function payoutFor(outcome: RoundOutcome, stake: number): number {
  switch (outcome.kind) {
    case 'player_blackjack':
      return stake + Math.floor((stake * BLACKJACK_NUMERATOR) / BLACKJACK_DENOMINATOR);
    case 'player_win':
      return stake + stake * EVEN_MONEY;
    case 'push':
      return stake;
    case 'dealer_win':
      return 0;
  }
}

/** Net change to the player's coins for an outcome, given the stake already on the felt. */
export function netForOutcome(outcome: RoundOutcome, stake: number): number {
  return payoutFor(outcome, stake) - stake;
}
