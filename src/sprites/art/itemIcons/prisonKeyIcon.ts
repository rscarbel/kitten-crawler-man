import type { Rect } from '../../../ui/core/geom';
import { drawPrisonKeyShape } from '../prisonKeyArt';

/**
 * The prison key in the quest slot: the same ornate gold key that floats over
 * the vault's pedestal, laid corner to corner so its length fills the square.
 * The bow and the bit at either end are what read at hotbar size.
 */
const DIAGONAL_TILT = Math.PI / 4;
/** The key's length as a share of the square's diagonal, leaving room for its outline. */
const LENGTH_SHARE = 0.92;
const FACE_ON = 1;

export function drawPrisonKeyIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const side = Math.min(rect.w, rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(DIAGONAL_TILT);
  drawPrisonKeyShape(ctx, 0, 0, side * Math.SQRT2 * LENGTH_SHARE, FACE_ON, 0);
  ctx.restore();
}
