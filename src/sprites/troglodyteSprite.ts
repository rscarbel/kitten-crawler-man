import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

/**
 * Draw the troglodyte body and, when active, its tongue overlay.
 *
 * @param tongueExtend   0–1 tongue extension progress (0 = retracted, 1 = full reach).
 * @param mouthOpenAmt   0–1 mouth-open windup amount preceding the strike.
 */
export function drawTroglodyteSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  tongueExtend = 0,
  mouthOpenAmt = 0,
  facingX = 1,
  _facingY = 0,
): void {
  const flipX = facingX < 0;

  // Body state
  if (mouthOpenAmt > 0 || tongueExtend > 0) {
    const progress = Math.max(mouthOpenAmt, tongueExtend);
    drawSpriteKey(ctx, 'troglodyte', 'mouth_open', progressFrameIndex(progress, 6), sx, sy, s, {
      flipX,
    });
  } else if (isMoving) {
    drawSpriteKey(ctx, 'troglodyte', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
  } else {
    drawSpriteKey(ctx, 'troglodyte', 'idle', 0, sx, sy, s, { flipX });
  }

  // Tongue overlay — drawn on top of the body when extending.
  if (tongueExtend > 0) {
    drawSpriteKey(
      ctx,
      'troglodyte_tongue',
      'extend',
      progressFrameIndex(tongueExtend, 6),
      sx,
      sy,
      s,
      { flipX },
    );
  }
}
