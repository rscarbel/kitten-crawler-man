#!/usr/bin/env tsx
/**
 * Generates the destructible prop sprite sheets from procedural drawing code.
 *
 * Outputs four PNG files to src/images/environment/props/:
 *   barrel.png       — idle (row 0) + damaged (1) + shatter (2, 6 frames) + remains (3)
 *   barrel_side.png  — same four rows
 *   crate.png        — same four rows
 *   torch.png        — same four rows, but idle and damaged are 6-frame flame loops
 *
 * Frames carry the 64px logical tile inset by 16px on every side, so shatter
 * debris can fly past the tile footprint without being clipped by the
 * neighbouring frame. The tile footprint itself is unchanged. The torch needs a
 * taller frame than the boxy props because its flame reaches a tile above the
 * ground it stands on.
 *
 * Run: npx tsx scripts/generate-destructible-props-sprite.ts
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const TILE_SCALE = 64;
/** Clearance around the logical tile for debris that flies past the footprint. */
const DEBRIS_MARGIN = 16;

const SHATTER_FRAMES = 6;
/** Frames in the torch's flame loop, shared by its intact and damaged rows. */
const FLAME_FRAMES = 6;
const ROW_COUNT = 4;

const TWO_PI = Math.PI * 2;

type PropKind = 'barrel' | 'barrel_side' | 'crate' | 'torch';
type PropState = 'idle' | 'damaged' | 'shatter' | 'remains';

interface FrameGeometry {
  frameW: number;
  frameH: number;
  tileX: number;
  tileY: number;
}

/** Boxy props sit inside their own tile, so a uniform margin is all they need. */
const BOXED_FRAME: FrameGeometry = {
  frameW: TILE_SCALE + DEBRIS_MARGIN * 2,
  frameH: TILE_SCALE + DEBRIS_MARGIN * 2,
  tileX: DEBRIS_MARGIN,
  tileY: DEBRIS_MARGIN,
};

/**
 * Headroom above the torch's tile, for the haft, the flame and its smoke.
 *
 * Exactly one tile, not one tile plus a debris margin: `unregisteredDecorationExtents`
 * in TileRenderer assumes a sprite-drawn decoration with no registered tile type
 * reaches at most one tile past its own square, and registering the torch to buy
 * it more would also hand it a frame-derived Y-sort anchor a quarter-tile below
 * its actual foot. The flame and the shatter burst are sized to fit inside this.
 */
const TORCH_HEADROOM = TILE_SCALE;
const TORCH_FRAME: FrameGeometry = {
  frameW: TILE_SCALE + DEBRIS_MARGIN * 2,
  frameH: TORCH_HEADROOM + TILE_SCALE + DEBRIS_MARGIN,
  tileX: DEBRIS_MARGIN,
  tileY: TORCH_HEADROOM,
};

function frameGeometryFor(kind: PropKind): FrameGeometry {
  return kind === 'torch' ? TORCH_FRAME : BOXED_FRAME;
}

// ── Palette ───────────────────────────────────────────────────────────────────
// Five-value warm oak ramp, lit from the upper left. The darkest value is the
// outline colour — nothing in this set is drawn in pure black, which is what
// made the old crate read as a UI icon rather than a prop.
const WOOD_EDGE = '#2a1a0d';
const WOOD_SHADOW = '#3a2413';
const WOOD_DARK = '#5a3a1e';
const WOOD_MID = '#7a5028';
const WOOD_LIGHT = '#9a6a38';
const WOOD_RIM = '#c09050';
const WOOD_RAMP = [WOOD_SHADOW, WOOD_DARK, WOOD_MID, WOOD_LIGHT, WOOD_RIM] as const;

// Cool grey-blue so the iron reads as a different material from the wood.
const IRON_DARK = '#3a4048';
const IRON_MID = '#4a5058';
const IRON_LIGHT = '#6b7480';
const IRON_SPEC = '#9aa4b0';

const CAVITY = '#1d1208';
const DUST = '#b09878';
const DUST_RGB = [176, 152, 120] as const;

// Fire ramp for the torch, running from the pale core out to the cooling tips.
const FLAME_CORE = '#fff6cf';
const FLAME_HOT = '#ffd24a';
const FLAME_MID = '#ff8a1e';
const FLAME_OUTER = '#e2450f';
const EMBER_RGB = [255, 142, 46] as const;
const SOOT = '#241a14';
const SMOKE_RGB = [172, 166, 160] as const;

const CONTACT_SHADOW_ALPHA = 0.35;
const CONTACT_SHADOW_WIDTH_FRACTION = 0.7;
const CONTACT_SHADOW_HEIGHT_FRACTION = 0.11;

// ── Deterministic noise ───────────────────────────────────────────────────────
// A seeded generator rather than Math.random so re-running the script produces
// byte-identical sheets and diffs stay meaningful.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Shared wood primitives ────────────────────────────────────────────────────

/**
 * Soft dark ellipse under a prop. Without this the props float above the floor
 * tile instead of sitting on it.
 */
function contactShadow(ctx: NodeCtx, cx: number, baseY: number, ts: number, scale = 1): void {
  const rx = ts * CONTACT_SHADOW_WIDTH_FRACTION * 0.5 * scale;
  const ry = ts * CONTACT_SHADOW_HEIGHT_FRACTION * scale;
  const grad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, rx);
  grad.addColorStop(0, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA})`);
  grad.addColorStop(0.6, `rgba(0,0,0,${CONTACT_SHADOW_ALPHA * 0.6})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Left-to-right wood gradient with the highlight sitting where the light hits. */
function woodGradient(ctx: NodeCtx, x0: number, x1: number, y: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y, x1, y);
  g.addColorStop(0, WOOD_DARK);
  g.addColorStop(0.18, WOOD_LIGHT);
  g.addColorStop(0.34, WOOD_RIM);
  g.addColorStop(0.62, WOOD_MID);
  g.addColorStop(0.86, WOOD_DARK);
  g.addColorStop(1, WOOD_SHADOW);
  return g;
}

/** Top-to-bottom wood gradient, for faces whose shading runs vertically. */
function woodGradientV(ctx: NodeCtx, x: number, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  g.addColorStop(0, WOOD_LIGHT);
  g.addColorStop(0.35, WOOD_MID);
  g.addColorStop(1, WOOD_SHADOW);
  return g;
}

/** A 1px plank seam. Spacing is varied by the caller so seams never read as stripes. */
function seam(ctx: NodeCtx, x0: number, y0: number, x1: number, y1: number, alpha = 0.85): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = WOOD_SHADOW;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/**
 * A horizontal iron hoop wrapped around a barrel: the band follows the barrel's
 * curve, so it is drawn as the strip between two ellipse arcs.
 */
function hoopBand(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thickness: number,
): void {
  const g = ctx.createLinearGradient(cx - rx, cy, cx + rx, cy);
  g.addColorStop(0, IRON_MID);
  g.addColorStop(0.22, IRON_LIGHT);
  g.addColorStop(0.55, IRON_MID);
  g.addColorStop(1, IRON_DARK);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + thickness / 2, rx, ry, 0, 0, Math.PI);
  ctx.ellipse(cx, cy - thickness / 2, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();

  // Single specular arc along the upper-left of the band.
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy - thickness / 2, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

/** An iron strap running between two points — crate edge bracket, barrel rivet strip. */
function ironStrap(
  ctx: NodeCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
): void {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, IRON_LIGHT);
  g.addColorStop(0.5, IRON_MID);
  g.addColorStop(1, IRON_DARK);
  ctx.save();
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 0.5, y0 - 0.5);
  ctx.lineTo(x1 - 0.5, y1 - 0.5);
  ctx.stroke();
  ctx.restore();
}

/** A jagged split running down a plank, with the dark cavity showing through. */
function crack(ctx: NodeCtx, x: number, y0: number, y1: number, wobble: number, rng: () => number) {
  ctx.save();
  ctx.strokeStyle = CAVITY;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    ctx.lineTo(x + (rng() - 0.5) * wobble, lerp(y0, y1, t));
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A missing chip: a shallow recess with a lit splinter lip on its upper edge.
 * The recess is deep-brown rather than near-black — a true black hole at this
 * size reads as a sticker blob stuck on the prop instead of a bite out of it.
 */
function chip(ctx: NodeCtx, x: number, y: number, w: number, h: number): void {
  ctx.save();
  const recess = ctx.createLinearGradient(x, y - h * 0.3, x + w, y + h);
  recess.addColorStop(0, CAVITY);
  recess.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = recess;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.6, y - h * 0.3);
  ctx.lineTo(x + w, y + h * 0.2);
  ctx.lineTo(x + w * 0.45, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WOOD_RIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w * 0.6, y - h * 0.3);
  ctx.lineTo(x + w, y + h * 0.2);
  ctx.stroke();
  ctx.restore();
}

/** A single flat wood shard, drawn as a rotated tapered plank. */
function shard(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  length: number,
  width: number,
  angle: number,
  shade: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(-length / 2, -width / 2);
  ctx.lineTo(length / 2, -width * 0.25);
  ctx.lineTo(length / 2, width * 0.3);
  ctx.lineTo(-length / 2, width / 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
}

/** Alpha of a puff's mid stop, relative to its centre. */
const PUFF_MID_STOP = 0.55;
const PUFF_MID_ALPHA_FRACTION = 0.45;

/**
 * Soft cloud puffed out behind the flying debris during a break. Tinted by the
 * caller so a splintering crate throws sawdust and a felled torch throws embers.
 */
function puff(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  radius: number,
  alpha: number,
  rgb: readonly [number, number, number],
): void {
  const [r, g, b] = rgb;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(PUFF_MID_STOP, `rgba(${r},${g},${b},${alpha * PUFF_MID_ALPHA_FRACTION})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Fine sawdust speckle scattered over settled wreckage. */
function sawdust(ctx: NodeCtx, cx: number, cy: number, spread: number, rng: () => number): void {
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const a = rng() * TWO_PI;
    const r = Math.sqrt(rng()) * spread;
    ctx.globalAlpha = 0.25 + rng() * 0.35;
    ctx.fillStyle = rng() < 0.4 ? DUST : WOOD_DARK;
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55, 1, 1);
  }
  ctx.restore();
}

// ── Upright barrel ────────────────────────────────────────────────────────────

const BARREL_LID_RY = 7;
const BARREL_TOP_RX = 20;
const BARREL_BOTTOM_RX = 17;
const BARREL_BULGE_RX = 23;

interface BarrelGeometry {
  cx: number;
  topY: number;
  bottomY: number;
  midY: number;
}

function barrelGeometry(ox: number, oy: number, ts: number): BarrelGeometry {
  return {
    cx: ox + ts / 2,
    topY: oy + ts * 0.22,
    bottomY: oy + ts * 0.88,
    midY: oy + ts * 0.55,
  };
}

/** Outline of the barrel body: bulged cylinder walls plus the base ellipse. */
function barrelBodyPath(ctx: NodeCtx, g: BarrelGeometry): void {
  const { cx, topY, bottomY, midY } = g;
  ctx.beginPath();
  ctx.moveTo(cx - BARREL_TOP_RX, topY);
  ctx.bezierCurveTo(
    cx - BARREL_BULGE_RX,
    lerp(topY, midY, 0.7),
    cx - BARREL_BULGE_RX,
    lerp(midY, bottomY, 0.4),
    cx - BARREL_BOTTOM_RX,
    bottomY,
  );
  ctx.ellipse(cx, bottomY, BARREL_BOTTOM_RX, BARREL_LID_RY * 0.8, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(
    cx + BARREL_BULGE_RX,
    lerp(midY, bottomY, 0.4),
    cx + BARREL_BULGE_RX,
    lerp(topY, midY, 0.7),
    cx + BARREL_TOP_RX,
    topY,
  );
  ctx.closePath();
}

function drawBarrelBody(ctx: NodeCtx, g: BarrelGeometry, rng: () => number): void {
  const { cx, topY, bottomY } = g;

  barrelBodyPath(ctx, g);
  ctx.save();
  ctx.fillStyle = woodGradient(ctx, cx - BARREL_BULGE_RX, cx + BARREL_BULGE_RX, g.midY);
  ctx.fill();
  ctx.clip();

  // Staves: unevenly spaced so they read as boards, not as a stripe pattern.
  let offset = -BARREL_BULGE_RX + 2;
  while (offset < BARREL_BULGE_RX - 2) {
    const x = cx + offset;
    seam(ctx, x, topY - 2, x + offset * 0.06, bottomY + 2, 0.5 + rng() * 0.3);
    offset += 4 + rng() * 3.5;
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  barrelBodyPath(ctx, g);
  ctx.stroke();
  ctx.restore();
}

function drawBarrelLid(ctx: NodeCtx, g: BarrelGeometry, rng: () => number): void {
  const { cx, topY } = g;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, topY, BARREL_TOP_RX, BARREL_LID_RY, 0, 0, TWO_PI);
  const lidGrad = ctx.createLinearGradient(
    cx - BARREL_TOP_RX,
    topY - BARREL_LID_RY,
    cx + BARREL_TOP_RX,
    topY + BARREL_LID_RY,
  );
  lidGrad.addColorStop(0, WOOD_RIM);
  lidGrad.addColorStop(0.45, WOOD_LIGHT);
  lidGrad.addColorStop(1, WOOD_DARK);
  ctx.fillStyle = lidGrad;
  ctx.fill();
  ctx.clip();
  // Two or three boards across the lid, not the old alternating stripe field.
  for (let i = -1; i <= 1; i++) {
    const y = topY + i * (BARREL_LID_RY * 0.75) + (rng() - 0.5);
    seam(ctx, cx - BARREL_TOP_RX, y, cx + BARREL_TOP_RX, y, 0.6);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, topY, BARREL_TOP_RX, BARREL_LID_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}

function drawBarrel(ctx: NodeCtx, ox: number, oy: number, ts: number, damaged: boolean): void {
  const rng = makeRng(0x8a71);
  const g = barrelGeometry(ox, oy, ts);

  contactShadow(ctx, g.cx, g.bottomY + 3, ts);
  drawBarrelBody(ctx, g, rng);

  const upperHoopY = lerp(g.topY, g.bottomY, 0.24);
  const lowerHoopY = lerp(g.topY, g.bottomY, 0.74);
  const hoopRxAt = (y: number) => {
    const t = (y - g.topY) / (g.bottomY - g.topY);
    const bulge = Math.sin(t * Math.PI);
    return lerp(BARREL_TOP_RX, BARREL_BOTTOM_RX, t) + bulge * (BARREL_BULGE_RX - BARREL_TOP_RX);
  };

  if (damaged) {
    // A sprung hoop: the upper band lifts and tilts off the staves.
    ctx.save();
    ctx.translate(g.cx, upperHoopY - 2);
    ctx.rotate(-0.13);
    ctx.translate(-g.cx, -(upperHoopY - 2));
    hoopBand(ctx, g.cx, upperHoopY - 2, hoopRxAt(upperHoopY), BARREL_LID_RY * 0.85, 3.5);
    ctx.restore();
  } else {
    hoopBand(ctx, g.cx, upperHoopY, hoopRxAt(upperHoopY), BARREL_LID_RY * 0.85, 3.5);
  }
  hoopBand(ctx, g.cx, lowerHoopY, hoopRxAt(lowerHoopY), BARREL_LID_RY * 0.8, 3.5);

  drawBarrelLid(ctx, g, rng);

  if (damaged) {
    crack(ctx, g.cx - 7, g.topY + 6, g.bottomY - 5, 3.5, rng);
    chip(ctx, g.cx + 6, g.topY + 12, 7, 9);
    chip(ctx, g.cx - BARREL_TOP_RX + 4, g.topY - 1, 5, 5);
  }
}

// ── Barrel on its side ────────────────────────────────────────────────────────

const BARREL_SIDE_HALF_LEN = 22;
const BARREL_SIDE_CAP_RX = 7;
const BARREL_SIDE_END_RY = 15;
const BARREL_SIDE_BULGE_RY = 18;

interface BarrelSideGeometry {
  cx: number;
  cy: number;
  leftX: number;
  rightX: number;
}

function barrelSideGeometry(ox: number, oy: number, ts: number): BarrelSideGeometry {
  const cx = ox + ts / 2;
  const cy = oy + ts * 0.56;
  return { cx, cy, leftX: cx - BARREL_SIDE_HALF_LEN, rightX: cx + BARREL_SIDE_HALF_LEN };
}

function barrelSideBodyPath(ctx: NodeCtx, g: BarrelSideGeometry): void {
  const { cx, cy, leftX, rightX } = g;
  ctx.beginPath();
  ctx.moveTo(leftX, cy - BARREL_SIDE_END_RY);
  ctx.bezierCurveTo(
    cx - BARREL_SIDE_HALF_LEN * 0.4,
    cy - BARREL_SIDE_BULGE_RY,
    cx + BARREL_SIDE_HALF_LEN * 0.4,
    cy - BARREL_SIDE_BULGE_RY,
    rightX,
    cy - BARREL_SIDE_END_RY,
  );
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, -Math.PI / 2, Math.PI / 2);
  ctx.bezierCurveTo(
    cx + BARREL_SIDE_HALF_LEN * 0.4,
    cy + BARREL_SIDE_BULGE_RY,
    cx - BARREL_SIDE_HALF_LEN * 0.4,
    cy + BARREL_SIDE_BULGE_RY,
    leftX,
    cy + BARREL_SIDE_END_RY,
  );
  ctx.ellipse(
    leftX,
    cy,
    BARREL_SIDE_CAP_RX,
    BARREL_SIDE_END_RY,
    0,
    Math.PI / 2,
    Math.PI * 1.5,
    false,
  );
  ctx.closePath();
}

function drawBarrelSide(ctx: NodeCtx, ox: number, oy: number, ts: number, damaged: boolean): void {
  const rng = makeRng(0x51c3);
  const g = barrelSideGeometry(ox, oy, ts);
  const { cx, cy, rightX } = g;

  contactShadow(ctx, cx, cy + BARREL_SIDE_END_RY + 2, ts, 1.05);

  barrelSideBodyPath(ctx, g);
  ctx.save();
  ctx.fillStyle = woodGradientV(ctx, cx, cy - BARREL_SIDE_BULGE_RY, cy + BARREL_SIDE_BULGE_RY);
  ctx.fill();
  ctx.clip();
  // Staves run along the barrel's axis when it lies down.
  let off = -BARREL_SIDE_BULGE_RY + 2;
  while (off < BARREL_SIDE_BULGE_RY - 2) {
    const y = cy + off;
    seam(ctx, g.leftX - 4, y, rightX, y, 0.45 + rng() * 0.3);
    off += 4 + rng() * 3;
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  barrelSideBodyPath(ctx, g);
  ctx.stroke();
  ctx.restore();

  // Hoops read as vertical bands when the barrel is on its side.
  const ryAt = (x: number) => {
    const t = (x - g.leftX) / (g.rightX - g.leftX);
    return lerp(BARREL_SIDE_END_RY, BARREL_SIDE_BULGE_RY, Math.sin(t * Math.PI));
  };
  for (const frac of [0.28, 0.72]) {
    const x = lerp(g.leftX, g.rightX, frac);
    const isSprung = damaged && frac === 0.28;
    ctx.save();
    if (isSprung) {
      ctx.translate(x, cy);
      ctx.rotate(0.16);
      ctx.translate(-x, -cy);
    }
    ctx.beginPath();
    ctx.ellipse(x, cy, 2, ryAt(x), 0, 0, TWO_PI);
    const bandGrad = ctx.createLinearGradient(x, cy - ryAt(x), x, cy + ryAt(x));
    bandGrad.addColorStop(0, IRON_LIGHT);
    bandGrad.addColorStop(0.4, IRON_MID);
    bandGrad.addColorStop(1, IRON_DARK);
    ctx.fillStyle = bandGrad;
    ctx.fill();
    ctx.strokeStyle = IRON_SPEC;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(x, cy, 2, ryAt(x), 0, Math.PI * 1.15, Math.PI * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  // Visible end cap.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, 0, TWO_PI);
  const capGrad = ctx.createRadialGradient(
    rightX - 2,
    cy - 5,
    1,
    rightX,
    cy,
    BARREL_SIDE_END_RY * 1.1,
  );
  capGrad.addColorStop(0, WOOD_LIGHT);
  capGrad.addColorStop(0.6, WOOD_MID);
  capGrad.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = capGrad;
  ctx.fill();
  ctx.clip();
  for (let i = -1; i <= 1; i++) {
    const y = cy + i * 7;
    seam(ctx, rightX - BARREL_SIDE_CAP_RX, y, rightX + BARREL_SIDE_CAP_RX, y, 0.6);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(rightX, cy, BARREL_SIDE_CAP_RX, BARREL_SIDE_END_RY, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();

  if (damaged) {
    crack(ctx, cx - 4, cy - BARREL_SIDE_BULGE_RY + 3, cy + BARREL_SIDE_BULGE_RY - 4, 3, rng);
    chip(ctx, cx + 4, cy - BARREL_SIDE_END_RY + 1, 8, 6);
    chip(ctx, g.leftX + 2, cy + 5, 6, 7);
  }
}

// ── Crate ─────────────────────────────────────────────────────────────────────
// 3/4 view: front face, right side face and a shallow top face, so the box has
// volume instead of reading as a flat square with an X on it.

interface CrateGeometry {
  frontL: number;
  frontR: number;
  frontT: number;
  frontB: number;
  depthX: number;
  depthY: number;
}

function crateGeometry(ox: number, oy: number, ts: number): CrateGeometry {
  return {
    frontL: ox + ts * 0.14,
    frontR: ox + ts * 0.7,
    frontT: oy + ts * 0.36,
    frontB: oy + ts * 0.88,
    depthX: ts * 0.16,
    depthY: -ts * 0.12,
  };
}

function drawCrate(ctx: NodeCtx, ox: number, oy: number, ts: number, damaged: boolean): void {
  const rng = makeRng(0x3f19);
  const { frontL, frontR, frontT, frontB, depthX, depthY } = crateGeometry(ox, oy, ts);
  const backL = frontL + depthX;
  const backR = frontR + depthX;
  const backT = frontT + depthY;
  const backB = frontB + depthY;

  contactShadow(ctx, (frontL + backR) / 2, frontB + 2, ts, 1.05);

  // Right side face — furthest from the light, so darkest.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontR, frontT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backB);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  const sideGrad = ctx.createLinearGradient(frontR, frontT, backR, backB);
  sideGrad.addColorStop(0, WOOD_DARK);
  sideGrad.addColorStop(1, WOOD_SHADOW);
  ctx.fillStyle = sideGrad;
  ctx.fill();
  ctx.clip();
  for (let i = 1; i <= 3; i++) {
    const t = i / 4 + (rng() - 0.5) * 0.06;
    const y0 = lerp(frontT, frontB, t);
    seam(ctx, frontR, y0, backR, y0 + depthY, 0.7);
  }
  ctx.restore();

  // Top face.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontL, frontT);
  ctx.lineTo(frontR, frontT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backL, backT);
  ctx.closePath();
  const topGrad = ctx.createLinearGradient(frontL, frontT, backR, backT);
  topGrad.addColorStop(0, WOOD_LIGHT);
  topGrad.addColorStop(0.4, WOOD_RIM);
  topGrad.addColorStop(1, WOOD_LIGHT);
  ctx.fillStyle = topGrad;
  ctx.fill();
  ctx.clip();
  for (let i = 1; i <= 3; i++) {
    const t = i / 4 + (rng() - 0.5) * 0.07;
    const x0 = lerp(frontL, frontR, t);
    seam(ctx, x0, frontT, x0 + depthX, backT, 0.6);
  }
  ctx.restore();

  // Front face.
  ctx.save();
  ctx.beginPath();
  ctx.rect(frontL, frontT, frontR - frontL, frontB - frontT);
  ctx.fillStyle = woodGradient(ctx, frontL, frontR, frontT);
  ctx.fill();
  ctx.clip();
  let x = frontL + 4 + rng() * 3;
  while (x < frontR - 2) {
    seam(ctx, x, frontT, x, frontB, 0.55 + rng() * 0.3);
    x += 6 + rng() * 4;
  }
  if (damaged) {
    // A split plank with the crate's dark interior showing through it.
    const splitX = lerp(frontL, frontR, 0.42);
    ctx.fillStyle = CAVITY;
    ctx.beginPath();
    ctx.moveTo(splitX - 2, frontT + 4);
    ctx.lineTo(splitX + 3, frontT + 14);
    ctx.lineTo(splitX - 1, frontB - 6);
    ctx.lineTo(splitX - 5, frontT + 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = WOOD_RIM;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX - 5, frontT + 16);
    ctx.lineTo(splitX - 2, frontT + 4);
    ctx.stroke();
  }
  ctx.restore();

  // Corner brackets and edge straps.
  const bracketWidth = 3;
  ironStrap(ctx, frontL, frontT, frontR, frontT, bracketWidth);
  ironStrap(ctx, frontL, frontB, frontR, frontB, bracketWidth);
  ironStrap(ctx, frontL, frontT, frontL, frontB, bracketWidth);
  if (damaged) {
    // The right bracket has been knocked loose and bows outward.
    ironStrap(ctx, frontR + 2, frontT + 3, frontR, frontB, bracketWidth);
  } else {
    ironStrap(ctx, frontR, frontT, frontR, frontB, bracketWidth);
  }
  ironStrap(ctx, frontR, frontT, backR, backT, bracketWidth - 1);
  ironStrap(ctx, backL, backT, backR, backT, bracketWidth - 1);

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(frontL, frontB);
  ctx.lineTo(frontL, frontT);
  ctx.lineTo(backL, backT);
  ctx.lineTo(backR, backT);
  ctx.lineTo(backR, backB);
  ctx.lineTo(frontR, frontB);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  if (damaged) {
    chip(ctx, frontR - 11, frontB - 11, 6, 5);
  }
}

// ── Torch ─────────────────────────────────────────────────────────────────────
// A floor-standing brand: splayed iron foot, wooden haft, iron fire bowl. The
// haft is what a swing breaks, which is why the torch splinters like the boxy
// props rather than shedding only iron.

const TORCH_FOOT_BASE_FRACTION = 0.93;
const TORCH_FOOT_HALF_W = 11;
const TORCH_FOOT_TOP_HALF_W = 6;
const TORCH_FOOT_H = 7;
/** How far above its own tile the fire bowl's rim sits, as a fraction of a tile. */
const TORCH_HEAD_ABOVE_TILE_FRACTION = 0.34;
const TORCH_HAFT_HALF_W_BOTTOM = 3.6;
const TORCH_HAFT_HALF_W_TOP = 2.9;
/** Where the two iron bands sit along the haft, as fractions of its length. */
const TORCH_FERRULE_FRACTIONS = [0.32, 0.74] as const;
const TORCH_FERRULE_WIDTH = 3;
const TORCH_FERRULE_OVERHANG = 1.8;
const TORCH_BOWL_RIM_RX = 11;
const TORCH_BOWL_RIM_RY = 4.5;
const TORCH_BOWL_DEPTH = 10;
const TORCH_BOWL_BASE_HALF_W = 4.5;
const TORCH_COAL_COUNT = 5;
const TORCH_COAL_RADIUS = 1.7;
/** Tilt a knocked-about bowl leans at, in radians. */
const TORCH_DAMAGED_BOWL_TILT = 0.14;
/** Angle a sprung ferrule twists off the haft, in radians. */
const TORCH_SPRUNG_FERRULE_TILT = -0.3;

const FLAME_BASE_H = 18;
const FLAME_H_FLICKER = 3.5;
const FLAME_HALF_W = 6.5;
const FLAME_SWAY = 2.2;
const FLAME_MID_SCALE = 0.66;
const FLAME_CORE_SCALE = 0.34;
/** Height a guttering flame burns at, relative to a healthy one. */
const FLAME_DAMAGED_SCALE = 0.62;
const FLAME_GLOW_RADIUS_TILE_FRACTION = 0.44;
const FLAME_GLOW_ALPHA_BASE = 0.26;
const FLAME_GLOW_ALPHA_FLICKER = 0.06;
/** Fraction of the flame's height the glow centres on. */
const FLAME_GLOW_CENTER_FRACTION = 0.45;
const SMOKE_PUFF_COUNT = 3;
/** Kept tight so the highest wisp stays inside TORCH_HEADROOM. */
const SMOKE_PUFF_STRIDE = 5;
const SMOKE_PUFF_LIFT = 3;
const SMOKE_PUFF_SWAY = 4;
const SMOKE_PUFF_BASE_RADIUS = 3;
const SMOKE_PUFF_ALPHA_BASE = 0.2;
const SMOKE_PUFF_ALPHA_DECAY = 0.055;
/** Extra smoke a guttering flame throws off, as a multiple of the healthy amount. */
const SMOKE_DAMAGED_MULTIPLIER = 1.8;

interface TorchGeometry {
  cx: number;
  footY: number;
  haftBottomY: number;
  haftTopY: number;
  rimY: number;
}

function torchGeometry(ox: number, oy: number, ts: number): TorchGeometry {
  const footY = oy + ts * TORCH_FOOT_BASE_FRACTION;
  const rimY = oy - ts * TORCH_HEAD_ABOVE_TILE_FRACTION;
  return {
    cx: ox + ts / 2,
    footY,
    haftBottomY: footY - TORCH_FOOT_H / 2,
    haftTopY: rimY + TORCH_BOWL_DEPTH,
    rimY,
  };
}

/** Splayed iron plinth that keeps the brand upright. */
function drawTorchFoot(ctx: NodeCtx, g: TorchGeometry): void {
  const { cx, footY } = g;
  const topY = footY - TORCH_FOOT_H;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - TORCH_FOOT_HALF_W, footY);
  ctx.lineTo(cx - TORCH_FOOT_TOP_HALF_W, topY);
  ctx.lineTo(cx + TORCH_FOOT_TOP_HALF_W, topY);
  ctx.lineTo(cx + TORCH_FOOT_HALF_W, footY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(
    cx - TORCH_FOOT_HALF_W,
    topY,
    cx + TORCH_FOOT_HALF_W,
    footY,
  );
  grad.addColorStop(0, IRON_LIGHT);
  grad.addColorStop(0.5, IRON_MID);
  grad.addColorStop(1, IRON_DARK);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawTorchHaft(ctx: NodeCtx, g: TorchGeometry, rng: () => number, damaged: boolean): void {
  const { cx, haftBottomY, haftTopY } = g;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - TORCH_HAFT_HALF_W_BOTTOM, haftBottomY);
  ctx.lineTo(cx - TORCH_HAFT_HALF_W_TOP, haftTopY);
  ctx.lineTo(cx + TORCH_HAFT_HALF_W_TOP, haftTopY);
  ctx.lineTo(cx + TORCH_HAFT_HALF_W_BOTTOM, haftBottomY);
  ctx.closePath();
  ctx.fillStyle = woodGradient(
    ctx,
    cx - TORCH_HAFT_HALF_W_BOTTOM,
    cx + TORCH_HAFT_HALF_W_BOTTOM,
    (haftTopY + haftBottomY) / 2,
  );
  ctx.fill();
  ctx.clip();
  // Two grain lines rather than the boxy props' plank seams: a haft is one turned
  // stick, so evenly spaced seams would read as staves it does not have.
  for (let i = 0; i < 2; i++) {
    const x = cx - TORCH_HAFT_HALF_W_TOP + 1 + i * (TORCH_HAFT_HALF_W_TOP + rng());
    seam(ctx, x, haftTopY, x + (rng() - 0.5) * 2, haftBottomY, 0.45 + rng() * 0.25);
  }
  if (damaged) crack(ctx, cx + 1, haftTopY + 6, haftBottomY - 8, 2.5, rng);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - TORCH_HAFT_HALF_W_BOTTOM, haftBottomY);
  ctx.lineTo(cx - TORCH_HAFT_HALF_W_TOP, haftTopY);
  ctx.moveTo(cx + TORCH_HAFT_HALF_W_BOTTOM, haftBottomY);
  ctx.lineTo(cx + TORCH_HAFT_HALF_W_TOP, haftTopY);
  ctx.stroke();
  ctx.restore();

  TORCH_FERRULE_FRACTIONS.forEach((fraction, index) => {
    const y = lerp(haftTopY, haftBottomY, fraction);
    const halfW = lerp(TORCH_HAFT_HALF_W_TOP, TORCH_HAFT_HALF_W_BOTTOM, fraction);
    const isSprung = damaged && index === 0;
    ctx.save();
    if (isSprung) {
      ctx.translate(cx, y);
      ctx.rotate(TORCH_SPRUNG_FERRULE_TILT);
      ctx.translate(-cx, -y);
    }
    ironStrap(
      ctx,
      cx - halfW - TORCH_FERRULE_OVERHANG,
      y,
      cx + halfW + TORCH_FERRULE_OVERHANG,
      y,
      TORCH_FERRULE_WIDTH,
    );
    ctx.restore();
  });

  if (damaged) chip(ctx, cx - TORCH_HAFT_HALF_W_TOP - 1, haftTopY + 14, 6, 7);
}

/** Iron cup at the head, holding the coals the flame rises from. */
function drawTorchBowl(ctx: NodeCtx, g: TorchGeometry, rng: () => number, damaged: boolean): void {
  const { cx, rimY } = g;
  ctx.save();
  if (damaged) {
    ctx.translate(cx, rimY);
    ctx.rotate(TORCH_DAMAGED_BOWL_TILT);
    ctx.translate(-cx, -rimY);
  }

  const bowlBottomY = rimY + TORCH_BOWL_DEPTH;
  ctx.beginPath();
  ctx.moveTo(cx - TORCH_BOWL_RIM_RX, rimY);
  ctx.lineTo(cx - TORCH_BOWL_BASE_HALF_W, bowlBottomY);
  ctx.lineTo(cx + TORCH_BOWL_BASE_HALF_W, bowlBottomY);
  ctx.lineTo(cx + TORCH_BOWL_RIM_RX, rimY);
  ctx.closePath();
  const bowlGrad = ctx.createLinearGradient(
    cx - TORCH_BOWL_RIM_RX,
    rimY,
    cx + TORCH_BOWL_RIM_RX,
    bowlBottomY,
  );
  bowlGrad.addColorStop(0, IRON_LIGHT);
  bowlGrad.addColorStop(0.45, IRON_MID);
  bowlGrad.addColorStop(1, IRON_DARK);
  ctx.fillStyle = bowlGrad;
  ctx.fill();
  ctx.strokeStyle = WOOD_EDGE;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Rim, then the soot-black interior seen over its near edge.
  ctx.beginPath();
  ctx.ellipse(cx, rimY, TORCH_BOWL_RIM_RX, TORCH_BOWL_RIM_RY, 0, 0, TWO_PI);
  ctx.fillStyle = SOOT;
  ctx.fill();
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, TORCH_BOWL_RIM_RX, TORCH_BOWL_RIM_RY, 0, Math.PI * 1.05, Math.PI * 1.85);
  ctx.stroke();

  for (let i = 0; i < TORCH_COAL_COUNT; i++) {
    const t = (i + 0.5) / TORCH_COAL_COUNT;
    ctx.globalAlpha = 0.6 + rng() * 0.4;
    ctx.fillStyle = rng() < 0.4 ? FLAME_HOT : FLAME_OUTER;
    ctx.beginPath();
    ctx.arc(
      lerp(cx - TORCH_BOWL_RIM_RX * 0.6, cx + TORCH_BOWL_RIM_RX * 0.6, t),
      rimY + (rng() - 0.5) * TORCH_BOWL_RIM_RY,
      TORCH_COAL_RADIUS * (0.6 + rng() * 0.6),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.restore();

  if (damaged) {
    // A gouge knocked out of the rim, so the head reads as struck rather than
    // merely tilted.
    ctx.save();
    ctx.fillStyle = SOOT;
    ctx.beginPath();
    ctx.moveTo(cx + TORCH_BOWL_RIM_RX - 4, rimY - 2);
    ctx.lineTo(cx + TORCH_BOWL_RIM_RX + 1, rimY + 1);
    ctx.lineTo(cx + TORCH_BOWL_RIM_RX - 3, rimY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** One teardrop of flame, swaying with the loop's phase. */
function flamePath(
  ctx: NodeCtx,
  x: number,
  baseY: number,
  halfW: number,
  height: number,
  sway: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - halfW, baseY);
  ctx.bezierCurveTo(
    x - halfW,
    baseY - height * 0.45,
    x + sway - halfW * 0.5,
    baseY - height * 0.78,
    x + sway,
    baseY - height,
  );
  ctx.bezierCurveTo(
    x + sway + halfW * 0.5,
    baseY - height * 0.78,
    x + halfW,
    baseY - height * 0.45,
    x + halfW,
    baseY,
  );
  ctx.closePath();
}

function drawTorchFlame(
  ctx: NodeCtx,
  g: TorchGeometry,
  ts: number,
  phase: number,
  damaged: boolean,
): void {
  const wave = Math.sin(phase * TWO_PI);
  const scale = damaged ? FLAME_DAMAGED_SCALE : 1;
  const height = (FLAME_BASE_H + wave * FLAME_H_FLICKER) * scale;
  const halfW = FLAME_HALF_W * scale;
  const sway = Math.sin(phase * TWO_PI * 2) * FLAME_SWAY;
  const baseY = g.rimY - 1;
  const tipY = baseY - height;

  const glowY = baseY - height * FLAME_GLOW_CENTER_FRACTION;
  puff(
    ctx,
    g.cx + sway * FLAME_GLOW_CENTER_FRACTION,
    glowY,
    ts * FLAME_GLOW_RADIUS_TILE_FRACTION,
    FLAME_GLOW_ALPHA_BASE + wave * FLAME_GLOW_ALPHA_FLICKER,
    EMBER_RGB,
  );

  ctx.save();
  flamePath(ctx, g.cx, baseY, halfW, height, sway);
  const outerGrad = ctx.createLinearGradient(g.cx, baseY, g.cx, tipY);
  outerGrad.addColorStop(0, FLAME_MID);
  outerGrad.addColorStop(0.55, FLAME_OUTER);
  outerGrad.addColorStop(1, FLAME_OUTER);
  ctx.fillStyle = outerGrad;
  ctx.fill();

  flamePath(ctx, g.cx, baseY, halfW * FLAME_MID_SCALE, height * 0.78, sway * 0.7);
  const midGrad = ctx.createLinearGradient(g.cx, baseY, g.cx, tipY);
  midGrad.addColorStop(0, FLAME_HOT);
  midGrad.addColorStop(1, FLAME_MID);
  ctx.fillStyle = midGrad;
  ctx.fill();

  flamePath(ctx, g.cx, baseY, halfW * FLAME_CORE_SCALE, height * 0.5, sway * 0.4);
  ctx.fillStyle = FLAME_CORE;
  ctx.fill();
  ctx.restore();

  const smokeAlphaScale = damaged ? SMOKE_DAMAGED_MULTIPLIER : 1;
  for (let i = 0; i < SMOKE_PUFF_COUNT; i++) {
    const drift = Math.sin(phase * TWO_PI + i) * SMOKE_PUFF_SWAY;
    puff(
      ctx,
      g.cx + sway + drift,
      tipY - SMOKE_PUFF_LIFT - i * SMOKE_PUFF_STRIDE,
      SMOKE_PUFF_BASE_RADIUS + i,
      Math.max(0, (SMOKE_PUFF_ALPHA_BASE - i * SMOKE_PUFF_ALPHA_DECAY) * smokeAlphaScale),
      SMOKE_RGB,
    );
  }
}

function drawTorch(
  ctx: NodeCtx,
  ox: number,
  oy: number,
  ts: number,
  damaged: boolean,
  frame: number,
): void {
  const rng = makeRng(0x6b2d);
  const g = torchGeometry(ox, oy, ts);

  contactShadow(ctx, g.cx, g.footY + 2, ts, 0.75);
  drawTorchFoot(ctx, g);
  drawTorchHaft(ctx, g, rng, damaged);
  drawTorchBowl(ctx, g, rng, damaged);
  drawTorchFlame(ctx, g, ts, frame / FLAME_FRAMES, damaged);
}

// ── Shatter ───────────────────────────────────────────────────────────────────

interface DebrisSpec {
  angle: number;
  distance: number;
  /** Where along the prop the piece came off, relative to the burst centre. */
  originY: number;
  /** Orientation the piece starts at, before its tumble is added. */
  restAngle: number;
  length: number;
  width: number;
  spin: number;
  shade: string;
  isIron: boolean;
}

/** Where in the tile the burst originates, as a fraction of tile height. */
const BURST_CENTER_Y_FRACTION = 0.5;
/**
 * Midpoint of the torch's haft, which is most of a tile above the floor. The
 * burst is centred there rather than on the tile so the pole reads as snapping
 * along its length instead of the floor beneath it erupting.
 */
const TORCH_BURST_CENTER_Y_FRACTION = 0.34;
/** Top-down foreshortening: debris spreads less vertically than horizontally. */
const DEBRIS_VERTICAL_SQUASH = 0.6;
const DEBRIS_COUNT = 16;
const DEBRIS_SPREAD_PX = 34;
/**
 * Vertical arc of the burst. Rise and fall are near-balanced on purpose: a fall
 * much larger than the rise walks the whole cloud off the bottom of the tile by
 * the last frame, so the break reads as debris landing a tile south of the prop
 * rather than as the prop itself coming apart.
 */
const DEBRIS_RISE_PX = 11;
const DEBRIS_FALL_PX = 9;
/**
 * Frame 0 is the instant the prop gives way, not the instant before it — the
 * pieces already have this much of their travel so the first frame reads as a
 * burst rather than as a single shard sitting on an empty tile.
 */
const DEBRIS_INITIAL_TRAVEL = 0.3;
/** Debris travels fastest at the start of the burst, then coasts. */
const debrisEase = (t: number) => 1 - Math.pow(1 - t, 2.2);
/** Progress past which the pieces start fading out. */
const DEBRIS_FADE_START = 0.55;
/** Alpha the last shatter frame lands on, handing off to the wreckage decal. */
const DEBRIS_FINAL_ALPHA = 0.22;
/** Bright impact flash, brief enough to live only in the first two frames. */
const IMPACT_FLASH_PROGRESS_END = 0.3;

function buildDebris(seed: number): DebrisSpec[] {
  const rng = makeRng(seed);
  const out: DebrisSpec[] = [];
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const isIron = i % 5 === 4;
    out.push({
      angle: (i / DEBRIS_COUNT) * TWO_PI + rng() * 0.5,
      distance: DEBRIS_SPREAD_PX * (0.45 + rng() * 0.75),
      originY: 0,
      restAngle: 0,
      length: isIron ? 9 + rng() * 5 : 7 + rng() * 9,
      width: isIron ? 2.5 : 2.5 + rng() * 3,
      spin: (rng() - 0.5) * 7,
      shade: WOOD_RAMP[Math.floor(rng() * WOOD_RAMP.length)],
      isIron,
    });
  }
  return out;
}

// ── Pole debris ───────────────────────────────────────────────────────────────
// A haft breaks nothing like a box. Its pieces come off all the way up the pole
// and are flung sideways off it, so they stay a tall narrow column of near-
// vertical slivers rather than opening into the boxy props' radial ring.

const TORCH_DEBRIS_COUNT = 18;
/** How far the pieces' origins spread along the haft, in tile heights. */
const TORCH_DEBRIS_ORIGIN_SPAN_TILES = 1.05;
/** Sideways fling, well short of DEBRIS_SPREAD_PX: a pole is a narrow thing. */
const TORCH_DEBRIS_SPREAD_PX = 15;
/** Half-angle of the sideways cone the pieces are thrown into, off horizontal. */
const TORCH_DEBRIS_CONE_HALF_ANGLE = Math.PI / 3;
/** One piece in six is a ferrule or a scrap off the fire bowl. */
const TORCH_DEBRIS_IRON_PERIOD = 6;
const TORCH_SPLINTER_LENGTH_MIN = 9;
const TORCH_SPLINTER_LENGTH_SPREAD = 10;
const TORCH_SPLINTER_WIDTH_MIN = 1.7;
const TORCH_SPLINTER_WIDTH_SPREAD = 1.6;
/** Slivers off a pole lie near-vertical, wobbling this far either side of it. */
const TORCH_SPLINTER_TILT = 0.5;
const TORCH_SPLINTER_SPIN_MAX = 4;
const QUARTER_TURN = Math.PI / 2;

function buildTorchDebris(seed: number): DebrisSpec[] {
  const rng = makeRng(seed);
  const out: DebrisSpec[] = [];
  for (let i = 0; i < TORCH_DEBRIS_COUNT; i++) {
    const isIron = i % TORCH_DEBRIS_IRON_PERIOD === TORCH_DEBRIS_IRON_PERIOD - 1;
    const thrownLeft = i % 2 === 0;
    const offHorizontal = (rng() - 0.5) * 2 * TORCH_DEBRIS_CONE_HALF_ANGLE;
    // Origins walk the pole in order, jittered inside their own slot, so the
    // column stays evenly populated instead of clumping.
    const alongPole = (i + rng()) / TORCH_DEBRIS_COUNT - 0.5;
    out.push({
      angle: (thrownLeft ? Math.PI : 0) + offHorizontal,
      distance: TORCH_DEBRIS_SPREAD_PX * (0.4 + rng() * 0.9),
      originY: alongPole * TORCH_DEBRIS_ORIGIN_SPAN_TILES,
      restAngle: isIron ? 0 : QUARTER_TURN + (rng() - 0.5) * 2 * TORCH_SPLINTER_TILT,
      length: isIron
        ? 7 + rng() * 4
        : TORCH_SPLINTER_LENGTH_MIN + rng() * TORCH_SPLINTER_LENGTH_SPREAD,
      width: isIron ? 2.5 : TORCH_SPLINTER_WIDTH_MIN + rng() * TORCH_SPLINTER_WIDTH_SPREAD,
      spin: (rng() - 0.5) * TORCH_SPLINTER_SPIN_MAX,
      shade: WOOD_RAMP[Math.floor(rng() * WOOD_RAMP.length)],
      isIron,
    });
  }
  return out;
}

const BARREL_DEBRIS = buildDebris(0x1177);
const BARREL_SIDE_DEBRIS = buildDebris(0x2288);
const CRATE_DEBRIS = buildDebris(0x3399);
const TORCH_DEBRIS = buildTorchDebris(0x44aa);

function debrisFor(kind: PropKind): DebrisSpec[] {
  if (kind === 'barrel') return BARREL_DEBRIS;
  if (kind === 'barrel_side') return BARREL_SIDE_DEBRIS;
  if (kind === 'torch') return TORCH_DEBRIS;
  return CRATE_DEBRIS;
}

/** Ember puffs stacked up the torch's haft, tracking the column of debris. */
const TORCH_CLOUD_PUFF_COUNT = 3;
/** Narrower than the boxy props' single cloud, so the column stays a column. */
const TORCH_CLOUD_RADIUS_SCALE = 0.55;

/**
 * The cloud the pieces come out of: one round puff of sawdust for a box, a
 * stack of ember puffs up the pole for a torch.
 */
function burstCloud(
  ctx: NodeCtx,
  kind: PropKind,
  cx: number,
  cy: number,
  ts: number,
  radiusFraction: number,
  alpha: number,
): void {
  if (kind !== 'torch') {
    puff(ctx, cx, cy, ts * radiusFraction, alpha, DUST_RGB);
    return;
  }
  const radius = ts * radiusFraction * TORCH_CLOUD_RADIUS_SCALE;
  for (let i = 0; i < TORCH_CLOUD_PUFF_COUNT; i++) {
    const alongPole = i / (TORCH_CLOUD_PUFF_COUNT - 1) - 0.5;
    puff(ctx, cx, cy + alongPole * ts * TORCH_DEBRIS_ORIGIN_SPAN_TILES, radius, alpha, EMBER_RGB);
  }
}

/**
 * One frame of the break. `progress` runs 0→1 across the six shatter frames:
 * the pieces burst outward, tumble apart, then fall and fade.
 */
function drawShatterFrame(
  ctx: NodeCtx,
  kind: PropKind,
  ox: number,
  oy: number,
  ts: number,
  progress: number,
): void {
  const isPole = kind === 'torch';
  const cx = ox + ts / 2;
  // Centre of the tile, not of the prop's silhouette: the burst has to stay
  // visually anchored to the tile the prop occupied.
  const cy = oy + ts * (isPole ? TORCH_BURST_CENTER_Y_FRACTION : BURST_CENTER_Y_FRACTION);
  const travel = lerp(DEBRIS_INITIAL_TRAVEL, 1, debrisEase(progress));

  // Dust sits behind the wood and only lives through the middle of the burst.
  const dustAlpha = Math.sin(Math.min(1, progress * 1.6) * Math.PI) * 0.5;
  if (dustAlpha > 0.01) {
    burstCloud(ctx, kind, cx, cy, ts, 0.28 + travel * 0.42, dustAlpha);
  }

  if (progress < IMPACT_FLASH_PROGRESS_END) {
    const flash = 1 - progress / IMPACT_FLASH_PROGRESS_END;
    burstCloud(ctx, kind, cx, cy, ts, 0.3, flash * 0.75);
  }

  const alpha =
    progress <= DEBRIS_FADE_START
      ? 1
      : lerp(1, DEBRIS_FINAL_ALPHA, (progress - DEBRIS_FADE_START) / (1 - DEBRIS_FADE_START));

  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  for (const d of debrisFor(kind)) {
    const dist = d.distance * travel;
    const px = cx + Math.cos(d.angle) * dist;
    // Pieces are thrown up first and pulled back down as the burst settles.
    const py =
      cy +
      d.originY * ts +
      Math.sin(d.angle) * dist * DEBRIS_VERTICAL_SQUASH -
      DEBRIS_RISE_PX * Math.sin(progress * Math.PI) +
      DEBRIS_FALL_PX * progress * progress;
    if (d.isIron) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(d.restAngle + d.spin * progress);
      ctx.strokeStyle = IRON_MID;
      ctx.lineWidth = d.width;
      ctx.beginPath();
      ctx.arc(0, 0, d.length * 0.6, 0.4, 2.6);
      ctx.stroke();
      ctx.restore();
    } else {
      shard(ctx, px, py, d.length, d.width, d.restAngle + d.spin * progress, d.shade);
    }
  }
  ctx.restore();
}

// ── Remains ───────────────────────────────────────────────────────────────────
// Flat wreckage with no vertical volume, so the tile still reads as walkable.

interface RemainsPlank {
  dx: number;
  dy: number;
  length: number;
  width: number;
  angle: number;
  shade: string;
}

function buildRemains(seed: number, plankCount: number): RemainsPlank[] {
  const rng = makeRng(seed);
  const out: RemainsPlank[] = [];
  for (let i = 0; i < plankCount; i++) {
    const a = (i / plankCount) * TWO_PI + rng() * 0.8;
    const r = 4 + rng() * 12;
    out.push({
      dx: Math.cos(a) * r,
      dy: Math.sin(a) * r * 0.5,
      length: 10 + rng() * 12,
      width: 2.5 + rng() * 2.5,
      angle: rng() * Math.PI,
      shade: WOOD_RAMP[1 + Math.floor(rng() * 3)],
    });
  }
  return out;
}

const REMAINS_PLANK_COUNT = 9;
const BARREL_REMAINS = buildRemains(0x4411, REMAINS_PLANK_COUNT);
const BARREL_SIDE_REMAINS = buildRemains(0x5522, REMAINS_PLANK_COUNT);
const CRATE_REMAINS = buildRemains(0x6633, REMAINS_PLANK_COUNT);
/** A haft is one long stick, so it leaves fewer and shorter pieces than a box. */
const TORCH_REMAINS_PLANK_COUNT = 7;
const TORCH_REMAINS = buildRemains(0x7755, TORCH_REMAINS_PLANK_COUNT);

function remainsFor(kind: PropKind): RemainsPlank[] {
  if (kind === 'barrel') return BARREL_REMAINS;
  if (kind === 'barrel_side') return BARREL_SIDE_REMAINS;
  if (kind === 'torch') return TORCH_REMAINS;
  return CRATE_REMAINS;
}

/** Scorch left where a torch's bowl tipped its coals onto the floor. */
const SCORCH_RX_TILE_FRACTION = 0.3;
const SCORCH_RY_TILE_FRACTION = 0.15;
const SCORCH_ALPHA = 0.5;
const DYING_EMBER_COUNT = 9;
const DYING_EMBER_SPREAD_TILE_FRACTION = 0.26;
const DYING_EMBER_MAX_RADIUS = 1.6;

function drawTorchScorch(
  ctx: NodeCtx,
  cx: number,
  cy: number,
  ts: number,
  rng: () => number,
): void {
  ctx.save();
  ctx.globalAlpha = SCORCH_ALPHA;
  ctx.fillStyle = SOOT;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ts * SCORCH_RX_TILE_FRACTION, ts * SCORCH_RY_TILE_FRACTION, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < DYING_EMBER_COUNT; i++) {
    const angle = rng() * TWO_PI;
    const reach = Math.sqrt(rng()) * ts * DYING_EMBER_SPREAD_TILE_FRACTION;
    ctx.save();
    ctx.globalAlpha = 0.35 + rng() * 0.5;
    ctx.fillStyle = rng() < 0.35 ? FLAME_HOT : FLAME_OUTER;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach * 0.5,
      0.7 + rng() * DYING_EMBER_MAX_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }
}

function drawRemains(ctx: NodeCtx, kind: PropKind, ox: number, oy: number, ts: number): void {
  const rng = makeRng(0x7744 + kind.length);
  const cx = ox + ts / 2;
  const cy = oy + ts * 0.6;

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2, ts * 0.34, ts * 0.17, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  if (kind === 'torch') drawTorchScorch(ctx, cx, cy, ts, rng);

  // A bent hoop / broken bracket / crushed fire bowl, whichever the prop had.
  ctx.save();
  ctx.strokeStyle = IRON_MID;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (kind === 'crate') {
    ctx.moveTo(cx - 14, cy + 7);
    ctx.quadraticCurveTo(cx - 2, cy + 12, cx + 13, cy + 5);
  } else if (kind === 'torch') {
    ctx.ellipse(cx - 6, cy + 4, 9, 4, -0.35, 0, Math.PI * 1.3);
  } else {
    ctx.ellipse(cx + 2, cy + 3, 15, 6, 0.2, 0.3, Math.PI * 1.75);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = IRON_SPEC;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();

  for (const p of remainsFor(kind)) {
    shard(ctx, cx + p.dx, cy + p.dy, p.length, p.width, p.angle, p.shade);
  }

  sawdust(ctx, cx, cy, ts * 0.34, rng);
}

// ── Sheet assembly ────────────────────────────────────────────────────────────

function drawProp(
  ctx: NodeCtx,
  kind: PropKind,
  state: PropState,
  frame: number,
  ox: number,
  oy: number,
  ts: number,
): void {
  if (state === 'shatter') {
    const progress = SHATTER_FRAMES > 1 ? frame / (SHATTER_FRAMES - 1) : 0;
    drawShatterFrame(ctx, kind, ox, oy, ts, progress);
    return;
  }
  if (state === 'remains') {
    drawRemains(ctx, kind, ox, oy, ts);
    return;
  }
  const damaged = state === 'damaged';
  if (kind === 'barrel') drawBarrel(ctx, ox, oy, ts, damaged);
  else if (kind === 'barrel_side') drawBarrelSide(ctx, ox, oy, ts, damaged);
  else if (kind === 'torch') drawTorch(ctx, ox, oy, ts, damaged, frame);
  else drawCrate(ctx, ox, oy, ts, damaged);
}

interface SheetRow {
  state: PropState;
  frames: number;
}

/** The boxy props hold a single pose per wear stage. */
const STATIC_ROWS: ReadonlyArray<SheetRow> = [
  { state: 'idle', frames: 1 },
  { state: 'damaged', frames: 1 },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

/** The torch keeps burning at both wear stages, so both loop. */
const TORCH_ROWS: ReadonlyArray<SheetRow> = [
  { state: 'idle', frames: FLAME_FRAMES },
  { state: 'damaged', frames: FLAME_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

function rowsFor(kind: PropKind): ReadonlyArray<SheetRow> {
  return kind === 'torch' ? TORCH_ROWS : STATIC_ROWS;
}

function renderSheet(kind: PropKind): Buffer {
  const { frameW, frameH, tileX, tileY } = frameGeometryFor(kind);
  const rows = rowsFor(kind);
  const cols = Math.max(...rows.map((r) => r.frames));
  const c = createCanvas(cols * frameW, ROW_COUNT * frameH);
  const ctx = c.getContext('2d') as NodeCtx;

  for (let row = 0; row < rows.length; row++) {
    for (let col = 0; col < rows[row].frames; col++) {
      drawProp(
        ctx,
        kind,
        rows[row].state,
        col,
        col * frameW + tileX,
        row * frameH + tileY,
        TILE_SCALE,
      );
    }
  }

  return c.toBuffer('image/png');
}

const outDir = resolve('src/images/environment/props');
const kinds: PropKind[] = ['barrel', 'barrel_side', 'crate', 'torch'];

console.log(`Generating destructible props (tileScale=${TILE_SCALE})…`);

for (let i = 0; i < kinds.length; i++) {
  const kind = kinds[i];
  const { frameW, frameH, tileX, tileY } = frameGeometryFor(kind);
  console.log(
    `  [${i + 1}/${kinds.length}] ${kind}.png — ${frameW}×${frameH}px frames, tileX=${tileX} tileY=${tileY}`,
  );
  writeFileSync(resolve(outDir, `${kind}.png`), renderSheet(kind));
}

console.log(`\nDone. Sheets written to ${outDir}`);
console.log('Rows: 0 idle, 1 damaged, 2 shatter (6 frames), 3 remains');
