/**
 * Static, themed decorations for each Desperado Club area, drawn on the floor
 * behind the NPCs so the corner alcoves read as distinct rooms — a bar, a casino
 * pit, a market stall, a weapon armoury, and a velvet VIP nook — rather than
 * identical empty corners. Geometry comes from {@link CLUB_ZONES}; props are
 * primitive canvas shapes keyed off each zone's id.
 */

import { TILE_SIZE } from '../core/constants';
import { drawText } from '../ui/TextBox';
import { drawBox } from '../ui/Box';
import { CLUB_ZONES, type ClubZone, type ClubStationId } from '../core/clubLayout';

const TS = TILE_SIZE;
const RUG_INSET = 4;
const LABEL_SIZE = 12;
const LABEL_TOP_OFFSET = 6;

interface Screen {
  x: number;
  y: number;
  w: number;
  h: number;
}

function zoneScreen(z: ClubZone, camX: number, camY: number): Screen {
  return {
    x: z.x0 * TS - camX,
    y: z.y0 * TS - camY,
    w: (z.x1 - z.x0 + 1) * TS,
    h: (z.y1 - z.y0 + 1) * TS,
  };
}

/** Draw all zone rugs, labels, and props. Call before the club NPCs so figures stand on top. */
export function drawClubDecor(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
  ctx.save();
  for (const zone of CLUB_ZONES) {
    const s = zoneScreen(zone, camX, camY);
    drawZoneRug(ctx, s, zone.color);
    drawZoneProps(ctx, zone.id, s, zone.color);
    drawText(ctx, zone.label, {
      x: s.x + s.w / 2,
      y: s.y + LABEL_TOP_OFFSET,
      size: LABEL_SIZE,
      bold: true,
      color: zone.color,
      align: 'center',
      outline: true,
    });
  }
  ctx.restore();
}

function drawZoneRug(ctx: CanvasRenderingContext2D, s: Screen, color: string): void {
  drawBox(ctx, {
    x: s.x + RUG_INSET,
    y: s.y + RUG_INSET,
    width: s.w - RUG_INSET * 2,
    height: s.h - RUG_INSET * 2,
    fill: hexToRgba(color, 0.1),
    border: hexToRgba(color, 0.5),
    borderWidth: 2,
    radius: 8,
  });
}

function drawZoneProps(
  ctx: CanvasRenderingContext2D,
  id: ClubStationId,
  s: Screen,
  color: string,
): void {
  switch (id) {
    case 'bar':
      drawBarProps(ctx, s, color);
      break;
    case 'casino':
      drawCasinoProps(ctx, s);
      break;
    case 'market':
      drawMarketProps(ctx, s, color);
      break;
    case 'mercenary':
      drawMercenaryProps(ctx, s, color);
      break;
    case 'vip':
      drawVipProps(ctx, s, color);
      break;
    case 'sledge':
      break;
  }
}

// ── The Bar — back shelf of bottles, a wood counter, and stools ──────────────
const BAR_WOOD = '#5a3a20';
const BAR_WOOD_TOP = '#7a5230';
const BAR_COUNTER_TOP = '#2a1c12';
const BOTTLE_COLORS = ['#5ac0e0', '#e05a7a', '#7ae05a', '#e0c05a', '#c05ae0', '#e0905a'] as const;

function drawBarProps(ctx: CanvasRenderingContext2D, s: Screen, accent: string): void {
  // Back shelf with a row of bottles along the top of the alcove.
  const shelfY = s.y + TS * 0.9;
  const shelfX = s.x + TS * 0.5;
  const shelfW = s.w - TS;
  ctx.fillStyle = BAR_WOOD;
  ctx.fillRect(shelfX, shelfY, shelfW, TS * 0.16);
  const bottleCount = 6;
  const bottleGap = shelfW / bottleCount;
  for (let i = 0; i < bottleCount; i++) {
    ctx.fillStyle = BOTTLE_COLORS[i % BOTTLE_COLORS.length];
    const bx = shelfX + bottleGap * (i + 0.5) - TS * 0.05;
    ctx.fillRect(bx, shelfY - TS * 0.42, TS * 0.1, TS * 0.42);
    ctx.fillRect(bx + TS * 0.03, shelfY - TS * 0.56, TS * 0.04, TS * 0.16);
  }

  // Wood bar counter with a dark polished top.
  const counterY = s.y + s.h - TS * 1.5;
  const counterX = s.x + TS * 0.5;
  const counterW = s.w - TS;
  ctx.fillStyle = BAR_WOOD;
  ctx.fillRect(counterX, counterY, counterW, TS * 0.8);
  ctx.fillStyle = BAR_COUNTER_TOP;
  ctx.fillRect(counterX, counterY, counterW, TS * 0.22);
  ctx.fillStyle = hexToRgba(accent, 0.6);
  ctx.fillRect(counterX, counterY + TS * 0.2, counterW, 2);

  // Stools in front of the counter.
  const stoolY = counterY + TS * 1.05;
  const stools = 3;
  for (let i = 0; i < stools; i++) {
    const stoolX = counterX + (counterW / stools) * (i + 0.5);
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(stoolX - 1, stoolY, 2, TS * 0.3);
    ctx.fillStyle = BAR_WOOD_TOP;
    ctx.beginPath();
    ctx.arc(stoolX, stoolY, TS * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── The Casino — a felt table with cards and chip stacks ────────────────────
const FELT_GREEN = '#155a34';
const FELT_GREEN_EDGE = '#0c3a22';
const CHIP_COLORS = ['#d84040', '#4060d8', '#e0c040'] as const;

function drawCasinoProps(ctx: CanvasRenderingContext2D, s: Screen): void {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2 + TS * 0.3;
  const rw = s.w * 0.34;
  const rh = s.h * 0.26;
  ctx.fillStyle = FELT_GREEN_EDGE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw + 4, rh + 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FELT_GREEN;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();

  // Two face-up cards on the felt.
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(cx - TS * 0.32, cy - TS * 0.12, TS * 0.24, TS * 0.34);
  ctx.fillRect(cx - TS * 0.04, cy - TS * 0.12, TS * 0.24, TS * 0.34);
  ctx.fillStyle = '#c02020';
  ctx.fillRect(cx - TS * 0.28, cy - TS * 0.08, TS * 0.05, TS * 0.05);
  ctx.fillStyle = '#101010';
  ctx.fillRect(cx, cy - TS * 0.08, TS * 0.05, TS * 0.05);

  // Chip stacks.
  for (let i = 0; i < CHIP_COLORS.length; i++) {
    const stackX = cx + TS * 0.28 + i * TS * 0.16;
    for (let j = 0; j < 3; j++) {
      ctx.fillStyle = CHIP_COLORS[i];
      ctx.beginPath();
      ctx.ellipse(stackX, cy + TS * 0.08 - j * 3, TS * 0.07, TS * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── The Market — striped awning over crates and produce ─────────────────────
const CRATE = '#7a5028';
const CRATE_EDGE = '#4a2f16';

function drawMarketProps(ctx: CanvasRenderingContext2D, s: Screen, accent: string): void {
  // Striped awning across the top.
  const awningY = s.y + TS * 0.7;
  const awningX = s.x + TS * 0.4;
  const awningW = s.w - TS * 0.8;
  const stripes = 6;
  const stripeW = awningW / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? accent : '#f0e8d8';
    ctx.beginPath();
    ctx.moveTo(awningX + i * stripeW, awningY);
    ctx.lineTo(awningX + (i + 1) * stripeW, awningY);
    ctx.lineTo(awningX + (i + 0.5) * stripeW, awningY + TS * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = hexToRgba(accent, 0.8);
  ctx.fillRect(awningX, awningY - TS * 0.14, awningW, TS * 0.14);

  // Crates + produce along the bottom.
  const crateY = s.y + s.h - TS * 1.2;
  const crates = 3;
  const crateW = TS * 0.7;
  const crateGap = (s.w - TS - crates * crateW) / (crates - 1);
  for (let i = 0; i < crates; i++) {
    const crateX = s.x + TS * 0.5 + i * (crateW + crateGap);
    ctx.fillStyle = CRATE;
    ctx.fillRect(crateX, crateY, crateW, TS * 0.7);
    ctx.strokeStyle = CRATE_EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(crateX, crateY, crateW, TS * 0.7);
    // A couple of round goods on top.
    ctx.fillStyle = ['#d05030', '#40a030', '#e0b030'][i % 3];
    ctx.beginPath();
    ctx.arc(crateX + crateW * 0.35, crateY - TS * 0.08, TS * 0.1, 0, Math.PI * 2);
    ctx.arc(crateX + crateW * 0.65, crateY - TS * 0.08, TS * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Meat Shields — a weapon rack and a banner ───────────────────────────────
const STEEL = '#b8c0cc';
const STEEL_DARK = '#6a7280';
const HAFT = '#4a3218';

function drawMercenaryProps(ctx: CanvasRenderingContext2D, s: Screen, accent: string): void {
  // Wall banner.
  const bannerX = s.x + s.w / 2 - TS * 0.5;
  const bannerY = s.y + TS * 0.7;
  ctx.fillStyle = hexToRgba(accent, 0.85);
  ctx.beginPath();
  ctx.moveTo(bannerX, bannerY);
  ctx.lineTo(bannerX + TS, bannerY);
  ctx.lineTo(bannerX + TS, bannerY + TS * 0.8);
  ctx.lineTo(bannerX + TS * 0.5, bannerY + TS * 0.62);
  ctx.lineTo(bannerX, bannerY + TS * 0.8);
  ctx.closePath();
  ctx.fill();

  // Weapon rack: a horizontal beam with weapons standing against it.
  const rackY = s.y + s.h - TS * 1.5;
  const rackX = s.x + TS * 0.6;
  const rackW = s.w - TS * 1.2;
  ctx.fillStyle = HAFT;
  ctx.fillRect(rackX, rackY, rackW, TS * 0.12);
  ctx.fillRect(rackX, s.y + s.h - TS * 0.4, rackW, TS * 0.12);

  // A sword, an axe, a spear.
  const slot = rackW / 3;
  // Sword.
  const swX = rackX + slot * 0.5;
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(swX, rackY + TS * 0.1);
  ctx.lineTo(swX, rackY - TS * 0.7);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(swX - TS * 0.12, rackY - TS * 0.05);
  ctx.lineTo(swX + TS * 0.12, rackY - TS * 0.05);
  ctx.stroke();
  // Axe.
  const axX = rackX + slot * 1.5;
  ctx.strokeStyle = HAFT;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(axX, rackY + TS * 0.1);
  ctx.lineTo(axX, rackY - TS * 0.7);
  ctx.stroke();
  ctx.fillStyle = STEEL_DARK;
  ctx.beginPath();
  ctx.moveTo(axX, rackY - TS * 0.6);
  ctx.lineTo(axX + TS * 0.22, rackY - TS * 0.7);
  ctx.lineTo(axX + TS * 0.22, rackY - TS * 0.44);
  ctx.closePath();
  ctx.fill();
  // Spear.
  const spX = rackX + slot * 2.5;
  ctx.strokeStyle = HAFT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(spX, rackY + TS * 0.1);
  ctx.lineTo(spX, rackY - TS * 0.8);
  ctx.stroke();
  ctx.fillStyle = STEEL;
  ctx.beginPath();
  ctx.moveTo(spX, rackY - TS * 0.95);
  ctx.lineTo(spX - TS * 0.08, rackY - TS * 0.72);
  ctx.lineTo(spX + TS * 0.08, rackY - TS * 0.72);
  ctx.closePath();
  ctx.fill();
}

// ── VIP Lounge — velvet couch, rope stanchions, gold sparkle ────────────────
const VELVET = '#7a1f3a';
const VELVET_LIGHT = '#a02f52';
const GOLD = '#e0c050';
const ROPE = '#b01f3a';

function drawVipProps(ctx: CanvasRenderingContext2D, s: Screen, accent: string): void {
  // Plush velvet couch centered in the nook.
  const couchW = s.w * 0.3;
  const couchX = s.x + s.w / 2 - couchW / 2;
  const couchY = s.y + s.h - TS * 0.95;
  const couchH = TS * 0.55;
  drawBox(ctx, {
    x: couchX,
    y: couchY,
    width: couchW,
    height: couchH,
    fill: VELVET,
    radius: 6,
  });
  // Backrest + cushions.
  ctx.fillStyle = VELVET_LIGHT;
  ctx.fillRect(couchX, couchY, couchW, TS * 0.16);
  const cushions = 3;
  for (let i = 0; i < cushions; i++) {
    ctx.fillStyle = VELVET_LIGHT;
    const cw = couchW / cushions;
    drawBox(ctx, {
      x: couchX + i * cw + 2,
      y: couchY + TS * 0.18,
      width: cw - 4,
      height: couchH - TS * 0.22,
      fill: VELVET_LIGHT,
      radius: 4,
    });
  }

  // Two gold rope stanchions guarding the front, joined by a velvet rope.
  const postY = s.y + s.h - TS * 0.3;
  const leftPostX = couchX - TS * 0.6;
  const rightPostX = couchX + couchW + TS * 0.6;
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(leftPostX, postY - TS * 0.2);
  ctx.quadraticCurveTo(
    (leftPostX + rightPostX) / 2,
    postY + TS * 0.15,
    rightPostX,
    postY - TS * 0.2,
  );
  ctx.stroke();
  for (const postX of [leftPostX, rightPostX]) {
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(postX, postY);
    ctx.lineTo(postX, postY - TS * 0.4);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(postX, postY - TS * 0.44, TS * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gold sparkle accents.
  ctx.fillStyle = hexToRgba(accent, 0.9);
  for (const [dx, dy] of [
    [0.2, 0.5],
    [0.8, 0.45],
    [0.5, 0.35],
  ]) {
    const px = s.x + s.w * dx;
    const py = s.y + s.h * dy;
    ctx.beginPath();
    ctx.moveTo(px, py - 3);
    ctx.lineTo(px + 1, py);
    ctx.lineTo(px + 3, py);
    ctx.lineTo(px + 1, py + 1);
    ctx.lineTo(px, py + 3);
    ctx.lineTo(px - 1, py + 1);
    ctx.lineTo(px - 3, py);
    ctx.lineTo(px - 1, py);
    ctx.closePath();
    ctx.fill();
  }
}

/** Expand a `#rrggbb` string to an `rgba()` with the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
