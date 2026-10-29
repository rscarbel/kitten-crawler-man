/**
 * The Starlight Tent's ground warnings that are not plain tiles: the red pool
 * on a stretch of menagerie boards the lamps are about to find.
 *
 * Kept apart from the tent's furniture (`starlightTentMazeProps.ts`) so
 * `check:ui-style` can hold it to the theme: every ground warning is red, drawn
 * by the shared painters in `dangerTelegraph.ts`.
 */

import { drawDangerCircle } from './dangerTelegraph';

/** The warning's reach, as a share of the tile: just inside the lit pool that follows it. */
const SPOT_WARM_RADIUS = 0.46;
/** The warning is fixed the moment it appears, so it is drawn at full strength. */
const SPOT_WARM_FADE = 1;

/**
 * The warning on a tile the lamps are about to light: the red ground warning,
 * locked because the lamps' path is fixed, its fill reaching the outline as
 * `progress` runs 0 → 1 to the moment they strike. Given the tile's top-left
 * corner.
 */
export function drawSpotlightWarm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  progress: number,
): void {
  drawDangerCircle(ctx, x + size / 2, y + size / 2, size * SPOT_WARM_RADIUS, SPOT_WARM_FADE, {
    fillProgress: progress,
    locked: true,
  });
}
