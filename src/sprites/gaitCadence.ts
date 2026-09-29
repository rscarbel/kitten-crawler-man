/**
 * How far a walk cycle turns for the ground a figure covered in one tick.
 *
 * A gait row is paced by distance, never by time: one cycle has to cover
 * exactly the ground its planted foot sweeps, or the foot skates. That alone
 * is unbounded, though — a separation shove, a knockback or a respawn covers
 * ground many times faster than any walk, and uncapped the cycle would skip
 * whole frames of the row and strobe the legs. So the turn is capped at one
 * frame of the row per tick: the row is always played, never skipped through.
 */
export function gaitCyclesForDistance(
  coveredPx: number,
  cyclePx: number,
  rowFrames: number,
): number {
  if (coveredPx <= 0 || cyclePx <= 0 || rowFrames <= 0) return 0;
  return Math.min(coveredPx / cyclePx, 1 / rowFrames);
}
