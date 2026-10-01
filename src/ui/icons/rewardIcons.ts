/**
 * Small icons for rewards that are not bag items: experience, coins and an
 * achievement loot box. Each paints into the `size`-pixel square whose top-left
 * corner is (`x`, `y`), the same contract as `drawItemIcon`.
 */

import type { BoxTier } from '../../core/AchievementManager';

const FULL_TURN = Math.PI * 2;

const XP_STAR_POINTS = 5;
const XP_STAR_OUTER_RADIUS = 0.46;
const XP_STAR_INNER_RADIUS = 0.2;
/** Points the star's first tip straight up. */
const XP_STAR_START_ANGLE = -Math.PI / 2;
const XP_STAR_FILL = '#a3e635';
const XP_STAR_EDGE = '#365314';
const XP_STAR_EDGE_WIDTH = 0.07;

/** A five-pointed green star: experience, the colour the XP bar fills in. */
export function drawXpRewardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const tips = XP_STAR_POINTS * 2;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < tips; i++) {
    const radius = (i % 2 === 0 ? XP_STAR_OUTER_RADIUS : XP_STAR_INNER_RADIUS) * size;
    const angle = XP_STAR_START_ANGLE + (i / tips) * FULL_TURN;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = XP_STAR_FILL;
  ctx.fill();
  ctx.strokeStyle = XP_STAR_EDGE;
  ctx.lineWidth = XP_STAR_EDGE_WIDTH * size;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

const COIN_RADIUS = 0.42;
const COIN_FILL = '#fbbf24';
const COIN_EDGE = '#92400e';
const COIN_EDGE_WIDTH = 0.08;
const COIN_RIM_RADIUS = 0.3;
const COIN_RIM_COLOR = '#d97706';
const COIN_RIM_WIDTH = 0.05;
const COIN_GLINT_OFFSET = 0.13;
const COIN_GLINT_RADIUS = 0.09;
const COIN_GLINT_COLOR = '#fef3c7';

/** A gold coin seen face-on, with an inner rim and a glint. */
export function drawCoinRewardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, COIN_RADIUS * size, 0, FULL_TURN);
  ctx.fillStyle = COIN_FILL;
  ctx.fill();
  ctx.strokeStyle = COIN_EDGE;
  ctx.lineWidth = COIN_EDGE_WIDTH * size;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, COIN_RIM_RADIUS * size, 0, FULL_TURN);
  ctx.strokeStyle = COIN_RIM_COLOR;
  ctx.lineWidth = COIN_RIM_WIDTH * size;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(
    cx - COIN_GLINT_OFFSET * size,
    cy - COIN_GLINT_OFFSET * size,
    COIN_GLINT_RADIUS * size,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = COIN_GLINT_COLOR;
  ctx.fill();
  ctx.restore();
}

/** The colour each loot box tier is drawn in, matching the achievement notification. */
const LOOT_BOX_TIER_COLORS: Record<BoxTier, string> = {
  Bronze: '#cd7f32',
  Silver: '#c0c0c0',
  Gold: '#ffd700',
  Legendary: '#a855f7',
  Celestial: '#38bdf8',
};

const BOX_INSET = 0.12;
const BOX_BODY_TOP = 0.42;
const BOX_LID_TOP = 0.28;
const BOX_LID_HEIGHT = 0.16;
const BOX_LID_OVERHANG = 0.05;
const BOX_BODY_FILL_ALPHA = 0.35;
const BOX_EDGE_WIDTH = 0.06;
const BOX_RIBBON_WIDTH = 0.1;

/** A ribboned box in its tier's colour. */
export function drawLootBoxRewardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  tier: BoxTier,
): void {
  const color = LOOT_BOX_TIER_COLORS[tier];
  const left = x + BOX_INSET * size;
  const width = size * (1 - BOX_INSET * 2);
  const bodyTop = y + BOX_BODY_TOP * size;
  const bodyHeight = y + size * (1 - BOX_INSET) - bodyTop;
  const lidLeft = left - BOX_LID_OVERHANG * size;
  const lidWidth = width + BOX_LID_OVERHANG * size * 2;
  const lidTop = y + BOX_LID_TOP * size;
  const lidHeight = BOX_LID_HEIGHT * size;
  const centreX = x + size / 2;

  ctx.save();
  ctx.lineWidth = BOX_EDGE_WIDTH * size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha *= BOX_BODY_FILL_ALPHA;
  ctx.fillRect(left, bodyTop, width, bodyHeight);
  ctx.globalAlpha /= BOX_BODY_FILL_ALPHA;
  ctx.strokeRect(left, bodyTop, width, bodyHeight);
  ctx.fillRect(lidLeft, lidTop, lidWidth, lidHeight);
  ctx.fillRect(
    centreX - (BOX_RIBBON_WIDTH * size) / 2,
    lidTop,
    BOX_RIBBON_WIDTH * size,
    bodyTop + bodyHeight - lidTop,
  );
  ctx.restore();
}
