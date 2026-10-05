import { TILE_SIZE } from '../core/constants';
import { drawSpriteKey } from '../core/SpriteRenderer';

/** The Doomsday escape stairwell is drawn this many tiles across. */
export const STAIRWELL_SCALE = 2;
const STAIRWELL_PULSE_CENTER = 0.7;
const STAIRWELL_PULSE_AMPLITUDE = 0.2;
/** Milliseconds per radian of the rim's pulse. */
const STAIRWELL_PULSE_SPEED = 500;
const STAIRWELL_BORDER_WIDTH = 2;
const STAIRWELL_OPEN_GLOW_BLUR = 12;
/** Pixels the border sits inside the sprite's own edge, so the stroke is not clipped by it. */
const STAIRWELL_BORDER_INSET = 1;
const OPEN_RIM_RGB = '74, 222, 128';
const OPEN_GLOW_COLOR = '#4ade80';
const SEALED_RIM_RGB = '239, 68, 68';

/**
 * The stairwell and its rim: a red pulse while it is sealed, a green glow once
 * the crystal is contained and it leads out.
 */
export function renderEscapeStairwell(
  ctx: CanvasRenderingContext2D,
  tile: { x: number; y: number },
  camX: number,
  camY: number,
  open: boolean,
): void {
  const sx = tile.x * TILE_SIZE - camX;
  const sy = tile.y * TILE_SIZE - camY;
  const size = TILE_SIZE * STAIRWELL_SCALE;
  const pulse =
    STAIRWELL_PULSE_CENTER +
    Math.sin(Date.now() / STAIRWELL_PULSE_SPEED) * STAIRWELL_PULSE_AMPLITUDE;

  drawSpriteKey(ctx, 'stairwell', 'street', 0, sx, sy, size);
  ctx.save();
  if (open) {
    ctx.strokeStyle = `rgba(${OPEN_RIM_RGB}, ${pulse})`;
    ctx.shadowColor = OPEN_GLOW_COLOR;
    ctx.shadowBlur = STAIRWELL_OPEN_GLOW_BLUR;
  } else {
    ctx.strokeStyle = `rgba(${SEALED_RIM_RGB}, ${pulse})`;
  }
  ctx.lineWidth = STAIRWELL_BORDER_WIDTH;
  ctx.strokeRect(
    sx + STAIRWELL_BORDER_INSET,
    sy + STAIRWELL_BORDER_INSET,
    size - STAIRWELL_BORDER_INSET * 2,
    size - STAIRWELL_BORDER_INSET * 2,
  );
  ctx.restore();
}
