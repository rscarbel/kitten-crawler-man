/**
 * The storm-drain grate on the Civic Terrace: a heavy iron grille, two tiles
 * wide, over the shaft down into the sewer, set in a stone collar and ringed
 * by the grime the street washes into it.
 *
 * The grate's vocabulary is the goblin nursery's floor grate, at a street's
 * scale: a grime halo, a bevelled collar with chipped corners, a shaft that
 * falls away into the dark, a riveted frame and its bars, rust where water
 * stands. It is baked into the terrain chunk, and each of its two tiles paints
 * the whole grate clipped to itself, so the two halves meet exactly.
 * Everything is a share of `ts`; light comes from the upper left.
 */

import { mulberry32, range, type Rng } from '../../sprites/person/rng';

/** Which of the grate's two tiles is being drawn. */
export type StormDrainGrateHalf = 'west' | 'east';

/** The grate spans this many tiles east to west, and one north to south. */
export const STORM_DRAIN_GRATE_WIDTH_TILES = 2;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
/** One seed for the whole grate: its two halves must agree on every chip and stain. */
const GRATE_SEED = 0x5d1a7e;

const GRIME_REACH_X = 1.05;
const GRIME_REACH_Y = 0.62;
const GRIME_INNER = 'rgba(26,22,14,0.62)';
const GRIME_MID = 'rgba(36,32,20,0.36)';
const GRIME_MID_STOP = 0.7;
const GRIME_OUTER = 'rgba(44,38,26,0)';
const GRIME_STREAK_COUNT = 6;
const GRIME_STREAK_COLOR = 'rgba(34,40,24,0.3)';
const GRIME_STREAK_MIN = 0.05;
const GRIME_STREAK_MAX = 0.11;

const COLLAR_INSET_X = 0.03;
const COLLAR_INSET_Y = 0.04;
const COLLAR_FILL = '#57514a';
const COLLAR_LIGHT = 'rgba(222,210,188,0.5)';
const COLLAR_DARK = 'rgba(18,14,10,0.6)';
const COLLAR_BEVEL = 0.05;
const COLLAR_CHIP_COUNT = 5;
const COLLAR_CHIP_SIZE = 0.06;
const COLLAR_CHIP_COLOR = 'rgba(32,28,22,0.55)';
const COLLAR_JOINT_COLOR = 'rgba(30,26,20,0.4)';
const COLLAR_JOINT_WIDTH = 0.02;

const SHAFT_INSET_X = 0.16;
const SHAFT_INSET_Y = 0.17;
const SHAFT_TOP = '#15120e';
const SHAFT_BOTTOM = '#030303';
const SHAFT_WALL_DEPTH = 0.18;
const SHAFT_LIT_WALL = 'rgba(120,108,88,0.45)';
const SHAFT_GLINT = 'rgba(110,150,140,0.25)';
const SHAFT_GLINT_WIDTH = 0.5;
const SHAFT_GLINT_HEIGHT = 0.035;
const SHAFT_GLINT_Y = 0.66;

const FRAME_INSET_X = 0.12;
const FRAME_INSET_Y = 0.13;
const FRAME_WIDTH = 0.09;
const IRON_EDGE = '#141619';
const IRON_DARK = '#2a2e33';
const IRON_MID = '#40464d';
const IRON_LIGHT = '#69727c';
const IRON_OUTLINE_WIDTH = 0.022;
/** Heavy bars, close set: a street grate a crawler stands on, not a vent. */
const BAR_COUNT = 6;
const BAR_WIDTH = 0.1;
const BAR_SHADOW_OFFSET = 0.035;
const BAR_SHADOW = 'rgba(0,0,0,0.6)';
const CROSS_BAR_WIDTH = 0.08;
const RIVET_RADIUS = 0.03;
const RIVET_LIGHT = '#98a2ae';

const RUST_SPOT_COUNT = 5;
const RUST_SPOT_MIN = 0.014;
const RUST_SPOT_MAX = 0.03;
const RUST_COLOR = 'rgba(132,70,32,0.5)';
const RUST_STREAK_COLOR = 'rgba(120,62,26,0.32)';
const RUST_STREAK_LENGTH = 0.1;
const RUST_STREAK_WIDTH = 0.028;

interface GrateBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Draws one tile of the grate: `half` says which, `(sx, sy)` is that tile's corner. */
export function drawStormDrainGrateTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  half: StormDrainGrateHalf,
): void {
  const grateX = half === 'east' ? sx - ts : sx;
  const whole: GrateBox = { x: grateX, y: sy, w: ts * STORM_DRAIN_GRATE_WIDTH_TILES, h: ts };
  const rng = mulberry32(GRATE_SEED);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  drawGrime(ctx, whole, ts, rng);
  drawCollar(ctx, whole, ts, rng);
  drawShaft(ctx, whole, ts);
  drawGrille(ctx, whole, ts);
  drawRust(ctx, whole, ts, rng);
  ctx.restore();
}

function inset(box: GrateBox, ts: number, x: number, y: number): GrateBox {
  return { x: box.x + ts * x, y: box.y + ts * y, w: box.w - ts * x * 2, h: box.h - ts * y * 2 };
}

function drawGrime(ctx: CanvasRenderingContext2D, box: GrateBox, ts: number, rng: Rng): void {
  const cx = box.x + box.w * HALF;
  const cy = box.y + box.h * HALF;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(GRIME_REACH_X, GRIME_REACH_Y);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, ts);
  halo.addColorStop(0, GRIME_INNER);
  halo.addColorStop(GRIME_MID_STOP, GRIME_MID);
  halo.addColorStop(1, GRIME_OUTER);
  ctx.fillStyle = halo;
  ctx.fillRect(-ts, -ts, ts * 2, ts * 2);
  ctx.restore();
  ctx.fillStyle = GRIME_STREAK_COLOR;
  for (let streak = 0; streak < GRIME_STREAK_COUNT; streak++) {
    const x = box.x + box.w * rng();
    const y =
      box.y + box.h * (rng() < HALF ? rng() * COLLAR_INSET_Y * 2 : 1 - rng() * COLLAR_INSET_Y * 2);
    const r = ts * range(rng, GRIME_STREAK_MIN, GRIME_STREAK_MAX);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 2, r, 0, 0, FULL_TURN);
    ctx.fill();
  }
}

function drawCollar(ctx: CanvasRenderingContext2D, box: GrateBox, ts: number, rng: Rng): void {
  const collar = inset(box, ts, COLLAR_INSET_X, COLLAR_INSET_Y);
  ctx.fillStyle = COLLAR_FILL;
  ctx.fillRect(collar.x, collar.y, collar.w, collar.h);
  const bevel = ts * COLLAR_BEVEL;
  ctx.fillStyle = COLLAR_LIGHT;
  ctx.fillRect(collar.x, collar.y, collar.w, bevel);
  ctx.fillRect(collar.x, collar.y, bevel, collar.h);
  ctx.fillStyle = COLLAR_DARK;
  ctx.fillRect(collar.x, collar.y + collar.h - bevel, collar.w, bevel);
  ctx.fillRect(collar.x + collar.w - bevel, collar.y, bevel, collar.h);
  ctx.fillStyle = COLLAR_JOINT_COLOR;
  const jointW = ts * COLLAR_JOINT_WIDTH;
  ctx.fillRect(collar.x + collar.w * HALF - jointW * HALF, collar.y, jointW, ts * SHAFT_INSET_Y);
  ctx.fillRect(
    collar.x + collar.w * HALF - jointW * HALF,
    collar.y + collar.h - ts * SHAFT_INSET_Y,
    jointW,
    ts * SHAFT_INSET_Y,
  );
  ctx.fillStyle = COLLAR_CHIP_COLOR;
  const chip = ts * COLLAR_CHIP_SIZE;
  for (let index = 0; index < COLLAR_CHIP_COUNT; index++) {
    const onTop = rng() < HALF;
    const x = collar.x + (collar.w - chip) * rng();
    const y = onTop ? collar.y + bevel : collar.y + collar.h - bevel - chip;
    ctx.fillRect(x, y, chip, chip * HALF);
  }
}

function drawShaft(ctx: CanvasRenderingContext2D, box: GrateBox, ts: number): void {
  const shaft = inset(box, ts, SHAFT_INSET_X, SHAFT_INSET_Y);
  const fall = ctx.createLinearGradient(0, shaft.y, 0, shaft.y + shaft.h);
  fall.addColorStop(0, SHAFT_TOP);
  fall.addColorStop(1, SHAFT_BOTTOM);
  ctx.fillStyle = fall;
  ctx.fillRect(shaft.x, shaft.y, shaft.w, shaft.h);
  ctx.fillStyle = SHAFT_LIT_WALL;
  ctx.fillRect(
    shaft.x,
    shaft.y + shaft.h - ts * SHAFT_WALL_DEPTH,
    shaft.w,
    ts * SHAFT_WALL_DEPTH * HALF,
  );
  ctx.fillStyle = SHAFT_GLINT;
  const glintW = shaft.w * SHAFT_GLINT_WIDTH;
  ctx.fillRect(
    shaft.x + (shaft.w - glintW) * HALF,
    shaft.y + shaft.h * SHAFT_GLINT_Y,
    glintW,
    ts * SHAFT_GLINT_HEIGHT,
  );
}

function drawIronBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  ctx.fillStyle = BAR_SHADOW;
  ctx.fillRect(x + ts * BAR_SHADOW_OFFSET, y + ts * BAR_SHADOW_OFFSET, w, h);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y, Math.min(w, h) * HALF, h);
  ctx.strokeStyle = IRON_EDGE;
  ctx.lineWidth = ts * IRON_OUTLINE_WIDTH;
  ctx.strokeRect(x, y, w, h);
}

function drawGrille(ctx: CanvasRenderingContext2D, box: GrateBox, ts: number): void {
  const frame = inset(box, ts, FRAME_INSET_X, FRAME_INSET_Y);
  const frameW = ts * FRAME_WIDTH;
  const barW = ts * BAR_WIDTH;
  const inner = {
    x: frame.x + frameW,
    y: frame.y + frameW,
    w: frame.w - frameW * 2,
    h: frame.h - frameW * 2,
  };
  for (let bar = 1; bar <= BAR_COUNT; bar++) {
    const x = inner.x + (inner.w * bar) / (BAR_COUNT + 1) - barW * HALF;
    drawIronBar(ctx, x, inner.y, barW, inner.h, ts);
  }
  const crossH = ts * CROSS_BAR_WIDTH;
  drawIronBar(ctx, inner.x, inner.y + inner.h * HALF - crossH * HALF, inner.w, crossH, ts);
  ctx.fillStyle = IRON_DARK;
  ctx.fillRect(frame.x, frame.y, frame.w, frameW);
  ctx.fillRect(frame.x, frame.y + frame.h - frameW, frame.w, frameW);
  ctx.fillRect(frame.x, frame.y, frameW, frame.h);
  ctx.fillRect(frame.x + frame.w - frameW, frame.y, frameW, frame.h);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(frame.x, frame.y, frame.w, frameW * HALF);
  ctx.strokeStyle = IRON_EDGE;
  ctx.lineWidth = ts * IRON_OUTLINE_WIDTH;
  ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
  ctx.fillStyle = RIVET_LIGHT;
  const rivet = ts * RIVET_RADIUS;
  for (const [rx, ry] of [
    [frame.x + frameW * HALF, frame.y + frameW * HALF],
    [frame.x + frame.w - frameW * HALF, frame.y + frameW * HALF],
    [frame.x + frameW * HALF, frame.y + frame.h - frameW * HALF],
    [frame.x + frame.w - frameW * HALF, frame.y + frame.h - frameW * HALF],
    [frame.x + frame.w * HALF, frame.y + frameW * HALF],
    [frame.x + frame.w * HALF, frame.y + frame.h - frameW * HALF],
  ] as const) {
    ctx.beginPath();
    ctx.arc(rx, ry, rivet, 0, FULL_TURN);
    ctx.fill();
  }
}

function drawRust(ctx: CanvasRenderingContext2D, box: GrateBox, ts: number, rng: Rng): void {
  const frame = inset(box, ts, FRAME_INSET_X, FRAME_INSET_Y);
  for (let spot = 0; spot < RUST_SPOT_COUNT; spot++) {
    const x = frame.x + frame.w * rng();
    const y = frame.y + frame.h * rng();
    ctx.fillStyle = RUST_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, ts * range(rng, RUST_SPOT_MIN, RUST_SPOT_MAX), 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = RUST_STREAK_COLOR;
    ctx.fillRect(x, y, ts * RUST_STREAK_WIDTH, ts * RUST_STREAK_LENGTH);
  }
}
