/**
 * Drawing engine for the power lab.
 *
 * The lab grew young krakens in its vats until the experiment failed.
 * Everything in the room is painted from one cold steel ramp, one sick-pink
 * ramp for the growth medium and the puddles it left, and a single warning
 * yellow, so the lab reads as one facility.
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

/** The growth medium: a sick pink, thinned into fluid. */
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

const WARNING_YELLOW = '#d9b23a';
const WARNING_BLACK = '#1b1a16';
const SCREEN_DARK = '#071612';
const SCREEN_GREEN = '#58e0a0';
const SCREEN_CYAN = '#6fd6e8';
const SCREEN_RED = '#ff5a5a';

const SPARK_CORE = '#fffbe0';
const SPARK_HOT = '#ffe36a';
const ARC_CORE = '#f4fdff';
const ARC_GLOW = 'rgba(120, 200, 255, 0.35)';
const ARC_WASH = 'rgba(150, 215, 255, 0.14)';

const WATER_FOAM = 'rgba(255, 214, 234, 0.85)';

/** Frame counts every sheet plan and every runtime frame pick agree on. */
export const VAT_BUBBLE_FRAMES = 3;
export const CONSOLE_SCREEN_FRAMES = 4;
export const FX_SPARK_FRAMES = 4;
export const FX_ARC_FRAMES = 4;
export const FX_RIPPLE_FRAMES = 4;
export const FX_DRIP_FRAMES = 4;

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

// ── Specimen vat ─────────────────────────────────────────────────────────────

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
 * The failed specimen: a half-formed young kraken, a knot of flesh with one
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

/** A waist-high lab console, its monitor showing a specimen's vitals. */
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

const SPARK_SEED = 0x59a4c;
// ── One-tile effect overlays ─────────────────────────────────────────────────

/** Sparks crawling over a puddle as it is about to be charged: the charge's telegraph. */
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
/** A ripple ring spreading on a puddle's surface. */
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
