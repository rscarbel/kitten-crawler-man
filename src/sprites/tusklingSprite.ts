import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export function drawTusklingSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  chargeWindup = 0,
  facingX = 1,
  _facingY = 0,
): void {
  const flipX = facingX < 0;

  if (chargeWindup > 0) {
    drawSpriteKey(ctx, 'tuskling', 'charge', progressFrameIndex(chargeWindup, 6), sx, sy, s, {
      flipX,
    });
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'tuskling', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'tuskling', 'idle', 0, sx, sy, s, { flipX });
}
