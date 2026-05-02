import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

export function drawLlamaSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  spitAnim = 0,
  facingX = 1,
): void {
  const flipX = facingX < 0;

  if (spitAnim > 0) {
    drawSpriteKey(ctx, 'llama', 'spit', progressFrameIndex(spitAnim, 6), sx, sy, s, { flipX });
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'llama', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, s, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'llama', 'idle', 0, sx, sy, s, { flipX });
}
