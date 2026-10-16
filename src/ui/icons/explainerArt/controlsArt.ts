/**
 * The controls the explainer illustrations show being pressed: a keyboard
 * keycap, a fingertip tap and the phone HUD's switch-character button.
 */

import { worldPlate } from '../../world/worldShapes';
import { worldText } from '../../world/worldText';

const HALF = 0.5;
const TWO_PI = Math.PI * 2;

export const KEYCAP_H = 34;
export const KEYCAP_RADIUS = 6;
const KEYCAP_MIN_W = 40;
const KEYCAP_CHAR_W = 10;
const KEYCAP_PAD_X = 12;
const KEYCAP_LABEL_SIZE = 14;
/** How far a keycap's face sinks into its skirt when pressed, and how much skirt shows below it at rest. */
export const KEYCAP_DEPTH = 4;
const KEYCAP_SKIRT = '#020617';
const KEYCAP_FILL = '#0f172a';
const KEYCAP_BORDER = '#475569';
const KEYCAP_BORDER_WIDTH = 1.5;
const KEYCAP_LABEL_COLOR = '#e2e8f0';
const KEYCAP_PRESSED_FILL = '#1e3a5f';
const KEYCAP_PRESSED_BORDER = '#60a5fa';
/** How long a pictured key stays sunk, or a pictured button lit, after it is pressed. */
export const KEY_PRESS_FRAMES = 12;

const TAP_RING_FRAMES = 22;
const TAP_RING_MAX_RADIUS = 22;
const TAP_RING_COLOR = 'rgba(255,255,255,0.8)';
const TAP_RING_WIDTH = 2;
const TAP_DOT_RADIUS = 6;

/** The look of a phone HUD button in the illustrations. */
export const HUD_BUTTON_IDLE_FILL = 'rgba(0,0,0,0.65)';
export const HUD_BUTTON_IDLE_BORDER = '#475569';
export const HUD_BUTTON_BORDER_WIDTH = 1.5;
export const HUD_BUTTON_PRESSED_FILL = 'rgba(96,165,250,0.35)';

/** The mobile HUD's switch control, as the player sees it while playing the human. */
const MOBILE_SWITCH_ICON = '🐱';
const MOBILE_SWITCH_LABEL = 'Cat';
export const MOBILE_SWITCH_SIZE = 50;
const MOBILE_SWITCH_ICON_SIZE = 20;
const MOBILE_SWITCH_ICON_Y = 8;
const MOBILE_SWITCH_LABEL_Y = 32;
const MOBILE_SWITCH_LABEL_SIZE = 10;
const MOBILE_SWITCH_LABEL_COLOR = '#e2e8f0';

export function keycapWidth(label: string): number {
  return Math.max(KEYCAP_MIN_W, label.length * KEYCAP_CHAR_W + KEYCAP_PAD_X * 2);
}

/** A keycap with a visible skirt, sunk while the key is held. Returns its width. */
export function drawKeycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  pressed: boolean,
): number {
  const width = keycapWidth(label);
  const sink = pressed ? KEYCAP_DEPTH : 0;
  worldPlate(
    ctx,
    { x, y: y + KEYCAP_DEPTH, w: width, h: KEYCAP_H },
    { fill: KEYCAP_SKIRT, radius: KEYCAP_RADIUS },
  );
  worldPlate(
    ctx,
    { x, y: y + sink, w: width, h: KEYCAP_H },
    {
      fill: pressed ? KEYCAP_PRESSED_FILL : KEYCAP_FILL,
      border: pressed ? KEYCAP_PRESSED_BORDER : KEYCAP_BORDER,
      borderWidth: KEYCAP_BORDER_WIDTH,
      radius: KEYCAP_RADIUS,
      glow: pressed ? KEYCAP_PRESSED_BORDER : false,
    },
  );
  worldText(ctx, label, {
    x: x + width * HALF,
    y: y + sink + (KEYCAP_H - KEYCAP_LABEL_SIZE) * HALF,
    size: KEYCAP_LABEL_SIZE,
    bold: true,
    color: KEYCAP_LABEL_COLOR,
    align: 'center',
  });
  return width;
}

/** A fingertip landing: a dot and a ring spreading from it. */
export function drawTap(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sinceTap: number,
): void {
  if (sinceTap < 0 || sinceTap >= TAP_RING_FRAMES) return;
  const t = sinceTap / TAP_RING_FRAMES;
  ctx.save();
  ctx.strokeStyle = TAP_RING_COLOR;
  ctx.fillStyle = TAP_RING_COLOR;
  ctx.globalAlpha *= 1 - t;
  ctx.lineWidth = TAP_RING_WIDTH;
  ctx.beginPath();
  ctx.arc(cx, cy, TAP_RING_MAX_RADIUS * t, 0, TWO_PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, TAP_DOT_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export function drawMobileSwitchButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pressed: boolean,
): void {
  worldPlate(
    ctx,
    { x, y, w: MOBILE_SWITCH_SIZE, h: MOBILE_SWITCH_SIZE },
    {
      fill: pressed ? HUD_BUTTON_PRESSED_FILL : HUD_BUTTON_IDLE_FILL,
      border: HUD_BUTTON_IDLE_BORDER,
      borderWidth: HUD_BUTTON_BORDER_WIDTH,
      radius: KEYCAP_RADIUS,
    },
  );
  worldText(ctx, MOBILE_SWITCH_ICON, {
    x: x + MOBILE_SWITCH_SIZE * HALF,
    y: y + MOBILE_SWITCH_ICON_Y,
    size: MOBILE_SWITCH_ICON_SIZE,
    align: 'center',
  });
  worldText(ctx, MOBILE_SWITCH_LABEL, {
    x: x + MOBILE_SWITCH_SIZE * HALF,
    y: y + MOBILE_SWITCH_LABEL_Y,
    size: MOBILE_SWITCH_LABEL_SIZE,
    color: MOBILE_SWITCH_LABEL_COLOR,
    align: 'center',
  });
}
