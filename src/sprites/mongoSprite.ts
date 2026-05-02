import { drawSpriteKey, walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';

/**
 * @param scale  Visual size multiplier (0.7–1.5).  Passed as a tileSize
 *               multiplier so the sprite scales around the tile anchor.
 */
export function drawMongoSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  facingX = 1,
  _facingY = 0,
  attackAmt = 0,
  scale = 1,
): void {
  const flipX = facingX < 0;
  const scaledS = s * scale;

  if (attackAmt > 0) {
    drawSpriteKey(ctx, 'mongo', 'attack', progressFrameIndex(attackAmt, 6), sx, sy, scaledS, {
      flipX,
    });
    return;
  }

  if (isMoving) {
    drawSpriteKey(ctx, 'mongo', 'walk', walkFrameIndex(walkFrame, 8), sx, sy, scaledS, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'mongo', 'idle', 0, sx, sy, scaledS, { flipX });
}

/** Small centered icon for hotbar / UI use. */
export function drawMongoIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  drawSpriteKey(ctx, 'mongo', 'idle', 0, cx - size * 0.5, cy - size * 0.5, size);
}
