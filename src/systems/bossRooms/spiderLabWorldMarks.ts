/**
 * The spider lab's marks painted into the room itself, in world space: the
 * scientist's alarm and line, the arrow over the terminal and its boot line,
 * the sealed room's pulsing border and the colours of the cutscene's gore.
 */

import type { Rect } from '../../ui/core/geom';
import { worldPalette } from '../../ui/theme/worldInk';
import { measureWorldText, worldText } from '../../ui/world/worldText';

/** Flesh tones a burst chunk of the escaping spider's victim is drawn in. */
export const SPIDER_CUTSCENE_GORE_COLORS = [
  '#7f1d1d',
  '#991b1b',
  '#b91c1c',
  '#dc2626',
  '#5b1010',
] as const;

const CENTRE = 0.5;
/** The alarm and the scientist's line are set in the system face, not the world's monospace. */
const LAB_MARK_FAMILY = 'sans-serif';

const EXCLAMATION_BOB_AMPLITUDE = 3;
const EXCLAMATION_BOB_PERIOD_MS = 350;
const EXCLAMATION_FONT_SIZE = 16;
const EXCLAMATION_STROKE_WIDTH = 3;
const EXCLAMATION_RISE = 16;

/** A bobbing gold "!" centred at (`cx`, `cy`), raised over someone with something to say. */
export function paintExclamationMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  nowMs: number,
): void {
  const bob = Math.sin(nowMs / EXCLAMATION_BOB_PERIOD_MS) * EXCLAMATION_BOB_AMPLITUDE;
  const y = cy - EXCLAMATION_RISE + bob;
  worldText(ctx, '!', {
    x: cx,
    y,
    size: EXCLAMATION_FONT_SIZE,
    bold: true,
    family: LAB_MARK_FAMILY,
    color: worldPalette.spiderLab.alarm,
    outline: worldPalette.spiderLab.alarmOutline,
    outlineWidth: EXCLAMATION_STROKE_WIDTH,
    align: 'center',
    baseline: 'middle',
  });
}

const BUBBLE_PADDING = 8;
const BUBBLE_FONT_SIZE = 9;
const BUBBLE_HEIGHT = 22;
const BUBBLE_LIFT = 8;
const BUBBLE_TAIL_HALF_WIDTH = 5;
const BUBBLE_TAIL_DROP = 6;
const BUBBLE_CORNER_RADIUS = 4;
const BUBBLE_STROKE_WIDTH = 1.5;
const BUBBLE_FILL = 'rgba(255,255,255,0.92)';
const BUBBLE_EDGE = '#334155';

/** A one-line speech bubble over a sprite whose top-left is (`sx`, `sy`) and width `spriteW`. */
export function paintSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  spriteW: number,
  line: string,
  alpha: number,
): void {
  const bubbleFont = { size: BUBBLE_FONT_SIZE, bold: true, family: LAB_MARK_FAMILY } as const;
  const bubbleW = measureWorldText(ctx, line, bubbleFont).width + BUBBLE_PADDING * 2;
  const spriteCentreX = sx + spriteW * CENTRE;
  const bx = spriteCentreX - bubbleW * CENTRE;
  const by = sy - BUBBLE_HEIGHT - BUBBLE_LIFT;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = BUBBLE_FILL;
  ctx.strokeStyle = BUBBLE_EDGE;
  ctx.lineWidth = BUBBLE_STROKE_WIDTH;
  ctx.beginPath();
  ctx.roundRect(bx, by, bubbleW, BUBBLE_HEIGHT, BUBBLE_CORNER_RADIUS);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(spriteCentreX - BUBBLE_TAIL_HALF_WIDTH, by + BUBBLE_HEIGHT);
  ctx.lineTo(spriteCentreX, by + BUBBLE_HEIGHT + BUBBLE_TAIL_DROP);
  ctx.lineTo(spriteCentreX + BUBBLE_TAIL_HALF_WIDTH, by + BUBBLE_HEIGHT);
  ctx.fillStyle = BUBBLE_FILL;
  ctx.fill();
  ctx.restore();

  worldText(ctx, line, {
    ...bubbleFont,
    x: bx + bubbleW * CENTRE,
    y: by + BUBBLE_HEIGHT * CENTRE,
    color: worldPalette.spiderLab.bubbleInk,
    alpha,
    align: 'center',
    baseline: 'middle',
  });
}

const MS_PER_SECOND = 1000;
const ARROW_BOUNCE_RATE = 3.5;
/** The arrow's bounce height, as a fraction of a tile. */
const ARROW_BOUNCE_TILES = 0.25;
/** The arrow's width and head height, as fractions of a tile. */
const ARROW_WIDTH_TILES = 0.4;
const ARROW_HEAD_TILES = 0.3;
/** The shaft's half width as a fraction of the arrow's width, and its length as a fraction of the head. */
const ARROW_SHAFT_HALF_WIDTH = 0.2;
const ARROW_SHAFT_LENGTH = 0.55;
/** How far above the terminal's anchor tile its arrow floats, in tiles: clear of the monitor. */
const TERMINAL_ARROW_RISE_TILES = 1;
const ARROW_OUTLINE_WIDTH = 3;
const ARROW_OUTLINE = '#000';
const ARROW_FILL = '#facc15';

/** A gold arrow bouncing over the terminal on the tile whose top-left is (`tileX`, `tileY`) on screen. */
export function paintTerminalArrow(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  ts: number,
  nowMs: number,
): void {
  const seconds = nowMs / MS_PER_SECOND;
  const bounce = Math.abs(Math.sin(seconds * ARROW_BOUNCE_RATE)) * ts * ARROW_BOUNCE_TILES;
  const tipX = tileX + ts * CENTRE;
  const headTop = tileY - ts * TERMINAL_ARROW_RISE_TILES - ts * ARROW_HEAD_TILES - bounce;
  const width = ts * ARROW_WIDTH_TILES;
  const head = ts * ARROW_HEAD_TILES;
  const shaftHalf = width * ARROW_SHAFT_HALF_WIDTH;
  const shaftTop = headTop - head * ARROW_SHAFT_LENGTH;

  ctx.save();
  ctx.strokeStyle = ARROW_OUTLINE;
  ctx.lineWidth = ARROW_OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tipX, headTop + head);
  ctx.lineTo(tipX - width * CENTRE, headTop);
  ctx.lineTo(tipX - shaftHalf, headTop);
  ctx.lineTo(tipX - shaftHalf, shaftTop);
  ctx.lineTo(tipX + shaftHalf, shaftTop);
  ctx.lineTo(tipX + shaftHalf, headTop);
  ctx.lineTo(tipX + width * CENTRE, headTop);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = ARROW_FILL;
  ctx.fill();
  ctx.restore();
}

const BOOT_LINE_SIZE = 11;

/** The terminal's "ACCESSING TERMINAL..." line, centred on `centreX` with its top at `y`. */
export function paintTerminalBootLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  centreX: number,
  y: number,
): void {
  worldText(ctx, line, {
    x: centreX,
    y,
    size: BOOT_LINE_SIZE,
    bold: true,
    color: worldPalette.spiderLab.console,
    align: 'center',
    glow: worldPalette.spiderLab.console,
    outline: true,
  });
}

const BORDER_STROKE_WIDTH = 3;
const CORNER_STROKE_WIDTH = 2;
const CORNER_INSET = 4;
const BORDER_OPEN_COLOR = '#fbbf24';
const BORDER_SEALED_COLOR = '#ef4444';

/**
 * The sealed lab's outline with a cross in each corner tile, gold while a
 * straggler can still get in and red once it is shut. `bounds` is in tiles.
 */
export function paintLockedRoomBorder(
  ctx: CanvasRenderingContext2D,
  bounds: Rect,
  camX: number,
  camY: number,
  ts: number,
  alpha: number,
  entryOpen: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = entryOpen ? BORDER_OPEN_COLOR : BORDER_SEALED_COLOR;
  ctx.lineWidth = BORDER_STROKE_WIDTH;
  ctx.strokeRect(bounds.x * ts - camX, bounds.y * ts - camY, bounds.w * ts, bounds.h * ts);
  ctx.lineWidth = CORNER_STROKE_WIDTH;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [bounds.x, bounds.y],
    [lastX, bounds.y],
    [bounds.x, lastY],
    [lastX, lastY],
  ];
  for (const [tileX, tileY] of corners) {
    const sx = tileX * ts - camX;
    const sy = tileY * ts - camY;
    ctx.beginPath();
    ctx.moveTo(sx + CORNER_INSET, sy + CORNER_INSET);
    ctx.lineTo(sx + ts - CORNER_INSET, sy + ts - CORNER_INSET);
    ctx.moveTo(sx + ts - CORNER_INSET, sy + CORNER_INSET);
    ctx.lineTo(sx + CORNER_INSET, sy + ts - CORNER_INSET);
    ctx.stroke();
  }
  ctx.restore();
}
