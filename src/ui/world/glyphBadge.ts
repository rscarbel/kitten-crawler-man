/**
 * The small dark rounded-square badge that bobs over something in the world
 * to say what it does: a Briar Hollow station's output, the coin over
 * anyone who sells things, or the cross over a healer. One painter, so every
 * such badge reads as the same family.
 */

import { worldPalette } from '../theme/worldInk';

/** Paints a glyph centred on `(cx, cy)` at `radius`, as the station glyphs do. */
export type BadgeGlyph = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
) => void;

const GLYPH_RADIUS = 7;
const PADDING = 5;
const CORNER_RADIUS = 5;
const BORDER_WIDTH = 1;
const BOB_PERIOD_MS = 1100;

/** The badge's side length at scale 1. */
export const GLYPH_BADGE_SIZE = GLYPH_RADIUS * 2 + PADDING * 2;
/** How far the badge bobs either side of its resting centre, at scale 1. */
export const GLYPH_BADGE_BOB_AMPLITUDE = 3;

/** The badge's vertical offset from its resting centre at `nowMs`, at scale 1. */
export function glyphBadgeBob(nowMs: number): number {
  return Math.sin(nowMs / BOB_PERIOD_MS) * GLYPH_BADGE_BOB_AMPLITUDE;
}

/**
 * Paints the badge centred on `(cx, cy)` with `glyph` inside. `scale` sizes
 * the whole badge, for wearers drawn larger than one world tile.
 */
export function drawGlyphBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  glyph: BadgeGlyph,
  scale = 1,
): void {
  const size = GLYPH_BADGE_SIZE * scale;
  const r = CORNER_RADIUS * scale;
  const bx = cx - size / 2;
  const by = cy - size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + size, by, bx + size, by + size, r);
  ctx.arcTo(bx + size, by + size, bx, by + size, r);
  ctx.arcTo(bx, by + size, bx, by, r);
  ctx.arcTo(bx, by, bx + size, by, r);
  ctx.closePath();
  ctx.fillStyle = worldPalette.glyphBadge.fill;
  ctx.fill();
  ctx.strokeStyle = worldPalette.glyphBadge.border;
  ctx.lineWidth = BORDER_WIDTH * scale;
  ctx.stroke();
  glyph(ctx, cx, cy, GLYPH_RADIUS * scale);
  ctx.restore();
}
