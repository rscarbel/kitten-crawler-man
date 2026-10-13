/**
 * The five reel strips and how a set of stops turns into the 5×3 glass.
 *
 * Each reel is a fixed, looping strip of symbols. A spin picks one stop per
 * reel, uniformly over the strip, and the stop names the strip position shown
 * in the top row. How often a symbol lands is therefore set by how many copies
 * of it each strip carries, which is what the weight tables below tune.
 */

import { SLOT_SYMBOLS, type SlotSymbol } from './slotSymbols';

export const REEL_COUNT = 5;
export const ROW_COUNT = 3;

export type ReelWeights = Readonly<Record<SlotSymbol, number>>;

/**
 * Copies of each symbol per reel strip. The symbols are spread nearly evenly
 * so short runs land often without one symbol flooding the lines. The second
 * and fourth reels carry an extra scatter, which keeps the free-spin trigger
 * in reach without it landing every few dozen spins. Golden 7s
 * thin out to the right, which keeps five on a line (the progressive) rare
 * and makes the fourth and fifth reels the ones that miss it.
 */
export const REEL_WEIGHTS: ReadonlyArray<ReelWeights> = [
  {
    cherries: 6,
    lemon: 6,
    bell: 6,
    bar: 5,
    mongo: 5,
    tiara: 5,
    boots: 4,
    seven: 4,
    wild: 1,
    scatter: 1,
  },
  {
    cherries: 6,
    lemon: 6,
    bell: 6,
    bar: 5,
    mongo: 5,
    tiara: 5,
    boots: 4,
    seven: 4,
    wild: 1,
    scatter: 2,
  },
  {
    cherries: 6,
    lemon: 6,
    bell: 6,
    bar: 5,
    mongo: 5,
    tiara: 5,
    boots: 4,
    seven: 3,
    wild: 1,
    scatter: 1,
  },
  {
    cherries: 6,
    lemon: 6,
    bell: 6,
    bar: 5,
    mongo: 5,
    tiara: 5,
    boots: 4,
    seven: 2,
    wild: 1,
    scatter: 2,
  },
  {
    cherries: 6,
    lemon: 6,
    bell: 6,
    bar: 5,
    mongo: 5,
    tiara: 5,
    boots: 4,
    seven: 1,
    wild: 1,
    scatter: 1,
  },
];

/**
 * An irrational step that staggers where each symbol's copies start on the
 * strip, so no two symbols fall into lockstep and clump together.
 */
const GOLDEN_RATIO_FRACTION = 0.6180339887498949;

/**
 * Lays a reel's copies out as evenly as the counts allow: each symbol's copies
 * are spaced a constant fraction of the strip apart, starting from a
 * per-symbol offset. Deterministic, so a save or a seeded sim always sees the
 * same strips.
 */
export function buildReelStrip(weights: ReelWeights): ReadonlyArray<SlotSymbol> {
  const placed: { symbol: SlotSymbol; position: number; order: number }[] = [];
  SLOT_SYMBOLS.forEach((symbol, order) => {
    const copies = weights[symbol];
    const offset = (order * GOLDEN_RATIO_FRACTION) % 1;
    for (let copy = 0; copy < copies; copy++) {
      placed.push({ symbol, position: ((copy + offset) / copies) % 1, order });
    }
  });
  placed.sort((a, b) => a.position - b.position || a.order - b.order);
  return placed.map((entry) => entry.symbol);
}

export const REEL_STRIPS: ReadonlyArray<ReadonlyArray<SlotSymbol>> =
  REEL_WEIGHTS.map(buildReelStrip);

export type ReelStrips = ReadonlyArray<ReadonlyArray<SlotSymbol>>;

/** One stop index per reel: the strip position showing in the top row. */
export type ReelStops = ReadonlyArray<number>;

/** The glass, indexed `[reel][row]`, row 0 on top. */
export type SlotGrid = ReadonlyArray<ReadonlyArray<SlotSymbol>>;

export interface GridCell {
  readonly reel: number;
  readonly row: number;
}

/** Wraps any integer onto a strip of `length`, so offsets above and below the glass loop. */
export function wrapStop(position: number, length: number): number {
  return ((position % length) + length) % length;
}

/** The symbol at `offset` rows below the top row of `reel` (negative is above the glass). */
export function symbolAt(
  strips: ReelStrips,
  stops: ReelStops,
  reel: number,
  offset: number,
): SlotSymbol {
  const strip = strips[reel];
  return strip[wrapStop(stops[reel] + offset, strip.length)];
}

export function gridFor(strips: ReelStrips, stops: ReelStops): SlotGrid {
  const grid: SlotSymbol[][] = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const column: SlotSymbol[] = [];
    for (let row = 0; row < ROW_COUNT; row++) column.push(symbolAt(strips, stops, reel, row));
    grid.push(column);
  }
  return grid;
}

/** True when `stops` has one integer per reel, each a real position on that reel's strip. */
export function areValidStops(strips: ReelStrips, stops: ReelStops): boolean {
  if (stops.length !== REEL_COUNT || strips.length !== REEL_COUNT) return false;
  return stops.every(
    (stop, reel) => Number.isInteger(stop) && stop >= 0 && stop < strips[reel].length,
  );
}

/** A uniformly random stop on every reel. */
export function randomStops(strips: ReelStrips, random: () => number): number[] {
  return strips.map((strip) => Math.min(strip.length - 1, Math.floor(random() * strip.length)));
}
