/**
 * Drawing engine for Krakaren Clone's flooded clone lab.
 *
 * Someone grew a copy of the Krakaren here and the tank failed. Everything in
 * the room is painted from one cold steel ramp, one sick-pink ramp for the
 * growth medium and the flood, and a single warning yellow, so the lab reads as
 * one facility and the pink reads as *her* — the same pink her own art is lit
 * with.
 *
 * Every measurement is a fraction of the caller's `ts` (the logical tile), and
 * every painter is handed the anchor tile's top-left corner. Light comes from
 * the upper left, matching every other prop in the game.
 *
 * These paint prop-sheet cells once, at floor load, so gradients are fine here;
 * nothing in this file runs per frame.
 */

import { mulberry32 } from '../person/rng';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

// ── Palette ──────────────────────────────────────────────────────────────────
const STEEL_EDGE = '#15191e';
const STEEL_DARK = '#2a3139';
const STEEL_MID = '#46505a';
const STEEL_LIGHT = '#6f7b86';
const STEEL_SPEC = '#a9b5bf';
const RIVET = '#8c98a3';

/** The growth medium: her pink, thinned into fluid. */
const MEDIUM_DEEP = '#6e1f47';
const MEDIUM_MID = '#b8467e';
const MEDIUM_LIGHT = '#ec8fbd';
const MEDIUM_GLOW = 'rgba(255, 170, 214, 0.55)';
const MEDIUM_MURK_DEEP = '#3a2233';
const MEDIUM_MURK_MID = '#5d3a4f';

const SPECIMEN_DARK = '#4a0f2c';
const SPECIMEN_MID = '#8d2c5a';
const SPECIMEN_LIGHT = '#c75d8e';
const SPECIMEN_EYE = '#f1e7d4';
const SPECIMEN_PUPIL = '#1a0610';

const GLASS_RIM = 'rgba(214, 240, 255, 0.55)';
const GLASS_GLARE = 'rgba(255, 255, 255, 0.4)';
const GLASS_EDGE_DARK = 'rgba(10, 20, 30, 0.55)';
const GLASS_SHARD = 'rgba(200, 236, 255, 0.85)';
const CRACK_LIGHT = 'rgba(240, 252, 255, 0.95)';

const WARNING_YELLOW = '#d9b23a';
const WARNING_BLACK = '#1b1a16';
const SCREEN_DARK = '#071612';
const SCREEN_GREEN = '#58e0a0';
const SCREEN_CYAN = '#6fd6e8';
const SCREEN_RED = '#ff5a5a';
const LED_GREEN = '#6dff9a';

const SPARK_CORE = '#fffbe0';
const SPARK_HOT = '#ffe36a';
const ARC_CORE = '#f4fdff';
const ARC_GLOW = 'rgba(120, 200, 255, 0.35)';
const ARC_WASH = 'rgba(150, 215, 255, 0.14)';
const WARN_WASH = '#ff4f8a';

const FLESH_OUTLINE = '#2e0617';
const FLESH_DARK = '#6b1a3d';
const FLESH_MID = '#b3406f';
const FLESH_LIGHT = '#e57fa9';
const SUCKER = '#f4b8cf';

const WATER_FOAM = 'rgba(255, 214, 234, 0.85)';
const WATER_SPRAY = 'rgba(236, 143, 189, 0.8)';

/** Frame counts every sheet plan and every runtime frame pick agree on. */
export const VAT_BUBBLE_FRAMES = 3;
export const VAT_CRACK_FRAMES = 3;
export const VAT_BURST_FRAMES = 4;
export const CONSOLE_SCREEN_FRAMES = 4;
export const JUNCTION_SPARK_FRAMES = 2;
export const FX_SPARK_FRAMES = 4;
export const FX_ARC_FRAMES = 4;
export const FX_WARN_FRAMES = 2;
export const FX_RIPPLE_FRAMES = 4;
export const FX_DRAIN_BURST_FRAMES = 4;
export const FX_DRIP_FRAMES = 4;
export const SPLASH_FRAMES = 4;
export const SEAL_BAR_FRAMES = 4;

// ── Shared helpers ───────────────────────────────────────────────────────────

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** A horizontal steel band lit from above: dark rim, mid body, a bright top edge. */
function steelBand(ctx: Ctx, x: number, y: number, w: number, h: number, ts: number): void {
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, STEEL_LIGHT);
  grad.addColorStop(STEEL_BAND_MID_STOP, STEEL_MID);
  grad.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, ts * STEEL_BAND_CORNER);
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.stroke();
  ctx.fillStyle = STEEL_SPEC;
  ctx.fillRect(
    x + ts * STEEL_BAND_CORNER,
    y + ts * HAIRLINE,
    w - ts * STEEL_BAND_CORNER * 2,
    ts * HAIRLINE,
  );
}
const STEEL_BAND_MID_STOP = 0.45;
const STEEL_BAND_CORNER = 0.05;
const HAIRLINE = 0.035;
const HAIRLINE_THICK = 0.05;

function rivet(ctx: Ctx, x: number, y: number, ts: number): void {
  ctx.fillStyle = RIVET;
  ctx.beginPath();
  ctx.arc(x, y, ts * RIVET_RADIUS, 0, TWO_PI);
  ctx.fill();
}
const RIVET_RADIUS = 0.03;

/** A jagged crack from `(x, y)` wandering `length` along `angle`, forking once. */
function crack(
  ctx: Ctx,
  rng: () => number,
  x: number,
  y: number,
  angle: number,
  length: number,
  ts: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  let px = x;
  let py = y;
  const steps = CRACK_STEPS;
  for (let i = 1; i <= steps; i++) {
    const a = angle + (rng() - HALF) * CRACK_WANDER_RAD;
    px += (Math.cos(a) * length) / steps;
    py += (Math.sin(a) * length) / steps;
    ctx.lineTo(px, py);
  }
  ctx.strokeStyle = CRACK_LIGHT;
  ctx.lineWidth = ts * CRACK_WIDTH;
  ctx.stroke();
}
const CRACK_STEPS = 4;
const CRACK_WANDER_RAD = 1.1;
const CRACK_WIDTH = 0.03;

// ── Clone vat ────────────────────────────────────────────────────────────────

/** Vat geometry in tile fractions, from the anchor tile's top-left; negative is above the tile. */
const VAT = {
  plinthTop: 0.62,
  plinthBottom: 0.97,
  plinthInset: 0.04,
  glassLeft: 0.14,
  glassRight: 0.86,
  glassTop: -0.66,
  glassBottom: 0.64,
  capTop: -0.9,
  capBottom: -0.64,
  capInset: 0.08,
  pipeWidth: 0.12,
  pipeTop: -0.95,
  pipeX: 0.62,
  fluidTop: -0.52,
  meniscus: 0.035,
  glareX: 0.24,
  glareWidth: 0.06,
  rimWidth: 0.03,
  specimenX: 0.5,
  specimenY: -0.08,
  specimenRx: 0.23,
  specimenRy: 0.3,
  specimenBob: 0.025,
  eyeDx: 0.07,
  eyeDy: -0.1,
  eyeR: 0.07,
  pupilR: 0.032,
  tentacleCount: 4,
  tentacleLength: 0.34,
  tentacleWidth: 0.07,
  cordWidth: 0.04,
  bubbleCount: 5,
  bubbleMaxR: 0.035,
  bubbleMinR: 0.015,
  lightGlowR: 0.34,
} as const;

/** Every vat is painted from one seed so the specimens are the same creature at every vat. */
const SPECIMEN_SEED = 0x5c10e7;
const BUBBLE_SEED = 0xb0bb1e;
const CRACK_SEED = 0xc4ac3d;
const SHARD_SEED = 0x54a4d0;

export interface VatPaintOptions {
  /** Whether a failed specimen floats in the medium. */
  readonly specimen: boolean;
  /** 0-based animation frame of the row being painted. */
  readonly frame: number;
}

function vatPlinth(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const x = ox + ts * VAT.plinthInset;
  const w = ts * (1 - VAT.plinthInset * 2);
  const y = oy + ts * VAT.plinthTop;
  const h = ts * (VAT.plinthBottom - VAT.plinthTop);
  steelBand(ctx, x, y, w, h, ts);
  // A warning collar, so every vat reads as lab equipment at a glance.
  const stripeY = y + h * VAT_STRIPE_TOP;
  const stripeH = h * VAT_STRIPE_HEIGHT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + ts * HAIRLINE, stripeY, w - ts * HAIRLINE * 2, stripeH);
  ctx.clip();
  ctx.fillStyle = WARNING_BLACK;
  ctx.fillRect(x, stripeY, w, stripeH);
  ctx.fillStyle = WARNING_YELLOW;
  const step = ts * VAT_STRIPE_STEP;
  for (let sx = x - stripeH; sx < x + w + stripeH; sx += step * 2) {
    ctx.beginPath();
    ctx.moveTo(sx, stripeY + stripeH);
    ctx.lineTo(sx + step, stripeY + stripeH);
    ctx.lineTo(sx + step + stripeH, stripeY);
    ctx.lineTo(sx + stripeH, stripeY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  rivet(ctx, x + ts * RIVET_INSET, y + h * RIVET_ROW, ts);
  rivet(ctx, x + w - ts * RIVET_INSET, y + h * RIVET_ROW, ts);
}
const VAT_STRIPE_TOP = 0.42;
const VAT_STRIPE_HEIGHT = 0.3;
const VAT_STRIPE_STEP = 0.08;
const RIVET_INSET = 0.07;
const RIVET_ROW = 0.2;

function vatCap(ctx: Ctx, ox: number, oy: number, ts: number): void {
  // A feed pipe into the ceiling, so the vat is plumbed into something.
  const pipeX = ox + ts * VAT.pipeX;
  ctx.fillStyle = STEEL_DARK;
  const pipeTop = oy + ts * VAT.pipeTop;
  const pipeLength = ts * (VAT.capTop - VAT.pipeTop);
  ctx.fillRect(pipeX, pipeTop, ts * VAT.pipeWidth, pipeLength + ts * HAIRLINE);
  ctx.fillStyle = STEEL_LIGHT;
  ctx.fillRect(pipeX, pipeTop, ts * HAIRLINE, pipeLength);
  steelBand(
    ctx,
    ox + ts * VAT.capInset,
    oy + ts * VAT.capTop,
    ts * (1 - VAT.capInset * 2),
    ts * (VAT.capBottom - VAT.capTop),
    ts,
  );
}

function glassBounds(
  ox: number,
  oy: number,
  ts: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: ox + ts * VAT.glassLeft,
    y: oy + ts * VAT.glassTop,
    w: ts * (VAT.glassRight - VAT.glassLeft),
    h: ts * (VAT.glassBottom - VAT.glassTop),
  };
}

function vatMedium(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  murky: boolean,
  fluidTopFrac: number,
): void {
  const g = glassBounds(ox, oy, ts);
  ctx.fillStyle = 'rgba(8, 12, 16, 0.85)';
  ctx.fillRect(g.x, g.y, g.w, g.h);
  const fluidY = oy + ts * fluidTopFrac;
  if (fluidY >= g.y + g.h) return;
  const grad = ctx.createLinearGradient(g.x, fluidY, g.x, g.y + g.h);
  grad.addColorStop(0, murky ? MEDIUM_MURK_MID : MEDIUM_LIGHT);
  grad.addColorStop(MEDIUM_MID_STOP, murky ? MEDIUM_MURK_DEEP : MEDIUM_MID);
  grad.addColorStop(1, murky ? MEDIUM_MURK_DEEP : MEDIUM_DEEP);
  ctx.fillStyle = grad;
  ctx.fillRect(g.x, fluidY, g.w, g.y + g.h - fluidY);
  if (!murky) {
    // The medium is lit from inside: a soft bloom behind the specimen.
    const cx = ox + ts * VAT.specimenX;
    const cy = oy + ts * VAT.specimenY;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * VAT.lightGlowR);
    glow.addColorStop(0, MEDIUM_GLOW);
    glow.addColorStop(1, 'rgba(255, 170, 214, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(g.x, fluidY, g.w, g.y + g.h - fluidY);
  }
  ctx.fillStyle = murky ? 'rgba(160, 120, 140, 0.6)' : 'rgba(255, 220, 238, 0.8)';
  ctx.fillRect(g.x, fluidY, g.w, ts * VAT.meniscus);
}
const MEDIUM_MID_STOP = 0.45;

function vatGlassFront(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const g = glassBounds(ox, oy, ts);
  ctx.fillStyle = GLASS_EDGE_DARK;
  ctx.fillRect(g.x + g.w - ts * VAT.rimWidth * 2, g.y, ts * VAT.rimWidth * 2, g.h);
  ctx.fillStyle = GLASS_RIM;
  ctx.fillRect(g.x, g.y, ts * VAT.rimWidth, g.h);
  ctx.fillStyle = GLASS_GLARE;
  ctx.fillRect(
    ox + ts * VAT.glareX,
    g.y + g.h * GLARE_START,
    ts * VAT.glareWidth,
    g.h * GLARE_LENGTH,
  );
  ctx.fillRect(
    ox + ts * VAT.glareX + ts * VAT.glareWidth * 2,
    g.y + g.h * GLARE_START,
    ts * HAIRLINE,
    g.h * GLARE_SHORT,
  );
}
const GLARE_START = 0.08;
const GLARE_LENGTH = 0.7;
const GLARE_SHORT = 0.35;

/**
 * The failed specimen: a half-formed copy of her, a knot of flesh with one
 * clouded eye and stunted tentacles that never learned to hold anything.
 */
function specimen(ctx: Ctx, cx: number, cy: number, ts: number, slump: number): void {
  const rng = mulberry32(SPECIMEN_SEED);
  const rx = ts * VAT.specimenRx * (1 + slump * SLUMP_WIDEN);
  const ry = ts * VAT.specimenRy * (1 - slump * SLUMP_FLATTEN);
  // Tentacles first, so the body sits over their roots.
  for (let i = 0; i < VAT.tentacleCount; i++) {
    const spread = (i / (VAT.tentacleCount - 1) - HALF) * TENTACLE_FAN;
    const baseX = cx + spread * rx;
    const baseY = cy + ry * TENTACLE_ROOT;
    const len = ts * VAT.tentacleLength * (TENTACLE_MIN_LENGTH + rng() * TENTACLE_LENGTH_SPREAD);
    const droop =
      slump > 0 ? Math.PI * HALF + spread * SLUMP_SPLAY : Math.PI * HALF + spread * TENTACLE_SPLAY;
    const curl = (rng() - HALF) * TENTACLE_CURL;
    const endX = baseX + Math.cos(droop) * len;
    const endY = baseY + Math.sin(droop) * len * (1 - slump * SLUMP_FLATTEN);
    ctx.strokeStyle = SPECIMEN_DARK;
    ctx.lineCap = 'round';
    ctx.lineWidth = ts * VAT.tentacleWidth;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + curl * ts, (baseY + endY) * HALF, endX, endY);
    ctx.stroke();
    ctx.strokeStyle = SPECIMEN_MID;
    ctx.lineWidth = ts * VAT.tentacleWidth * TENTACLE_CORE;
    ctx.stroke();
  }
  const body = ctx.createRadialGradient(
    cx - rx * BODY_LIGHT_OFFSET,
    cy - ry * BODY_LIGHT_OFFSET,
    0,
    cx,
    cy,
    Math.max(rx, ry),
  );
  body.addColorStop(0, SPECIMEN_LIGHT);
  body.addColorStop(BODY_MID_STOP, SPECIMEN_MID);
  body.addColorStop(1, SPECIMEN_DARK);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  // A lumpy second lobe: it never finished becoming one shape.
  ctx.beginPath();
  ctx.ellipse(
    cx + rx * LOBE_DX,
    cy - ry * LOBE_DY,
    rx * LOBE_SCALE,
    ry * LOBE_SCALE,
    LOBE_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  if (slump < 1) {
    const eyeX = cx - ts * VAT.eyeDx;
    const eyeY = cy + ts * VAT.eyeDy;
    ctx.fillStyle = SPECIMEN_EYE;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, ts * VAT.eyeR, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SPECIMEN_PUPIL;
    ctx.beginPath();
    ctx.ellipse(
      eyeX + ts * PUPIL_SHIFT,
      eyeY,
      ts * VAT.pupilR * PUPIL_SLIT,
      ts * VAT.pupilR,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  } else {
    // Dead: the eye is a closed seam.
    ctx.strokeStyle = SPECIMEN_DARK;
    ctx.lineWidth = ts * HAIRLINE;
    ctx.beginPath();
    ctx.moveTo(cx - ts * VAT.eyeDx - ts * VAT.eyeR, cy + ts * VAT.eyeDy);
    ctx.lineTo(cx - ts * VAT.eyeDx + ts * VAT.eyeR, cy + ts * VAT.eyeDy);
    ctx.stroke();
  }
}
const SLUMP_WIDEN = 0.5;
const SLUMP_FLATTEN = 0.5;
const TENTACLE_FAN = 1.6;
const TENTACLE_ROOT = 0.55;
const TENTACLE_MIN_LENGTH = 0.7;
const TENTACLE_LENGTH_SPREAD = 0.5;
const TENTACLE_SPLAY = 0.8;
const SLUMP_SPLAY = 2.2;
const TENTACLE_CURL = 0.25;
const TENTACLE_CORE = 0.5;
const BODY_LIGHT_OFFSET = 0.35;
const BODY_MID_STOP = 0.55;
const LOBE_DX = 0.55;
const LOBE_DY = 0.45;
const LOBE_SCALE = 0.55;
const LOBE_TILT = 0.5;
const PUPIL_SHIFT = 0.012;
const PUPIL_SLIT = 0.55;

function bubbles(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  frame: number,
  murky: boolean,
): void {
  const g = glassBounds(ox, oy, ts);
  const rng = mulberry32(BUBBLE_SEED);
  const fluidTop = oy + ts * VAT.fluidTop;
  const travel = g.y + g.h - fluidTop;
  ctx.fillStyle = murky ? 'rgba(200, 170, 185, 0.55)' : 'rgba(255, 236, 246, 0.8)';
  for (let i = 0; i < VAT.bubbleCount; i++) {
    const x = g.x + g.w * (BUBBLE_MARGIN + rng() * (1 - BUBBLE_MARGIN * 2));
    const phase = rng();
    const rise = (phase + frame / VAT_BUBBLE_FRAMES) % 1;
    const y = g.y + g.h - travel * rise - ts * BUBBLE_BASE_LIFT;
    const r = ts * (VAT.bubbleMinR + rng() * (VAT.bubbleMaxR - VAT.bubbleMinR));
    if (y < fluidTop) continue;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }
}
const BUBBLE_MARGIN = 0.15;
const BUBBLE_BASE_LIFT = 0.05;

/** An intact vat, bubbling. */
export function paintVatIntact(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  options: VatPaintOptions,
): void {
  const murky = !options.specimen;
  vatPlinth(ctx, ox, oy, ts);
  vatMedium(ctx, ox, oy, ts, murky, VAT.fluidTop);
  if (options.specimen) {
    const bob = Math.sin((options.frame / VAT_BUBBLE_FRAMES) * TWO_PI) * ts * VAT.specimenBob;
    specimen(ctx, ox + ts * VAT.specimenX, oy + ts * VAT.specimenY + bob, ts, 0);
    ctx.strokeStyle = SPECIMEN_DARK;
    ctx.lineWidth = ts * VAT.cordWidth;
    ctx.beginPath();
    ctx.moveTo(ox + ts * VAT.specimenX, oy + ts * VAT.capBottom);
    ctx.quadraticCurveTo(
      ox + ts * (VAT.specimenX + CORD_SWAY),
      oy + ts * (VAT.capBottom + VAT.specimenY) * HALF,
      ox + ts * VAT.specimenX,
      oy + ts * (VAT.specimenY - VAT.specimenRy) + bob,
    );
    ctx.stroke();
  } else {
    // Something dissolved in there: shreds hanging in the murk.
    const rng = mulberry32(SHARD_SEED);
    ctx.fillStyle = 'rgba(120, 60, 90, 0.6)';
    for (let i = 0; i < MURK_SHRED_COUNT; i++) {
      const x =
        ox +
        ts *
          (VAT.glassLeft +
            MURK_MARGIN +
            rng() * (VAT.glassRight - VAT.glassLeft - MURK_MARGIN * 2));
      const y =
        oy +
        ts *
          (VAT.fluidTop + MURK_MARGIN + rng() * (VAT.glassBottom - VAT.fluidTop - MURK_MARGIN * 2));
      ctx.fillRect(
        x,
        y + ((options.frame + i) % VAT_BUBBLE_FRAMES) * ts * HAIRLINE,
        ts * MURK_SHRED_W,
        ts * MURK_SHRED_H,
      );
    }
  }
  bubbles(ctx, ox, oy, ts, options.frame, murky);
  vatGlassFront(ctx, ox, oy, ts);
  vatCap(ctx, ox, oy, ts);
}
const CORD_SWAY = 0.08;
const MURK_SHRED_COUNT = 6;
const MURK_MARGIN = 0.06;
const MURK_SHRED_W = 0.08;
const MURK_SHRED_H = 0.04;

/** Cracks spreading across the glass, with jets of medium leaking out. */
export function paintVatCracking(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  options: VatPaintOptions,
): void {
  paintVatIntact(ctx, ox, oy, ts, { specimen: options.specimen, frame: options.frame });
  const g = glassBounds(ox, oy, ts);
  const rng = mulberry32(CRACK_SEED);
  const cracks = CRACK_BASE_COUNT + options.frame * CRACK_GROWTH;
  const reach = (options.frame + 1) / VAT_CRACK_FRAMES;
  const hitX = g.x + g.w * CRACK_ORIGIN_X;
  const hitY = g.y + g.h * CRACK_ORIGIN_Y;
  for (let i = 0; i < cracks; i++) {
    const angle = rng() * TWO_PI;
    crack(
      ctx,
      rng,
      hitX,
      hitY,
      angle,
      g.h * CRACK_REACH * reach * (CRACK_MIN + rng() * (1 - CRACK_MIN)),
      ts,
    );
  }
  // Leaks: thin jets of pink running from the crack's heart down the glass.
  ctx.strokeStyle = WATER_SPRAY;
  ctx.lineWidth = ts * JET_WIDTH;
  for (let i = 0; i <= options.frame; i++) {
    const jx = hitX + (i - HALF) * ts * JET_SPACING;
    ctx.beginPath();
    ctx.moveTo(jx, hitY);
    ctx.quadraticCurveTo(
      jx + ts * JET_ARC,
      hitY + ts * JET_DROP * HALF,
      jx + ts * JET_ARC * HALF,
      oy + ts * VAT.plinthTop,
    );
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(236, 143, 189, 0.5)';
  ctx.beginPath();
  ctx.ellipse(
    ox + ts * HALF,
    oy + ts * PUDDLE_Y,
    ts * PUDDLE_RX * reach,
    ts * PUDDLE_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}
const CRACK_BASE_COUNT = 3;
const CRACK_GROWTH = 2;
const CRACK_ORIGIN_X = 0.62;
const CRACK_ORIGIN_Y = 0.55;
const CRACK_REACH = 0.55;
const CRACK_MIN = 0.4;
const JET_WIDTH = 0.045;
const JET_SPACING = 0.12;
const JET_ARC = 0.1;
const JET_DROP = 0.4;
const PUDDLE_Y = 0.9;
const PUDDLE_RX = 0.45;
const PUDDLE_RY = 0.08;

/** The glass giving way: shards flying, the medium collapsing out of the frame. */
export function paintVatBurst(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  options: VatPaintOptions,
): void {
  const t = (options.frame + 1) / VAT_BURST_FRAMES;
  vatPlinth(ctx, ox, oy, ts);
  const fluidTop = VAT.fluidTop + (VAT.glassBottom - VAT.fluidTop) * t;
  vatMedium(ctx, ox, oy, ts, !options.specimen, fluidTop);
  if (options.specimen) {
    const cy = oy + ts * (VAT.specimenY + (SLUMPED_Y - VAT.specimenY) * t);
    specimen(ctx, ox + ts * VAT.specimenX, cy, ts, t);
  }
  brokenGlassStubs(ctx, ox, oy, ts);
  vatCap(ctx, ox, oy, ts);
  // Shards and a burst of medium flung outward, fading as they fly.
  const rng = mulberry32(SHARD_SEED + options.frame);
  const cx = ox + ts * HALF;
  const cy = oy + ts * BURST_CENTRE_Y;
  const fade = 1 - t * BURST_FADE;
  for (let i = 0; i < BURST_SHARDS; i++) {
    const a = rng() * TWO_PI;
    const d = ts * BURST_REACH * (t * (BURST_MIN_TRAVEL + rng() * (1 - BURST_MIN_TRAVEL)));
    const sx = cx + Math.cos(a) * d * BURST_SQUASH_X;
    const sy = cy + Math.sin(a) * d + ts * BURST_FALL * t * t;
    const size = ts * (BURST_SHARD_MIN + rng() * BURST_SHARD_SPREAD);
    ctx.fillStyle = i % 2 === 0 ? `rgba(200, 236, 255, ${fade})` : `rgba(236, 143, 189, ${fade})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy - size);
    ctx.lineTo(sx + size * SHARD_WIDTH, sy + size * HALF);
    ctx.lineTo(sx - size * SHARD_WIDTH, sy + size * HALF);
    ctx.closePath();
    ctx.fill();
  }
}
const SLUMPED_Y = 0.42;
const BURST_CENTRE_Y = -0.05;
const BURST_FADE = 0.7;
const BURST_SHARDS = 16;
const BURST_REACH = 0.62;
const BURST_MIN_TRAVEL = 0.35;
const BURST_SQUASH_X = 0.75;
const BURST_FALL = 0.35;
const BURST_SHARD_MIN = 0.04;
const BURST_SHARD_SPREAD = 0.06;
const SHARD_WIDTH = 0.6;

function brokenGlassStubs(ctx: Ctx, ox: number, oy: number, ts: number): void {
  const g = glassBounds(ox, oy, ts);
  const rng = mulberry32(SHARD_SEED);
  ctx.fillStyle = GLASS_SHARD;
  // Jagged teeth left standing in the plinth ring and hanging from the cap.
  const teeth = STUB_TEETH;
  for (let i = 0; i < teeth; i++) {
    const x0 = g.x + (g.w * i) / teeth;
    const x1 = g.x + (g.w * (i + 1)) / teeth;
    const tipLow = oy + ts * VAT.glassBottom - ts * (STUB_MIN + rng() * STUB_SPREAD);
    ctx.beginPath();
    ctx.moveTo(x0, oy + ts * VAT.glassBottom);
    ctx.lineTo((x0 + x1) * HALF, tipLow);
    ctx.lineTo(x1, oy + ts * VAT.glassBottom);
    ctx.closePath();
    ctx.globalAlpha = STUB_ALPHA;
    ctx.fill();
    const tipHigh = g.y + ts * (STUB_MIN + rng() * STUB_SPREAD);
    ctx.beginPath();
    ctx.moveTo(x0, g.y);
    ctx.lineTo((x0 + x1) * HALF, tipHigh);
    ctx.lineTo(x1, g.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = GLASS_RIM;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.strokeRect(g.x, g.y, g.w, g.h);
}
const STUB_TEETH = 5;
const STUB_MIN = 0.06;
const STUB_SPREAD = 0.14;
const STUB_ALPHA = 0.8;

/** A burst vat: an empty frame of glass teeth, the specimen slumped dead on the plinth. */
export function paintVatBroken(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  options: VatPaintOptions,
): void {
  vatPlinth(ctx, ox, oy, ts);
  const g = glassBounds(ox, oy, ts);
  ctx.fillStyle = 'rgba(8, 12, 16, 0.75)';
  ctx.fillRect(g.x, g.y, g.w, g.h);
  // Medium still dripping down the inside of the glass.
  ctx.fillStyle = 'rgba(184, 70, 126, 0.55)';
  const rng = mulberry32(CRACK_SEED);
  for (let i = 0; i < RESIDUE_STREAKS; i++) {
    const x = g.x + g.w * rng();
    ctx.fillRect(
      x,
      g.y + g.h * rng() * HALF,
      ts * HAIRLINE * 2,
      g.h * (RESIDUE_MIN + rng() * RESIDUE_SPREAD),
    );
  }
  ctx.fillStyle = 'rgba(110, 31, 71, 0.8)';
  ctx.fillRect(g.x, g.y + g.h - ts * RESIDUE_POOL, g.w, ts * RESIDUE_POOL);
  if (options.specimen) specimen(ctx, ox + ts * VAT.specimenX, oy + ts * SLUMPED_Y, ts, 1);
  brokenGlassStubs(ctx, ox, oy, ts);
  vatCap(ctx, ox, oy, ts);
}
const RESIDUE_STREAKS = 6;
const RESIDUE_MIN = 0.2;
const RESIDUE_SPREAD = 0.5;
const RESIDUE_POOL = 0.08;

// ── Console ──────────────────────────────────────────────────────────────────

const CONSOLE = {
  deskTop: 0.3,
  deskBottom: 0.96,
  deskInset: 0.06,
  panelTop: 0.14,
  monitorTop: -0.4,
  monitorBottom: 0.18,
  monitorInset: 0.14,
  screenInset: 0.05,
  ventRows: 3,
  ventTop: 0.58,
  ventGap: 0.1,
  ventWidth: 0.44,
  buttonY: 0.22,
  buttonR: 0.028,
} as const;

/** A waist-high lab console, its monitor showing her vitals. */
export function paintConsole(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const dx = ox + ts * CONSOLE.deskInset;
  const dw = ts * (1 - CONSOLE.deskInset * 2);
  steelBand(
    ctx,
    dx,
    oy + ts * CONSOLE.deskTop,
    dw,
    ts * (CONSOLE.deskBottom - CONSOLE.deskTop),
    ts,
  );
  ctx.fillStyle = STEEL_EDGE;
  for (let i = 0; i < CONSOLE.ventRows; i++) {
    ctx.fillRect(
      ox + ts * (HALF - CONSOLE.ventWidth * HALF),
      oy + ts * (CONSOLE.ventTop + i * CONSOLE.ventGap),
      ts * CONSOLE.ventWidth,
      ts * HAIRLINE * 2,
    );
  }
  // The slanted control panel.
  ctx.fillStyle = STEEL_MID;
  ctx.beginPath();
  ctx.moveTo(dx, oy + ts * CONSOLE.deskTop);
  ctx.lineTo(dx + ts * PANEL_LEAN, oy + ts * CONSOLE.panelTop);
  ctx.lineTo(dx + dw - ts * PANEL_LEAN, oy + ts * CONSOLE.panelTop);
  ctx.lineTo(dx + dw, oy + ts * CONSOLE.deskTop);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.stroke();
  const buttons = [SCREEN_RED, WARNING_YELLOW, SCREEN_GREEN, SCREEN_CYAN];
  buttons.forEach((color, i) => {
    const lit = (frame + i) % CONSOLE_SCREEN_FRAMES !== 0;
    ctx.fillStyle = lit ? color : STEEL_DARK;
    ctx.beginPath();
    ctx.arc(
      dx + dw * (BUTTON_FIRST + i * BUTTON_STEP),
      oy + ts * CONSOLE.buttonY,
      ts * CONSOLE.buttonR,
      0,
      TWO_PI,
    );
    ctx.fill();
  });
  // Monitor housing on a short neck.
  const mx = ox + ts * CONSOLE.monitorInset;
  const mw = ts * (1 - CONSOLE.monitorInset * 2);
  const my = oy + ts * CONSOLE.monitorTop;
  const mh = ts * (CONSOLE.monitorBottom - CONSOLE.monitorTop - PANEL_NECK);
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(ox + ts * (HALF - NECK_HALF), my + mh, ts * NECK_HALF * 2, ts * PANEL_NECK);
  steelBand(ctx, mx, my, mw, mh, ts);
  const sx = mx + ts * CONSOLE.screenInset;
  const sy = my + ts * CONSOLE.screenInset;
  const sw = mw - ts * CONSOLE.screenInset * 2;
  const sh = mh - ts * CONSOLE.screenInset * 2;
  ctx.fillStyle = SCREEN_DARK;
  ctx.fillRect(sx, sy, sw, sh);
  const glitch = frame === CONSOLE_GLITCH_FRAME;
  // Her vitals: a trace that scrolls a quarter-screen each frame.
  ctx.strokeStyle = glitch ? SCREEN_RED : SCREEN_GREEN;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.beginPath();
  const samples = TRACE_SAMPLES;
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const phase = u * TWO_PI * TRACE_CYCLES + (frame / CONSOLE_SCREEN_FRAMES) * TWO_PI;
    const spike = Math.sin(phase) > TRACE_SPIKE_THRESHOLD ? TRACE_SPIKE : 0;
    const y =
      sy + sh * (TRACE_BASELINE - spike - Math.sin(phase * TRACE_WOBBLE) * TRACE_WOBBLE_AMP);
    if (i === 0) ctx.moveTo(sx + sw * u, y);
    else ctx.lineTo(sx + sw * u, y);
  }
  ctx.stroke();
  // Readout lines under the trace.
  ctx.fillStyle = glitch ? 'rgba(255, 90, 90, 0.7)' : SCREEN_CYAN;
  const rng = mulberry32(CONSOLE_TEXT_SEED + frame);
  for (let i = 0; i < READOUT_LINES; i++) {
    const w = sw * (READOUT_MIN + rng() * READOUT_SPREAD);
    ctx.fillRect(sx + ts * HAIRLINE, sy + sh * (READOUT_TOP + i * READOUT_GAP), w, ts * HAIRLINE);
  }
  // Scanline glow, strongest on the glitch frame.
  ctx.fillStyle = glitch ? 'rgba(255, 120, 120, 0.2)' : 'rgba(88, 224, 160, 0.1)';
  ctx.fillRect(sx, sy, sw, sh);
}
const PANEL_LEAN = 0.05;
const PANEL_NECK = 0.06;
const NECK_HALF = 0.08;
const BUTTON_FIRST = 0.2;
const BUTTON_STEP = 0.2;
const CONSOLE_GLITCH_FRAME = 2;
const TRACE_SAMPLES = 24;
const TRACE_CYCLES = 2;
const TRACE_SPIKE_THRESHOLD = 0.92;
const TRACE_SPIKE = 0.22;
const TRACE_BASELINE = 0.38;
const TRACE_WOBBLE = 3;
const TRACE_WOBBLE_AMP = 0.05;
const CONSOLE_TEXT_SEED = 0x7e47;
const READOUT_LINES = 3;
const READOUT_MIN = 0.3;
const READOUT_SPREAD = 0.55;
const READOUT_TOP = 0.62;
const READOUT_GAP = 0.13;

// ── Junction box ─────────────────────────────────────────────────────────────

const JUNCTION = {
  left: 0.22,
  right: 0.78,
  top: 0.12,
  bottom: 0.78,
  conduitWidth: 0.1,
  ledR: 0.035,
} as const;

export type JunctionState = 'intact' | 'sparking' | 'broken';

/** The breaker box the live cable runs from; smash it and the cable goes dead. */
export function paintJunctionBox(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  state: JunctionState,
  frame: number,
): void {
  const x = ox + ts * JUNCTION.left;
  const y = oy + ts * JUNCTION.top;
  const w = ts * (JUNCTION.right - JUNCTION.left);
  const h = ts * (JUNCTION.bottom - JUNCTION.top);
  // Conduit feeding down into the floor, where the cable picks up.
  ctx.fillStyle = WARNING_BLACK;
  ctx.fillRect(
    ox + ts * (HALF - JUNCTION.conduitWidth * HALF),
    y + h,
    ts * JUNCTION.conduitWidth,
    ts * (1 - JUNCTION.bottom),
  );
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x + ts * SHADOW_OFFSET, y + ts * SHADOW_OFFSET, w, h);
  steelBand(ctx, x, y, w, h, ts);
  if (state === 'broken') {
    // Lid torn open, the guts charred.
    ctx.fillStyle = '#0c0b0a';
    ctx.fillRect(
      x + ts * HAIRLINE * 2,
      y + ts * HAIRLINE * 2,
      w - ts * HAIRLINE * 4,
      h - ts * HAIRLINE * 4,
    );
    ctx.fillStyle = STEEL_MID;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x - ts * LID_SWING, y + h + ts * LID_DROP);
    ctx.lineTo(x - ts * LID_SWING, y + ts * LID_DROP);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9b3a1c';
    ctx.lineWidth = ts * HAIRLINE * 2;
    for (let i = 0; i < DANGLING_WIRES; i++) {
      ctx.beginPath();
      ctx.moveTo(x + w * (WIRE_FIRST + i * WIRE_STEP), y + h * HALF);
      ctx.quadraticCurveTo(
        x + w * (WIRE_FIRST + i * WIRE_STEP),
        y + h,
        x + w * (WIRE_FIRST + i * WIRE_STEP + WIRE_STEP * HALF),
        y + h + ts * WIRE_HANG,
      );
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20, 16, 14, 0.6)';
    ctx.beginPath();
    ctx.ellipse(x + w * HALF, y - ts * SCORCH_LIFT, w * HALF, ts * SCORCH_RY, 0, 0, TWO_PI);
    ctx.fill();
    return;
  }
  // A lightning-bolt warning placard.
  const cx = x + w * HALF;
  const cy = y + h * PLACARD_Y;
  const s = ts * PLACARD_SIZE;
  ctx.fillStyle = WARNING_YELLOW;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + s, cy + s * PLACARD_BASE);
  ctx.lineTo(cx - s, cy + s * PLACARD_BASE);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = WARNING_BLACK;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.beginPath();
  ctx.moveTo(cx + s * BOLT_A, cy - s * BOLT_TOP);
  ctx.lineTo(cx - s * BOLT_A, cy + s * BOLT_MID);
  ctx.lineTo(cx + s * BOLT_A, cy + s * BOLT_MID);
  ctx.lineTo(cx - s * BOLT_A, cy + s * BOLT_BOTTOM);
  ctx.stroke();
  const ledLit = state === 'intact' || frame % 2 === 0;
  ctx.fillStyle = ledLit ? (state === 'intact' ? LED_GREEN : SCREEN_RED) : STEEL_DARK;
  ctx.beginPath();
  ctx.arc(x + w * LED_X, y + h * LED_Y, ts * JUNCTION.ledR, 0, TWO_PI);
  ctx.fill();
  if (state === 'sparking') {
    const rng = mulberry32(SPARK_SEED + frame);
    sparkBurst(
      ctx,
      rng,
      x + w * (frame === 0 ? SPARK_CORNER_A : SPARK_CORNER_B),
      y + h * SPARK_CORNER_Y,
      ts * SPARK_REACH,
      ts,
    );
  }
}
const SHADOW_OFFSET = 0.04;
const LID_SWING = 0.16;
const LID_DROP = 0.12;
const DANGLING_WIRES = 3;
const WIRE_FIRST = 0.25;
const WIRE_STEP = 0.22;
const WIRE_HANG = 0.12;
const SCORCH_LIFT = 0.03;
const SCORCH_RY = 0.06;
const PLACARD_Y = 0.42;
const PLACARD_SIZE = 0.13;
const PLACARD_BASE = 0.75;
const BOLT_A = 0.18;
const BOLT_TOP = 0.55;
const BOLT_MID = 0.1;
const BOLT_BOTTOM = 0.6;
const LED_X = 0.82;
const LED_Y = 0.85;
const SPARK_SEED = 0x59a4c;
const SPARK_CORNER_A = 0.1;
const SPARK_CORNER_B = 0.9;
const SPARK_CORNER_Y = 0.15;
const SPARK_REACH = 0.22;

function sparkBurst(
  ctx: Ctx,
  rng: () => number,
  x: number,
  y: number,
  reach: number,
  ts: number,
): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
  glow.addColorStop(0, 'rgba(255, 240, 160, 0.7)');
  glow.addColorStop(1, 'rgba(255, 240, 160, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, reach, 0, TWO_PI);
  ctx.fill();
  ctx.lineWidth = ts * HAIRLINE;
  for (let i = 0; i < SPARK_RAYS; i++) {
    const a = rng() * TWO_PI;
    const len = reach * (SPARK_MIN_LEN + rng() * (1 - SPARK_MIN_LEN));
    ctx.strokeStyle = i % 2 === 0 ? SPARK_CORE : SPARK_HOT;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}
const SPARK_RAYS = 7;
const SPARK_MIN_LEN = 0.4;

// ── One-tile effect overlays ─────────────────────────────────────────────────

/** Sparks crawling over a live puddle: the arc's telegraph. */
export function paintSparks(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const rng = mulberry32(SPARK_SEED * 2 + frame);
  ctx.fillStyle = 'rgba(160, 220, 255, 0.16)';
  ctx.fillRect(ox, oy, ts, ts);
  for (let i = 0; i < CRAWL_SPARKS; i++) {
    const x = ox + ts * (EDGE_MARGIN + rng() * (1 - EDGE_MARGIN * 2));
    const y = oy + ts * (EDGE_MARGIN + rng() * (1 - EDGE_MARGIN * 2));
    zigzag(
      ctx,
      rng,
      x,
      y,
      ts * CRAWL_SPARK_LEN,
      i % 2 === 0 ? SPARK_HOT : SPARK_CORE,
      ts * HAIRLINE_THICK,
    );
  }
}
const CRAWL_SPARKS = 4;
const CRAWL_SPARK_LEN = 0.22;
const EDGE_MARGIN = 0.12;

/** The arc itself: the whole puddle lit white-blue with bolts. */
export function paintArc(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const rng = mulberry32(SPARK_SEED * 3 + frame);
  ctx.fillStyle = ARC_WASH;
  ctx.fillRect(ox, oy, ts, ts);
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * HALF);
  glow.addColorStop(0, 'rgba(210, 240, 255, 0.55)');
  glow.addColorStop(1, 'rgba(210, 240, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(ox, oy, ts, ts);
  for (let i = 0; i < ARC_BOLTS; i++) {
    const a = rng() * TWO_PI;
    const x0 = cx - Math.cos(a) * ts * ARC_HALF_SPAN;
    const y0 = cy - Math.sin(a) * ts * ARC_HALF_SPAN;
    zigzag(ctx, rng, x0, y0, ts * ARC_HALF_SPAN * 2, ARC_GLOW, ts * ARC_GLOW_WIDTH, a);
    zigzag(
      ctx,
      mulberry32(SPARK_SEED * 3 + frame * ARC_BOLTS + i),
      x0,
      y0,
      ts * ARC_HALF_SPAN * 2,
      ARC_CORE,
      ts * HAIRLINE * 2,
      a,
    );
  }
}
const ARC_BOLTS = 3;
const ARC_HALF_SPAN = 0.46;
const ARC_GLOW_WIDTH = 0.14;

function zigzag(
  ctx: Ctx,
  rng: () => number,
  x: number,
  y: number,
  length: number,
  color: string,
  width: number,
  heading: number = rng() * TWO_PI,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  let px = x;
  let py = y;
  for (let i = 1; i <= ZIGZAG_STEPS; i++) {
    const a = heading + (rng() - HALF) * ZIGZAG_JITTER;
    px += (Math.cos(a) * length) / ZIGZAG_STEPS;
    py += (Math.sin(a) * length) / ZIGZAG_STEPS;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
}
const ZIGZAG_STEPS = 5;
const ZIGZAG_JITTER = 1.8;

/** The ground a bursting vat is about to sweep: a pulsing warning wash. */
export function paintWarn(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const strong = frame === 1;
  ctx.fillStyle = WARN_WASH;
  ctx.globalAlpha = strong ? WARN_STRONG_ALPHA : WARN_WEAK_ALPHA;
  ctx.fillRect(ox, oy, ts, ts);
  ctx.globalAlpha = 1;
  // Diagonal spray streaks, so the wash reads as "liquid coming this way".
  ctx.strokeStyle = strong ? 'rgba(255, 190, 220, 0.75)' : 'rgba(255, 190, 220, 0.45)';
  ctx.lineWidth = ts * HAIRLINE * 2;
  for (let i = 0; i < WARN_STREAKS; i++) {
    const u = (i + (strong ? HALF : 0)) / WARN_STREAKS;
    ctx.beginPath();
    ctx.moveTo(ox + ts * u, oy + ts * WARN_INSET);
    ctx.lineTo(ox + ts * (u + WARN_STREAK_SLANT), oy + ts * (1 - WARN_INSET));
    ctx.stroke();
  }
}
const WARN_WEAK_ALPHA = 0.22;
const WARN_STRONG_ALPHA = 0.4;
const WARN_STREAKS = 3;
const WARN_INSET = 0.15;
const WARN_STREAK_SLANT = 0.18;

/** A ripple ring spreading on the flood's surface. */
export function paintRipple(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const t = (frame + 1) / FX_RIPPLE_FRAMES;
  ctx.strokeStyle = `rgba(255, 214, 234, ${RIPPLE_ALPHA * (1 - t) + RIPPLE_ALPHA_FLOOR})`;
  ctx.lineWidth = ts * HAIRLINE_THICK;
  ctx.beginPath();
  ctx.ellipse(
    ox + ts * HALF,
    oy + ts * HALF,
    ts * RIPPLE_MAX_R * t,
    ts * RIPPLE_MAX_R * t * RIPPLE_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
}
const RIPPLE_ALPHA = 0.32;
const RIPPLE_ALPHA_FLOOR = 0.1;
const RIPPLE_MAX_R = 0.42;
const RIPPLE_SQUASH = 0.55;

/** A drain grate rattling as something forces its way up through it. */
export function paintDrainBurst(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const t = (frame + 1) / FX_DRAIN_BURST_FRAMES;
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  ctx.fillStyle = `rgba(110, 20, 60, ${DRAIN_DARK_ALPHA * t})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ts * DRAIN_R, ts * DRAIN_R * DRAIN_SQUASH, 0, 0, TWO_PI);
  ctx.fill();
  // Froth boiling up between the bars.
  const rng = mulberry32(DRAIN_SEED + frame);
  for (let i = 0; i < DRAIN_FROTH; i++) {
    const a = rng() * TWO_PI;
    const d = ts * DRAIN_R * rng() * t;
    const r = ts * (DRAIN_BUBBLE_MIN + rng() * DRAIN_BUBBLE_SPREAD) * (HALF + t);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(236, 143, 189, 0.85)' : 'rgba(255, 214, 234, 0.8)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * DRAIN_SQUASH, r, 0, TWO_PI);
    ctx.fill();
  }
  // The grate lifting and the ring it cracks round itself.
  ctx.strokeStyle = `rgba(255, 150, 200, ${DRAIN_RING_ALPHA})`;
  ctx.lineWidth = ts * HAIRLINE * 2;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    ts * DRAIN_RING_R * (HALF + t * HALF),
    ts * DRAIN_RING_R * DRAIN_SQUASH * (HALF + t * HALF),
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
  ctx.strokeStyle = STEEL_LIGHT;
  ctx.lineWidth = ts * HAIRLINE * 2;
  const lift = ts * DRAIN_LIFT * (frame % 2);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + ts * GRATE_BAR_STEP * i, cy - ts * GRATE_BAR_HALF - lift);
    ctx.lineTo(cx + ts * GRATE_BAR_STEP * i, cy + ts * GRATE_BAR_HALF - lift);
    ctx.stroke();
  }
}
const DRAIN_R = 0.34;
const DRAIN_SQUASH = 0.7;
const DRAIN_DARK_ALPHA = 0.7;
const DRAIN_SEED = 0xd4a1;
const DRAIN_FROTH = 9;
const DRAIN_BUBBLE_MIN = 0.03;
const DRAIN_BUBBLE_SPREAD = 0.04;
const DRAIN_RING_ALPHA = 0.9;
const DRAIN_RING_R = 0.4;
const DRAIN_LIFT = 0.05;
const GRATE_BAR_STEP = 0.1;
const GRATE_BAR_HALF = 0.16;

/** Condensation falling from the pipes overhead and landing. */
export function paintDrip(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const cx = ox + ts * HALF;
  if (frame < DRIP_FALL_FRAMES) {
    const y = oy + ts * (DRIP_START + frame * DRIP_STEP);
    ctx.fillStyle = WATER_FOAM;
    ctx.beginPath();
    ctx.ellipse(cx, y, ts * DRIP_R, ts * DRIP_R * DRIP_STRETCH, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 234, 0.35)';
    ctx.fillRect(cx - ts * HAIRLINE * HALF, y - ts * DRIP_TRAIL, ts * HAIRLINE, ts * DRIP_TRAIL);
    return;
  }
  const t = (frame - DRIP_FALL_FRAMES + 1) / (FX_DRIP_FRAMES - DRIP_FALL_FRAMES);
  ctx.strokeStyle = `rgba(255, 214, 234, ${DRIP_RING_ALPHA * (1 - t * HALF)})`;
  ctx.lineWidth = ts * HAIRLINE;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    oy + ts * DRIP_LAND,
    ts * DRIP_RING_R * t,
    ts * DRIP_RING_R * t * RIPPLE_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.stroke();
}
const DRIP_FALL_FRAMES = 2;
const DRIP_START = 0.15;
const DRIP_STEP = 0.3;
const DRIP_R = 0.03;
const DRIP_STRETCH = 1.8;
const DRIP_TRAIL = 0.12;
const DRIP_LAND = 0.8;
const DRIP_RING_R = 0.2;
const DRIP_RING_ALPHA = 0.7;

// ── Splash ring ──────────────────────────────────────────────────────────────

/** Where a slam tentacle breaks the flood's surface: a ring of spray thrown outward. */
export function paintSplash(ctx: Ctx, cx: number, cy: number, ts: number, frame: number): void {
  const t = (frame + 1) / SPLASH_FRAMES;
  const r = ts * SPLASH_MAX_R * (SPLASH_START + (1 - SPLASH_START) * t);
  const fade = 1 - t * SPLASH_FADE;
  ctx.strokeStyle = `rgba(255, 214, 234, ${fade})`;
  ctx.lineWidth = ts * SPLASH_RING_WIDTH * (1 - t * HALF);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * RIPPLE_SQUASH, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = `rgba(236, 143, 189, ${fade * SPLASH_INNER_ALPHA})`;
  ctx.lineWidth = ts * HAIRLINE * 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * SPLASH_INNER, r * SPLASH_INNER * RIPPLE_SQUASH, 0, 0, TWO_PI);
  ctx.stroke();
  const rng = mulberry32(SPLASH_SEED);
  ctx.fillStyle = `rgba(255, 224, 240, ${fade})`;
  for (let i = 0; i < SPLASH_DROPS; i++) {
    const a = (i / SPLASH_DROPS) * TWO_PI + rng() * SPLASH_DROP_JITTER;
    const d = r * (SPLASH_DROP_OUT + rng() * SPLASH_DROP_SPREAD);
    const lift = ts * SPLASH_ARC * Math.sin(t * Math.PI);
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(a) * d,
      cy + Math.sin(a) * d * RIPPLE_SQUASH - lift,
      ts * SPLASH_DROP_R,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}
const SPLASH_MAX_R = 0.72;
const SPLASH_START = 0.3;
const SPLASH_FADE = 0.8;
const SPLASH_RING_WIDTH = 0.08;
const SPLASH_INNER = 0.6;
const SPLASH_INNER_ALPHA = 0.7;
const SPLASH_SEED = 0x5a1a54;
const SPLASH_DROPS = 12;
const SPLASH_DROP_JITTER = 0.3;
const SPLASH_DROP_OUT = 0.9;
const SPLASH_DROP_SPREAD = 0.2;
const SPLASH_ARC = 0.25;
const SPLASH_DROP_R = 0.035;

// ── Seal bars ────────────────────────────────────────────────────────────────

/**
 * Fleshy pink tentacles grown up across a doorway, three abreast like bars.
 * `frame` 0 is a stub just breaking the floor; the last is fully grown.
 */
export function paintSealBars(ctx: Ctx, ox: number, oy: number, ts: number, frame: number): void {
  const grown = (frame + 1) / SEAL_BAR_FRAMES;
  const floorY = oy + ts * SEAL_FLOOR;
  for (let i = 0; i < SEAL_BARS; i++) {
    const baseX = ox + ts * (SEAL_FIRST + i * SEAL_STEP);
    const height = ts * SEAL_HEIGHT * grown * (i === 1 ? 1 : SEAL_SIDE_HEIGHT);
    const lean = (i - 1) * ts * SEAL_LEAN * grown;
    const tipX = baseX + lean;
    const tipY = floorY - height;
    // Churned floor where it broke through.
    ctx.fillStyle = 'rgba(40, 8, 24, 0.55)';
    ctx.beginPath();
    ctx.ellipse(baseX, floorY, ts * SEAL_ROOT_RX, ts * SEAL_ROOT_RY, 0, 0, TWO_PI);
    ctx.fill();
    const width = ts * SEAL_WIDTH * (i === 1 ? 1 : SEAL_SIDE_WIDTH);
    ctx.lineCap = 'round';
    ctx.strokeStyle = FLESH_OUTLINE;
    ctx.lineWidth = width + ts * HAIRLINE * 2;
    ctx.beginPath();
    ctx.moveTo(baseX, floorY);
    ctx.quadraticCurveTo(baseX - lean * HALF, (floorY + tipY) * HALF, tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = FLESH_DARK;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = FLESH_MID;
    ctx.lineWidth = width * SEAL_CORE;
    ctx.stroke();
    ctx.strokeStyle = FLESH_LIGHT;
    ctx.lineWidth = width * SEAL_HIGHLIGHT;
    ctx.beginPath();
    ctx.moveTo(baseX - width * SEAL_HIGHLIGHT_OFFSET, floorY);
    ctx.quadraticCurveTo(
      baseX - lean * HALF - width * SEAL_HIGHLIGHT_OFFSET,
      (floorY + tipY) * HALF,
      tipX - width * SEAL_HIGHLIGHT_OFFSET,
      tipY + width,
    );
    ctx.stroke();
    // Suckers down the inner face.
    ctx.fillStyle = SUCKER;
    const suckers = Math.max(1, Math.floor(SEAL_SUCKERS * grown));
    for (let s = 1; s <= suckers; s++) {
      const u = s / (SEAL_SUCKERS + 1);
      const sx = baseX + (tipX - baseX) * u + width * SEAL_SUCKER_OFFSET;
      const sy = floorY + (tipY - floorY) * u;
      ctx.beginPath();
      ctx.arc(sx, sy, ts * SEAL_SUCKER_R, 0, TWO_PI);
      ctx.fill();
    }
  }
}
const SEAL_BARS = 3;
const SEAL_FLOOR = 0.76;
const SEAL_FIRST = 0.24;
const SEAL_STEP = 0.26;
const SEAL_HEIGHT = 1.45;
const SEAL_SIDE_HEIGHT = 0.82;
const SEAL_LEAN = 0.06;
const SEAL_ROOT_RX = 0.14;
const SEAL_ROOT_RY = 0.06;
const SEAL_WIDTH = 0.26;
const SEAL_SIDE_WIDTH = 0.8;
const SEAL_CORE = 0.62;
const SEAL_HIGHLIGHT = 0.2;
const SEAL_HIGHLIGHT_OFFSET = 0.25;
const SEAL_SUCKERS = 4;
const SEAL_SUCKER_OFFSET = 0.3;
const SEAL_SUCKER_R = 0.035;
