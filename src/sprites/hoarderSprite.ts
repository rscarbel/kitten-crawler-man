import { drawSpriteKey, progressFrameIndex } from '../core/SpriteRenderer';

const VOMIT_FLASH_MAX = 40;

/**
 * Draw the Hoarder boss sprite.
 * Reusable for both in-game rendering and boss intro portraits.
 *
 * @param vomitFlash  Countdown timer (0–40) active during vomit animation.
 */
export function drawHoarderSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  isEnraged: boolean,
  facingX: number,
  _facingY: number,
  vomitFlash: number,
): void {
  const flipX = facingX < 0;

  if (vomitFlash > 0) {
    const progress = 1 - vomitFlash / VOMIT_FLASH_MAX;
    const frame = progressFrameIndex(progress, 6);
    const state = isEnraged ? 'vomit_enraged' : 'vomit';
    drawSpriteKey(ctx, 'hoarder', state, frame, sx, sy, ts, { flipX });
    return;
  }

  drawSpriteKey(ctx, 'hoarder', isEnraged ? 'enraged' : 'idle', 0, sx, sy, ts, { flipX });
}
