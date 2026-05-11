#!/usr/bin/env tsx
/**
 * Generates the grotesque_spider spit attack sprite sheets.
 *
 * Outputs to src/images/enemies/:
 *   grotesque_spider_spit.png          — creature spit animation  (16 frames)
 *   grotesque_spider_spit_projectile.png — flying glob            (8 frames)
 *   grotesque_spider_spit_trap.png     — sticky puddle splat+idle (8+8 frames)
 *
 * Run: npx tsx scripts/generate-grotesque-spider-spit-sprite.ts
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const TWO_PI = Math.PI * 2;

// ══════════════════════════════════════════════════════════════════════════════
// ── Creature spit animation  (inlined from grotesqueSpiderSprite.ts)
// ══════════════════════════════════════════════════════════════════════════════

// Same frame spec as slam/screech sheets for consistent tileX/tileY.
const SPIT_FRAME_W = 320;
const SPIT_FRAME_H = 384;
const SPIT_TILE_SCALE = 64;
const SPIT_TILE_X = 128;
const SPIT_TILE_Y = 128;

interface HairStrand {
  readonly ax: number; readonly ay: number; readonly len: number;
  readonly phase: number; readonly freq: number;
  readonly thick: number; readonly bend: number;
}
function buildHairStrands(): readonly HairStrand[] {
  const out: HairStrand[] = [];
  for (let i = 0; i < 48; i++) {
    const h1 = (i * 137 + 11) % 97; const h2 = (i * 73 + 29) % 89;
    const h3 = (i * 41 + 53) % 79; const h4 = (i * 97 + 7) % 61;
    const h5 = (i * 19 + 83) % 53;
    out.push({
      ax: (h1 / 97 - 0.5) * 0.95, ay: (h2 / 89 - 0.2) * 0.28,
      len: 0.9 + (h3 / 79) * 2.4, phase: (h4 / 61) * TWO_PI,
      freq: 0.45 + (h5 / 53) * 1.9, thick: 1.0 + (h1 % 5) * 0.45,
      bend: ((h2 % 7) / 7 - 0.5) * 0.55,
    });
  }
  return out;
}
const HAIR_STRANDS = buildHairStrands();

interface EyeDesc {
  readonly bx: number; readonly by: number; readonly r: number;
  readonly blinkPhase: number; readonly slit: boolean; readonly bloodshot: boolean;
}
const EYES: readonly EyeDesc[] = [
  { bx: -0.29, by: -0.38, r: 0.115, blinkPhase: 0.0,  slit: false, bloodshot: true  },
  { bx:  0.21, by: -0.44, r: 0.082, blinkPhase: 2.1,  slit: true,  bloodshot: false },
  { bx: -0.07, by: -0.53, r: 0.052, blinkPhase: 4.3,  slit: false, bloodshot: false },
  { bx:  0.38, by: -0.27, r: 0.068, blinkPhase: 1.1,  slit: true,  bloodshot: true  },
  { bx: -0.43, by: -0.21, r: 0.088, blinkPhase: 3.7,  slit: false, bloodshot: false },
  { bx:  0.11, by: -0.31, r: 0.038, blinkPhase: 5.2,  slit: true,  bloodshot: false },
  { bx: -0.19, by: -0.20, r: 0.033, blinkPhase: 0.9,  slit: false, bloodshot: true  },
];

interface LegDesc {
  readonly ax: number; readonly ay: number;
  readonly rx: number; readonly ry: number;
  readonly phase: number; readonly freq: number; readonly kOut: number;
}
const LEGS: readonly LegDesc[] = [
  { ax: -0.42, ay: -0.06, rx: -1.55, ry: -0.65, phase: 0.00, freq: 2.10, kOut: -1 },
  { ax: -0.48, ay:  0.10, rx: -1.65, ry:  0.25, phase: 1.40, freq: 1.83, kOut: -1 },
  { ax: -0.44, ay:  0.28, rx: -1.38, ry:  0.92, phase: 2.90, freq: 2.37, kOut: -1 },
  { ax: -0.30, ay:  0.40, rx: -0.82, ry:  1.52, phase: 0.70, freq: 1.62, kOut: -1 },
  { ax:  0.38, ay: -0.09, rx:  1.48, ry: -0.52, phase: 3.14, freq: 2.04, kOut:  1 },
  { ax:  0.50, ay:  0.07, rx:  1.72, ry:  0.32, phase: 4.55, freq: 1.91, kOut:  1 },
  { ax:  0.46, ay:  0.25, rx:  1.54, ry:  0.87, phase: 0.30, freq: 2.28, kOut:  1 },
  { ax:  0.27, ay:  0.43, rx:  0.92, ry:  1.57, phase: 1.85, freq: 1.74, kOut:  1 },
];

function drawHair(ctx: NodeCtx, cx: number, cy: number, ts: number, time: number): void {
  const headCy = cy - ts * 0.44;
  ctx.save(); ctx.lineCap = 'round';
  for (let i = 0; i < HAIR_STRANDS.length; i++) {
    const s = HAIR_STRANDS[i];
    const ax = cx + s.ax * ts; const ay = headCy + s.ay * ts;
    const strandLen = s.len * ts;
    const sway = Math.sin(time * s.freq + s.phase) * ts * 0.07;
    const sway2 = Math.cos(time * s.freq * 0.63 + s.phase) * ts * 0.04;
    const ex = ax + s.bend * ts + sway;
    const ey = ay + strandLen * 0.75;
    const cpx = ax + s.bend * ts * 0.5 + sway2;
    const cpy = ay + strandLen * 0.38;
    const v = 2 + (i % 5) * 2;
    ctx.strokeStyle = `rgb(${v},${v - 1},${v})`; ctx.lineWidth = s.thick;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cpx, cpy, ex, ey); ctx.stroke();
  }
  ctx.restore();
}

function drawLeg(ctx: NodeCtx, ax: number, ay: number, tx: number, ty: number, ts: number, kOut: number): void {
  const seg1 = ts * 0.66; const seg2 = ts * 0.72;
  const dx = tx - ax; const dy = ty - ay;
  const dist = Math.sqrt(dx * dx + dy * dy); if (dist < 0.001) return;
  const halfDist = dist * 0.5;
  const totalLen = (seg1 + seg2) * 0.5;
  const h = Math.sqrt(Math.max(0, totalLen * totalLen - halfDist * halfDist));
  const mx = (ax + tx) * 0.5; const my = (ay + ty) * 0.5;
  const px = (-dy / dist) * kOut; const py = (dx / dist) * kOut;
  const kx = mx + px * h; const ky = my + py * h;
  const baseThick = ts * 0.065;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ky);
  ctx.strokeStyle = '#1a0a12'; ctx.lineWidth = baseThick * 2.0; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(tx, ty);
  ctx.strokeStyle = '#120608'; ctx.lineWidth = baseThick * 1.35; ctx.stroke();
  ctx.fillStyle = '#2a1020'; ctx.beginPath(); ctx.arc(kx, ky, baseThick * 1.3, 0, TWO_PI); ctx.fill();
  const footAngle = Math.atan2(ty - ky, tx - kx);
  ctx.strokeStyle = '#080408'; ctx.lineWidth = baseThick * 0.85;
  for (let c = 0; c < 3; c++) {
    const ca = footAngle + (c - 1) * 0.38;
    ctx.beginPath(); ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ca) * ts * 0.13, ty + Math.sin(ca) * ts * 0.13); ctx.stroke();
  }
}

function getIdleLegTip(cx: number, cy: number, ts: number, leg: LegDesc): { tx: number; ty: number } {
  return { tx: cx + leg.rx * ts, ty: cy + leg.ry * ts };
}

function drawBody(ctx: NodeCtx, cx: number, cy: number, ts: number, time: number): void {
  const breathe = Math.sin(time * 0.82) * 0.026;
  ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#000000';
  ctx.beginPath(); ctx.ellipse(cx + ts * 0.06, cy + ts * 0.46, ts * 1.15, ts * 0.19, 0, 0, TWO_PI); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#12070e';
  ctx.beginPath(); ctx.ellipse(cx, cy - ts * 0.05, ts * (0.74 + breathe), ts * (0.60 + breathe), 0, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#1b0b15'; ctx.beginPath(); ctx.ellipse(cx - ts * 0.48, cy - ts * 0.26, ts * 0.43, ts * 0.37, -0.28, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#170910'; ctx.beginPath(); ctx.ellipse(cx + ts * 0.36, cy - ts * 0.10, ts * 0.34, ts * 0.46, 0.22, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#1e0c18'; ctx.beginPath(); ctx.ellipse(cx - ts * 0.09, cy + ts * 0.23, ts * 0.53, ts * 0.34, 0.14, 0, TWO_PI); ctx.fill();
  ctx.fillStyle = '#100609'; ctx.beginPath(); ctx.ellipse(cx + ts * 0.05, cy - ts * 0.46, ts * 0.40, ts * 0.27, 0, 0, TWO_PI); ctx.fill();
  const tears: Array<readonly [number, number, number, number, number]> = [
    [-0.26, -0.05, 0.21, 0.077, 0.30], [ 0.19, -0.16, 0.13, 0.055, -0.22],
    [-0.05,  0.19, 0.11, 0.048,  0.78], [ 0.29,  0.09, 0.087, 0.038, -0.50],
  ];
  for (const [ox, oy, ew, eh, angle] of tears) {
    ctx.fillStyle = '#4a1530'; ctx.beginPath(); ctx.ellipse(cx + ox * ts, cy + oy * ts, ew * ts, eh * ts, angle, 0, TWO_PI); ctx.fill();
    ctx.fillStyle = '#7a2040'; ctx.beginPath(); ctx.ellipse(cx + ox * ts - ts * ew * 0.22, cy + oy * ts - ts * eh * 0.28, ew * ts * 0.52, eh * ts * 0.40, angle, 0, TWO_PI); ctx.fill();
  }
  ctx.save(); ctx.globalAlpha = 0.12 + 0.07 * Math.sin(time * 2.05); ctx.strokeStyle = '#1e3612'; ctx.lineWidth = 1.4;
  const veins: Array<readonly [number, number, number, number, number, number]> = [
    [-0.31, -0.09, 0.09, -0.40, -0.16, 0.16], [ 0.14, -0.01, -0.11, -0.31, 0.19, -0.21], [-0.10, 0.21, 0.19, 0.10, -0.22, -0.10],
  ];
  for (const [x1, y1, cpx, cpy, x2, y2] of veins) {
    ctx.beginPath(); ctx.moveTo(cx + x1 * ts, cy + y1 * ts); ctx.quadraticCurveTo(cx + cpx * ts, cy + cpy * ts, cx + x2 * ts, cy + y2 * ts); ctx.stroke();
  }
  ctx.restore();
}

function drawEyes(ctx: NodeCtx, cx: number, cy: number, ts: number, time: number): void {
  for (const eye of EYES) {
    const ex = cx + eye.bx * ts; const ey = cy + eye.by * ts; const er = eye.r * ts;
    const blinkRaw = Math.sin(time * 0.38 + eye.blinkPhase);
    const blinkAmt = blinkRaw > 0.93 ? (blinkRaw - 0.93) / 0.07 : 0;
    ctx.fillStyle = eye.bloodshot ? '#e8d8b0' : '#d2c8a4';
    ctx.beginPath(); ctx.ellipse(ex, ey, er, er * (1 - blinkAmt * 0.92), 0, 0, TWO_PI); ctx.fill();
    if (eye.bloodshot) {
      ctx.save(); ctx.globalAlpha = 0.52; ctx.strokeStyle = '#cc1818'; ctx.lineWidth = 0.7;
      for (let v = 0; v < 5; v++) {
        const va = (v / 5) * TWO_PI + eye.blinkPhase;
        ctx.beginPath(); ctx.moveTo(ex + Math.cos(va) * er * 0.42, ey + Math.sin(va) * er * 0.42);
        ctx.lineTo(ex + Math.cos(va + 0.28) * er * 0.87, ey + Math.sin(va + 0.28) * er * 0.87); ctx.stroke();
      }
      ctx.restore();
    }
    if (blinkAmt < 0.5) {
      const pupilR = eye.slit ? er * 0.16 : er * 0.44;
      ctx.fillStyle = '#040204';
      if (eye.slit) { ctx.beginPath(); ctx.ellipse(ex, ey, pupilR, er * 0.56, 0, 0, TWO_PI); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(ex, ey, pupilR, 0, TWO_PI); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath(); ctx.arc(ex - er * 0.26, ey - er * 0.23, er * 0.19, 0, TWO_PI); ctx.fill();
    }
    if (blinkAmt > 0) {
      ctx.fillStyle = '#12070e';
      ctx.beginPath(); ctx.ellipse(ex, ey - er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex, ey + er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI); ctx.fill();
    }
  }
}

function drawMawWithSpit(ctx: NodeCtx, cx: number, cy: number, ts: number, time: number, spitProgress: number): void {
  const mawCx = cx - ts * 0.04; const mawCy = cy + ts * 0.12;
  const windupT = Math.min(spitProgress / 0.58, 1.0);
  let openAmt = 0.055 + Math.sin(time * 0.78) * 0.022 + windupT * 0.22;
  const mawW = ts * (0.46 + openAmt * 0.28); const mawH = ts * openAmt;

  ctx.fillStyle = '#060003'; ctx.beginPath(); ctx.ellipse(mawCx, mawCy, mawW, mawH, 0, 0, TWO_PI); ctx.fill();

  if (openAmt > 0.04) {
    const toothScale = Math.min(openAmt / 0.1, 1.0);
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TWO_PI;
      const ex = mawCx + Math.cos(angle) * mawW * 0.88; const ey = mawCy + Math.sin(angle) * mawH * 0.88;
      const tLen = ts * (0.055 + (i % 3) * 0.018) * toothScale; const inward = angle + Math.PI;
      ctx.fillStyle = '#c4bca4'; ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.21) * tLen, ey + Math.sin(angle - 0.21) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.55, ey + Math.sin(inward) * tLen * 1.55);
      ctx.lineTo(ex + Math.cos(angle + 0.21) * tLen, ey + Math.sin(angle + 0.21) * tLen); ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * TWO_PI + Math.PI / 9;
      const ex = mawCx + Math.cos(angle) * mawW * 0.52; const ey = mawCy + Math.sin(angle) * mawH * 0.52;
      const tLen = ts * 0.042 * toothScale; const inward = angle + Math.PI;
      ctx.fillStyle = '#9e9684'; ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.26) * tLen, ey + Math.sin(angle - 0.26) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.4, ey + Math.sin(inward) * tLen * 1.4);
      ctx.lineTo(ex + Math.cos(angle + 0.26) * tLen, ey + Math.sin(angle + 0.26) * tLen); ctx.closePath(); ctx.fill();
    }
  }

  // Spit glob forming at maw
  const releaseT = Math.max((spitProgress - 0.58) / 0.42, 0.0);
  if (windupT > 0.08) {
    const fadeIn = Math.min((windupT - 0.08) / 0.28, 1.0);
    const fadeOut = releaseT > 0 ? 1.0 - Math.min(releaseT / 0.5, 1.0) : 1.0;
    const globAlpha = fadeIn * fadeOut;
    if (globAlpha > 0.01) {
      const globR = ts * 0.28 * windupT;
      const globCx = mawCx + ts * 0.04; const globCy = mawCy - ts * 0.07;
      ctx.save();
      ctx.globalAlpha = globAlpha * 0.9; ctx.fillStyle = '#485c0a';
      ctx.beginPath(); ctx.ellipse(globCx, globCy, globR * 1.18, globR * 0.9, 0, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = globAlpha * 0.62; ctx.fillStyle = '#60780e';
      ctx.beginPath(); ctx.ellipse(globCx - globR * 0.22, globCy - globR * 0.26, globR * 0.6, globR * 0.46, 0, 0, TWO_PI); ctx.fill();
      ctx.globalAlpha = globAlpha * 0.48; ctx.fillStyle = 'rgba(140,180,20,0.6)';
      ctx.beginPath(); ctx.ellipse(globCx - globR * 0.3, globCy - globR * 0.3, globR * 0.28, globR * 0.2, 0, 0, TWO_PI); ctx.fill();
      ctx.strokeStyle = 'rgba(52,68,6,0.55)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.globalAlpha = globAlpha * 0.52;
      for (let d = 0; d < 4; d++) {
        const da = (d / 4) * TWO_PI + 1.3;
        ctx.beginPath(); ctx.moveTo(globCx + Math.cos(da) * globR * 0.78, globCy + Math.sin(da) * globR * 0.78);
        ctx.lineTo(globCx + Math.cos(da) * globR * 1.48, globCy + Math.sin(da) * globR * 1.48); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawCreatureSpit(ctx: NodeCtx, sx: number, sy: number, ts: number, spitProgress: number): void {
  const cx = sx + ts * 0.5; const cy = sy + ts * 0.5;
  const windupT = Math.min(spitProgress / 0.58, 1.0);
  const releaseT = Math.max((spitProgress - 0.58) / 0.42, 0.0);
  const leanY = releaseT > 0
    ? ts * 0.07 * Math.sin(releaseT * Math.PI)
    : -ts * 0.09 * Math.sin(windupT * Math.PI * 0.5);

  if (leanY !== 0) { ctx.save(); ctx.translate(0, leanY); }
  drawHair(ctx, cx, cy, ts, 0);
  for (const i of [2, 3, 6, 7]) {
    const leg = LEGS[i]; const { tx, ty } = getIdleLegTip(cx, cy, ts, leg);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }
  drawBody(ctx, cx, cy, ts, 0);
  for (const i of [0, 1, 4, 5]) {
    const leg = LEGS[i]; const { tx, ty } = getIdleLegTip(cx, cy, ts, leg);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }
  drawEyes(ctx, cx, cy, ts, spitProgress * 3);
  drawMawWithSpit(ctx, cx, cy, ts, 0, spitProgress);
  if (leanY !== 0) ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Spit projectile  (inlined from grotesqueSpiderSpitSprite.ts)
// ══════════════════════════════════════════════════════════════════════════════

const PROJ_FRAME_W = 96;
const PROJ_FRAME_H = 64;
const PROJ_TILE_SCALE = 64;
const PROJ_TILE_X = 48;  // blob centre in frame
const PROJ_TILE_Y = 32;

function drawSpitProjectile(ctx: NodeCtx, cx: number, cy: number, ts: number, frame: number): void {
  const wobble = (frame / 8) * TWO_PI;
  ctx.save(); ctx.lineCap = 'round';
  const trailColors: readonly string[] = ['rgba(52,66,7,0.52)', 'rgba(44,58,5,0.40)', 'rgba(60,76,9,0.36)'];
  for (let i = 0; i < 3; i++) {
    const yOff = (i - 1) * ts * 0.065; const trailLen = ts * (0.52 + i * 0.14);
    const droopAmt = ts * 0.06 * Math.sin(wobble + i * 1.1);
    ctx.strokeStyle = trailColors[i]; ctx.lineWidth = ts * (0.07 - i * 0.018);
    ctx.beginPath(); ctx.moveTo(cx - ts * 0.30, cy + yOff);
    ctx.quadraticCurveTo(cx - ts * 0.30 - trailLen * 0.45 + droopAmt, cy + yOff * 0.55 + droopAmt, cx - ts * 0.30 - trailLen, cy + yOff * 0.8 + droopAmt * (1 + i * 0.5));
    ctx.stroke();
  }
  ctx.restore();
  const rx = ts * (0.345 + Math.sin(wobble) * 0.038); const ry = ts * (0.275 - Math.cos(wobble) * 0.030);
  ctx.save();
  ctx.globalAlpha = 0.90; ctx.fillStyle = '#4a5e0a'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.65; ctx.fillStyle = '#607010'; ctx.beginPath(); ctx.ellipse(cx - ts * 0.065, cy - ts * 0.038, rx * 0.74, ry * 0.78, -0.28, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.42; ctx.fillStyle = '#38480a'; ctx.beginPath(); ctx.ellipse(cx + ts * 0.055, cy + ts * 0.03, rx * 0.44, ry * 0.46, 0.18, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.52; ctx.fillStyle = 'rgba(160,200,40,0.55)'; ctx.beginPath(); ctx.ellipse(cx - rx * 0.32, cy - ry * 0.36, rx * 0.27, ry * 0.20, -0.35, 0, TWO_PI); ctx.fill();
  ctx.restore();
  const dropX = cx - rx * 1.28 + Math.sin(wobble) * ts * 0.03; const dropY = cy + ts * 0.038 * Math.cos(wobble * 1.3);
  ctx.save(); ctx.globalAlpha = 0.62; ctx.fillStyle = '#4a5e08'; ctx.beginPath(); ctx.arc(dropX, dropY, ts * 0.058, 0, TWO_PI); ctx.fill(); ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Spit trap  (inlined from grotesqueSpiderSpitSprite.ts)
// ══════════════════════════════════════════════════════════════════════════════

const TRAP_FRAME_W = 256;
const TRAP_FRAME_H = 256;
const TRAP_TILE_SCALE = 64;
const TRAP_TILE_X = 128;
const TRAP_TILE_Y = 128;

interface WebStrand { readonly aAngle: number; readonly bAngle: number; readonly rA: number; readonly rB: number; readonly phase: number; }
function buildWebStrands(): readonly WebStrand[] {
  const out: WebStrand[] = [];
  for (let i = 0; i < 8; i++) {
    const h1 = (i * 137 + 11) % 97; const h2 = (i * 73 + 29) % 89;
    out.push({ aAngle: (i / 8) * TWO_PI + (h1 / 97) * 0.45, bAngle: (i / 8) * TWO_PI + Math.PI * 0.62 + (h2 / 89) * 0.85, rA: 0.70 + (h1 % 3) * 0.10, rB: 0.65 + (h2 % 4) * 0.08, phase: (i / 8) * TWO_PI });
  }
  return out;
}
const WEB_STRANDS = buildWebStrands();

function drawSpitTrapSplat(ctx: NodeCtx, cx: number, cy: number, ts: number, frame: number): void {
  const progress = frame / 7;
  const maxR = ts * 1.48; const r = maxR * (0.07 + progress * 0.93);
  ctx.save();
  const dropCount = 7 + Math.floor(frame * 1.5);
  ctx.fillStyle = 'rgba(66,84,10,0.55)';
  for (let i = 0; i < dropCount; i++) {
    const angle = (i / dropCount) * TWO_PI + (i % 3) * 0.18;
    const dist = r * (0.55 + (i % 4) * 0.12) * (0.5 + progress * 0.5);
    const dropR = ts * (0.052 - (i % 3) * 0.011) * (1 - progress * 0.55);
    if (dropR > 0.5) { ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, dropR, 0, TWO_PI); ctx.fill(); }
  }
  ctx.globalAlpha = (1 - progress) * 0.45; ctx.strokeStyle = '#506010'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.08, r * 0.74, 0, 0, TWO_PI); ctx.stroke();
  ctx.globalAlpha = 0.28 + progress * 0.45; ctx.fillStyle = '#384808';
  ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.06, r * 0.72, 0, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.48 + progress * 0.22; ctx.fillStyle = '#4c6010';
  ctx.beginPath(); ctx.ellipse(cx - r * 0.06, cy - r * 0.04, r * 0.82, r * 0.58, -0.1, 0, TWO_PI); ctx.fill();
  if (progress > 0.5) {
    ctx.globalAlpha = (progress - 0.5) * 2 * 0.22; ctx.fillStyle = 'rgba(140,180,20,0.4)';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.22, cy - r * 0.26, r * 0.28, r * 0.18, -0.25, 0, TWO_PI); ctx.fill();
  }
  ctx.restore();
}

function drawSpitTrapIdle(ctx: NodeCtx, cx: number, cy: number, ts: number, frame: number): void {
  const time = (frame / 8) * TWO_PI;
  const breathe = Math.sin(time * 2.1) * 0.014;
  const rx = ts * 1.48 * (1 + breathe); const ry = ts * 1.04 * (1 + breathe);
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.fillStyle = '#6a9014';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx * 1.14, ry * 1.14, 0, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.74; ctx.fillStyle = '#384808';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.56; ctx.fillStyle = '#4c6010';
  ctx.beginPath(); ctx.ellipse(cx - ts * 0.07, cy - ts * 0.04, rx * 0.80, ry * 0.76, -0.12, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.24; ctx.fillStyle = 'rgba(140,180,20,0.5)';
  ctx.beginPath(); ctx.ellipse(cx - rx * 0.21, cy - ry * 0.24, rx * 0.34, ry * 0.26, -0.18, 0, TWO_PI); ctx.fill();
  ctx.globalAlpha = 0.38; ctx.strokeStyle = '#6a8812'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  for (const strand of WEB_STRANDS) {
    const sway = Math.sin(time + strand.phase) * ts * 0.045;
    const sway2 = Math.cos(time * 0.7 + strand.phase) * ts * 0.028;
    const ax = cx + Math.cos(strand.aAngle) * rx * strand.rA; const ay = cy + Math.sin(strand.aAngle) * ry * strand.rA;
    const bx2 = cx + Math.cos(strand.bAngle) * rx * strand.rB; const by2 = cy + Math.sin(strand.bAngle) * ry * strand.rB;
    const cpx = (ax + bx2) / 2 + sway; const cpy = (ay + by2) / 2 + sway2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cpx, cpy, bx2, by2); ctx.stroke();
  }
  const bubbleCycle = ((time * 1.4 + 0.8) % TWO_PI) / TWO_PI;
  const bubbleAlpha = Math.sin(bubbleCycle * Math.PI);
  if (bubbleAlpha > 0.05) {
    const bubbleR = ts * 0.095 * bubbleAlpha;
    ctx.globalAlpha = bubbleAlpha * 0.62; ctx.strokeStyle = '#8aaa18'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(cx + ts * 0.32, cy - ts * 0.12, bubbleR, 0, TWO_PI); ctx.stroke();
    ctx.globalAlpha = bubbleAlpha * 0.38; ctx.fillStyle = '#aace24';
    ctx.beginPath(); ctx.arc(cx + ts * 0.32 - bubbleR * 0.32, cy - ts * 0.12 - bubbleR * 0.32, bubbleR * 0.24, 0, TWO_PI); ctx.fill();
  }
  const b2c = ((time * 1.1 + 3.8) % TWO_PI) / TWO_PI;
  const b2a = Math.sin(b2c * Math.PI);
  if (b2a > 0.05) {
    ctx.globalAlpha = b2a * 0.48; ctx.strokeStyle = '#7a9a14'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx - ts * 0.38, cy + ts * 0.18, ts * 0.058 * b2a, 0, TWO_PI); ctx.stroke();
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Sheet rendering helpers
// ══════════════════════════════════════════════════════════════════════════════

function renderSheet(
  rowGroups: Array<Array<() => void>>,
  frameW: number, frameH: number,
): Buffer {
  const cols = Math.max(...rowGroups.map(r => r.length));
  const c = createCanvas(cols * frameW, rowGroups.length * frameH);
  const ctx = c.getContext('2d') as NodeCtx;
  for (let row = 0; row < rowGroups.length; row++) {
    for (let col = 0; col < rowGroups[row].length; col++) {
      // Clip to this frame so nothing bleeds into neighbours
      ctx.save();
      ctx.beginPath();
      ctx.rect(col * frameW, row * frameH, frameW, frameH);
      ctx.clip();
      rowGroups[row][col]();
      ctx.restore();
    }
  }
  return c.toBuffer('image/png');
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Generate files
// ══════════════════════════════════════════════════════════════════════════════

const outDir = resolve('src/images/enemies');
const ATK_FRAMES = 16;
const spitSteps = Array.from({ length: ATK_FRAMES }, (_, i) => i / (ATK_FRAMES - 1));

// 1. Creature spit animation
console.log('  [1/3] grotesque_spider_spit.png  (creature spit, 16 frames) …');
writeFileSync(
  resolve(outDir, 'grotesque_spider_spit.png'),
  renderSheet(
    [spitSteps.map(p => () => {
      drawCreatureSpit(
        createCanvas(1, 1).getContext('2d') as NodeCtx, // dummy — will use the real ctx
        0, 0, SPIT_TILE_SCALE, p,                       // unused, see below
      );
    })],
    SPIT_FRAME_W, SPIT_FRAME_H,
  ),
);

// Re-do properly with the shared canvas
{
  const c = createCanvas(ATK_FRAMES * SPIT_FRAME_W, SPIT_FRAME_H);
  const ctx = c.getContext('2d') as NodeCtx;
  for (let col = 0; col < ATK_FRAMES; col++) {
    ctx.save();
    ctx.beginPath(); ctx.rect(col * SPIT_FRAME_W, 0, SPIT_FRAME_W, SPIT_FRAME_H); ctx.clip();
    drawCreatureSpit(ctx, col * SPIT_FRAME_W + SPIT_TILE_X, SPIT_TILE_Y, SPIT_TILE_SCALE, spitSteps[col]);
    ctx.restore();
  }
  writeFileSync(resolve(outDir, 'grotesque_spider_spit.png'), c.toBuffer('image/png'));
  console.log(`        → ${ATK_FRAMES * SPIT_FRAME_W}×${SPIT_FRAME_H}px`);
}

// 2. Projectile
console.log('  [2/3] grotesque_spider_spit_projectile.png  (8-frame wobble) …');
{
  const PROJ_FRAMES = 8;
  const c = createCanvas(PROJ_FRAMES * PROJ_FRAME_W, PROJ_FRAME_H);
  const ctx = c.getContext('2d') as NodeCtx;
  for (let col = 0; col < PROJ_FRAMES; col++) {
    ctx.save();
    ctx.beginPath(); ctx.rect(col * PROJ_FRAME_W, 0, PROJ_FRAME_W, PROJ_FRAME_H); ctx.clip();
    drawSpitProjectile(ctx, col * PROJ_FRAME_W + PROJ_TILE_X, PROJ_TILE_Y, PROJ_TILE_SCALE, col);
    ctx.restore();
  }
  writeFileSync(resolve(outDir, 'grotesque_spider_spit_projectile.png'), c.toBuffer('image/png'));
  console.log(`        → ${PROJ_FRAMES * PROJ_FRAME_W}×${PROJ_FRAME_H}px`);
}

// 3. Trap (splat row 0 + idle row 1)
console.log('  [3/3] grotesque_spider_spit_trap.png  (8-frame splat + 8-frame idle) …');
{
  const TRAP_FRAMES = 8;
  const c = createCanvas(TRAP_FRAMES * TRAP_FRAME_W, 2 * TRAP_FRAME_H);
  const ctx = c.getContext('2d') as NodeCtx;
  for (let col = 0; col < TRAP_FRAMES; col++) {
    // row 0: splat
    ctx.save();
    ctx.beginPath(); ctx.rect(col * TRAP_FRAME_W, 0, TRAP_FRAME_W, TRAP_FRAME_H); ctx.clip();
    drawSpitTrapSplat(ctx, col * TRAP_FRAME_W + TRAP_TILE_X, TRAP_TILE_Y, TRAP_TILE_SCALE, col);
    ctx.restore();
    // row 1: idle
    ctx.save();
    ctx.beginPath(); ctx.rect(col * TRAP_FRAME_W, TRAP_FRAME_H, TRAP_FRAME_W, TRAP_FRAME_H); ctx.clip();
    drawSpitTrapIdle(ctx, col * TRAP_FRAME_W + TRAP_TILE_X, TRAP_FRAME_H + TRAP_TILE_Y, TRAP_TILE_SCALE, col);
    ctx.restore();
  }
  writeFileSync(resolve(outDir, 'grotesque_spider_spit_trap.png'), c.toBuffer('image/png'));
  console.log(`        → ${TRAP_FRAMES * TRAP_FRAME_W}×${2 * TRAP_FRAME_H}px`);
}

console.log('\nDone.');
console.log('Manifest entries needed:');
console.log(`  grotesque_spider_spit:            frameWidth=${SPIT_FRAME_W}  frameHeight=${SPIT_FRAME_H}  tileX=${SPIT_TILE_X}  tileY=${SPIT_TILE_Y}  tileScale=${SPIT_TILE_SCALE}`);
console.log(`  grotesque_spider_spit_projectile: frameWidth=${PROJ_FRAME_W}  frameHeight=${PROJ_FRAME_H}  tileX=${PROJ_TILE_X}  tileY=${PROJ_TILE_Y}  tileScale=${PROJ_TILE_SCALE}`);
console.log(`  grotesque_spider_spit_trap:       frameWidth=${TRAP_FRAME_W}  frameHeight=${TRAP_FRAME_H}  tileX=${TRAP_TILE_X}  tileY=${TRAP_TILE_Y}  tileScale=${TRAP_TILE_SCALE}`);
