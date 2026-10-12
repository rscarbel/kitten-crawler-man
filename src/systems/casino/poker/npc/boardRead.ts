/**
 * What a regular can see about their own hand on the current board: the made
 * hand, the draws, the outs and the board's texture, plus the naive "I have top
 * pair!" score a weak player judges by. Pure and canvas-free.
 */

import type { Card, Rank, Suit } from '../../Deck';
import { SUITS } from '../../Deck';
import { evaluateBest } from '../handEvaluator';

export const MADE_HAND_CATEGORIES = [
  'high_card',
  'pair',
  'two_pair',
  'trips',
  'straight',
  'flush',
  'full_house',
  'quads',
  'straight_flush',
] as const;
export type MadeHandCategory = (typeof MADE_HAND_CATEGORIES)[number];

const RANK_VALUES: Readonly<Record<Rank, number>> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** A rank as a comparable number, deuce 2 through ace 14. */
export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

const ACE_HIGH = 14;
/** The ace counts as a one when it ends a wheel (A-2-3-4-5). */
const ACE_LOW = 1;
const STRAIGHT_LENGTH = 5;
const FLUSH_LENGTH = 5;
const LOWEST_STRAIGHT_TOP = ACE_LOW + STRAIGHT_LENGTH - 1;
const PAIR_COUNT = 2;
const TRIPS_COUNT = 3;
const QUADS_COUNT = 4;
const FLOP_SIZE = 3;
const RIVER_SIZE = 5;
/** Three board cards inside one five-rank window make a straight possible. */
const CONNECTED_BOARD_RANKS = 3;
const FLUSH_DRAW_OUTS = 9;
const OPEN_ENDED_OUTS = 8;
const GUTSHOT_OUTS = 4;
const OVERCARD_OUTS = 3;
/** Completing ranks a straight draw needs before it plays like an open-ender. */
const OPEN_ENDED_COMPLETIONS = 2;
/** A flush draw and a straight draw share the cards that would make both. */
const COMBO_DRAW_SHARED_OUTS = 2;

function rankCounts(cards: ReadonlyArray<Card>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) {
    const value = rankValue(card.rank);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function suitCounts(cards: ReadonlyArray<Card>): Map<Suit, number> {
  const counts = new Map<Suit, number>();
  for (const card of cards) counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  return counts;
}

function presentValues(cards: ReadonlyArray<Card>): Set<number> {
  const values = new Set<number>();
  for (const card of cards) {
    const value = rankValue(card.rank);
    values.add(value);
    if (value === ACE_HIGH) values.add(ACE_LOW);
  }
  return values;
}

/** The top rank of the best straight inside `values`, or null. */
function straightTop(values: ReadonlySet<number>): number | null {
  for (let top = ACE_HIGH; top >= LOWEST_STRAIGHT_TOP; top--) {
    let complete = true;
    for (let step = 0; step < STRAIGHT_LENGTH; step++) {
      if (!values.has(top - step)) {
        complete = false;
        break;
      }
    }
    if (complete) return top;
  }
  return null;
}

function longestSuit(cards: ReadonlyArray<Card>): { suit: Suit | null; count: number } {
  let best: Suit | null = null;
  let bestCount = 0;
  for (const [suit, count] of suitCounts(cards)) {
    if (count > bestCount) {
      best = suit;
      bestCount = count;
    }
  }
  return { suit: best, count: bestCount };
}

/** The best made-hand category among any number of cards (fewer than five is fine). */
export function madeHandCategory(cards: ReadonlyArray<Card>): MadeHandCategory {
  const { suit: flushSuit, count: flushCount } = longestSuit(cards);
  const hasFlush = flushCount >= FLUSH_LENGTH;
  if (hasFlush && flushSuit !== null) {
    const suited = cards.filter((card) => card.suit === flushSuit);
    if (straightTop(presentValues(suited)) !== null) return 'straight_flush';
  }
  const groups = [...rankCounts(cards).values()].sort((a, b) => b - a);
  const largest = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  if (largest >= QUADS_COUNT) return 'quads';
  if (largest >= TRIPS_COUNT && second >= PAIR_COUNT) return 'full_house';
  if (hasFlush) return 'flush';
  if (straightTop(presentValues(cards)) !== null) return 'straight';
  if (largest >= TRIPS_COUNT) return 'trips';
  if (largest >= PAIR_COUNT && second >= PAIR_COUNT) return 'two_pair';
  if (largest >= PAIR_COUNT) return 'pair';
  return 'high_card';
}

/** How a one-pair hand sits against the board, the way a casual player names it. */
export type PairQuality = 'none' | 'board' | 'underpair' | 'bottom' | 'middle' | 'top' | 'overpair';

export interface MadeHandRead {
  readonly category: MadeHandCategory;
  /** False when the board alone makes the same category, so the hole cards add nothing. */
  readonly usesHole: boolean;
  readonly pairQuality: PairQuality;
  /** The hole card not used by a one-pair hand, or the higher hole card otherwise. */
  readonly kicker: number;
}

function pairQualityOf(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): PairQuality {
  const boardValues = [...new Set(board.map((card) => rankValue(card.rank)))].sort((a, b) => b - a);
  const holeValues = hole.map((card) => rankValue(card.rank));
  const pocketPair = holeValues.length === 2 && holeValues[0] === holeValues[1];
  if (pocketPair) {
    const first = holeValues[0];
    if (boardValues.includes(first)) return 'none';
    return boardValues.every((value) => first > value) ? 'overpair' : 'underpair';
  }
  const paired = holeValues.filter((value) => boardValues.includes(value));
  if (paired.length === 0) return 'board';
  const best = Math.max(...paired);
  const index = boardValues.indexOf(best);
  if (index === 0) return 'top';
  if (index === boardValues.length - 1) return 'bottom';
  return 'middle';
}

/** Categories whose every card is part of what makes the hand, with no kickers. */
const ALL_CARDS_COUNT: ReadonlySet<MadeHandCategory> = new Set([
  'straight',
  'flush',
  'straight_flush',
]);

function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/**
 * Whether a hole card is part of what makes the hand when the board alone
 * already reaches the same category: a higher card in a board straight or
 * flush, or a pocket pair that out-ranks one of the board's pairs. A hole card
 * that only plays as a kicker does not count, so a board pair stays the
 * board's.
 */
function holeShapesSameCategory(
  hole: ReadonlyArray<Card>,
  board: ReadonlyArray<Card>,
  category: MadeHandCategory,
): boolean {
  const full = evaluateBest([...hole, ...board]);
  if (evaluateBest(board).rankValue >= full.rankValue) return false;
  const best = full.best5;
  const holeInBest = best.filter((card) => hole.some((holeCard) => sameCard(card, holeCard)));
  if (ALL_CARDS_COUNT.has(category)) return holeInBest.length > 0;
  return holeInBest.some(
    (holeCard) => best.filter((card) => card.rank === holeCard.rank).length >= PAIR_COUNT,
  );
}

export function readMadeHand(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): MadeHandRead {
  const category = madeHandCategory([...hole, ...board]);
  const boardCategory = madeHandCategory(board);
  const improvesCategory =
    MADE_HAND_CATEGORIES.indexOf(category) > MADE_HAND_CATEGORIES.indexOf(boardCategory);
  const usesHole = improvesCategory || holeShapesSameCategory(hole, board, category);
  const holeValues = hole.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
  const boardValues = new Set(board.map((card) => rankValue(card.rank)));
  const pairQuality = category === 'pair' ? pairQualityOf(hole, board) : 'none';
  const unpairedKicker = holeValues.find((value) => !boardValues.has(value));
  const kicker =
    category === 'pair' && unpairedKicker !== undefined ? unpairedKicker : (holeValues[0] ?? 0);
  return { category, usesHole, pairQuality, kicker };
}

export interface DrawRead {
  readonly flushDraw: boolean;
  /** Two or more ranks complete a straight: an open-ender or a double gutshot. */
  readonly openEnded: boolean;
  readonly gutshot: boolean;
  /** Hole cards above every board card, counted only while no hole card is paired. */
  readonly overcards: number;
  /** Approximate cards that improve the hand to a likely winner, by the usual rules of thumb. */
  readonly outs: number;
}

const NO_DRAWS: DrawRead = {
  flushDraw: false,
  openEnded: false,
  gutshot: false,
  overcards: 0,
  outs: 0,
};

/** The ranks that would complete a straight using at least one hole card. */
function straightCompletions(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): number {
  const all = presentValues([...hole, ...board]);
  const boardOnly = presentValues(board);
  let completions = 0;
  for (let value = 2; value <= ACE_HIGH; value++) {
    if (all.has(value)) continue;
    const withCard = new Set(all);
    withCard.add(value);
    if (value === ACE_HIGH) withCard.add(ACE_LOW);
    const boardWithCard = new Set(boardOnly);
    boardWithCard.add(value);
    if (value === ACE_HIGH) boardWithCard.add(ACE_LOW);
    const made = straightTop(withCard);
    if (made !== null && made !== straightTop(boardWithCard)) completions++;
  }
  return completions;
}

/**
 * Hole cards above every board card, counted only while neither hole card is
 * paired (with the other or with the board): a board pair leaves AK on 7-7-2
 * drawing to its overcards just like an unpaired board.
 */
function countOvercards(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): number {
  const boardValues = board.map((card) => rankValue(card.rank));
  const holeValues = hole.map((card) => rankValue(card.rank));
  const pocketPair = new Set(holeValues).size < holeValues.length;
  const pairsBoard = holeValues.some((value) => boardValues.includes(value));
  if (pocketPair || pairsBoard) return 0;
  const highestBoard = Math.max(...boardValues);
  return holeValues.filter((value) => value > highestBoard).length;
}

/** Draws only exist with cards still to come, so a full board reads as no draws. */
export function readDraws(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): DrawRead {
  if (board.length < FLOP_SIZE || board.length >= RIVER_SIZE) return NO_DRAWS;
  const all = [...hole, ...board];
  const category = madeHandCategory(all);
  const madeFlushOrBetter =
    MADE_HAND_CATEGORIES.indexOf(category) >= MADE_HAND_CATEGORIES.indexOf('flush');
  const madeStraightOrBetter =
    MADE_HAND_CATEGORIES.indexOf(category) >= MADE_HAND_CATEGORIES.indexOf('straight');

  const flushDraw =
    !madeFlushOrBetter &&
    SUITS.some((suit) => {
      const total = all.filter((card) => card.suit === suit).length;
      const inHole = hole.some((card) => card.suit === suit);
      return total === FLUSH_LENGTH - 1 && inHole;
    });

  const completions = madeStraightOrBetter ? 0 : straightCompletions(hole, board);
  const openEnded = completions >= OPEN_ENDED_COMPLETIONS;
  const gutshot = completions === 1;

  const overcards = madeStraightOrBetter ? 0 : countOvercards(hole, board);

  let outs = 0;
  if (flushDraw) outs += FLUSH_DRAW_OUTS;
  if (openEnded) outs += OPEN_ENDED_OUTS;
  else if (gutshot) outs += GUTSHOT_OUTS;
  if (flushDraw && (openEnded || gutshot)) outs -= COMBO_DRAW_SHARED_OUTS;
  outs += overcards * OVERCARD_OUTS;
  return { flushDraw, openEnded, gutshot, overcards, outs };
}

export interface BoardTexture {
  readonly paired: boolean;
  /** Three or more board cards of one suit: a flush is already possible. */
  readonly monotone: boolean;
  /** Exactly two of the most common suit: a flush draw is possible. */
  readonly twoTone: boolean;
  /** Three board ranks fit inside one straight: a straight is possible. */
  readonly connected: boolean;
  /** Unpaired, unconnected and at most two-tone: few draws and few strong hands. */
  readonly dry: boolean;
  readonly dominantSuit: Suit | null;
  readonly dominantSuitCount: number;
}

export function readBoardTexture(board: ReadonlyArray<Card>): BoardTexture {
  const paired = [...rankCounts(board).values()].some((count) => count >= PAIR_COUNT);
  const { suit, count } = longestSuit(board);
  const values = presentValues(board);
  let connected = false;
  for (let top = ACE_HIGH; top >= LOWEST_STRAIGHT_TOP && !connected; top--) {
    let inWindow = 0;
    for (let step = 0; step < STRAIGHT_LENGTH; step++) {
      if (values.has(top - step)) inWindow++;
    }
    if (inWindow >= CONNECTED_BOARD_RANKS) connected = true;
  }
  const monotone = count >= TRIPS_COUNT;
  const twoTone = count === 2;
  return {
    paired,
    monotone,
    twoTone,
    connected,
    dry: !paired && !connected && !monotone,
    dominantSuit: suit,
    dominantSuitCount: count,
  };
}

/**
 * How good the hand looks to someone who only asks "what do I have?", ignoring
 * what the board might give everyone else. Blended with real equity by players
 * with little `boardAwareness`, which is what lets a fish call down top pair on
 * a four-flush board.
 */
const NAIVE_SCORE: Readonly<Record<MadeHandCategory, number>> = {
  high_card: 0.1,
  pair: 0.45,
  two_pair: 0.75,
  trips: 0.82,
  straight: 0.88,
  flush: 0.92,
  full_house: 0.96,
  quads: 0.99,
  straight_flush: 1,
};

const NAIVE_PAIR_SCORE: Readonly<Record<PairQuality, number>> = {
  none: 0.45,
  board: 0.15,
  underpair: 0.35,
  bottom: 0.3,
  middle: 0.42,
  top: 0.6,
  overpair: 0.7,
};

/** A board-only hand still feels like something, but much less than one's own. */
const BOARD_PLAYS_SCORE_SCALE = 0.4;
/** A top kicker makes top pair feel noticeably better to anyone. */
const KICKER_SCORE_BONUS = 0.08;
const STRONG_KICKER = 12;
const OVERCARD_SCORE_BONUS = 0.04;

export function naiveMadeHandScore(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): number {
  const made = readMadeHand(hole, board);
  if (made.category === 'pair') {
    const base = NAIVE_PAIR_SCORE[made.pairQuality];
    const kickerBonus =
      made.pairQuality === 'top' && made.kicker >= STRONG_KICKER ? KICKER_SCORE_BONUS : 0;
    const overcardBonus =
      made.pairQuality === 'board' ? readDraws(hole, board).overcards * OVERCARD_SCORE_BONUS : 0;
    return base + kickerBonus + overcardBonus;
  }
  const base = NAIVE_SCORE[made.category];
  if (!made.usesHole && made.category !== 'high_card') return base * BOARD_PLAYS_SCORE_SCALE;
  if (made.category === 'high_card') {
    return base + readDraws(hole, board).overcards * OVERCARD_SCORE_BONUS;
  }
  return base;
}

export interface HandRead {
  readonly made: MadeHandRead;
  readonly draws: DrawRead;
  readonly texture: BoardTexture;
  readonly naiveScore: number;
}

/** Everything `boardRead` knows about a hole pair on a board, in one call. */
export function readHand(hole: ReadonlyArray<Card>, board: ReadonlyArray<Card>): HandRead {
  return {
    made: readMadeHand(hole, board),
    draws: readDraws(hole, board),
    texture: readBoardTexture(board),
    naiveScore: naiveMadeHandScore(hole, board),
  };
}
