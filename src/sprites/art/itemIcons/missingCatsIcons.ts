import type { Rect } from '../../../ui/core/geom';
import { drawGreyFeatherShape, drawTunaTinShape } from '../missingCatsArt';
import { drawKeyRingShape, drawPawNoteShape } from '../townInterior/rooms/towerWorks';

/** The feather lies corner to corner so its length fills the square. */
const DIAGONAL_TILT = -Math.PI / 4;
const FEATHER_LENGTH_SHARE = 0.9;
const TIN_WIDTH_SHARE = 0.78;
const KEY_RING_SIZE_SHARE = 0.9;
const NOTE_SIZE_SHARE = 1;

function centreOf(rect: Rect): { readonly side: number; readonly cx: number; readonly cy: number } {
  return { side: Math.min(rect.w, rect.h), cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
}

export function drawGreyFeatherIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { side, cx, cy } = centreOf(rect);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DIAGONAL_TILT);
  drawGreyFeatherShape(ctx, side * Math.SQRT2 * FEATHER_LENGTH_SHARE);
  ctx.restore();
}

export function drawTunaTinIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { side, cx, cy } = centreOf(rect);
  ctx.save();
  ctx.translate(cx, cy);
  drawTunaTinShape(ctx, side * TIN_WIDTH_SHARE);
  ctx.restore();
}

export function drawKeyRingIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { side, cx, cy } = centreOf(rect);
  ctx.save();
  ctx.translate(cx, cy);
  drawKeyRingShape(ctx, side * KEY_RING_SIZE_SHARE);
  ctx.restore();
}

export function drawPawNoteIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { side, cx, cy } = centreOf(rect);
  ctx.save();
  ctx.translate(cx, cy);
  drawPawNoteShape(ctx, side * NOTE_SIZE_SHARE);
  ctx.restore();
}
