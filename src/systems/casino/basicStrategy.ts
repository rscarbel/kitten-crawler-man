/**
 * The book play for the hand on the felt — the source of the live advice line
 * under the action buttons.
 *
 * Standard basic strategy for a dealer who stands on all 17, with no split,
 * insurance or surrender, so it never advises a move the table cannot make. A
 * double is only ever suggested while doubling is still legal; where the chart
 * says double but the hand has already been hit, it falls back to the chart's
 * secondary action.
 */

import type { Card } from './Deck';
import { ACE_HIGH, cardValue, handValue } from './blackjackRules';

export type StrategyAction = 'hit' | 'stand' | 'double';

export interface StrategyAdvice {
  readonly action: StrategyAction;
  /** One short, factual line naming what the dealer shows and what the book says. */
  readonly line: string;
}

// Dealer up-card bands the chart turns on.
const DEALER_WEAK_LOW = 2;
const DEALER_WEAK_HIGH = 6;
/** Lowest up card a hard 9 or a soft 17 will double against. */
const DEALER_DOUBLE_FLOOR_MID = 3;
/** Lowest up card a hard 12 or a soft 15/16 will act against. */
const DEALER_DOUBLE_FLOOR_HIGH = 4;
/** Lowest up card the weakest soft doubles (A2/A3) will double against. */
const DEALER_DOUBLE_FLOOR_SOFT_LOW = 5;

// Hard-total thresholds.
const HARD_NINE = 9;
const HARD_TEN = 10;
const HARD_ELEVEN = 11;
const HARD_TWELVE = 12;
const HARD_STIFF_MAX = 16;
const HARD_STAND_MIN = 17;

// Soft-total thresholds (the total already counts one ace as 11).
const SOFT_LOW_MIN = 13;
const SOFT_LOW_MAX = 14;
const SOFT_MID_MIN = 15;
const SOFT_MID_MAX = 16;
const SOFT_SEVENTEEN = 17;
const SOFT_EIGHTEEN = 18;
const SOFT_NINETEEN = 19;

/** Dealer up cards a soft 18 can still beat by standing. */
const SOFT_EIGHTEEN_STAND_HIGH = 8;

/** Highest dealer up card an eleven still doubles against; an ace is a plain hit. */
const ELEVEN_DOUBLE_MAX = 10;
/** Highest dealer up card a ten still doubles against. */
const TEN_DOUBLE_MAX = 9;

function dealerUpValue(upCard: Card): number {
  return upCard.rank === 'A' ? ACE_HIGH : cardValue(upCard);
}

function dealerLabel(upCard: Card): string {
  return upCard.rank === 'A' ? 'an ace' : upCard.rank;
}

function inWeakBand(up: number): boolean {
  return up >= DEALER_WEAK_LOW && up <= DEALER_WEAK_HIGH;
}

/** The weak band with its floor raised — how every "double from N through 6" row reads. */
function inBand(up: number, floor: number): boolean {
  return up >= floor && up <= DEALER_WEAK_HIGH;
}

/** The chart's answer, before checking whether doubling is still legal. */
function chartAction(total: number, soft: boolean, up: number): StrategyAction {
  if (soft) {
    if (total >= SOFT_NINETEEN) return 'stand';
    if (total === SOFT_EIGHTEEN) {
      if (inWeakBand(up)) return 'double';
      return up <= SOFT_EIGHTEEN_STAND_HIGH ? 'stand' : 'hit';
    }
    if (total === SOFT_SEVENTEEN) return inBand(up, DEALER_DOUBLE_FLOOR_MID) ? 'double' : 'hit';
    if (total >= SOFT_MID_MIN && total <= SOFT_MID_MAX) {
      return inBand(up, DEALER_DOUBLE_FLOOR_HIGH) ? 'double' : 'hit';
    }
    if (total >= SOFT_LOW_MIN && total <= SOFT_LOW_MAX) {
      return inBand(up, DEALER_DOUBLE_FLOOR_SOFT_LOW) ? 'double' : 'hit';
    }
    return 'hit';
  }

  if (total >= HARD_STAND_MIN) return 'stand';
  if (total >= SOFT_LOW_MIN && total <= HARD_STIFF_MAX) return inWeakBand(up) ? 'stand' : 'hit';
  if (total === HARD_TWELVE) return inBand(up, DEALER_DOUBLE_FLOOR_HIGH) ? 'stand' : 'hit';
  if (total === HARD_ELEVEN) return up <= ELEVEN_DOUBLE_MAX ? 'double' : 'hit';
  if (total === HARD_TEN) return up <= TEN_DOUBLE_MAX ? 'double' : 'hit';
  if (total === HARD_NINE) return inBand(up, DEALER_DOUBLE_FLOOR_MID) ? 'double' : 'hit';
  // Eight or less: no total is close enough to 21 for standing to make sense.
  return 'hit';
}

/** Where the chart says double but doubling is closed, this is the next-best move. */
function fallbackForClosedDouble(total: number, soft: boolean, up: number): StrategyAction {
  if (soft) return total === SOFT_EIGHTEEN && up <= SOFT_EIGHTEEN_STAND_HIGH ? 'stand' : 'hit';
  return 'hit';
}

function adviceLine(action: StrategyAction, total: number, soft: boolean, upCard: Card): string {
  const shows = `Dealer shows ${dealerLabel(upCard)}`;
  const hand = soft ? `soft ${total}` : `${total}`;
  switch (action) {
    case 'double':
      return `${shows} — doubling on ${hand} is the book play.`;
    case 'stand':
      return `${shows} — standing on ${hand} is the book play.`;
    case 'hit':
      return `${shows} — hitting ${hand} is the book play.`;
  }
}

/**
 * The book play for `playerCards` against the dealer's up card, or `null` when
 * there is nothing to advise (no hand on the felt, or no up card yet).
 */
export function basicStrategyAdvice(
  playerCards: ReadonlyArray<Card>,
  dealerUpCard: Card | undefined,
  doubleAvailable: boolean,
): StrategyAdvice | null {
  if (playerCards.length === 0 || dealerUpCard === undefined) return null;
  const { total, soft } = handValue(playerCards);
  const up = dealerUpValue(dealerUpCard);
  const charted = chartAction(total, soft, up);
  const action =
    charted === 'double' && !doubleAvailable ? fallbackForClosedDouble(total, soft, up) : charted;
  return { action, line: adviceLine(action, total, soft, dealerUpCard) };
}
