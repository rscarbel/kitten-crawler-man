/**
 * Generates dungeon_tileset.png
 * Run: tsx scripts/generateDungeonTileset.ts
 *
 * Design:
 *  - Floors are LIGHT muted grey (145–165 range) so they read as walkable.
 *  - Walls are DARK warm stone (60–78 range) so the contrast is obvious.
 *  - No grout at tile edges — seams only between interior stones, so tiles
 *    never create double-width dark lines at their boundaries.
 *  - Each variant gets a random mix of surface features (stains, accent
 *    stones, hairline cracks, edge wear) for visual richness without chaos.
 */
import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D } from 'canvas';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

const T = 64;

// ─── Math helpers ─────────────────────────────────────────────────────────────

function h(a: number, b: number, c = 0): number {
  return ((Math.imul(a, 374761393) ^ Math.imul(b, 1103515245) ^ Math.imul(c, 668265263)) >>> 0) % 65536;
}
const hf = (a: number, b: number, c = 0): number => h(a, b, c) / 65535;
const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (r: number, g: number, b: number): string =>
  `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
const rgba = (r: number, g: number, b: number, a: number): string =>
  `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${a.toFixed(3)})`;

// ─── Stone seam layouts (2×2 family) ─────────────────────────────────────────
// vx = x position of the vertical interior seam
// hy = y position of the horizontal interior seam
// All seams are at least 10px from any edge so tiles never create
// double-wide dark borders when placed next to each other.

interface SeamLayout { vx: number; hy: number; }

const SEAM_LAYOUTS: SeamLayout[] = [
  { vx: 32, hy: 32 },  // centered
  { vx: 34, hy: 30 },
  { vx: 30, hy: 34 },
  { vx: 36, hy: 27 },
  { vx: 27, hy: 36 },
  { vx: 38, hy: 30 },
  { vx: 26, hy: 32 },
  { vx: 32, hy: 38 },
];

// ─── Floor palettes ───────────────────────────────────────────────────────────
// Floors are LIGHT so they look walkable and contrast with dark walls.
// seam colour is only ~22 units darker than stone — barely a shadow.

interface FPalette {
  sr: number; sg: number; sb: number;   // stone base (light grey family)
  cr: number; cg: number; cb: number;   // seam colour
  varAmt: number;   // ±per-stone colour variation
  litBoost: number; // top-edge highlight amount
  shdDrop: number;  // bottom-edge shadow amount
}

const FP: Record<string, FPalette> = {
  //  Floors are all light muted grey — channels kept close together (low saturation).
  //  varAmt is large so each stone in a tile reads as a clearly different piece.
  //                        stone                 seam                var   lit  shd
  plain:   { sr:168, sg:169, sb:172,  cr:138, cg:139, cb:142,  varAmt:22, litBoost:16, shdDrop:11 },
  worn:    { sr:178, sg:178, sb:180,  cr:148, cg:148, cb:150,  varAmt:16, litBoost:12, shdDrop:8  },
  cracked: { sr:162, sg:163, sb:167,  cr:132, cg:133, cb:137,  varAmt:22, litBoost:15, shdDrop:12 },
  mossy:   { sr:158, sg:166, sb:160,  cr:128, cg:136, cb:130,  varAmt:18, litBoost:13, shdDrop:10 },
  wet:     { sr:148, sg:152, sb:164,  cr:118, cg:122, cb:134,  varAmt:16, litBoost:18, shdDrop:8  },
  dark:    { sr:132, sg:134, sb:140,  cr:104, cg:106, cb:112,  varAmt:20, litBoost:12, shdDrop:11 },
  ornate:  { sr:182, sg:182, sb:186,  cr:150, cg:150, cb:154,  varAmt:14, litBoost:18, shdDrop:9  },
};

// ─── Core floor tile drawing ──────────────────────────────────────────────────

function drawFloorBase(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
  pal: FPalette,
): void {
  const { vx, hy } = SEAM_LAYOUTS[variant % SEAM_LAYOUTS.length];

  // 4 stone quads: TL, TR, BL, BR
  const quads = [
    { x: 0,  y: 0,  w: vx,     hh: hy      },
    { x: vx, y: 0,  w: T - vx, hh: hy      },
    { x: 0,  y: hy, w: vx,     hh: T - hy  },
    { x: vx, y: hy, w: T - vx, hh: T - hy  },
  ];

  // Decide per-variant features deterministically
  const accentIdx  = h(variant, 0, 200) % 4;           // which stone gets accent colour
  const hasAccent  = h(variant, 1, 200) % 3 !== 0;     // 67% chance of an accent stone
  const stainIdx   = h(variant, 2, 200) % 4;
  const hasStain   = h(variant, 3, 200) % 4 !== 0;     // 75% chance of a small stain
  const grainLevel = 3 + (h(variant, 4, 200) % 6);     // 3–8 grain specks per stone

  for (let qi = 0; qi < quads.length; qi++) {
    const { x, y, w, hh } = quads[qi];

    // Base colour — slight per-stone variation
    const sv = hf(variant * 4 + qi, 7, 1);
    const variation = (sv - 0.5) * pal.varAmt;

    // Accent stone: one stone is noticeably lighter/darker for visual interest
    const accentShift = (hasAccent && qi === accentIdx)
      ? (h(variant, 5, 200) % 2 === 0 ? 12 : -10)
      : 0;

    const br = pal.sr + variation + accentShift;
    const bg2 = pal.sg + variation * 0.9 + accentShift * 0.9;
    const bb = pal.sb + variation * 0.7 + accentShift * 0.7;

    // Fill stone to full quad (no inset at tile edges)
    ctx.fillStyle = rgb(br, bg2, bb);
    ctx.fillRect(ox + x, oy + y, w, hh);

    // Surface grain — density varies per variant
    for (let n = 0; n < grainLevel; n++) {
      const gx = x + 1 + Math.floor(hf(variant * 9 + qi, n, 11) * (w - 2));
      const gy = y + 1 + Math.floor(hf(variant * 9 + qi, n, 12) * (hh - 2));
      const ga = 0.03 + hf(variant, qi * 8 + n, 13) * 0.06;
      ctx.fillStyle = rgba(0, 0, 0, ga);
      ctx.fillRect(ox + gx, oy + gy, 2, 1);
    }
    // Mineral flecks (lighter)
    for (let n = 0; n < 2; n++) {
      const gx = x + 1 + Math.floor(hf(variant * 5 + qi, n, 21) * (w - 2));
      const gy = y + 1 + Math.floor(hf(variant * 5 + qi, n, 22) * (hh - 2));
      ctx.fillStyle = rgba(255, 252, 240, 0.09);
      ctx.fillRect(ox + gx, oy + gy, 1, 1);
    }

    // Stain on one stone — a small dark oval (age/moisture mark)
    if (hasStain && qi === stainIdx) {
      const sw = 6 + Math.floor(hf(variant, qi, 30) * 10);
      const sh2 = 3 + Math.floor(hf(variant, qi, 31) * 5);
      const scx = x + Math.floor(w * 0.3 + hf(variant, qi, 32) * w * 0.4);
      const scy = y + Math.floor(hh * 0.3 + hf(variant, qi, 33) * hh * 0.4);
      ctx.fillStyle = rgba(0, 0, 0, 0.07 + hf(variant, qi, 34) * 0.05);
      ctx.beginPath();
      ctx.ellipse(ox + scx, oy + scy, sw / 2, sh2 / 2, hf(variant, qi, 35) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    // Top-edge highlight (overhead ambient light)
    ctx.fillStyle = rgb(br + pal.litBoost, bg2 + pal.litBoost * 0.9, bb + pal.litBoost * 0.7);
    ctx.fillRect(ox + x, oy + y, w, 2);

    // Bottom + right shadow
    ctx.fillStyle = rgb(br - pal.shdDrop, bg2 - pal.shdDrop * 0.9, bb - pal.shdDrop * 0.6);
    ctx.fillRect(ox + x, oy + y + hh - 2, w, 2);
    ctx.fillRect(ox + x + w - 2, oy + y + 2, 2, hh - 4);
  }

  // Interior seam lines — only between stones, never at tile edges
  ctx.fillStyle = rgb(pal.cr, pal.cg, pal.cb);
  ctx.fillRect(ox + vx - 1, oy, 2, T);
  ctx.fillRect(ox, oy + hy - 1, T, 2);

  // Ambient occlusion dot at seam intersection
  ctx.fillStyle = rgba(0, 0, 0, 0.22);
  ctx.fillRect(ox + vx - 2, oy + hy - 2, 4, 4);
}

// ─── Floor overlay effects ────────────────────────────────────────────────────

function drawMossOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
): void {
  const seam = SEAM_LAYOUTS[variant % SEAM_LAYOUTS.length];
  const count = 8 + Math.floor(hf(variant, 0, 70) * 10);
  for (let i = 0; i < count; i++) {
    const nearV = h(variant, i, 71) % 2 === 0;
    const mx = nearV ? seam.vx - 3 + Math.floor(hf(variant, i, 72) * 6) : Math.floor(hf(variant, i, 72) * T);
    const my = nearV ? Math.floor(hf(variant, i, 73) * T) : seam.hy - 3 + Math.floor(hf(variant, i, 73) * 6);
    const mr = 1 + Math.floor(hf(variant, i, 74) * 3);
    ctx.fillStyle = rgba(30, 58, 30, 0.14 + hf(variant, i, 75) * 0.10);
    ctx.beginPath();
    ctx.arc(ox + mx, oy + my, mr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWetOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
): void {
  ctx.fillStyle = rgba(0, 8, 24, 0.16);
  ctx.fillRect(ox, oy, T, T);
  for (let i = 0; i < 3; i++) {
    const wx = Math.floor(hf(variant, i, 50) * (T - 10)) + 4;
    const wy = Math.floor(hf(variant, i, 51) * (T - 8)) + 3;
    const ww = 5 + Math.floor(hf(variant, i, 52) * 9);
    const wh = 2 + Math.floor(hf(variant, i, 53) * 3);
    ctx.fillStyle = rgba(200, 220, 255, 0.09 + hf(variant, i, 54) * 0.07);
    ctx.beginPath();
    ctx.ellipse(ox + wx + ww / 2, oy + wy + wh / 2, ww / 2, wh / 2, (hf(variant, i, 55) - 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOrnatePattern(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
  pal: FPalette,
): void {
  const cx = ox + T / 2;
  const cy = oy + T / 2;
  const lineColor = rgb(pal.cr - 6, pal.cg - 6, pal.cb - 4);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 0.8;

  switch (variant % 4) {
    case 0: {
      ctx.beginPath();
      ctx.moveTo(cx, oy + 10); ctx.lineTo(ox + T - 10, cy);
      ctx.lineTo(cx, oy + T - 10); ctx.lineTo(ox + 10, cy);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = rgba(pal.cr - 8, pal.cg - 8, pal.cb - 6, 0.16);
      ctx.fill();
      ctx.fillStyle = lineColor;
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 1: {
      const r = 22, cut = 9;
      ctx.beginPath();
      ctx.moveTo(cx - r + cut, cy - r); ctx.lineTo(cx + r - cut, cy - r);
      ctx.lineTo(cx + r, cy - r + cut); ctx.lineTo(cx + r, cy + r - cut);
      ctx.lineTo(cx + r - cut, cy + r); ctx.lineTo(cx - r + cut, cy + r);
      ctx.lineTo(cx - r, cy + r - cut); ctx.lineTo(cx - r, cy - r + cut);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = rgba(pal.cr - 6, pal.cg - 6, pal.cb - 4, 0.14);
      ctx.fill();
      ctx.fillStyle = lineColor;
      ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 2: {
      ctx.strokeRect(ox + 8, oy + 8, T - 16, T - 16);
      ctx.beginPath();
      ctx.moveTo(cx, oy + 8); ctx.lineTo(cx, oy + T - 8);
      ctx.moveTo(ox + 8, cy); ctx.lineTo(ox + T - 8, cy);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = lineColor;
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20, 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
  }
}

function drawHoarderFloor(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
): void {
  // Dark grimy base, varies warmly per variant — no tile grid, fully organic
  const baseR = 30 + Math.floor(hf(variant, 0, 900) * 16);
  const baseG = 20 + Math.floor(hf(variant, 1, 900) * 10);
  const baseB = 10 + Math.floor(hf(variant, 2, 900) * 8);
  ctx.fillStyle = rgb(baseR, baseG, baseB);
  ctx.fillRect(ox, oy, T, T);

  // Large organic grime zones (2–4 per tile)
  const zoneCount = 2 + h(variant, 0, 910) % 3;
  for (let i = 0; i < zoneCount; i++) {
    const zx = Math.floor(hf(variant, i, 911) * T);
    const zy = Math.floor(hf(variant, i, 912) * T);
    const zrx = 14 + Math.floor(hf(variant, i, 913) * 18);
    const zry = 9 + Math.floor(hf(variant, i, 914) * 13);
    const zang = hf(variant, i, 915) * Math.PI;
    const zalpha = 0.16 + hf(variant, i, 916) * 0.20;
    const ztone = h(variant * 3 + i, 0, 917) % 3;
    if (ztone === 0)      ctx.fillStyle = rgba(85, 108, 18, zalpha);
    else if (ztone === 1) ctx.fillStyle = rgba(66, 50, 12, zalpha);
    else                  ctx.fillStyle = rgba(112, 90, 22, zalpha);
    ctx.beginPath();
    ctx.ellipse(ox + zx, oy + zy, zrx, zry, zang, 0, Math.PI * 2);
    ctx.fill();
  }

  // Medium stain blotches (4–7 per tile)
  const blotchCount = 4 + h(variant, 0, 920) % 4;
  for (let i = 0; i < blotchCount; i++) {
    const bx = Math.floor(hf(variant, i, 921) * T);
    const by = Math.floor(hf(variant, i, 922) * T);
    const bbrx = 4 + Math.floor(hf(variant, i, 923) * 10);
    const bbry = 3 + Math.floor(hf(variant, i, 924) * 6);
    const bba = hf(variant, i, 925) * Math.PI;
    const balpha = 0.12 + hf(variant, i, 926) * 0.20;
    const btone = h(variant * 5 + i, 0, 927) % 4;
    if (btone === 0)      ctx.fillStyle = rgba(24, 34, 8, balpha);
    else if (btone === 1) ctx.fillStyle = rgba(56, 42, 10, balpha);
    else if (btone === 2) ctx.fillStyle = rgba(96, 78, 18, balpha);
    else                  ctx.fillStyle = rgba(0, 0, 0, balpha);
    ctx.beginPath();
    ctx.ellipse(ox + bx, oy + by, bbrx, bbry, bba, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dense speckle/debris layer (18–34 specks)
  const speckleCount = 18 + h(variant, 0, 930) % 17;
  for (let i = 0; i < speckleCount; i++) {
    const spx = Math.floor(hf(variant, i, 931) * T);
    const spy = Math.floor(hf(variant, i, 932) * T);
    const spr = 0.5 + hf(variant, i, 933) * 1.5;
    if (h(variant, i, 934) % 3 !== 0) {
      ctx.fillStyle = rgba(8, 6, 4, 0.28 + hf(variant, i, 935) * 0.28);
    } else {
      ctx.fillStyle = rgba(92, 72, 38, 0.14 + hf(variant, i, 936) * 0.18);
    }
    ctx.beginPath();
    ctx.arc(ox + spx, oy + spy, spr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Occasional worn/scuffed lighter patch
  if (h(variant, 0, 940) % 3 !== 0) {
    const wx = Math.floor(hf(variant, 0, 941) * (T - 14)) + 7;
    const wy = Math.floor(hf(variant, 0, 942) * (T - 10)) + 5;
    ctx.fillStyle = rgba(175, 148, 102, 0.04 + hf(variant, 0, 943) * 0.04);
    ctx.beginPath();
    ctx.ellipse(ox + wx, oy + wy, 10 + hf(variant, 0, 944) * 9, 6 + hf(variant, 0, 945) * 5, hf(variant, 0, 946) * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFloorTile(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  state: string,
  variant: number,
): void {
  switch (state) {
    case 'floor_plain':
      drawFloorBase(ctx, ox, oy, variant, FP.plain);
      break;
    case 'floor_worn':
      drawFloorBase(ctx, ox, oy, variant, FP.worn);
      // Polish sheen: soft centred highlight on each stone
      for (let qi = 0; qi < 4; qi++) {
        const { vx, hy } = SEAM_LAYOUTS[variant % SEAM_LAYOUTS.length];
        const qx = qi % 2 === 0 ? 0 : vx;
        const qy = qi < 2 ? 0 : hy;
        const qw = qi % 2 === 0 ? vx : T - vx;
        const qh = qi < 2 ? hy : T - hy;
        ctx.fillStyle = rgba(255, 252, 240, 0.05);
        ctx.beginPath();
        ctx.ellipse(ox + qx + qw / 2, oy + qy + qh / 2, qw * 0.32, qh * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'floor_cracked':
      drawFloorBase(ctx, ox, oy, variant, FP.cracked);
      break;
    case 'floor_mossy':
      drawFloorBase(ctx, ox, oy, variant, FP.mossy);
      drawMossOverlay(ctx, ox, oy, variant);
      break;
    case 'floor_wet':
      drawFloorBase(ctx, ox, oy, variant, FP.wet);
      drawWetOverlay(ctx, ox, oy, variant);
      break;
    case 'floor_dark':
      drawFloorBase(ctx, ox, oy, variant, FP.dark);
      ctx.fillStyle = rgba(0, 0, 0, 0.14);
      ctx.fillRect(ox, oy + T / 2, T, T / 2);
      break;
    case 'floor_ornate': {
      // Clean uniform base — no seam grid or stain so the pattern reads clearly
      const off = hf(variant, 0, 600) * 10 - 5;
      ctx.fillStyle = rgb(FP.ornate.sr + off, FP.ornate.sg + off, FP.ornate.sb + off);
      ctx.fillRect(ox, oy, T, T);
      // Very subtle top-left bevel
      ctx.fillStyle = rgb(FP.ornate.sr + FP.ornate.litBoost + off, FP.ornate.sg + FP.ornate.litBoost * 0.9 + off, FP.ornate.sb + FP.ornate.litBoost * 0.7 + off);
      ctx.fillRect(ox, oy, T, 1);
      ctx.fillRect(ox, oy, 1, T);
      drawOrnatePattern(ctx, ox, oy, variant, FP.ornate);
      break;
    }
    case 'floor_hoarder':
      drawHoarderFloor(ctx, ox, oy, variant);
      break;
  }
}

// ─── Wall drawing ─────────────────────────────────────────────────────────────
// Walls are DARK warm stone so they contrast sharply with the light floor.

interface WPalette {
  br: number; bg: number; bb: number;
  mr: number; mg: number; mb: number;
  varAmt: number;
  topLift: number;
}

const WP: Record<string, WPalette> = {
  //               brick              mortar            var  top
  plain:   { br:72,bg:62,bb:54,  mr:54,mg:46,mb:40,  varAmt:14, topLift:16 },
  cracked: { br:68,bg:59,bb:52,  mr:52,mg:44,mb:38,  varAmt:14, topLift:15 },
  mossy:   { br:62,bg:65,bb:50,  mr:46,mg:50,mb:38,  varAmt:12, topLift:12 },
  dark:    { br:42,bg:38,bb:44,  mr:28,mg:25,mb:30,  varAmt:8,  topLift:9  },
};

const BRICK_W = 30;
const BRICK_H = 14;
const MORTAR  = 2;

function drawBrickTile(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
  pal: WPalette,
): void {
  // Per-variant: one horizontal band of bricks can be slightly lighter/darker
  const accentRow  = h(variant, 0, 400) % 4;
  const hasRowAccent = h(variant, 1, 400) % 2 === 0;
  const surfaceGrain = 3 + (h(variant, 2, 400) % 5);

  // Mortar fill
  ctx.fillStyle = rgb(pal.mr, pal.mg, pal.mb);
  ctx.fillRect(ox, oy, T, T);

  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, T, T); ctx.clip();

  const rowH = BRICK_H + MORTAR;
  let row = 0;
  for (let ry = 0; ry < T + rowH; ry += rowH, row++) {
    const offset = row % 2 === 0 ? 0 : Math.floor(BRICK_W / 2 + MORTAR / 2);
    const rowAccentShift = (hasRowAccent && row % 4 === accentRow) ? 8 : 0;

    for (let bx = -BRICK_W; bx < T + BRICK_W; bx += BRICK_W + MORTAR) {
      const brickX = ox + bx + offset;
      const brickY = oy + ry;
      if (brickX + BRICK_W < ox || brickX > ox + T) continue;
      if (brickY + BRICK_H < oy || brickY > oy + T) continue;

      const idx = row * 7 + Math.floor((bx + offset + BRICK_W) / (BRICK_W + MORTAR));
      const bv = hf(variant, idx, 5);
      const variation = (bv - 0.5) * pal.varAmt;
      const br2 = pal.br + variation + rowAccentShift;
      const bg2 = pal.bg + variation * 0.85 + rowAccentShift * 0.85;
      const bb2 = pal.bb + variation * 0.7 + rowAccentShift * 0.7;

      // Brick face
      ctx.fillStyle = rgb(br2, bg2, bb2);
      ctx.fillRect(brickX, brickY, BRICK_W, BRICK_H);

      // Top face (overhead light)
      ctx.fillStyle = rgb(br2 + pal.topLift, bg2 + pal.topLift * 0.9, bb2 + pal.topLift * 0.7);
      ctx.fillRect(brickX, brickY, BRICK_W, 3);

      // Left edge highlight
      ctx.fillStyle = rgba(255, 240, 220, 0.06);
      ctx.fillRect(brickX, brickY + 3, 2, BRICK_H - 3);

      // Right + bottom shadow
      ctx.fillStyle = rgba(0, 0, 0, 0.22);
      ctx.fillRect(brickX + BRICK_W - 2, brickY + 3, 2, BRICK_H - 3);
      ctx.fillRect(brickX, brickY + BRICK_H - 2, BRICK_W, 2);

      // Surface grain
      for (let n = 0; n < surfaceGrain; n++) {
        const gx2 = brickX + 2 + Math.floor(hf(variant, idx * 6 + n, 14) * (BRICK_W - 4));
        const gy2 = brickY + 3 + Math.floor(hf(variant, idx * 6 + n, 15) * (BRICK_H - 5));
        ctx.fillStyle = rgba(0, 0, 0, 0.06 + hf(variant, idx, 16) * 0.06);
        ctx.fillRect(gx2, gy2, 2, 1);
      }
    }
  }
  ctx.restore();

  // Subtle ceiling-light gradient across top of tile
  ctx.fillStyle = rgba(255, 240, 200, 0.05);
  ctx.fillRect(ox, oy, T, 6);
}

function drawWallMossOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  variant: number,
): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, T, T); ctx.clip();

  const count = 8 + Math.floor(hf(variant, 0, 80) * 10);
  for (let i = 0; i < count; i++) {
    const mx = Math.floor(hf(variant, i, 81) * T);
    const my = T - 5 - Math.floor(hf(variant, i, 82) * T * 0.5);
    const mr = 2 + Math.floor(hf(variant, i, 83) * 5);
    ctx.fillStyle = rgba(20, 46, 18, 0.55 + hf(variant, i, 84) * 0.2);
    ctx.beginPath(); ctx.arc(ox + mx, oy + my, mr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgba(16, 40, 14, 0.30);
  ctx.fillRect(ox, oy + 28, T, 2);

  ctx.restore();
}

function drawWallTile(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  state: string,
  variant: number,
): void {
  switch (state) {
    case 'wall_plain':
      drawBrickTile(ctx, ox, oy, variant, WP.plain);
      break;
    case 'wall_cracked':
      drawBrickTile(ctx, ox, oy, variant, WP.cracked);
      break;
    case 'wall_mossy':
      drawBrickTile(ctx, ox, oy, variant, WP.mossy);
      drawWallMossOverlay(ctx, ox, oy, variant);
      break;
    case 'wall_dark':
      drawBrickTile(ctx, ox, oy, variant, WP.dark);
      // Moisture drip streaks
      for (let d = 0; d < 1 + (h(variant, 0, 90) % 2); d++) {
        const dx = Math.floor(hf(variant, d, 91) * (T - 3));
        ctx.fillStyle = rgba(0, 4, 20, 0.20);
        ctx.fillRect(ox + dx, oy, 2, T);
      }
      break;
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

const STATES: Array<[string, number]> = [
  ['floor_plain',   8],
  ['floor_worn',    8],
  ['floor_cracked', 8],
  ['floor_mossy',   8],
  ['floor_wet',     8],
  ['floor_dark',    8],
  ['floor_ornate',  8],
  ['floor_hoarder', 8],
  ['wall_plain',    8],
  ['wall_cracked',  8],
  ['wall_mossy',    8],
  ['wall_dark',     8],
];

const MAX_FRAMES = Math.max(...STATES.map(([, n]) => n));
const canvas = createCanvas(MAX_FRAMES * T, STATES.length * T);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;

ctx.fillStyle = '#000';
ctx.fillRect(0, 0, canvas.width, canvas.height);

for (let row = 0; row < STATES.length; row++) {
  const [state, count] = STATES[row];
  for (let col = 0; col < count; col++) {
    const ox = col * T;
    const oy = row * T;
    if (state.startsWith('floor_')) drawFloorTile(ctx, ox, oy, state, col);
    else drawWallTile(ctx, ox, oy, state, col);
  }
}

const outPath = join(__dir, '..', 'src', 'images', 'environment', 'dungeon_tileset.png');
writeFileSync(outPath, (canvas as unknown as { toBuffer: (fmt: string) => Buffer }).toBuffer('image/png'));
console.log(`Wrote ${outPath}  (${canvas.width}×${canvas.height} px)`);
