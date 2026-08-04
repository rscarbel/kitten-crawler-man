import { drawBox } from './Box';
import { drawText } from './TextBox';

/**
 * The "you cannot use this yet" wipe: a dark panel that drains off the bottom of
 * a button as the wait runs out, with the remaining seconds over it.
 *
 * Shared rather than duplicated because two very different things now use it —
 * the hotbar's ability slots and Mongo's Summon button — and the whole value of
 * a countdown is that the player learns to read one and gets the rest for free.
 */

const COOLDOWN_OVERLAY_ALPHA = 0.65;
const COOLDOWN_OVERLAY_DARK = 0.75;
const COOLDOWN_FRAMES_PER_SECOND = 60;
/** Above this the number stops being a count and starts being a wall of digits. */
const COOLDOWN_SECS_OVERFLOW = 99;
const COOLDOWN_FONT_SCALE = 0.28;
const COOLDOWN_TEXT_Y_OFFSET = 4;
/** Share of the font size the glyph sits above its baseline, for top-anchored text. */
const COOLDOWN_FONT_BASELINE = 0.8;
const COOLDOWN_TEXT_COLOR = '#e2e8f0';

export interface CooldownOverlayOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Frames still to wait. Nothing is drawn at or below zero. */
  remainingFrames: number;
  /** Frames the full wait lasts, which sets how much of the box is covered. */
  totalFrames: number;
}

/** Draws the drain overlay and the seconds remaining. A no-op when ready. */
export function drawCooldownOverlay(
  ctx: CanvasRenderingContext2D,
  { x, y, width, height, remainingFrames, totalFrames }: CooldownOverlayOptions,
): void {
  if (remainingFrames <= 0 || totalFrames <= 0) return;
  const remainingFraction = Math.max(0, Math.min(1, remainingFrames / totalFrames));

  const coveredHeight = height * remainingFraction;
  drawBox(ctx, {
    x,
    y: y + height - coveredHeight,
    width,
    height: coveredHeight,
    fill: `rgba(0,0,0,${COOLDOWN_OVERLAY_DARK})`,
    alpha: COOLDOWN_OVERLAY_ALPHA,
  });

  const seconds = Math.ceil(remainingFrames / COOLDOWN_FRAMES_PER_SECOND);
  const fontSize = Math.floor(Math.min(width, height) * COOLDOWN_FONT_SCALE);
  const topY =
    y + height / 2 + COOLDOWN_TEXT_Y_OFFSET - Math.round(fontSize * COOLDOWN_FONT_BASELINE);

  // Outlined: the number sits on top of whatever the slot's icon draws, and a
  // pale glyph over a pale icon is invisible exactly while it is worth reading.
  drawText(ctx, seconds > COOLDOWN_SECS_OVERFLOW ? '…' : `${seconds}`, {
    x: x + width / 2,
    y: topY,
    size: fontSize,
    bold: true,
    color: COOLDOWN_TEXT_COLOR,
    outline: true,
    align: 'center',
  });
}
