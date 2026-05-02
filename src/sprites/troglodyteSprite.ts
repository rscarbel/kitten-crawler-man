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
  facingY = 0,
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

  // Tongue overlay — rotated to face the attack direction, anchored at the mouth.
  // Mouth position derived from body sprite geometry: tileX=24, tileY=16, 128×128 at tileScale=64.
  // Source mouth ≈ (64, 28) → screen offset = ((64-24)/64*s, (28-16)/64*s).
  if (tongueExtend > 0) {
    const angle = Math.atan2(facingY, facingX);
    const mouthX = sx + s * (40 / 64);
    const mouthY = sy + s * (12 / 64);
    drawSpriteKey(
      ctx,
      'troglodyte_tongue',
      'extend',
      progressFrameIndex(tongueExtend, 6),
      mouthX,
      mouthY,
      s,
      { rotation: angle },
    );
  }
}
