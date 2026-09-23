/**
 * The shared measure behind every "a chased kite still runs" row.
 *
 * A kite exists to draw a player who follows it toward a friend, so a kite
 * that ends the moment it is followed is a kite that does nothing. A catch-up
 * row read over such kites passes vacuously — nothing opens a gap in one
 * frame — which is why each of those rows also asks this.
 */

/**
 * The least a chased kite's median length may be, as a share of the same
 * layout's unchased median: the player closing in may cut a kite short, but
 * only by catching it, never merely by following.
 */
export const CHASED_KITE_MIN_SHARE = 0.5;

/** The middle value of `values`, or zero when there are none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const isEven = sorted.length % 2 === 0;
  return isEven ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Whether chased kites ran a meaningful length against the unchased ones. */
export function chasedKitesRunOn(
  chasedLengths: readonly number[],
  unchasedLengths: readonly number[],
): boolean {
  const unchased = median(unchasedLengths);
  return (
    chasedLengths.length > 0 &&
    unchased > 0 &&
    median(chasedLengths) >= unchased * CHASED_KITE_MIN_SHARE
  );
}

/** A row's summary of the two medians. */
export function describeKiteLengths(
  chasedLengths: readonly number[],
  unchasedLengths: readonly number[],
): string {
  return `chased kites ran a median ${median(chasedLengths)} frames over ${chasedLengths.length} kites (unchased ${median(unchasedLengths)}; need ${CHASED_KITE_MIN_SHARE} of it)`;
}
