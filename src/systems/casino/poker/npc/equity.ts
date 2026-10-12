/**
 * Monte Carlo equity: the share of the pot a hand wins on average when the
 * unknown cards are dealt many times over.
 *
 * Each pass samples one combo per opponent from their weighted range (see
 * `ranges.ts`), skipping any combo that collides with cards already out, deals
 * the rest of the board, and scores the hand. A decision runs once when the
 * seat's turn begins, never per frame, so the pass count is fixed and small;
 * the loop reuses its arrays and the allocation-free `handRank` so one
 * decision costs a millisecond or two.
 */

import type { Card } from '../../Deck';
import { handRank } from '../handEvaluator';
import {
  CARDS,
  CARD_COUNT,
  COMBO_COUNT,
  COMBO_FIRST,
  COMBO_SECOND,
  type CardMask,
  cardIndex,
  comboBlocked,
  maskOf,
} from './combos';
import type { Rng } from '../../../../sprites/person/rng';

/**
 * Passes per equity estimate. About ±2.5% standard error, which is finer than
 * any threshold a regular decides by, at a cost of a millisecond or two.
 */
export const EQUITY_ITERATIONS = 400;

const BOARD_SIZE = 5;
const HOLE_SIZE = 2;
const SEVEN = HOLE_SIZE + BOARD_SIZE;
/** Collisions are rare, so a few redraws nearly always land; past this the pass falls back to random cards. */
const MAX_COMBO_REDRAWS = 8;

interface PassState {
  readonly stamps: Int32Array;
  stamp: number;
}

function drawFreeCard(state: PassState, rng: Rng): number {
  for (;;) {
    const card = Math.floor(rng() * CARD_COUNT);
    if (state.stamps[card] !== state.stamp) {
      state.stamps[card] = state.stamp;
      return card;
    }
  }
}

/** Running totals of a range's weights over its unblocked combos, for weighted sampling. */
function cumulativeWeights(weights: Float64Array, dead: CardMask): Float64Array {
  const cumulative = new Float64Array(COMBO_COUNT);
  let total = 0;
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    if (!comboBlocked(dead, combo)) total += Math.max(0, weights[combo]);
    cumulative[combo] = total;
  }
  return cumulative;
}

function sampleCombo(cumulative: Float64Array, rng: Rng): number {
  const total = cumulative[COMBO_COUNT - 1];
  const target = rng() * total;
  let low = 0;
  let high = COMBO_COUNT - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] > target) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Fills `hand[0..1]` for one opponent from their range, marking the cards used. */
function dealOpponent(cumulative: Float64Array, state: PassState, rng: Rng, hand: Card[]): void {
  const hasWeight = cumulative[COMBO_COUNT - 1] > 0;
  for (let attempt = 0; hasWeight && attempt < MAX_COMBO_REDRAWS; attempt++) {
    const combo = sampleCombo(cumulative, rng);
    const first = COMBO_FIRST[combo];
    const second = COMBO_SECOND[combo];
    if (state.stamps[first] === state.stamp || state.stamps[second] === state.stamp) continue;
    state.stamps[first] = state.stamp;
    state.stamps[second] = state.stamp;
    hand[0] = CARDS[first];
    hand[1] = CARDS[second];
    return;
  }
  hand[0] = CARDS[drawFreeCard(state, rng)];
  hand[1] = CARDS[drawFreeCard(state, rng)];
}

/**
 * The hero's equity in [0, 1] against every opponent at once, each holding a
 * combo drawn from their own range. Ties split the pot evenly.
 */
export function equityVsRanges(
  hole: ReadonlyArray<Card>,
  board: ReadonlyArray<Card>,
  ranges: ReadonlyArray<Float64Array>,
  rng: Rng,
  iterations: number = EQUITY_ITERATIONS,
): number {
  if (hole.length !== HOLE_SIZE || ranges.length === 0 || iterations <= 0) return 1;
  const known = [...hole, ...board].map(cardIndex);
  const dead = maskOf([...hole, ...board]);
  const cumulatives = ranges.map((weights) => cumulativeWeights(weights, dead));
  const state: PassState = { stamps: new Int32Array(CARD_COUNT), stamp: 0 };
  const hero: Card[] = [hole[0], hole[1], ...new Array<Card>(BOARD_SIZE).fill(hole[0])];
  const opponents: Card[][] = ranges.map(() => new Array<Card>(SEVEN).fill(hole[0]));
  for (let slot = 0; slot < board.length; slot++) {
    hero[HOLE_SIZE + slot] = board[slot];
    for (const hand of opponents) hand[HOLE_SIZE + slot] = board[slot];
  }

  let won = 0;
  for (let pass = 0; pass < iterations; pass++) {
    state.stamp++;
    for (const card of known) state.stamps[card] = state.stamp;
    for (let i = 0; i < opponents.length; i++) {
      dealOpponent(cumulatives[i], state, rng, opponents[i]);
    }
    for (let slot = board.length; slot < BOARD_SIZE; slot++) {
      const card = CARDS[drawFreeCard(state, rng)];
      hero[HOLE_SIZE + slot] = card;
      for (const hand of opponents) hand[HOLE_SIZE + slot] = card;
    }
    const mine = handRank(hero);
    let best = 0;
    let tiedWithBest = 0;
    for (const hand of opponents) {
      const theirs = handRank(hand);
      if (theirs > best) {
        best = theirs;
        tiedWithBest = 1;
      } else if (theirs === best) tiedWithBest++;
    }
    if (mine > best) won += 1;
    else if (mine === best) won += 1 / (tiedWithBest + 1);
  }
  return won / iterations;
}

/**
 * Each hand's equity when every hand is known and only the board is to come,
 * e.g. the moment the last chips went in. Exact once the board is complete.
 */
export function knownHandsEquity(
  hands: ReadonlyArray<ReadonlyArray<Card>>,
  board: ReadonlyArray<Card>,
  rng: Rng,
  iterations: number = EQUITY_ITERATIONS,
): number[] {
  const shares = hands.map(() => 0);
  if (hands.length === 0) return shares;
  const known = [...hands.flat(), ...board].map(cardIndex);
  const state: PassState = { stamps: new Int32Array(CARD_COUNT), stamp: 0 };
  const full: Card[][] = hands.map((hand) => [...hand, ...board]);
  const passes = board.length >= BOARD_SIZE ? 1 : iterations;
  const ranks = hands.map(() => 0);
  for (let pass = 0; pass < passes; pass++) {
    state.stamp++;
    for (const card of known) state.stamps[card] = state.stamp;
    for (let slot = board.length; slot < BOARD_SIZE; slot++) {
      const card = CARDS[drawFreeCard(state, rng)];
      for (const hand of full) hand[HOLE_SIZE + slot] = card;
    }
    let best = 0;
    for (let i = 0; i < full.length; i++) {
      ranks[i] = handRank(full[i]);
      best = Math.max(best, ranks[i]);
    }
    const winners = ranks.filter((rank) => rank === best).length;
    for (let i = 0; i < full.length; i++) {
      if (ranks[i] === best) shares[i] += 1 / winners;
    }
  }
  return shares.map((share) => share / passes);
}
