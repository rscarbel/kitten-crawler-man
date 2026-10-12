/**
 * The 52 cards and 1,326 two-card starting combos as small integers, so the
 * equity and range code can work in typed arrays instead of allocating card
 * objects inside its hot loops.
 */

import { RANKS, SUITS, type Card } from '../../Deck';
import { handRank } from '../handEvaluator';
import { preflopTopFraction } from './preflop';

export const CARD_COUNT = RANKS.length * SUITS.length;

/** Every card once; a card's index is its position here. */
export const CARDS: ReadonlyArray<Card> = SUITS.flatMap((suit) =>
  RANKS.map((rank) => ({ rank, suit })),
);

const RANK_INDEX = new Map(RANKS.map((rank, index) => [rank, index]));
const SUIT_INDEX = new Map(SUITS.map((suit, index) => [suit, index]));

export function cardIndex(card: Card): number {
  return (SUIT_INDEX.get(card.suit) ?? 0) * RANKS.length + (RANK_INDEX.get(card.rank) ?? 0);
}

export const COMBO_COUNT = (CARD_COUNT * (CARD_COUNT - 1)) / 2;

export const COMBO_FIRST = new Uint8Array(COMBO_COUNT);
export const COMBO_SECOND = new Uint8Array(COMBO_COUNT);
/** Each combo's `preflopTopFraction`: small for strong starting hands. */
export const COMBO_TOP_FRACTION = new Float64Array(COMBO_COUNT);

{
  let combo = 0;
  for (let first = 0; first < CARD_COUNT; first++) {
    for (let second = first + 1; second < CARD_COUNT; second++) {
      COMBO_FIRST[combo] = first;
      COMBO_SECOND[combo] = second;
      COMBO_TOP_FRACTION[combo] = preflopTopFraction(CARDS[first], CARDS[second]);
      combo++;
    }
  }
}

/** A card set as a 52-bit mask split across two 26-bit words, which plain numbers hold exactly. */
export interface CardMask {
  low: number;
  high: number;
}

const MASK_WORD_BITS = 26;
/** A tied showdown splits the pot, so it scores half a win. */
export const TIE_SHARE = 0.5;

export function emptyMask(): CardMask {
  return { low: 0, high: 0 };
}

export function addToMask(mask: CardMask, card: number): void {
  if (card < MASK_WORD_BITS) mask.low |= 1 << card;
  else mask.high |= 1 << (card - MASK_WORD_BITS);
}

export function maskHas(mask: CardMask, card: number): boolean {
  return card < MASK_WORD_BITS
    ? (mask.low & (1 << card)) !== 0
    : (mask.high & (1 << (card - MASK_WORD_BITS))) !== 0;
}

export function maskOf(cards: ReadonlyArray<Card>): CardMask {
  const mask = emptyMask();
  for (const card of cards) addToMask(mask, cardIndex(card));
  return mask;
}

export function comboBlocked(mask: CardMask, combo: number): boolean {
  return maskHas(mask, COMBO_FIRST[combo]) || maskHas(mask, COMBO_SECOND[combo]);
}

/**
 * Each combo's made-hand strength on `board`, as the share of the other
 * unblocked combos it beats (ties count half); blocked combos get 0. One pass
 * of 1,326 rankings, shared by every opponent range built for one decision.
 */
export function boardStrengthPercentiles(board: ReadonlyArray<Card>): Float64Array {
  const percentiles = new Float64Array(COMBO_COUNT);
  if (board.length === 0) return percentiles;
  const dead = maskOf(board);
  const hand: Card[] = [CARDS[0], CARDS[0], ...board];
  const ranks: Array<{ combo: number; rank: number }> = [];
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (comboBlocked(dead, combo)) continue;
    hand[0] = CARDS[COMBO_FIRST[combo]];
    hand[1] = CARDS[COMBO_SECOND[combo]];
    ranks.push({ combo, rank: handRank(hand) });
  }
  ranks.sort((a, b) => a.rank - b.rank);
  const denominator = Math.max(1, ranks.length - 1);
  let start = 0;
  while (start < ranks.length) {
    let end = start;
    while (end + 1 < ranks.length && ranks[end + 1].rank === ranks[start].rank) end++;
    const tiedShare = (start + end) / 2 / denominator;
    for (let i = start; i <= end; i++) percentiles[ranks[i].combo] = tiedShare;
    start = end + 1;
  }
  return percentiles;
}

/**
 * The share of opponent combos the hand beats right now, ties counting half:
 * classic "hand strength" against one random hand, with no cards to come.
 */
export function handStrengthNow(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): number {
  const dead = maskOf([...hole, ...board]);
  const mine = handRank([...hole, ...board]);
  const theirs: Card[] = [CARDS[0], CARDS[0], ...board];
  let score = 0;
  let total = 0;
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (comboBlocked(dead, combo)) continue;
    theirs[0] = CARDS[COMBO_FIRST[combo]];
    theirs[1] = CARDS[COMBO_SECOND[combo]];
    const rank = handRank(theirs);
    total++;
    if (mine > rank) score += 1;
    else if (mine === rank) score += TIE_SHARE;
  }
  return total === 0 ? 0 : score / total;
}
