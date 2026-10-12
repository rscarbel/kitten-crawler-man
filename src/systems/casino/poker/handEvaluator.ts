/**
 * Texas Hold'em hand ranking for one to seven cards.
 *
 * Hands are scored by counting ranks and suits once rather than by trying every
 * five-card subset, and the counters are module-level scratch arrays, so
 * `handRank` allocates nothing. NPC equity estimates call it hundreds of times
 * per decision; `evaluateBest` adds the readable label and the five cards for
 * the table and is the one to use for display.
 *
 * A rank value packs the category above five kicker ranks, one base-16 digit
 * each, so a single numeric comparison orders any two hands and equal values
 * are exact ties.
 */

import { SUITS, type Card, type Rank, type Suit } from '../Deck';

export const HAND_CATEGORIES = [
  'high_card',
  'pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface EvaluatedHand {
  readonly category: HandCategory;
  /** Higher beats lower; equal values split the pot. */
  readonly rankValue: number;
  /** The cards that make the hand, strongest group first; fewer than five when fewer were given. */
  readonly best5: ReadonlyArray<Card>;
  /** A readable name, e.g. "Two Pair, Kings and Sevens" or "Flush, Ace high". */
  readonly label: string;
}

/** Cards in a made poker hand: a straight or flush needs this many. */
export const HAND_SIZE = 5;
const RANK_RADIX = 16;
const ACE_HIGH = 14;
/** The ace's value when it plays low in the wheel (A-2-3-4-5). */
const ACE_LOW = 1;
const LOWEST_RANK = 2;
/** The top card of the wheel, the lowest straight there is. */
const WHEEL_TOP = 5;
const STRAIGHT_SPAN = HAND_SIZE - 1;
const STRAIGHT_RUN_BITS = (1 << HAND_SIZE) - 1;
const QUAD_COUNT = 4;
const TRIP_COUNT = 3;
const PAIR_COUNT = 2;
const TRIP_KICKERS = 2;
const PAIR_KICKERS = 3;
const RADIX_POWERS = Array.from({ length: HAND_SIZE + 1 }, (_, power) => RANK_RADIX ** power);
const CATEGORY_SCALE = RANK_RADIX ** HAND_SIZE;

const RANK_VALUE: Record<Rank, number> = {
  A: 14,
  K: 13,
  Q: 12,
  J: 11,
  '10': 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2,
};

const SUIT_INDEX: Record<Suit, number> = { spades: 0, hearts: 1, diamonds: 2, clubs: 3 };

/** Singular and plural names by rank value; the ace's low value names it too. */
const RANK_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['', ''],
  ['Ace', 'Aces'],
  ['Two', 'Twos'],
  ['Three', 'Threes'],
  ['Four', 'Fours'],
  ['Five', 'Fives'],
  ['Six', 'Sixes'],
  ['Seven', 'Sevens'],
  ['Eight', 'Eights'],
  ['Nine', 'Nines'],
  ['Ten', 'Tens'],
  ['Jack', 'Jacks'],
  ['Queen', 'Queens'],
  ['King', 'Kings'],
  ['Ace', 'Aces'],
];

const rankCounts = new Int8Array(ACE_HIGH + 1);
const suitCounts = new Int8Array(SUITS.length);
const suitRankMasks = new Int32Array(SUITS.length);

export function rankValueOf(rank: Rank): number {
  return RANK_VALUE[rank];
}

/** The highest straight's top rank within a rank bitmask, or 0 when there is none. */
function straightTop(mask: number): number {
  const withLowAce = mask & (1 << ACE_HIGH) ? mask | (1 << ACE_LOW) : mask;
  for (let top = ACE_HIGH; top >= WHEEL_TOP; top--) {
    if (((withLowAce >> (top - STRAIGHT_SPAN)) & STRAIGHT_RUN_BITS) === STRAIGHT_RUN_BITS)
      return top;
  }
  return 0;
}

function packStraight(category: number, top: number): number {
  let packed = category;
  for (let offset = 0; offset < HAND_SIZE; offset++) packed = packed * RANK_RADIX + (top - offset);
  return packed;
}

/** Appends the `slots` highest ranks set in `mask`, padding with zeros when it runs out. */
function appendTopRanks(packed: number, mask: number, slots: number): number {
  let result = packed;
  let left = slots;
  for (let rank = ACE_HIGH; rank >= LOWEST_RANK && left > 0; rank--) {
    if (mask & (1 << rank)) {
      result = result * RANK_RADIX + rank;
      left--;
    }
  }
  return result * RADIX_POWERS[left];
}

function appendRepeated(packed: number, rank: number, times: number): number {
  let result = packed;
  for (let i = 0; i < times; i++) result = result * RANK_RADIX + rank;
  return result;
}

function categoryIndex(category: HandCategory): number {
  return HAND_CATEGORIES.indexOf(category);
}

const STRAIGHT_FLUSH = categoryIndex('straight_flush');
const FOUR_OF_A_KIND = categoryIndex('four_of_a_kind');
const FULL_HOUSE = categoryIndex('full_house');
const FLUSH = categoryIndex('flush');
const STRAIGHT = categoryIndex('straight');
const THREE_OF_A_KIND = categoryIndex('three_of_a_kind');
const TWO_PAIR = categoryIndex('two_pair');
const PAIR = categoryIndex('pair');
const HIGH_CARD = categoryIndex('high_card');

/**
 * The comparable value of the best hand within `cards` (one to seven). Allocates
 * nothing, so it is the one to call in tight loops.
 */
export function handRank(cards: ReadonlyArray<Card>): number {
  rankCounts.fill(0);
  suitCounts.fill(0);
  suitRankMasks.fill(0);
  let rankMask = 0;
  for (const card of cards) {
    const rank = RANK_VALUE[card.rank];
    const suit = SUIT_INDEX[card.suit];
    rankCounts[rank]++;
    suitCounts[suit]++;
    suitRankMasks[suit] |= 1 << rank;
    rankMask |= 1 << rank;
  }

  let flushMask = 0;
  for (let suit = 0; suit < SUITS.length; suit++) {
    if (suitCounts[suit] >= HAND_SIZE) flushMask = suitRankMasks[suit];
  }
  if (flushMask !== 0) {
    const top = straightTop(flushMask);
    if (top > 0) return packStraight(STRAIGHT_FLUSH, top);
  }

  let quads = 0;
  let topTrips = 0;
  let secondTrips = 0;
  let topPair = 0;
  let secondPair = 0;
  for (let rank = ACE_HIGH; rank >= LOWEST_RANK; rank--) {
    const count = rankCounts[rank];
    if (count === QUAD_COUNT && quads === 0) quads = rank;
    else if (count === TRIP_COUNT) {
      if (topTrips === 0) topTrips = rank;
      else if (secondTrips === 0) secondTrips = rank;
    } else if (count === PAIR_COUNT) {
      if (topPair === 0) topPair = rank;
      else if (secondPair === 0) secondPair = rank;
    }
  }

  if (quads !== 0) {
    const packed = appendRepeated(FOUR_OF_A_KIND, quads, QUAD_COUNT);
    return appendTopRanks(packed, rankMask & ~(1 << quads), 1);
  }
  const fullHousePair = Math.max(secondTrips, topPair);
  if (topTrips !== 0 && fullHousePair !== 0) {
    const packed = appendRepeated(FULL_HOUSE, topTrips, TRIP_COUNT);
    return appendRepeated(packed, fullHousePair, PAIR_COUNT);
  }
  if (flushMask !== 0) return appendTopRanks(FLUSH, flushMask, HAND_SIZE);
  const top = straightTop(rankMask);
  if (top > 0) return packStraight(STRAIGHT, top);
  if (topTrips !== 0) {
    const packed = appendRepeated(THREE_OF_A_KIND, topTrips, TRIP_COUNT);
    return appendTopRanks(packed, rankMask & ~(1 << topTrips), TRIP_KICKERS);
  }
  if (topPair !== 0 && secondPair !== 0) {
    let packed = appendRepeated(TWO_PAIR, topPair, PAIR_COUNT);
    packed = appendRepeated(packed, secondPair, PAIR_COUNT);
    return appendTopRanks(packed, rankMask & ~(1 << topPair) & ~(1 << secondPair), 1);
  }
  if (topPair !== 0) {
    const packed = appendRepeated(PAIR, topPair, PAIR_COUNT);
    return appendTopRanks(packed, rankMask & ~(1 << topPair), PAIR_KICKERS);
  }
  return appendTopRanks(HIGH_CARD, rankMask, HAND_SIZE);
}

export function categoryOf(rankValue: number): HandCategory {
  return HAND_CATEGORIES[Math.floor(rankValue / CATEGORY_SCALE)];
}

/** The rank in kicker slot `slot` (0 = most significant) of a packed value; 0 when the slot is empty. */
function slotRank(rankValue: number, slot: number): number {
  return Math.floor(rankValue / RADIX_POWERS[HAND_SIZE - 1 - slot]) % RANK_RADIX;
}

function rankWord(rank: number, plural: boolean): string {
  const words = RANK_WORDS[rank];
  return plural ? words[1] : words[0];
}

function labelFor(category: HandCategory, rankValue: number): string {
  const first = slotRank(rankValue, 0);
  switch (category) {
    case 'straight_flush':
      return first === ACE_HIGH ? 'Royal Flush' : `Straight Flush, ${rankWord(first, false)} high`;
    case 'four_of_a_kind':
      return `Four of a Kind, ${rankWord(first, true)}`;
    case 'full_house':
      return `Full House, ${rankWord(first, true)} full of ${rankWord(slotRank(rankValue, TRIP_COUNT), true)}`;
    case 'flush':
      return `Flush, ${rankWord(first, false)} high`;
    case 'straight':
      return `Straight, ${rankWord(first, false)} high`;
    case 'three_of_a_kind':
      return `Three of a Kind, ${rankWord(first, true)}`;
    case 'two_pair':
      return `Two Pair, ${rankWord(first, true)} and ${rankWord(slotRank(rankValue, PAIR_COUNT), true)}`;
    case 'pair':
      return `Pair of ${rankWord(first, true)}`;
    case 'high_card':
      return first === 0 ? 'No cards' : `${rankWord(first, false)} high`;
  }
}

function flushSuitOf(cards: ReadonlyArray<Card>): Suit | null {
  for (const suit of SUITS) {
    if (cards.filter((card) => card.suit === suit).length >= HAND_SIZE) return suit;
  }
  return null;
}

/** Picks one unused card per kicker slot, restricted to the flush suit when the hand is a flush. */
function pickBestCards(
  cards: ReadonlyArray<Card>,
  category: HandCategory,
  rankValue: number,
): Card[] {
  const suitedOnly =
    category === 'flush' || category === 'straight_flush' ? flushSuitOf(cards) : null;
  const used = cards.map(() => false);
  const picked: Card[] = [];
  for (let slot = 0; slot < HAND_SIZE; slot++) {
    const slotValue = slotRank(rankValue, slot);
    if (slotValue === 0) break;
    const wanted = slotValue === ACE_LOW ? ACE_HIGH : slotValue;
    const index = cards.findIndex(
      (card, i) =>
        !used[i] &&
        RANK_VALUE[card.rank] === wanted &&
        (suitedOnly === null || card.suit === suitedOnly),
    );
    if (index < 0) continue;
    used[index] = true;
    picked.push(cards[index]);
  }
  return picked;
}

/** The best hand within one to seven cards, with its label and the cards that make it. */
export function evaluateBest(cards: ReadonlyArray<Card>): EvaluatedHand {
  const rankValue = handRank(cards);
  const category = categoryOf(rankValue);
  return {
    category,
    rankValue,
    best5: pickBestCards(cards, category, rankValue),
    label: labelFor(category, rankValue),
  };
}
