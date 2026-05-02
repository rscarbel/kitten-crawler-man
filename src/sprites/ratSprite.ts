import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export function drawRatSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  attackAnim = 0,
  facingX = 1,
): void {
  const flipX = facingX < 0;

  if (attackAnim > 0) {
    drawSpriteKey(ctx, 'rat', 'attack', progressFrameIndex(attackAnim, 6), sx, sy, s, { flipX });
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'rat', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'rat', 'idle', 0, sx, sy, s, { flipX });
}
