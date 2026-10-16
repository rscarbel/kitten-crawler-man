/**
 * Edge markers for something out of sight: a portrait or badge pinned to the
 * screen edge, with a chevron pointing on past it along the bearing to the
 * target. The pet's is drawn on the raw world canvas in CSS pixels, after the
 * fog and before the HUD; the siege's clocktower badge in a surface, in UI
 * units. Both go through {@link paintOffscreenTargetMarker}.
 */

import { MINIMAP_MARKER_COLORS } from '../theme/minimapColors';

/** Kept off the very edge, where a marker is half-clipped and reads as an artefact. */
const EDGE_INSET_PX = 22;
const PORTRAIT_SIZE_PX = 26;
/** Chevron length as a fraction of the portrait, so the two scale together. */
export const CHEVRON_LENGTH_RATIO = 0.75;
/** How far back from the tip the chevron's trailing corners sit, as a fraction of its length. */
const CHEVRON_BACK_RATIO = 0.35;
const CHEVRON_HALF_WIDTH_RATIO = 0.45;
const CHEVRON_LINE_WIDTH = 1.5;

export interface OffscreenTargetMarker {
  /** Where the target is on screen, in the painter's units; may lie outside the screen. */
  readonly screenX: number;
  readonly screenY: number;
  readonly screenW: number;
  readonly screenH: number;
  /** Radians towards the target. */
  readonly bearing: number;
  readonly paintPortrait: (
    ctx: CanvasRenderingContext2D,
    centreX: number,
    centreY: number,
    size: number,
  ) => void;
}

/** The pet's marker is a target marker in CSS pixels. */
export type OffscreenPetMarker = OffscreenTargetMarker;

export interface OffscreenMarkerStyle {
  /** How far the marker's centre is kept in from each edge. */
  readonly edgeInset: number;
  readonly portraitSize: number;
  readonly chevronFill: string;
  readonly chevronOutline: string;
  readonly chevronLineWidth: number;
}

const PET_MARKER_STYLE: OffscreenMarkerStyle = {
  edgeInset: EDGE_INSET_PX,
  portraitSize: PORTRAIT_SIZE_PX,
  chevronFill: MINIMAP_MARKER_COLORS.pet,
  chevronOutline: MINIMAP_MARKER_COLORS.outline,
  chevronLineWidth: CHEVRON_LINE_WIDTH,
};

/** Paints the marker and returns where its portrait was centred. */
export function paintOffscreenTargetMarker(
  ctx: CanvasRenderingContext2D,
  marker: OffscreenTargetMarker,
  style: OffscreenMarkerStyle,
): { x: number; y: number } {
  const inset = style.edgeInset;
  const markerX = Math.max(inset, Math.min(marker.screenW - inset, marker.screenX));
  const markerY = Math.max(inset, Math.min(marker.screenH - inset, marker.screenY));
  marker.paintPortrait(ctx, markerX, markerY, style.portraitSize);

  // The portrait says who; the chevron says which way, which the clamped
  // position alone cannot at a corner, where both axes are pinned.
  const tip = style.portraitSize * CHEVRON_LENGTH_RATIO;
  ctx.save();
  ctx.translate(markerX, markerY);
  ctx.rotate(marker.bearing);
  ctx.fillStyle = style.chevronFill;
  ctx.strokeStyle = style.chevronOutline;
  ctx.lineWidth = style.chevronLineWidth;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.lineTo(tip * CHEVRON_BACK_RATIO, -tip * CHEVRON_HALF_WIDTH_RATIO);
  ctx.lineTo(tip * CHEVRON_BACK_RATIO, tip * CHEVRON_HALF_WIDTH_RATIO);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  return { x: markerX, y: markerY };
}

export function paintOffscreenPetMarker(
  ctx: CanvasRenderingContext2D,
  marker: OffscreenPetMarker,
): void {
  paintOffscreenTargetMarker(ctx, marker, PET_MARKER_STYLE);
}
