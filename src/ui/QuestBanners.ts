/**
 * Shared quest banner / completion-overlay rendering, extracted from
 * CircusQuestSystem so every questline announces stages and completion the
 * same way. Callers own the countdown timers and pass frames-remaining.
 */

import { drawText } from './TextBox';
import { drawOverlay } from './Box';

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
  canvas: HTMLCanvasElement,
  text: string,
  framesLeft: number,
  color = '#a8f070',
  glow = '#3a6a2a',
): void {
  if (framesLeft <= 0) return;
  const alpha = framesLeft < BANNER_FADE_FRAMES ? framesLeft / BANNER_FADE_FRAMES : 1;
  drawText(ctx, text, {
    x: canvas.width / 2,
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
  canvas: HTMLCanvasElement,
  title: string,
  framesLeft: number,
): void {
  if (framesLeft <= 0) return;
  const alpha = framesLeft < OVERLAY_FADE_FRAMES ? framesLeft / OVERLAY_FADE_FRAMES : 1;

  drawOverlay(ctx, {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    alpha: alpha * OVERLAY_DIM_ALPHA,
  });

  drawText(ctx, title, {
    x: canvas.width / 2,
    y: canvas.height / 2 - OVERLAY_TITLE_Y_OFFSET,
    size: OVERLAY_TITLE_SIZE,
    bold: true,
    color: '#4ade80',
    align: 'center',
    alpha,
    glow: '#4ade80',
    glowBlur: OVERLAY_GLOW_BLUR,
  });
  drawText(ctx, 'Click to dismiss', {
    x: canvas.width / 2,
    y: canvas.height / 2 + OVERLAY_DISMISS_Y_OFFSET,
    size: OVERLAY_DISMISS_SIZE,
    color: 'rgba(200,200,200,0.7)',
    align: 'center',
    alpha,
  });
}
