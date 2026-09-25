/**
 * Warms the Briar Hollow cast's first rows as the party approaches the
 * village, so twenty-one figures coming on screen at once are not twenty-one
 * cold cache misses on one frame.
 *
 * The trigger is distance to the palisade, not to any villager: the whole
 * village comes into view together as the party crests the approach. Requests
 * go out one character per frame, and the figure cache drains them under its
 * own prewarm slice of the frame budget, so neither the requests nor the
 * baking spike a frame.
 */

import type { TileRect } from '../../map/town/townPlan';
import { TILE_SIZE } from '../../core/constants';
import { RATKIN_CAST_PREWARM_ORDER, prewarmRatkinCastMember } from '../../sprites/ratkinCastSprite';
import type { RatkinCastId } from '../../sprites/art/ratkin/cast';
import {
  IDLE_FRAMES_BEFORE_RELEASE,
  figureCacheFrame,
} from '../../sprites/figure/figureFrameCache';

/** How close to the palisade, in tiles, the party gets before the cast is warmed. */
export const RATKIN_PREWARM_RADIUS_TILES = 30;
/**
 * How much further out the party must go before an approach counts as new.
 * Without the margin, pacing along the radius re-queues the whole cast every
 * time it is crossed.
 */
const RATKIN_PREWARM_RELEASE_MARGIN_TILES = 10;

/** Tile distance from a point to the nearest tile of a rectangle; 0 inside it. */
function tilesOutside(rect: TileRect, tileX: number, tileY: number): number {
  const dx = Math.max(rect.x - tileX, 0, tileX - (rect.x + rect.w - 1));
  const dy = Math.max(rect.y - tileY, 0, tileY - (rect.y + rect.h - 1));
  return Math.hypot(dx, dy);
}

/**
 * How often, in the figure cache's own frames, the cast is queued again while
 * the party stays near.
 *
 * The cache frees a row nobody has touched for `IDLE_FRAMES_BEFORE_RELEASE` of
 * its frames, counted from its last bake or request. A party gathering just
 * outside the palisade can stand inside the ring far longer than that before
 * any villager is drawn, so one pass would warm cells only for the cache to
 * sweep them. Re-asking at half the window keeps them touched; for a row that
 * is still warm a request bakes nothing and only refreshes it. Measured on the
 * cache's clock, not in gameplay updates: the cache ticks once per rendered
 * frame, which is twice per update at 120 Hz and keeps running while paused.
 */
export const RATKIN_PREWARM_REFRESH_FRAMES = Math.floor(IDLE_FRAMES_BEFORE_RELEASE / 2);

export class RatkinCastPrewarm {
  /** Next cast member to queue; the cast length once a pass has queued everyone. */
  private next = 0;
  private armed = false;
  /** The cache frame the current pass began on. */
  private passStartedAt = 0;

  /**
   * @param requestMember How one cast member's rows are queued; the figure
   *   cache's paced prewarm in the game, a recorder in the gate.
   * @param cacheFrame The figure cache's frame clock; a simulated one in the gate.
   */
  constructor(
    private readonly requestMember: (id: RatkinCastId) => void = prewarmRatkinCastMember,
    private readonly cacheFrame: () => number = figureCacheFrame,
  ) {}

  /**
   * Call once per gameplay update with the active crawler's world position
   * (pixels) and the village's palisade bounds.
   */
  update(worldX: number, worldY: number, palisade: TileRect): void {
    const distance = tilesOutside(palisade, worldX / TILE_SIZE, worldY / TILE_SIZE);
    if (distance > RATKIN_PREWARM_RADIUS_TILES + RATKIN_PREWARM_RELEASE_MARGIN_TILES) {
      this.armed = false;
      this.next = 0;
      return;
    }
    if (distance <= RATKIN_PREWARM_RADIUS_TILES && !this.armed) {
      this.armed = true;
      this.passStartedAt = this.cacheFrame();
    }
    if (!this.armed) return;
    const now = this.cacheFrame();
    if (now - this.passStartedAt >= RATKIN_PREWARM_REFRESH_FRAMES) {
      this.next = 0;
      this.passStartedAt = now;
    }
    if (this.next >= RATKIN_CAST_PREWARM_ORDER.length) return;
    this.requestMember(RATKIN_CAST_PREWARM_ORDER[this.next]);
    this.next++;
  }
}
