/**
 * The dotted trail drawn along Midge's road, from where the escort has got to
 * on past the waypoint in hand, so the road ahead reads as the way to go even
 * where it bends out of the arrow's line. Painted on the ground, under every
 * body, like the waypoint's own highlight.
 */

import { TILE_SIZE } from '../../../core/constants';
import type { TilePoint } from '../../../map/town/townPlan';

const TILE_CENTRE = 0.5;
const FULL_TURN = Math.PI * 2;

/** One dot per this many road tiles. */
const TRAIL_DOT_EVERY_TILES = 2;
const TRAIL_DOT_RADIUS_PX = 4.5;
const TRAIL_DOT_OUTLINE_PX = 2;
const TRAIL_DOT_FILL = '#facc15';
const TRAIL_DOT_OUTLINE = 'rgba(0,0,0,0.7)';
/** The first dot's opacity; the trail fades toward the last. */
const TRAIL_NEAR_ALPHA = 1;
const TRAIL_FAR_ALPHA = 0.45;
/**
 * A brighter swell runs along the trail toward the waypoint, once per this
 * long, so the dots read as leading somewhere rather than as a scatter.
 */
const TRAIL_SWELL_PERIOD_MS = 1600;
/** How many dots the swell spans. */
const TRAIL_SWELL_WIDTH_DOTS = 3;
/** How much the swell adds to a dot's radius, as a share of it. */
const TRAIL_SWELL_GROWTH = 0.5;

/** The trail's dots along `trail`, in world tiles, with the camera at (`camX`, `camY`). */
export function drawEscortTrail(
  ctx: CanvasRenderingContext2D,
  trail: readonly TilePoint[],
  camX: number,
  camY: number,
  nowMs: number,
): void {
  const dotCount = Math.ceil(trail.length / TRAIL_DOT_EVERY_TILES);
  if (dotCount === 0) return;
  const swellAt = ((nowMs % TRAIL_SWELL_PERIOD_MS) / TRAIL_SWELL_PERIOD_MS) * dotCount;
  ctx.save();
  ctx.lineWidth = TRAIL_DOT_OUTLINE_PX;
  ctx.strokeStyle = TRAIL_DOT_OUTLINE;
  ctx.fillStyle = TRAIL_DOT_FILL;
  for (let dot = 0; dot < dotCount; dot++) {
    const tile = trail[dot * TRAIL_DOT_EVERY_TILES];
    const along = dotCount === 1 ? 0 : dot / (dotCount - 1);
    const swell = Math.max(0, 1 - Math.abs(dot - swellAt) / TRAIL_SWELL_WIDTH_DOTS);
    ctx.globalAlpha = TRAIL_NEAR_ALPHA + (TRAIL_FAR_ALPHA - TRAIL_NEAR_ALPHA) * along;
    ctx.beginPath();
    ctx.arc(
      (tile.x + TILE_CENTRE) * TILE_SIZE - camX,
      (tile.y + TILE_CENTRE) * TILE_SIZE - camY,
      TRAIL_DOT_RADIUS_PX * (1 + TRAIL_SWELL_GROWTH * swell),
      0,
      FULL_TURN,
    );
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
