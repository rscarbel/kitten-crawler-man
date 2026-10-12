/**
 * What a regular puts an opponent on: a weight for every one of the 1,326
 * starting combos, built from what the opponent did this hand and how loose
 * the regular believes they are.
 *
 * Before the flop the range is the top slice of starting hands their actions
 * imply (a limp shows their whole playing range, a raise their raising range, a
 * re-raise a sliver of it). After the flop every bet or raise shifts weight
 * toward the combos that are strong on this board, and every call a little
 * less so, while a floor keeps room for bluffs and draws.
 *
 * `rangeReading` is how much of this the regular actually does: at 0 every
 * opponent holds any two cards; at 1 the estimate above is used as is.
 */

import type { PokerActionKind } from '../bettingRound';
import type { HandActionRecord } from '../PokerTable';
import { COMBO_COUNT, COMBO_TOP_FRACTION } from './combos';

/** How loose a regular believes an opponent plays, as shares of all hands dealt. */
export interface PerceivedTendencies {
  readonly vpip: number;
  readonly pfr: number;
}

/** One opponent's actions this hand, as a range reads them. */
export interface ObservedLine {
  /** Bets and raises before the flop. */
  readonly preflopRaises: number;
  /** Their first preflop raise came over someone else's raise. */
  readonly reRaised: boolean;
  /** They called before the flop without ever raising. */
  readonly preflopCalled: boolean;
  readonly postflopAggressive: number;
  readonly postflopCalls: number;
}

export const VOLUNTARY_KINDS: ReadonlySet<PokerActionKind> = new Set<PokerActionKind>([
  'call',
  'bet',
  'raise',
  'all_in',
]);

/** Reads `seat`'s line out of the hand history. */
export function lineOf(history: ReadonlyArray<HandActionRecord>, seat: number): ObservedLine {
  let preflopRaises = 0;
  let reRaised = false;
  let preflopCalled = false;
  let postflopAggressive = 0;
  let postflopCalls = 0;
  let raisesSeenPreflop = 0;
  for (const record of history) {
    const preflop = record.street === 'preflop';
    if (record.seat !== seat) {
      if (preflop && record.aggressive) raisesSeenPreflop++;
      continue;
    }
    if (preflop) {
      if (record.aggressive) {
        if (preflopRaises === 0 && raisesSeenPreflop > 0) reRaised = true;
        preflopRaises++;
        raisesSeenPreflop++;
      } else if (VOLUNTARY_KINDS.has(record.kind)) {
        preflopCalled = true;
      }
      continue;
    }
    if (record.aggressive) postflopAggressive++;
    else if (record.kind === 'call' || record.kind === 'all_in') postflopCalls++;
  }
  return {
    preflopRaises,
    reRaised,
    preflopCalled: preflopCalled && preflopRaises === 0,
    postflopAggressive,
    postflopCalls,
  };
}

/** A four-bet or more is close to the very top of anyone's range. */
const FOUR_BET_WIDTH = 0.03;
/** Two raises before the flop from one opponent is a four-bet line: a raise, then a re-raise over a three-bet. */
const FOUR_BET_RAISE_COUNT = 2;
/** Of the hands a player opens with, about this share are strong enough to re-raise with. */
const RE_RAISE_SHARE_OF_PFR = 0.35;
const MIN_RANGE_WIDTH = 0.02;
/** How quickly weight falls away past the edge of the implied range, so the edge is not a cliff. */
const RANGE_EDGE_SOFTNESS = 0.08;
/** Each bet or raise after the flop sharpens the lean toward strong hands by this much. */
const AGGRESSION_SHARPENING = 1.6;
const CALL_SHARPENING = 0.6;
/** Even a heavy lean leaves this weight on weak combos: people bluff and draw. */
const BLUFF_AND_DRAW_FLOOR = 0.12;

/** The share of starting hands the opponent's preflop line implies. */
export function preflopWidth(line: ObservedLine, tendencies: PerceivedTendencies): number {
  let width = 1;
  if (line.preflopRaises >= FOUR_BET_RAISE_COUNT) width = FOUR_BET_WIDTH;
  else if (line.preflopRaises === 1) {
    width = line.reRaised ? tendencies.pfr * RE_RAISE_SHARE_OF_PFR : tendencies.pfr;
  } else if (line.preflopCalled) width = tendencies.vpip;
  return Math.min(1, Math.max(MIN_RANGE_WIDTH, width));
}

/**
 * The opponent's range as one weight per combo. `boardPercentiles` (from
 * `boardStrengthPercentiles`) is required for the postflop lean; pass `null`
 * before the flop. Cards the reader can see are not removed here: the equity
 * sampler skips blocked combos itself.
 */
export function estimateRange(
  line: ObservedLine,
  tendencies: PerceivedTendencies,
  rangeReading: number,
  boardPercentiles: Float64Array | null,
): Float64Array {
  const weights = new Float64Array(COMBO_COUNT);
  const width = preflopWidth(line, tendencies);
  const sharpening =
    boardPercentiles === null
      ? 0
      : line.postflopAggressive * AGGRESSION_SHARPENING + line.postflopCalls * CALL_SHARPENING;
  const reading = Math.min(1, Math.max(0, rangeReading));
  for (let combo = 0; combo < COMBO_COUNT; combo++) {
    const pastEdge = COMBO_TOP_FRACTION[combo] - width;
    let weight = pastEdge <= 0 ? 1 : Math.exp(-pastEdge / RANGE_EDGE_SOFTNESS);
    if (sharpening > 0 && boardPercentiles !== null) {
      const lean = boardPercentiles[combo] ** sharpening;
      weight *= BLUFF_AND_DRAW_FLOOR + (1 - BLUFF_AND_DRAW_FLOOR) * lean;
    }
    weights[combo] = reading * weight + (1 - reading);
  }
  return weights;
}
