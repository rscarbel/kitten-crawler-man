#!/usr/bin/env tsx
/**
 * Generates grotesque_spider sprite sheets from the procedural drawing code.
 *
 * Outputs three PNG files to src/images/enemies/:
 *   grotesque_spider_base.png     — idle (row 0) + walk_down (1) + walk_up (2) + walk_side (3)
 *   grotesque_spider_slam.png     — attack_slam row
 *   grotesque_spider_screech.png  — attack_screech row
 *
 * Run: npx tsx scripts/generate-grotesque-spider-sprite.ts
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// FRAME_W=320: walk_side legs step 29px forward beyond rest position, pushing
// the rightmost tip to ~cx+139. At the previous 256px width (tileX=96, cx=128)
// that reached 267px — 11px past the frame edge, bleeding into adjacent frames.
// 320px (tileX=128, cx=160) gives 21px clearance on the widest walk frame.
const FRAME_W = 320;
const FRAME_H = 384;
const TILE_SCALE = 64; // tile size used when drawing
const TILE_X = 128; // tile top-left x within each frame
const TILE_Y = 128; // tile top-left y within each frame

type GrotesqueSpiderState = 'idle' | 'walk' | 'attack_slam' | 'attack_screech';

const TWO_PI = Math.PI * 2;

interface HairStrand {
  readonly ax: number;
  readonly ay: number;
  readonly len: number;
  readonly phase: number;
  readonly freq: number;
  readonly thick: number;
  readonly bend: number;
}

function buildHairStrands(): readonly HairStrand[] {
  const out: HairStrand[] = [];
  for (let i = 0; i < 48; i++) {
    const h1 = (i * 137 + 11) % 97;
    const h2 = (i * 73 + 29) % 89;
    const h3 = (i * 41 + 53) % 79;
    const h4 = (i * 97 + 7) % 61;
    const h5 = (i * 19 + 83) % 53;
    out.push({
      ax: (h1 / 97 - 0.5) * 0.95,
      ay: (h2 / 89 - 0.2) * 0.28,
      len: 0.9 + (h3 / 79) * 2.4,
      phase: (h4 / 61) * TWO_PI,
      freq: 0.45 + (h5 / 53) * 1.9,
      thick: 1.0 + (h1 % 5) * 0.45,
      bend: ((h2 % 7) / 7 - 0.5) * 0.55,
    });
  }
  return out;
}

const HAIR_STRANDS = buildHairStrands();

interface EyeDesc {
  readonly bx: number;
  readonly by: number;
  readonly r: number;
  readonly blinkPhase: number;
  readonly slit: boolean;
  readonly bloodshot: boolean;
}

const EYES: readonly EyeDesc[] = [
  { bx: -0.29, by: -0.38, r: 0.115, blinkPhase: 0.0, slit: false, bloodshot: true },
  { bx: 0.21, by: -0.44, r: 0.082, blinkPhase: 2.1, slit: true, bloodshot: false },
  { bx: -0.07, by: -0.53, r: 0.052, blinkPhase: 4.3, slit: false, bloodshot: false },
  { bx: 0.38, by: -0.27, r: 0.068, blinkPhase: 1.1, slit: true, bloodshot: true },
  { bx: -0.43, by: -0.21, r: 0.088, blinkPhase: 3.7, slit: false, bloodshot: false },
  { bx: 0.11, by: -0.31, r: 0.038, blinkPhase: 5.2, slit: true, bloodshot: false },
  { bx: -0.19, by: -0.2, r: 0.033, blinkPhase: 0.9, slit: false, bloodshot: true },
];

interface LegDesc {
  readonly ax: number;
  readonly ay: number;
  readonly rx: number;
  readonly ry: number;
  readonly phase: number;
  readonly freq: number;
  readonly kOut: number;
}

const LEGS: readonly LegDesc[] = [
  { ax: -0.42, ay: -0.06, rx: -1.55, ry: -0.65, phase: 0.0, freq: 2.1, kOut: -1 },
  { ax: -0.48, ay: 0.1, rx: -1.65, ry: 0.25, phase: 1.4, freq: 1.83, kOut: -1 },
  { ax: -0.44, ay: 0.28, rx: -1.38, ry: 0.92, phase: 2.9, freq: 2.37, kOut: -1 },
  { ax: -0.3, ay: 0.4, rx: -0.82, ry: 1.52, phase: 0.7, freq: 1.62, kOut: -1 },
  { ax: 0.38, ay: -0.09, rx: 1.48, ry: -0.52, phase: 3.14, freq: 2.04, kOut: 1 },
  { ax: 0.5, ay: 0.07, rx: 1.72, ry: 0.32, phase: 4.55, freq: 1.91, kOut: 1 },
  { ax: 0.46, ay: 0.25, rx: 1.54, ry: 0.87, phase: 0.3, freq: 2.28, kOut: 1 },
  { ax: 0.27, ay: 0.43, rx: 0.92, ry: 1.57, phase: 1.85, freq: 1.74, kOut: 1 },
];

function drawHair(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  movingX: number,
  movingY: number,
): void {
  const headCy = cy - ts * 0.44;
  ctx.save();
  ctx.lineCap = 'round';

  for (let i = 0; i < HAIR_STRANDS.length; i++) {
    const s = HAIR_STRANDS[i];
    const ax = cx + s.ax * ts;
    const ay = headCy + s.ay * ts;
    const strandLen = s.len * ts;

    const windX = -movingX * ts * 0.22;
    const windY = -movingY * ts * 0.14;
    const sway = Math.sin(time * s.freq + s.phase) * ts * 0.07;
    const sway2 = Math.cos(time * s.freq * 0.63 + s.phase) * ts * 0.04;

    let splayX = 0;
    let splayY = 0;
    if (state === 'attack_screech') {
      const splay = Math.sin(stateProgress * Math.PI);
      splayX = s.ax * ts * splay * 1.6;
      splayY = -(strandLen * 0.4) * splay;
    }

    const ex = ax + s.bend * ts + windX * s.len * 0.35 + sway + splayX;
    const ey = ay + strandLen * 0.75 + windY * s.len * 0.18 + splayY;
    const cpx = ax + s.bend * ts * 0.5 + windX * 0.2 + sway2;
    const cpy = ay + strandLen * 0.38 + windY * 0.12;

    const v = 2 + (i % 5) * 2;
    ctx.strokeStyle = `rgb(${v},${v - 1},${v})`;
    ctx.lineWidth = s.thick;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cpx, cpy, ex, ey);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLeg(
  ctx: NodeCtx,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  ts: number,
  kOut: number,
): void {
  const seg1 = ts * 0.66;
  const seg2 = ts * 0.72;
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;

  const halfDist = dist * 0.5;
  const totalLen = (seg1 + seg2) * 0.5;
  const h = Math.sqrt(Math.max(0, totalLen * totalLen - halfDist * halfDist));
  const mx = (ax + tx) * 0.5;
  const my = (ay + ty) * 0.5;
  const px = (-dy / dist) * kOut;
  const py = (dx / dist) * kOut;
  const kx = mx + px * h;
  const ky = my + py * h;
  const baseThick = ts * 0.065;

  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(kx, ky);
  ctx.strokeStyle = '#1a0a12';
  ctx.lineWidth = baseThick * 2.0;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(kx, ky);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = '#120608';
  ctx.lineWidth = baseThick * 1.35;
  ctx.stroke();

  ctx.fillStyle = '#2a1020';
  ctx.beginPath();
  ctx.arc(kx, ky, baseThick * 1.3, 0, TWO_PI);
  ctx.fill();

  const footAngle = Math.atan2(ty - ky, tx - kx);
  ctx.strokeStyle = '#080408';
  ctx.lineWidth = baseThick * 0.85;
  for (let c = 0; c < 3; c++) {
    const ca = footAngle + (c - 1) * 0.38;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + Math.cos(ca) * ts * 0.13, ty + Math.sin(ca) * ts * 0.13);
    ctx.stroke();
  }
}

function getLegTip(
  cx: number,
  cy: number,
  ts: number,
  leg: LegDesc,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
  movingX: number,
  movingY: number,
): { tx: number; ty: number } {
  const restX = cx + leg.rx * ts;
  const restY = cy + leg.ry * ts;

  if (state === 'idle') {
    const sway = Math.sin(time * leg.freq * 0.25 + leg.phase) * ts * 0.035;
    return { tx: restX + sway, ty: restY };
  }
  if (state === 'walk') {
    const cycle = Math.sin(time * leg.freq + leg.phase);
    if (cycle > 0.25) {
      const liftT = (cycle - 0.25) / 0.75;
      const lift = Math.sin(liftT * Math.PI) * ts * 0.22;
      return {
        tx: restX + movingX * ts * 0.45 * liftT,
        ty: restY + movingY * ts * 0.25 * liftT - lift,
      };
    }
    return { tx: restX, ty: restY };
  }
  if (state === 'attack_slam' && leg.ry < 0) {
    const lift =
      stateProgress < 0.55
        ? Math.sin((stateProgress / 0.55) * Math.PI * 0.5)
        : 1.0 - Math.sin(((stateProgress - 0.55) / 0.45) * Math.PI * 0.5);
    return {
      tx: restX + leg.kOut * ts * 0.2 * stateProgress,
      ty: restY - ts * 1.35 * lift,
    };
  }
  return { tx: restX, ty: restY };
}

function drawBody(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const breathe = Math.sin(time * 0.82) * 0.026;
  const screamBulge = state === 'attack_screech' ? Math.sin(stateProgress * Math.PI) * 0.22 : 0;

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.06, cy + ts * 0.46, ts * 1.15, ts * 0.19, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#12070e';
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy - ts * 0.05,
    ts * (0.74 + breathe + screamBulge * 0.28),
    ts * (0.6 + breathe + screamBulge * 0.28),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();

  ctx.fillStyle = '#1b0b15';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.48, cy - ts * 0.26, ts * 0.43, ts * 0.37, -0.28, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = '#170910';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.36, cy - ts * 0.1, ts * 0.34, ts * 0.46, 0.22, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = '#1e0c18';
  ctx.beginPath();
  ctx.ellipse(cx - ts * 0.09, cy + ts * 0.23, ts * 0.53, ts * 0.34, 0.14, 0, TWO_PI);
  ctx.fill();

  ctx.fillStyle = '#100609';
  ctx.beginPath();
  ctx.ellipse(cx + ts * 0.05, cy - ts * 0.46, ts * 0.4, ts * 0.27, 0, 0, TWO_PI);
  ctx.fill();

  const tears: Array<readonly [number, number, number, number, number]> = [
    [-0.26, -0.05, 0.21, 0.077, 0.3],
    [0.19, -0.16, 0.13, 0.055, -0.22],
    [-0.05, 0.19, 0.11, 0.048, 0.78],
    [0.29, 0.09, 0.087, 0.038, -0.5],
  ];
  for (const [ox, oy, ew, eh, angle] of tears) {
    ctx.fillStyle = '#4a1530';
    ctx.beginPath();
    ctx.ellipse(cx + ox * ts, cy + oy * ts, ew * ts, eh * ts, angle, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#7a2040';
    ctx.beginPath();
    ctx.ellipse(
      cx + ox * ts - ts * ew * 0.22,
      cy + oy * ts - ts * eh * 0.28,
      ew * ts * 0.52,
      eh * ts * 0.4,
      angle,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = 0.12 + 0.07 * Math.sin(time * 2.05);
  ctx.strokeStyle = '#1e3612';
  ctx.lineWidth = 1.4;
  const veins: Array<readonly [number, number, number, number, number, number]> = [
    [-0.31, -0.09, 0.09, -0.4, -0.16, 0.16],
    [0.14, -0.01, -0.11, -0.31, 0.19, -0.21],
    [-0.1, 0.21, 0.19, 0.1, -0.22, -0.1],
  ];
  for (const [x1, y1, cpx, cpy, x2, y2] of veins) {
    ctx.beginPath();
    ctx.moveTo(cx + x1 * ts, cy + y1 * ts);
    ctx.quadraticCurveTo(cx + cpx * ts, cy + cpy * ts, cx + x2 * ts, cy + y2 * ts);
    ctx.stroke();
  }
  ctx.restore();

  if (state === 'attack_slam' && stateProgress > 0.82) {
    const flashAlpha = ((stateProgress - 0.82) / 0.18) * 0.55;
    ctx.save();
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ts * 0.3, ts * 1.45, ts * 0.7, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

function drawEyes(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const scream = state === 'attack_screech' ? stateProgress : 0;
  for (const eye of EYES) {
    const ex = cx + eye.bx * ts;
    const ey = cy + eye.by * ts;
    const er = eye.r * ts;
    const blinkRaw = Math.sin(time * 0.38 + eye.blinkPhase);
    const blinkAmt = blinkRaw > 0.93 ? (blinkRaw - 0.93) / 0.07 : 0;

    ctx.fillStyle = eye.bloodshot ? '#e8d8b0' : '#d2c8a4';
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * (1 - blinkAmt * 0.92) * (1 + scream * 0.32), 0, 0, TWO_PI);
    ctx.fill();

    if (eye.bloodshot) {
      ctx.save();
      ctx.globalAlpha = 0.52;
      ctx.strokeStyle = '#cc1818';
      ctx.lineWidth = 0.7;
      for (let v = 0; v < 5; v++) {
        const va = (v / 5) * TWO_PI + eye.blinkPhase;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(va) * er * 0.42, ey + Math.sin(va) * er * 0.42);
        ctx.lineTo(ex + Math.cos(va + 0.28) * er * 0.87, ey + Math.sin(va + 0.28) * er * 0.87);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (blinkAmt < 0.5) {
      const pupilR = eye.slit ? er * 0.16 : er * (0.44 - scream * 0.28);
      const pupilX = ex + facingX * er * 0.22;
      const pupilY = ey + facingY * er * 0.22;
      ctx.fillStyle = '#040204';
      if (eye.slit) {
        ctx.beginPath();
        ctx.ellipse(pupilX, pupilY, pupilR, er * 0.56, 0, 0, TWO_PI);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(pupilX, pupilY, pupilR, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.beginPath();
      ctx.arc(ex - er * 0.26, ey - er * 0.23, er * 0.19, 0, TWO_PI);
      ctx.fill();
    }

    if (blinkAmt > 0) {
      ctx.fillStyle = '#12070e';
      ctx.beginPath();
      ctx.ellipse(ex, ey - er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ex, ey + er * (1 - blinkAmt) * 0.5, er * 1.05, er * blinkAmt, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
}

function drawMaw(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  ts: number,
  time: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const mawCx = cx - ts * 0.04;
  const mawCy = cy + ts * 0.12;
  let openAmt = 0.055 + Math.sin(time * 0.78) * 0.022;
  if (state === 'attack_screech') {
    openAmt =
      stateProgress < 0.5
        ? 0.055 + stateProgress * 2.0 * 0.82
        : 0.055 + 0.82 - (stateProgress - 0.5) * 0.5;
  } else if (state === 'attack_slam') {
    openAmt += stateProgress * 0.28;
  }

  const mawW = ts * (0.46 + openAmt * 0.28);
  const mawH = ts * openAmt;
  ctx.fillStyle = '#060003';
  ctx.beginPath();
  ctx.ellipse(mawCx, mawCy, mawW, mawH, 0, 0, TWO_PI);
  ctx.fill();

  if (state === 'attack_screech' && stateProgress > 0.08) {
    ctx.save();
    ctx.globalAlpha = Math.min(stateProgress * 2.0, 1.0) * 0.68;
    const grad = ctx.createRadialGradient(mawCx, mawCy, 0, mawCx, mawCy, mawW * 0.8);
    grad.addColorStop(0, '#ff1020');
    grad.addColorStop(0.5, '#8b0012');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(mawCx, mawCy, mawW * 0.9, mawH * 0.9, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  if (openAmt > 0.04) {
    const toothScale = Math.min(openAmt / 0.1, 1.0);
    const outerCount = 14;
    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * TWO_PI;
      const ex = mawCx + Math.cos(angle) * mawW * 0.88;
      const ey = mawCy + Math.sin(angle) * mawH * 0.88;
      const tLen = ts * (0.055 + (i % 3) * 0.018) * toothScale;
      const inward = angle + Math.PI;
      ctx.fillStyle = '#c4bca4';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.21) * tLen, ey + Math.sin(angle - 0.21) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.55, ey + Math.sin(inward) * tLen * 1.55);
      ctx.lineTo(ex + Math.cos(angle + 0.21) * tLen, ey + Math.sin(angle + 0.21) * tLen);
      ctx.closePath();
      ctx.fill();
    }
    const innerCount = 9;
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * TWO_PI + Math.PI / innerCount;
      const ex = mawCx + Math.cos(angle) * mawW * 0.52;
      const ey = mawCy + Math.sin(angle) * mawH * 0.52;
      const tLen = ts * 0.042 * toothScale;
      const inward = angle + Math.PI;
      ctx.fillStyle = '#9e9684';
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(angle - 0.26) * tLen, ey + Math.sin(angle - 0.26) * tLen);
      ctx.lineTo(ex + Math.cos(inward) * tLen * 1.4, ey + Math.sin(inward) * tLen * 1.4);
      ctx.lineTo(ex + Math.cos(angle + 0.26) * tLen, ey + Math.sin(angle + 0.26) * tLen);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawBackRidge(ctx: NodeCtx, cx: number, cy: number, ts: number, time: number): void {
  const ridgeX = cx + ts * 0.06;
  const ridgeTop = cy - ts * 0.52;
  const ridgeBot = cy + ts * 0.35;
  const count = 7;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const ry = ridgeTop + (ridgeBot - ridgeTop) * t;
    const knobR = ts * (0.055 - t * 0.018);
    const pulse = Math.sin(time * 1.4 + i * 0.8) * ts * 0.008;
    ctx.fillStyle = '#2a1220';
    ctx.beginPath();
    ctx.ellipse(ridgeX + pulse, ry, knobR * 1.4, knobR, 0.2, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#3a1a28';
    ctx.beginPath();
    ctx.arc(ridgeX + pulse - knobR * 0.2, ry - knobR * 0.3, knobR * 0.5, 0, TWO_PI);
    ctx.fill();
  }
}

function drawGrotesqueSpider(
  ctx: NodeCtx,
  sx: number,
  sy: number,
  ts: number,
  time: number,
  facingX: number,
  facingY: number,
  state: GrotesqueSpiderState,
  stateProgress: number,
): void {
  const cx = sx + ts * 0.5;
  const cy = sy + ts * 0.5;
  const absX = Math.abs(facingX);
  const absY = Math.abs(facingY);
  const movingUp = facingY < -0.3 && absY > absX;
  const needsFlip = facingX < -0.1;
  const movX = state === 'walk' ? (needsFlip ? 1 : facingX) : 0;
  const movY = state === 'walk' ? facingY : 0;

  if (needsFlip) {
    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }
  const drawFacingX = needsFlip ? Math.abs(facingX) : facingX;

  drawHair(ctx, cx, cy, ts, time, state, stateProgress, movX, movY);

  for (const i of [2, 3, 6, 7]) {
    const leg = LEGS[i];
    const { tx, ty } = getLegTip(cx, cy, ts, leg, time, state, stateProgress, movX, movY);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }

  drawBody(ctx, cx, cy, ts, time, state, stateProgress);
  if (movingUp) drawBackRidge(ctx, cx, cy, ts, time);

  for (const i of [0, 1, 4, 5]) {
    const leg = LEGS[i];
    const { tx, ty } = getLegTip(cx, cy, ts, leg, time, state, stateProgress, movX, movY);
    drawLeg(ctx, cx + leg.ax * ts, cy + leg.ay * ts, tx, ty, ts, leg.kOut);
  }

  if (!movingUp) {
    drawEyes(ctx, cx, cy, ts, time, drawFacingX, facingY, state, stateProgress);
    drawMaw(ctx, cx, cy, ts, time, state, stateProgress);
  }

  if (state === 'attack_screech' && stateProgress > 0.3) {
    const ringProgress = (stateProgress - 0.3) / 0.7;
    ctx.save();
    ctx.globalAlpha = (1 - ringProgress) * 0.5;
    ctx.strokeStyle = '#600010';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy - ts * 0.1, ts * 1.6 * ringProgress, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  if (needsFlip) ctx.restore();
}

type FrameSpec = {
  time: number;
  facingX: number;
  facingY: number;
  state: GrotesqueSpiderState;
  stateProgress: number;
};

// Walk frames: time steps spread across multiple leg-step cycles so all 8 legs
// show varied positions (they desync due to irrational frequency ratios)
const WALK_TIMES = [0.0, 0.38, 0.76, 1.14, 1.52, 1.9, 2.28, 2.66];

// Idle frames: slow breathing cycle ~7.7s, 8 steps
const IDLE_TIMES = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0];

// Attack frames: 16 evenly-spaced stateProgress steps 0→1
const ATK_FRAMES = 16;
const ATK_STEPS = Array.from({ length: ATK_FRAMES }, (_, i) => i / (ATK_FRAMES - 1));

// Base sheet rows
type RowSpec = { frames: FrameSpec[]; label: string };
const BASE_ROWS: RowSpec[] = [
  {
    label: 'idle',
    frames: IDLE_TIMES.map((t) => ({
      time: t,
      facingX: 0,
      facingY: 1,
      state: 'idle',
      stateProgress: 0,
    })),
  },
  {
    label: 'walk_down',
    frames: WALK_TIMES.map((t) => ({
      time: t,
      facingX: 0,
      facingY: 1,
      state: 'walk',
      stateProgress: 0,
    })),
  },
  {
    label: 'walk_up',
    frames: WALK_TIMES.map((t) => ({
      time: t,
      facingX: 0,
      facingY: -1,
      state: 'walk',
      stateProgress: 0,
    })),
  },
  {
    label: 'walk_side',
    frames: WALK_TIMES.map((t) => ({
      time: t,
      facingX: 1,
      facingY: 0,
      state: 'walk',
      stateProgress: 0,
    })),
  },
];

const SLAM_ROW: FrameSpec[] = ATK_STEPS.map((p) => ({
  time: 0,
  facingX: 0,
  facingY: 1,
  state: 'attack_slam',
  stateProgress: p,
}));

const SCREECH_ROW: FrameSpec[] = ATK_STEPS.map((p) => ({
  time: 0,
  facingX: 0,
  facingY: 1,
  state: 'attack_screech',
  stateProgress: p,
}));

function renderRows(rowGroups: FrameSpec[][]): Buffer {
  const cols = Math.max(...rowGroups.map((r) => r.length));
  const sheetW = cols * FRAME_W;
  const sheetH = rowGroups.length * FRAME_H;
  const c = createCanvas(sheetW, sheetH);
  const ctx = c.getContext('2d') as NodeCtx;

  for (let row = 0; row < rowGroups.length; row++) {
    for (let col = 0; col < rowGroups[row].length; col++) {
      const spec = rowGroups[row][col];
      drawGrotesqueSpider(
        ctx,
        col * FRAME_W + TILE_X,
        row * FRAME_H + TILE_Y,
        TILE_SCALE,
        spec.time,
        spec.facingX,
        spec.facingY,
        spec.state,
        spec.stateProgress,
      );
    }
  }

  return c.toBuffer('image/png');
}

const outDir = resolve('src/images/enemies');

console.log(
  `Generating grotesque_spider sprites (${FRAME_W}×${FRAME_H}px frames, tileScale=${TILE_SCALE})…`,
);

console.log('  [1/3] grotesque_spider_base.png  (idle + walk_down + walk_up + walk_side) …');
writeFileSync(
  resolve(outDir, 'grotesque_spider_base.png'),
  renderRows(BASE_ROWS.map((r) => r.frames)),
);
console.log(`        → ${FRAME_W * 8}×${FRAME_H * 4}px  (4 rows × 8 frames)`);

console.log('  [2/3] grotesque_spider_slam.png  (attack_slam) …');
writeFileSync(resolve(outDir, 'grotesque_spider_slam.png'), renderRows([SLAM_ROW]));
console.log(`        → ${FRAME_W * ATK_FRAMES}×${FRAME_H}px  (1 row × ${ATK_FRAMES} frames)`);

console.log('  [3/3] grotesque_spider_screech.png  (attack_screech) …');
writeFileSync(resolve(outDir, 'grotesque_spider_screech.png'), renderRows([SCREECH_ROW]));
console.log(`        → ${FRAME_W * ATK_FRAMES}×${FRAME_H}px  (1 row × ${ATK_FRAMES} frames)`);

console.log('\nDone. grotesque_spider sprites written to src/images/enemies/');
console.log(`tileX=${TILE_X}  tileY=${TILE_Y}  tileScale=${TILE_SCALE}`);
