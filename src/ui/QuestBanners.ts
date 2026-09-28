/**
 * Shared quest banner / completion-overlay rendering, so every questline
 * announces stages and completion the same way. Callers own the countdown
 * timers and pass frames-remaining.
 */

import { drawText } from './TextBox';
import { drawOverlay } from './Box';
import { viewportWidth, viewportHeight } from '../core/Viewport';

/** Horizontal gap kept clear on each side of a full-width title, even on the narrowest mobile canvas. */
const TITLE_SIDE_MARGIN = 20;
/** Never shrink a title past this size, however narrow the canvas — word-wrap takes over below this. */
const FITTED_TITLE_MIN_SIZE = 14;
const FITTED_TITLE_SIZE_STEP = 1;
const FITTED_TITLE_DEFAULT_FONT = 'monospace';

function fittedTitleFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  baseSize: number,
  maxWidth: number,
  bold: boolean,
  font: string,
): number {
  let size = baseSize;
  while (size > FITTED_TITLE_MIN_SIZE) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= FITTED_TITLE_SIZE_STEP;
  }
  return size;
}

/** Options for {@link drawFittedTitle}. */
export interface FittedTitleOptions {
  /** Horizontal center of the title. */
  centerX: number;
  /** Top edge of the title text. */
  y: number;
  /** Preferred font size — shrunk down (and word-wrapped as a last resort) to fit the canvas width. */
  size: number;
  color: string;
  bold?: boolean;
  font?: string;
  alpha?: number;
  glow?: boolean | string;
  glowBlur?: number;
}

/**
 * Draws a centered title that shrinks to fit the canvas width (with a fixed
 * side margin) before falling back to word-wrap, so a long banner title never
 * runs off a narrow mobile canvas.
 */
export function drawFittedTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: FittedTitleOptions,
): void {
  const bold = opts.bold ?? true;
  const font = opts.font ?? FITTED_TITLE_DEFAULT_FONT;
  const maxWidth = Math.max(0, viewportWidth() - TITLE_SIDE_MARGIN * 2);

  ctx.save();
  const fittedSize = fittedTitleFontSize(ctx, text, opts.size, maxWidth, bold, font);
  ctx.restore();

  drawText(ctx, text, {
    x: opts.centerX - maxWidth / 2,
    y: opts.y,
    size: fittedSize,
    bold,
    font,
    color: opts.color,
    align: 'center',
    alpha: opts.alpha,
    glow: opts.glow,
    glowBlur: opts.glowBlur,
    width: maxWidth,
  });
}

const FRAMES_PER_SECOND = 60;

/** Stage-banner display time. */
const BANNER_SECONDS = 4;
export const QUEST_BANNER_FRAMES = BANNER_SECONDS * FRAMES_PER_SECOND;
const BANNER_FADE_FRAMES = 60;
const BANNER_TITLE_Y = 70;
const BANNER_TITLE_SIZE = 30;
const BANNER_GLOW_BLUR = 12;

/** Completion-overlay display time. */
const QUEST_COMPLETE_DISPLAY_SECONDS = 7;
export const QUEST_COMPLETE_OVERLAY_FRAMES = QUEST_COMPLETE_DISPLAY_SECONDS * FRAMES_PER_SECOND;
const OVERLAY_FADE_FRAMES = 90;
const OVERLAY_DIM_ALPHA = 0.6;
const OVERLAY_TITLE_Y_OFFSET = 30;
const OVERLAY_TITLE_SIZE = 26;
const OVERLAY_GLOW_BLUR = 15;
const OVERLAY_DISMISS_Y_OFFSET = 30;
const OVERLAY_DISMISS_SIZE = 12;

/** Draws a fading top-of-screen stage banner. No-op when framesLeft <= 0. */
export function drawQuestBanner(
  ctx: CanvasRenderingContext2D,
  text: string,
  framesLeft: number,
  color = '#a8f070',
  glow = '#3a6a2a',
): void {
  if (framesLeft <= 0) return;
  const alpha = framesLeft < BANNER_FADE_FRAMES ? framesLeft / BANNER_FADE_FRAMES : 1;
  drawText(ctx, text, {
    x: viewportWidth() / 2,
    y: BANNER_TITLE_Y,
    size: BANNER_TITLE_SIZE,
    bold: true,
    color,
    align: 'center',
    alpha,
    glow,
    glowBlur: BANNER_GLOW_BLUR,
  });
}

/** Draws the dimmed full-screen quest-complete overlay. No-op when framesLeft <= 0. */
export function drawQuestCompleteOverlay(
  ctx: CanvasRenderingContext2D,
  title: string,
  framesLeft: number,
): void {
  if (framesLeft <= 0) return;
  const alpha = framesLeft < OVERLAY_FADE_FRAMES ? framesLeft / OVERLAY_FADE_FRAMES : 1;

  drawOverlay(ctx, {
    canvasWidth: viewportWidth(),
    canvasHeight: viewportHeight(),
    alpha: alpha * OVERLAY_DIM_ALPHA,
  });

  drawFittedTitle(ctx, title, {
    centerX: viewportWidth() / 2,
    y: viewportHeight() / 2 - OVERLAY_TITLE_Y_OFFSET,
    size: OVERLAY_TITLE_SIZE,
    color: '#4ade80',
    alpha,
    glow: '#4ade80',
    glowBlur: OVERLAY_GLOW_BLUR,
  });
  drawText(ctx, 'Space or click to dismiss', {
    x: viewportWidth() / 2,
    y: viewportHeight() / 2 + OVERLAY_DISMISS_Y_OFFSET,
    size: OVERLAY_DISMISS_SIZE,
    color: 'rgba(200,200,200,0.7)',
    align: 'center',
    alpha,
  });
}
