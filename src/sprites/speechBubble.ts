/**
 * World-space speech bubbles above an NPC's head.
 *
 * Lifted out of `mordecaiSprite` once the Bopca needed the same shape with words
 * in it: two callers, one drawing routine, and the tail geometry is fiddly enough
 * that a second copy would have drifted.
 */

import { drawText } from '../ui/TextBox';

const BUBBLE_PULSE_RATE = 0.12;
const BUBBLE_ALPHA_BASE = 0.7;
const BUBBLE_ALPHA_SWING = 0.3;

// "..." bubble geometry, as fractions of the tile size.
const DOTS_BUBBLE_LEFT = 0.18;
const DOTS_BUBBLE_TOP = -0.52;
const DOTS_BUBBLE_WIDTH = 0.64;
const DOTS_BUBBLE_HEIGHT = 0.35;
const DOTS_BUBBLE_RADIUS = 0.06;
const DOTS_TAIL_INSET = 0.1;
const DOTS_TAIL_DROP = 0.15;
const DOTS_TAIL_LEFT = 0.12;
const DOTS_TAIL_RIGHT = 0.22;
const DOT_COUNT = 3;
const DOT_START_FRACTION = 0.28;
const DOT_STEP_FRACTION = 0.22;
const DOT_RADIUS = 0.04;

// Text bubble geometry, in pixels except where noted.
const TEXT_SIZE = 10;
const TEXT_LINE_HEIGHT = 13;
const TEXT_PADDING = 6;
const TEXT_MAX_WIDTH_TILES = 5.5;
const TEXT_BUBBLE_RADIUS = 4;
const TEXT_TAIL_HALF_WIDTH = 5;
const TEXT_TAIL_DROP = 7;
/** Gap between the bubble's bottom edge and the anchor point it points at. */
const TEXT_BUBBLE_GAP = 4;
/** Mean glyph width as a fraction of font size, for the sans-serif UI face. */
const AVERAGE_GLYPH_WIDTH_RATIO = 0.55;

const BUBBLE_FILL = '#ffffff';
const BUBBLE_DOTS = '#334155';
const BUBBLE_TEXT = '#1e293b';

/** Draws a rounded rect with a downward-left tail, in already-camera-offset space. */
function bubblePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  tailCentreX: number,
  tailHalfWidth: number,
  tailDrop: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(tailCentreX + tailHalfWidth, y + h);
  ctx.lineTo(tailCentreX, y + h + tailDrop);
  ctx.lineTo(tailCentreX - tailHalfWidth, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * The wordless "…" bubble that appears over an NPC the player can talk to.
 *
 * @param sx Screen-x of the NPC's tile origin.
 * @param sy Screen-y of the NPC's tile origin.
 */
export function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  pulse: number,
): void {
  ctx.save();
  ctx.globalAlpha = BUBBLE_ALPHA_BASE + Math.sin(pulse * BUBBLE_PULSE_RATE) * BUBBLE_ALPHA_SWING;

  const bx = sx + s * DOTS_BUBBLE_LEFT;
  const by = sy + s * DOTS_BUBBLE_TOP;
  const bw = s * DOTS_BUBBLE_WIDTH;
  const bh = s * DOTS_BUBBLE_HEIGHT;

  ctx.fillStyle = BUBBLE_FILL;
  ctx.beginPath();
  ctx.moveTo(bx + s * DOTS_BUBBLE_RADIUS, by);
  ctx.lineTo(bx + bw - s * DOTS_BUBBLE_RADIUS, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + s * DOTS_BUBBLE_RADIUS);
  ctx.lineTo(bx + bw, by + bh - s * DOTS_BUBBLE_RADIUS);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - s * DOTS_BUBBLE_RADIUS, by + bh);
  ctx.lineTo(bx + s * (DOTS_BUBBLE_RADIUS + DOTS_TAIL_INSET), by + bh);
  ctx.lineTo(bx + s * DOTS_TAIL_LEFT, by + bh + s * DOTS_TAIL_DROP);
  ctx.lineTo(bx + s * (DOTS_BUBBLE_RADIUS + DOTS_TAIL_RIGHT), by + bh);
  ctx.lineTo(bx + s * DOTS_BUBBLE_RADIUS, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - s * DOTS_BUBBLE_RADIUS);
  ctx.lineTo(bx, by + s * DOTS_BUBBLE_RADIUS);
  ctx.quadraticCurveTo(bx, by, bx + s * DOTS_BUBBLE_RADIUS, by);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = BUBBLE_DOTS;
  const dotY = by + bh * 0.5;
  for (let i = 0; i < DOT_COUNT; i++) {
    ctx.beginPath();
    ctx.arc(
      bx + bw * (DOT_START_FRACTION + i * DOT_STEP_FRACTION),
      dotY,
      s * DOT_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.restore();
}

/**
 * A bubble with a line of dialog in it, centred over `anchorX` and pointing down
 * at `anchorY`. Used for lines an NPC says unprompted, where opening the whole
 * dialog box would be far too heavy.
 */
export function drawSpeechBubbleWithText(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  s: number,
  text: string,
): void {
  // Sized from an average glyph width rather than `measureText`: the bubble is
  // drawn every frame a bark is up, and the font is fixed, so a measurement per
  // frame buys nothing that a slightly generous box does not.
  const textWidth = text.length * TEXT_SIZE * AVERAGE_GLYPH_WIDTH_RATIO;
  const boxWidth = Math.min(s * TEXT_MAX_WIDTH_TILES, textWidth + TEXT_PADDING * 2);
  const lineCount = Math.max(1, Math.ceil(textWidth / (boxWidth - TEXT_PADDING * 2)));
  const boxHeight = lineCount * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;
  const boxX = anchorX - boxWidth / 2;
  const boxY = anchorY - boxHeight - TEXT_TAIL_DROP - TEXT_BUBBLE_GAP;

  ctx.save();
  ctx.fillStyle = BUBBLE_FILL;
  bubblePath(
    ctx,
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    TEXT_BUBBLE_RADIUS,
    anchorX,
    TEXT_TAIL_HALF_WIDTH,
    TEXT_TAIL_DROP,
  );
  ctx.fill();
  ctx.restore();

  drawText(ctx, text, {
    x: boxX + TEXT_PADDING,
    y: boxY + TEXT_PADDING,
    size: TEXT_SIZE,
    color: BUBBLE_TEXT,
    width: boxWidth - TEXT_PADDING * 2,
    lineHeight: TEXT_LINE_HEIGHT,
  });
}
