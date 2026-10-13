/**
 * The twenty fixed paylines. Each line names the row (0 top, 1 middle,
 * 2 bottom) it crosses on each reel, left to right; the rules overlay draws
 * them as diagrams in this order.
 */

export type Payline = readonly [number, number, number, number, number];

export const PAYLINES: ReadonlyArray<Payline> = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0],
];

export const PAYLINE_COUNT = PAYLINES.length;
