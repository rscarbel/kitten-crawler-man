/**
 * Spread of each rooster's offset into the idle loop, in seconds, so a flock
 * standing together does not bob in unison. Seeded from the spawn tile rather
 * than drawn at random, so the same bird always bobs on the same beat.
 */
const IDLE_OFFSET_SPAN_SECONDS = 4;
const IDLE_OFFSET_TILE_X_STEP = 0.37;
const IDLE_OFFSET_TILE_Y_STEP = 0.71;

/** How far into the idle loop a rooster spawned on this tile starts, in seconds. */
export function roosterIdleOffsetSeconds(tileX: number, tileY: number): number {
  const seed = tileX * IDLE_OFFSET_TILE_X_STEP + tileY * IDLE_OFFSET_TILE_Y_STEP;
  return (seed % 1) * IDLE_OFFSET_SPAN_SECONDS;
}
