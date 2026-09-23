import type { Player } from '../Player';

/** Fraction of a tile a single knockback frame may cover. */
export const KNOCKBACK_MAX_STEP_TILE_FRACTION = 0.4;

/**
 * This frame's share of an in-progress knockback, in pixels.
 *
 * The share is weighted by frames remaining out of a triangular total
 * (1 + 2 + ... + knockbackTotalFrames), so the first frame — the one with the
 * most frames still remaining — carries the largest share and each later frame
 * carries less: an ease-out stagger, not a linear glide.
 *
 * Capped below one tile because both collision routines — the crawlers' and
 * the mobs' — only test the tile about to be entered, not anything between, so
 * an oversized step could skip clean over a one-tile wall.
 */
export function knockbackStepPx(
  body: Pick<Player, 'knockbackTotalFrames' | 'knockbackFramesRemaining' | 'knockbackDistancePx'>,
  tileSize: number,
): number {
  const total = body.knockbackTotalFrames;
  const triangularTotal = (total * (total + 1)) / 2;
  const easeShare = triangularTotal > 0 ? body.knockbackFramesRemaining / triangularTotal : 0;
  const maxStep = tileSize * KNOCKBACK_MAX_STEP_TILE_FRACTION;
  return Math.min(body.knockbackDistancePx * easeShare, maxStep);
}
