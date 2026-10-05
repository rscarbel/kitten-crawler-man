/**
 * The edge marker for a pet out of sight: his portrait pinned to the screen
 * edge, with a chevron pointing on past it along the bearing to him. Drawn on
 * the raw world canvas in CSS pixels, after the fog and before the HUD.
 */

import { MINIMAP_MARKER_COLORS } from '../theme/minimapColors';

/** Kept off the very edge, where a marker is half-clipped and reads as an artefact. */
const EDGE_INSET_PX = 22;
const PORTRAIT_SIZE_PX = 26;
/** Chevron length as a fraction of the portrait, so the two scale together. */
const CHEVRON_LENGTH_RATIO = 0.75;
/** How far back from the tip the chevron's trailing corners sit, as a fraction of its length. */
const CHEVRON_BACK_RATIO = 0.35;
const CHEVRON_HALF_WIDTH_RATIO = 0.45;
const CHEVRON_LINE_WIDTH = 1.5;

export interface OffscreenPetMarker {
  /** Where the pet is on screen, in CSS px; may lie outside the screen. */
  readonly screenX: number;
  readonly screenY: number;
  readonly screenW: number;
  readonly screenH: number;
  /** Radians from the player towards the pet. */
  readonly bearing: number;
  readonly paintPortrait: (
    ctx: CanvasRenderingContext2D,
    centreX: number,
    centreY: number,
    size: number,
  ) => void;
}

export function paintOffscreenPetMarker(
  ctx: CanvasRenderingContext2D,
  marker: OffscreenPetMarker,
): void {
  const markerX = Math.max(EDGE_INSET_PX, Math.min(marker.screenW - EDGE_INSET_PX, marker.screenX));
  const markerY = Math.max(EDGE_INSET_PX, Math.min(marker.screenH - EDGE_INSET_PX, marker.screenY));
  marker.paintPortrait(ctx, markerX, markerY, PORTRAIT_SIZE_PX);

  // The portrait says who; the chevron says which way, which the clamped
  // position alone cannot at a corner, where both axes are pinned.
  const tip = PORTRAIT_SIZE_PX * CHEVRON_LENGTH_RATIO;
  ctx.save();
  ctx.translate(markerX, markerY);
  ctx.rotate(marker.bearing);
  ctx.fillStyle = MINIMAP_MARKER_COLORS.pet;
  ctx.strokeStyle = MINIMAP_MARKER_COLORS.outline;
  ctx.lineWidth = CHEVRON_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.lineTo(tip * CHEVRON_BACK_RATIO, -tip * CHEVRON_HALF_WIDTH_RATIO);
  ctx.lineTo(tip * CHEVRON_BACK_RATIO, tip * CHEVRON_HALF_WIDTH_RATIO);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
