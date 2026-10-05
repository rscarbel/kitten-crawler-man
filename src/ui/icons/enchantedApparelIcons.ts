import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';

const BOXERS_CX = 0.5;
const BOXERS_CY = 0.56;
const BOXERS_WAIST_X = 0.12;
const BOXERS_WAIST_Y = 0.22;
const BOXERS_WAIST_W = 0.76;
const BOXERS_WAIST_H = 0.18;
const BOXERS_LEG_INNER_X = 0.32;
const BOXERS_LEG_INNER_VERT = 0.38;
const BOXERS_LEG_OUTER_X = 0.38;
const BOXERS_LEG_BOTTOM = 0.72;
const BOXERS_LEG_CENTER = 0.05;
const BOXERS_HEART_FONT = 0.18;
const BOXERS_HEART_OFFSET = 0.16;
const BOXERS_HEART_Y_OFFSET = 0.08;

const SHIRT_CX = 0.5;
const SHIRT_CY = 0.52;
const SHIRT_BODY_X = 0.3;
const SHIRT_BODY_TOP = 0.14;
const SHIRT_BODY_SIDE = 0.28;
const SHIRT_BODY_BOTTOM = 0.28;
const SHIRT_SLEEVE_X1 = 0.3;
const SHIRT_SLEEVE_X2 = 0.42;
const SHIRT_SLEEVE_X3 = 0.32;
const SHIRT_SLEEVE_X4 = 0.26;
const SHIRT_SLEEVE_Y_TOP = 0.14;
const SHIRT_SLEEVE_Y1 = 0.04;
const SHIRT_SLEEVE_Y2 = 0.08;
const SHIRT_SLEEVE_Y3 = 0.02;
const SHIRT_COLLAR_RX = 0.1;
const SHIRT_COLLAR_RY = 0.06;
const SHIRT_COLLAR_Y = 0.16;
const SHIRT_RUNE_FONT = 0.22;
const SHIRT_RUNE_Y = 0.14;

const CROWN_CX = 0.5;
const CROWN_CY = 0.48;
const CROWN_BASE_Y = 0.08;
const CROWN_BASE_RX = 0.34;
const CROWN_BASE_RY = 0.1;
const CROWN_BODY_X1 = 0.32;
const CROWN_BODY_Y1 = 0.04;
const CROWN_INNER_X1 = 0.28;
const CROWN_INNER_Y1 = 0.18;
const CROWN_INNER_X2 = 0.14;
const CROWN_INNER_Y2 = 0.06;
const CROWN_TIP_Y = 0.24;
const CROWN_GEM_CENTER_Y = 0.16;
const CROWN_GEM_CENTER_R = 0.06;
const CROWN_GEM_SIDE_X = 0.2;
const CROWN_GEM_SIDE_Y = 0.08;
const CROWN_GEM_SIDE_R = 0.04;
const CROWN_RIM_LINE_W = 1.5;
const CROWN_GEM_BLUR = 4;

/** How far inside the icon square the enchanted glow border sits, in px. */
const GLOW_BORDER_INSET = 1;

function drawGlowBorder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    x + GLOW_BORDER_INSET,
    y + GLOW_BORDER_INSET,
    size - GLOW_BORDER_INSET * 2,
    size - GLOW_BORDER_INSET * 2,
  );
}

/** Enchanted BigBoi Boxers: white boxers with red hearts. */
export function drawBigBoiBoxersIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * BOXERS_CX;
  const cy = y + size * BOXERS_CY;
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(
    x + size * BOXERS_WAIST_X,
    y + size * BOXERS_WAIST_Y,
    size * BOXERS_WAIST_W,
    size * BOXERS_WAIST_H,
  );
  ctx.fillStyle = '#f5f5f5';
  ctx.beginPath();
  ctx.moveTo(cx - size * BOXERS_LEG_INNER_X, y + size * BOXERS_LEG_INNER_VERT);
  ctx.lineTo(cx - size * BOXERS_LEG_OUTER_X, y + size * BOXERS_LEG_BOTTOM);
  ctx.lineTo(cx - size * BOXERS_LEG_CENTER, y + size * BOXERS_LEG_BOTTOM);
  ctx.lineTo(cx, y + size * BOXERS_LEG_INNER_VERT);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + size * BOXERS_LEG_INNER_X, y + size * BOXERS_LEG_INNER_VERT);
  ctx.lineTo(cx + size * BOXERS_LEG_OUTER_X, y + size * BOXERS_LEG_BOTTOM);
  ctx.lineTo(cx + size * BOXERS_LEG_CENTER, y + size * BOXERS_LEG_BOTTOM);
  ctx.lineTo(cx, y + size * BOXERS_LEG_INNER_VERT);
  ctx.closePath();
  ctx.fill();
  // The hearts are glyphs painted as icon art, not UI text, so they stay raw fillText.
  ctx.fillStyle = '#ef4444';
  ctx.font = `bold ${Math.floor(size * BOXERS_HEART_FONT)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('♥', cx - size * BOXERS_HEART_OFFSET, cy - size * BOXERS_HEART_Y_OFFSET);
  ctx.fillText('♥', cx + size * BOXERS_HEART_OFFSET, cy - size * BOXERS_HEART_Y_OFFSET);
  ctx.fillText('♥', cx, cy + size * BOXERS_HEART_Y_OFFSET);
  ctx.textAlign = 'left';
  drawGlowBorder(ctx, x, y, size, '#f87171');
}

/** Enchanted Trollskin Shirt: a mossy green shirt with a gold fist rune. */
export function drawTrollskinShirtIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * SHIRT_CX;
  const cy = y + size * SHIRT_CY;
  ctx.fillStyle = '#4a7c59';
  ctx.beginPath();
  ctx.moveTo(cx - size * SHIRT_BODY_X, cy - size * SHIRT_BODY_TOP);
  ctx.lineTo(cx + size * SHIRT_BODY_X, cy - size * SHIRT_BODY_TOP);
  ctx.lineTo(cx + size * SHIRT_BODY_SIDE, cy + size * SHIRT_BODY_BOTTOM);
  ctx.lineTo(cx - size * SHIRT_BODY_SIDE, cy + size * SHIRT_BODY_BOTTOM);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3d6b4a';
  ctx.beginPath();
  ctx.moveTo(cx - size * SHIRT_SLEEVE_X1, cy - size * SHIRT_SLEEVE_Y_TOP);
  ctx.lineTo(cx - size * SHIRT_SLEEVE_X2, cy + size * SHIRT_SLEEVE_Y1);
  ctx.lineTo(cx - size * SHIRT_SLEEVE_X3, cy + size * SHIRT_SLEEVE_Y2);
  ctx.lineTo(cx - size * SHIRT_SLEEVE_X4, cy - size * SHIRT_SLEEVE_Y3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + size * SHIRT_SLEEVE_X1, cy - size * SHIRT_SLEEVE_Y_TOP);
  ctx.lineTo(cx + size * SHIRT_SLEEVE_X2, cy + size * SHIRT_SLEEVE_Y1);
  ctx.lineTo(cx + size * SHIRT_SLEEVE_X3, cy + size * SHIRT_SLEEVE_Y2);
  ctx.lineTo(cx + size * SHIRT_SLEEVE_X4, cy - size * SHIRT_SLEEVE_Y3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2d5a3a';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - size * SHIRT_COLLAR_Y,
    size * SHIRT_COLLAR_RX,
    size * SHIRT_COLLAR_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // The rune is a glyph painted as icon art, not UI text, so it stays raw fillText.
  ctx.fillStyle = '#ffd700';
  ctx.font = `bold ${Math.floor(size * SHIRT_RUNE_FONT)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('\u{270A}', cx, cy + size * SHIRT_RUNE_Y);
  ctx.textAlign = 'left';
  drawGlowBorder(ctx, x, y, size, '#ffd700');
}

/** Enchanted Crown of the Sepsis Whore: a purple crown set with sickly green gems. */
export function drawSepsisCrownIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * CROWN_CX;
  const cy = y + size * CROWN_CY;
  ctx.fillStyle = '#581c87';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + size * CROWN_BASE_Y,
    size * CROWN_BASE_RX,
    size * CROWN_BASE_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.moveTo(cx - size * CROWN_BODY_X1, cy + size * CROWN_BODY_Y1);
  ctx.lineTo(cx - size * CROWN_INNER_X1, cy - size * CROWN_INNER_Y1);
  ctx.lineTo(cx - size * CROWN_INNER_X2, cy - size * CROWN_INNER_Y2);
  ctx.lineTo(cx, cy - size * CROWN_TIP_Y);
  ctx.lineTo(cx + size * CROWN_INNER_X2, cy - size * CROWN_INNER_Y2);
  ctx.lineTo(cx + size * CROWN_INNER_X1, cy - size * CROWN_INNER_Y1);
  ctx.lineTo(cx + size * CROWN_BODY_X1, cy + size * CROWN_BODY_Y1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = CROWN_RIM_LINE_W;
  ctx.stroke();
  ctx.fillStyle = '#bef264';
  ctx.shadowColor = '#65a30d';
  ctx.shadowBlur = CROWN_GEM_BLUR;
  ctx.beginPath();
  ctx.arc(cx, cy - size * CROWN_GEM_CENTER_Y, size * CROWN_GEM_CENTER_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a3e635';
  ctx.beginPath();
  ctx.arc(
    cx - size * CROWN_GEM_SIDE_X,
    cy - size * CROWN_GEM_SIDE_Y,
    size * CROWN_GEM_SIDE_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    cx + size * CROWN_GEM_SIDE_X,
    cy - size * CROWN_GEM_SIDE_Y,
    size * CROWN_GEM_SIDE_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.shadowBlur = 0;
  drawGlowBorder(ctx, x, y, size, '#a78bfa');
}
