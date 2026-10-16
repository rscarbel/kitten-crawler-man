/**
 * A dotted route painted on the ground: gold dots at an even spacing along a
 * line through tile centres, fading from near to far, with a brighter swell
 * running toward the far end so the dots read as leading somewhere rather
 * than as a scatter. Ground paint, drawn before the Y-sorted pass so every
 * body stands over it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { TilePoint } from '../../map/town/townPlan';
import { worldPalette } from '../theme/worldInk';

/**
 * Distance between dots along the line, in tiles. The line is resampled by
 * length rather than dotted per point, because a route's points are unevenly
 * spaced: diagonal steps, and straight runs of any length.
 */
export const WORLD_TRAIL_DOT_SPACING_TILES = 2;
const WORLD_TRAIL_DOT_RADIUS_PX = 4.5;
const WORLD_TRAIL_DOT_OUTLINE_PX = 2;
/** The nearest dot's opacity; the trail fades toward the farthest. */
const WORLD_TRAIL_NEAR_ALPHA = 1;
const WORLD_TRAIL_FAR_ALPHA = 0.45;
/** The swell runs the trail's length once per this long. */
const WORLD_TRAIL_SWELL_PERIOD_MS = 1600;
/** How many dots the swell spans. */
const WORLD_TRAIL_SWELL_WIDTH_DOTS = 3;
/** How much the swell adds to a dot's radius, as a share of it. */
const WORLD_TRAIL_SWELL_GROWTH = 0.5;

const TILE_CENTRE = 0.5;
const FULL_TURN = Math.PI * 2;
/** Off-screen slack before a dot is culled: a swollen dot's whole radius. */
const CULL_MARGIN_PX = WORLD_TRAIL_DOT_RADIUS_PX * (1 + WORLD_TRAIL_SWELL_GROWTH);

export interface WorldTrailOptions {
  /** The visible area in the caller's pixels; dots outside it are skipped. Omitted, none are. */
  readonly view?: { readonly width: number; readonly height: number };
}

/** Points every {@link WORLD_TRAIL_DOT_SPACING_TILES} along the line through `points`, in tiles. */
function resample(points: readonly TilePoint[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const dots = [{ x: points[0].x, y: points[0].y }];
  let carried = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    let along = WORLD_TRAIL_DOT_SPACING_TILES - carried;
    while (along <= length) {
      const share = along / length;
      dots.push({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share });
      along += WORLD_TRAIL_DOT_SPACING_TILES;
    }
    carried = length - (along - WORLD_TRAIL_DOT_SPACING_TILES);
  }
  return dots;
}

/**
 * The trail's dots along the line through `points` (tile coordinates, walked
 * centre to centre), with the camera at (`camX`, `camY`).
 */
export function worldTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly TilePoint[],
  camX: number,
  camY: number,
  nowMs: number,
  opts: WorldTrailOptions = {},
): void {
  const dots = resample(points);
  const dotCount = dots.length;
  if (dotCount === 0) return;
  const swellAt = ((nowMs % WORLD_TRAIL_SWELL_PERIOD_MS) / WORLD_TRAIL_SWELL_PERIOD_MS) * dotCount;
  const view = opts.view;
  ctx.save();
  ctx.lineWidth = WORLD_TRAIL_DOT_OUTLINE_PX;
  ctx.strokeStyle = worldPalette.objective.trailOutline;
  ctx.fillStyle = worldPalette.objective.trail;
  for (let dot = 0; dot < dotCount; dot++) {
    const x = (dots[dot].x + TILE_CENTRE) * TILE_SIZE - camX;
    const y = (dots[dot].y + TILE_CENTRE) * TILE_SIZE - camY;
    const offScreen =
      view !== undefined &&
      (x < -CULL_MARGIN_PX ||
        y < -CULL_MARGIN_PX ||
        x > view.width + CULL_MARGIN_PX ||
        y > view.height + CULL_MARGIN_PX);
    if (offScreen) continue;
    const along = dotCount === 1 ? 0 : dot / (dotCount - 1);
    const swell = Math.max(0, 1 - Math.abs(dot - swellAt) / WORLD_TRAIL_SWELL_WIDTH_DOTS);
    ctx.globalAlpha =
      WORLD_TRAIL_NEAR_ALPHA + (WORLD_TRAIL_FAR_ALPHA - WORLD_TRAIL_NEAR_ALPHA) * along;
    ctx.beginPath();
    ctx.arc(x, y, WORLD_TRAIL_DOT_RADIUS_PX * (1 + WORLD_TRAIL_SWELL_GROWTH * swell), 0, FULL_TURN);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
