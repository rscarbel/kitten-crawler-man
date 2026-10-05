import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';

const SCROLL_CX = 0.5;
const SCROLL_CY = 0.55;
const SCROLL_W = 0.52;
const SCROLL_H = 0.42;
const SCROLL_ROLL_OFFSET = 3;
const SCROLL_ROLL_PAD = 2;
const SCROLL_ROLL_H = 6;
const SCROLL_ROLL_BOTTOM = 4;
const SCROLL_SQUIGGLE_ROWS = 3;
const SCROLL_SQUIGGLE_START_Y = 8;
const SCROLL_SQUIGGLE_ROW_H = 9;
const SCROLL_SQUIGGLE_AMP = 4;
const SCROLL_SQUIGGLE_INNER = 0.35;
const SCROLL_SQUIGGLE_CTRL = 0.1;
const SCROLL_GLOW_W = 0.45;
const SCROLL_GLOW_H = 0.35;
const SCROLL_GLOW_ALPHA = 0.28;

/** Scroll of Confusing Fog: parchment with fog squiggles under a green glow. */
export function drawConfusingFogScrollIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * SCROLL_CX;
  const cy = y + size * SCROLL_CY;
  const sw = size * SCROLL_W;
  const sh = size * SCROLL_H;
  ctx.fillStyle = '#d4b483';
  ctx.fillRect(cx - sw / 2, cy - sh / 2, sw, sh);
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - sw / 2, cy - sh / 2, sw, sh);
  ctx.fillStyle = '#c49a40';
  ctx.fillRect(
    cx - sw / 2 - SCROLL_ROLL_OFFSET,
    cy - sh / 2 - SCROLL_ROLL_PAD,
    sw + SCROLL_ROLL_H,
    SCROLL_ROLL_H,
  );
  ctx.fillRect(
    cx - sw / 2 - SCROLL_ROLL_OFFSET,
    cy + sh / 2 - SCROLL_ROLL_BOTTOM,
    sw + SCROLL_ROLL_H,
    SCROLL_ROLL_H,
  );
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let row = 0; row < SCROLL_SQUIGGLE_ROWS; row++) {
    const ly = cy - sh / 2 + SCROLL_SQUIGGLE_START_Y + row * SCROLL_SQUIGGLE_ROW_H;
    ctx.moveTo(cx - sw * SCROLL_SQUIGGLE_INNER, ly);
    ctx.bezierCurveTo(
      cx - sw * SCROLL_SQUIGGLE_CTRL,
      ly - SCROLL_SQUIGGLE_AMP,
      cx + sw * SCROLL_SQUIGGLE_CTRL,
      ly + SCROLL_SQUIGGLE_AMP,
      cx + sw * SCROLL_SQUIGGLE_INNER,
      ly,
    );
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(60,200,140,${SCROLL_GLOW_ALPHA})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, sw * SCROLL_GLOW_W, sh * SCROLL_GLOW_H, 0, 0, Math.PI * 2);
  ctx.fill();
}
