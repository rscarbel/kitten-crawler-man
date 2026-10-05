/**
 * The small quest-relevance badge drawn wherever a dialog choice, dialog page,
 * or shop row is the thing an active quest needs. It's the same compass rose
 * as the HUD's Journal button, scaled down, so the player learns one shape for
 * "quest" instead of two.
 */

import { drawCompassIcon } from './icons/compassIcon';

/**
 * Draws the badge centred on `(x, y)` at `size` pixels across. Callers place
 * `(x, y)` themselves — typically a button or panel's top-right corner minus
 * half the icon size, so the badge sits centred on the corner rather than
 * hanging off it.
 */
export function drawQuestIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const half = size / 2;
  drawCompassIcon(ctx, { x: x - half, y: y - half, w: size, h: size });
}
