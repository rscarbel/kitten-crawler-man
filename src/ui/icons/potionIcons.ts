import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';

const HP_POTION_CX = 0.5;
const HP_POTION_CY = 0.58;
const HP_POTION_R = 0.27;
const HP_POTION_LIQUID_OFFSET = 0.15;
const HP_POTION_LIQUID_SCALE = 0.78;
const HP_POTION_NECK_X = 0.08;
const HP_POTION_NECK_Y = 0.22;
const HP_POTION_NECK_W = 0.16;
const HP_POTION_NECK_H = 0.2;
const HP_POTION_CORK_X = 0.1;
const HP_POTION_CORK_Y = 0.17;
const HP_POTION_CORK_W = 0.2;
const HP_POTION_CORK_H = 0.08;
const HP_POTION_SHINE_OFFSET = 0.3;
const HP_POTION_SHINE_RX = 0.22;
const HP_POTION_SHINE_RY = 0.13;
const HP_POTION_SHINE_ROT = -0.7;
const HP_POTION_SHINE_ALPHA = 0.45;

const POTION_LIQUID_Y_SHIFT = 0.15;
const POTION_LIQUID_R_SCALE = 0.78;
const POTION_SHINE_ALPHA = 0.4;

// Jugg Juice wide-flask uses an ellipse; needs its own RX scale
const JUGG_LIQUID_RX_SCALE = 0.82;

// Lightning bolt polygon geometry (fractions of bolt base size bs)
const BOLT_TIP_Y = 1.8;
const BOLT_NOTCH_X = 0.3;
const BOLT_NOTCH_Y = 0.1;
const BOLT_INNER_X = 0.5;

// Heart bezier geometry (fractions of heart size hs)
const HEART_APEX_Y = 0.3;
const HEART_TOP_CTRL = 0.3;
const HEART_MID_Y = 0.5;
const HEART_BOTTOM = 1.1;

// Clock hour hand angle: π/6 = 30° puts the short hand at 2 o'clock
const CLOCK_HOUR_ANGLE_DIVS = 6;

// Star centre Y shift (fraction of flask radius r)
const STAR_CY_SHIFT = 0.05;

const FLASK_CX = 0.5;
const FLASK_R = 0.25;
const FLASK_NECK_X = 0.07;
const FLASK_NECK_W = 0.14;
const FLASK_NECK_H = 0.18;
const FLASK_CORK_X = 0.09;
const FLASK_CORK_W = 0.18;
const FLASK_CORK_H = 0.08;
const FLASK_SHINE_OFFSET = 0.28;
const FLASK_SHINE_RX = 0.2;
const FLASK_SHINE_RY = 0.11;
const FLASK_SHINE_ROT = -0.7;

const SPEED_FIZZ_BOLT_CX = 0.5;
const SPEED_FIZZ_BOLT_CY = 0.62;
const SPEED_FIZZ_BOLT_SCALE = 0.13;

const JUGG_CY = 0.61;
const JUGG_RX = 0.3;
const JUGG_RY = 0.25;
const JUGG_NECK_X = 0.09;
const JUGG_NECK_Y = 0.26;
const JUGG_NECK_W = 0.18;
const JUGG_NECK_H = 0.14;
const JUGG_CORK_X = 0.11;
const JUGG_CORK_Y = 0.2;
const JUGG_CORK_W = 0.22;
const JUGG_HEART_SIZE = 0.12;
const JUGG_HEART_Y = 0.6;
const JUGG_SHINE_OFFSET = 0.25;

const ROUND_FLASK_CY = 0.58;
const ROUND_FLASK_NECK_Y = 0.24;
const ROUND_FLASK_CORK_Y = 0.18;

// The Cooldown Crisp flask sits slightly higher than the others to fit the clock face.
const COOL_CRISP_CY = 0.55;
const COOL_CRISP_NECK_Y = 0.22;
const COOL_CRISP_CORK_Y = 0.16;
const COOL_CRISP_CLOCK_R = 0.14;
const COOL_CRISP_HAND_LONG = 0.11;
const COOL_CRISP_HAND_SHORT = 0.07;
const COOL_CRISP_HAND_WIDTH = 1.5;

const STAT_BOOST_STAR_R_OUTER = 0.17;
const STAT_BOOST_STAR_R_INNER = 0.08;
const STAT_BOOST_STAR_POINTS = 5;

// Dirty Shirley icon proportions — a tall straight-sided highball glass, drawn as its
// own shape rather than via drawRoundFlask since a tumbler has no round body or neck
const DIRTY_SHIRLEY_CX = 0.5;
const DIRTY_SHIRLEY_GLASS_HALF_W = 0.2;
const DIRTY_SHIRLEY_GLASS_TOP_Y = 0.14;
const DIRTY_SHIRLEY_GLASS_BOTTOM_Y = 0.88;
const DIRTY_SHIRLEY_RIM_RY = 0.02;
const DIRTY_SHIRLEY_LIQUID_TOP_Y = 0.26;
const DIRTY_SHIRLEY_LIQUID_INSET = 0.02;
const DIRTY_SHIRLEY_HIGHLIGHT_X_OFFSET = 0.06;
const DIRTY_SHIRLEY_HIGHLIGHT_W = 0.045;
const DIRTY_SHIRLEY_HIGHLIGHT_ALPHA = 0.3;
const DIRTY_SHIRLEY_GLASS_ALPHA = 0.08;
const DIRTY_SHIRLEY_RIM_ALPHA = 0.4;
/** Shared by the fizz bubbles and the cherry's glint. */
const DIRTY_SHIRLEY_SPARKLE_ALPHA = 0.5;
const DIRTY_SHIRLEY_BUBBLE_R = 0.014;
const DIRTY_SHIRLEY_BUBBLE_1_X = 0.42;
const DIRTY_SHIRLEY_BUBBLE_1_Y = 0.7;
const DIRTY_SHIRLEY_BUBBLE_2_X = 0.58;
const DIRTY_SHIRLEY_BUBBLE_2_Y = 0.56;
const DIRTY_SHIRLEY_BUBBLE_3_X = 0.47;
const DIRTY_SHIRLEY_BUBBLE_3_Y = 0.42;
const DIRTY_SHIRLEY_CHERRY_X_OFFSET = 0.12;
const DIRTY_SHIRLEY_CHERRY_Y_OFFSET = -0.03;
const DIRTY_SHIRLEY_CHERRY_R = 0.055;
const DIRTY_SHIRLEY_CHERRY_SHINE_X_OFFSET = -0.018;
const DIRTY_SHIRLEY_CHERRY_SHINE_Y_OFFSET = -0.018;
const DIRTY_SHIRLEY_CHERRY_SHINE_R = 0.016;
const DIRTY_SHIRLEY_STEM_END_X_OFFSET = -0.03;
const DIRTY_SHIRLEY_STEM_END_Y_OFFSET = -0.1;
const DIRTY_SHIRLEY_STEM_CTRL_X_OFFSET = 0.05;
const DIRTY_SHIRLEY_STEM_CTRL_Y_OFFSET = -0.06;

/**
 * Draws the shared parts of a round-flask potion icon: body circle, liquid fill,
 * neck rect, cork rect, and shine highlight. Returns the computed centre and radius
 * so the caller can draw the symbol inside.
 */
function drawRoundFlask(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  cyFrac: number,
  neckYFrac: number,
  corkYFrac: number,
  bodyColor: string,
  liquidColor: string,
  neckColor: string,
  corkColor: string,
): { cx: number; cy: number; r: number } {
  const cx = x + size * FLASK_CX;
  const cy = y + size * cyFrac;
  const r = size * FLASK_R;

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = liquidColor;
  ctx.beginPath();
  ctx.arc(cx, cy + r * POTION_LIQUID_Y_SHIFT, r * POTION_LIQUID_R_SCALE, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = neckColor;
  ctx.fillRect(
    cx - size * FLASK_NECK_X,
    y + size * neckYFrac,
    size * FLASK_NECK_W,
    size * FLASK_NECK_H,
  );

  ctx.fillStyle = corkColor;
  ctx.fillRect(
    cx - size * FLASK_CORK_X,
    y + size * corkYFrac,
    size * FLASK_CORK_W,
    size * FLASK_CORK_H,
  );

  ctx.fillStyle = `rgba(255,255,255,${POTION_SHINE_ALPHA})`;
  ctx.beginPath();
  ctx.ellipse(
    cx - r * FLASK_SHINE_OFFSET,
    cy - r * FLASK_SHINE_OFFSET,
    r * FLASK_SHINE_RX,
    r * FLASK_SHINE_RY,
    FLASK_SHINE_ROT,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  return { cx, cy, r };
}

/** Health Potion: a red round flask. */
export function drawHealthPotionIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * HP_POTION_CX;
  const cy = y + size * HP_POTION_CY;
  const r = size * HP_POTION_R;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy + r * HP_POTION_LIQUID_OFFSET, r * HP_POTION_LIQUID_SCALE, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  ctx.fillRect(
    cx - size * HP_POTION_NECK_X,
    y + size * HP_POTION_NECK_Y,
    size * HP_POTION_NECK_W,
    size * HP_POTION_NECK_H,
  );
  ctx.fillStyle = '#92400e';
  ctx.fillRect(
    cx - size * HP_POTION_CORK_X,
    y + size * HP_POTION_CORK_Y,
    size * HP_POTION_CORK_W,
    size * HP_POTION_CORK_H,
  );
  ctx.fillStyle = `rgba(255,255,255,${HP_POTION_SHINE_ALPHA})`;
  ctx.beginPath();
  ctx.ellipse(
    cx - r * HP_POTION_SHINE_OFFSET,
    cy - r * HP_POTION_SHINE_OFFSET,
    r * HP_POTION_SHINE_RX,
    r * HP_POTION_SHINE_RY,
    HP_POTION_SHINE_ROT,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** Speed Fizz: a blue flask with a lightning bolt. */
export function drawSpeedFizzIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  drawRoundFlask(
    ctx,
    x,
    y,
    size,
    ROUND_FLASK_CY,
    ROUND_FLASK_NECK_Y,
    ROUND_FLASK_CORK_Y,
    '#0284c7',
    '#38bdf8',
    '#075985',
    '#92400e',
  );
  const bx = x + size * SPEED_FIZZ_BOLT_CX;
  const by = y + size * SPEED_FIZZ_BOLT_CY;
  const bs = size * SPEED_FIZZ_BOLT_SCALE;
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.moveTo(bx + bs, by - bs * BOLT_TIP_Y);
  ctx.lineTo(bx - bs * BOLT_NOTCH_X, by - bs * BOLT_NOTCH_Y);
  ctx.lineTo(bx + bs * BOLT_INNER_X, by - bs * BOLT_NOTCH_Y);
  ctx.lineTo(bx - bs, by + bs * BOLT_TIP_Y);
  ctx.lineTo(bx + bs * BOLT_NOTCH_X, by + bs * BOLT_NOTCH_Y);
  ctx.lineTo(bx - bs * BOLT_INNER_X, by + bs * BOLT_NOTCH_Y);
  ctx.closePath();
  ctx.fill();
}

/** Jugg Juice: a wide orange flask with a heart. */
export function drawJuggJuiceIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * FLASK_CX;
  const cy = y + size * JUGG_CY;
  const rx = size * JUGG_RX;
  const ry = size * JUGG_RY;
  ctx.fillStyle = '#c2410c';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fb923c';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy + ry * POTION_LIQUID_Y_SHIFT,
    rx * JUGG_LIQUID_RX_SCALE,
    ry * POTION_LIQUID_R_SCALE,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(
    cx - size * JUGG_NECK_X,
    y + size * JUGG_NECK_Y,
    size * JUGG_NECK_W,
    size * JUGG_NECK_H,
  );
  ctx.fillStyle = '#92400e';
  ctx.fillRect(
    cx - size * JUGG_CORK_X,
    y + size * JUGG_CORK_Y,
    size * JUGG_CORK_W,
    size * FLASK_CORK_H,
  );
  const hx = cx;
  const hy = y + size * JUGG_HEART_Y;
  const hs = size * JUGG_HEART_SIZE;
  ctx.fillStyle = '#fda4af';
  ctx.beginPath();
  ctx.moveTo(hx, hy + hs * HEART_APEX_Y);
  ctx.bezierCurveTo(hx, hy - hs * HEART_TOP_CTRL, hx - hs, hy - hs * HEART_TOP_CTRL, hx - hs, hy);
  ctx.bezierCurveTo(hx - hs, hy + hs * HEART_MID_Y, hx, hy + hs, hx, hy + hs * HEART_BOTTOM);
  ctx.bezierCurveTo(hx, hy + hs, hx + hs, hy + hs * HEART_MID_Y, hx + hs, hy);
  ctx.bezierCurveTo(
    hx + hs,
    hy - hs * HEART_TOP_CTRL,
    hx,
    hy - hs * HEART_TOP_CTRL,
    hx,
    hy + hs * HEART_APEX_Y,
  );
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${POTION_SHINE_ALPHA})`;
  ctx.beginPath();
  ctx.ellipse(
    cx - rx * JUGG_SHINE_OFFSET,
    cy - ry * JUGG_SHINE_OFFSET,
    rx * FLASK_SHINE_RX,
    ry * FLASK_SHINE_RY,
    FLASK_SHINE_ROT,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** Cooldown Crisp: a green flask with a clock face. */
export function drawCooldownCrispIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const { cx, cy } = drawRoundFlask(
    ctx,
    x,
    y,
    size,
    COOL_CRISP_CY,
    COOL_CRISP_NECK_Y,
    COOL_CRISP_CORK_Y,
    '#059669',
    '#34d399',
    '#065f46',
    '#92400e',
  );
  const clockR = size * COOL_CRISP_CLOCK_R;
  ctx.fillStyle = '#d1fae5';
  ctx.beginPath();
  ctx.arc(cx, cy, clockR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#059669';
  ctx.lineWidth = 1;
  ctx.stroke();
  const longR = size * COOL_CRISP_HAND_LONG;
  const shortR = size * COOL_CRISP_HAND_SHORT;
  ctx.strokeStyle = '#064e3b';
  ctx.lineWidth = COOL_CRISP_HAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(-Math.PI / 2) * longR, cy + Math.sin(-Math.PI / 2) * longR);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + Math.cos(Math.PI / CLOCK_HOUR_ANGLE_DIVS) * shortR,
    cy + Math.sin(Math.PI / CLOCK_HOUR_ANGLE_DIVS) * shortR,
  );
  ctx.stroke();
}

/** Stat Boost: a purple flask with a gold star. */
export function drawStatBoostIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const { cx, cy, r } = drawRoundFlask(
    ctx,
    x,
    y,
    size,
    ROUND_FLASK_CY,
    ROUND_FLASK_NECK_Y,
    ROUND_FLASK_CORK_Y,
    '#7e22ce',
    '#c084fc',
    '#581c87',
    '#d97706',
  );
  const outerR = size * STAT_BOOST_STAR_R_OUTER;
  const innerR = size * STAT_BOOST_STAR_R_INNER;
  const starCY = cy + r * STAR_CY_SHIFT;
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  for (let i = 0; i < STAT_BOOST_STAR_POINTS * 2; i++) {
    const angle = (i * Math.PI) / STAT_BOOST_STAR_POINTS - Math.PI / 2;
    const rad = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * rad;
    const py = starCY + Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** The Dirty Shirley: a highball of grenadine and ginger ale with a cherry on the rim. */
export function drawDirtyShirleyIcon(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, size } = iconSquare(rect);
  const cx = x + size * DIRTY_SHIRLEY_CX;
  const glassTopY = y + size * DIRTY_SHIRLEY_GLASS_TOP_Y;
  const glassBottomY = y + size * DIRTY_SHIRLEY_GLASS_BOTTOM_Y;
  const glassLeftX = cx - size * DIRTY_SHIRLEY_GLASS_HALF_W;
  const glassRightX = cx + size * DIRTY_SHIRLEY_GLASS_HALF_W;

  // Faint glass body under the liquid so the tumbler's walls read past the fill line
  ctx.fillStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_GLASS_ALPHA})`;
  ctx.fillRect(glassLeftX, glassTopY, glassRightX - glassLeftX, glassBottomY - glassTopY);

  const liquidTopY = y + size * DIRTY_SHIRLEY_LIQUID_TOP_Y;
  const liquidLeftX = glassLeftX + size * DIRTY_SHIRLEY_LIQUID_INSET;
  const liquidRightX = glassRightX - size * DIRTY_SHIRLEY_LIQUID_INSET;

  const liquidGradient = ctx.createLinearGradient(0, liquidTopY, 0, glassBottomY);
  liquidGradient.addColorStop(0, '#fda4af');
  liquidGradient.addColorStop(1, '#7f1d3d');
  ctx.fillStyle = liquidGradient;
  ctx.fillRect(liquidLeftX, liquidTopY, liquidRightX - liquidLeftX, glassBottomY - liquidTopY);

  ctx.strokeStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_RIM_ALPHA})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    glassTopY,
    size * DIRTY_SHIRLEY_GLASS_HALF_W,
    size * DIRTY_SHIRLEY_RIM_RY,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  // A pale stripe down one side sells the glass over the liquid
  ctx.fillStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_HIGHLIGHT_ALPHA})`;
  ctx.fillRect(
    glassLeftX + size * DIRTY_SHIRLEY_HIGHLIGHT_X_OFFSET,
    glassTopY,
    size * DIRTY_SHIRLEY_HIGHLIGHT_W,
    glassBottomY - glassTopY,
  );

  ctx.fillStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_SPARKLE_ALPHA})`;
  const bubbleFracs: Array<[number, number]> = [
    [DIRTY_SHIRLEY_BUBBLE_1_X, DIRTY_SHIRLEY_BUBBLE_1_Y],
    [DIRTY_SHIRLEY_BUBBLE_2_X, DIRTY_SHIRLEY_BUBBLE_2_Y],
    [DIRTY_SHIRLEY_BUBBLE_3_X, DIRTY_SHIRLEY_BUBBLE_3_Y],
  ];
  for (const [bxFrac, byFrac] of bubbleFracs) {
    ctx.beginPath();
    ctx.arc(x + size * bxFrac, y + size * byFrac, size * DIRTY_SHIRLEY_BUBBLE_R, 0, Math.PI * 2);
    ctx.fill();
  }

  const cherryX = cx + size * DIRTY_SHIRLEY_CHERRY_X_OFFSET;
  const cherryY = glassTopY + size * DIRTY_SHIRLEY_CHERRY_Y_OFFSET;
  const cherryR = size * DIRTY_SHIRLEY_CHERRY_R;

  ctx.strokeStyle = '#4d7c0f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cherryX, cherryY - cherryR);
  ctx.quadraticCurveTo(
    cherryX + size * DIRTY_SHIRLEY_STEM_CTRL_X_OFFSET,
    cherryY + size * DIRTY_SHIRLEY_STEM_CTRL_Y_OFFSET,
    cherryX + size * DIRTY_SHIRLEY_STEM_END_X_OFFSET,
    cherryY + size * DIRTY_SHIRLEY_STEM_END_Y_OFFSET,
  );
  ctx.stroke();

  ctx.fillStyle = '#7f1d3d';
  ctx.beginPath();
  ctx.arc(cherryX, cherryY, cherryR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255,255,255,${DIRTY_SHIRLEY_SPARKLE_ALPHA})`;
  ctx.beginPath();
  ctx.arc(
    cherryX + size * DIRTY_SHIRLEY_CHERRY_SHINE_X_OFFSET,
    cherryY + size * DIRTY_SHIRLEY_CHERRY_SHINE_Y_OFFSET,
    size * DIRTY_SHIRLEY_CHERRY_SHINE_R,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
