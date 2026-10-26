/**
 * What a lit fuse throws off, shared by the goblins' dynamite and the black
 * powder bomb so the two fuses are visibly the same burning cord: the hot
 * bead at the burn point, sparks spitting off it, a thin thread of smoke, and
 * the soft glow it casts on the floor.
 *
 * Nothing is simulated. Every spark is reconstructed from the fuse's seed and
 * age, so a review render replays any frame exactly and a fuse costs no
 * per-frame bookkeeping. A moving fuse passes its own screen velocity, and
 * whatever it shed in earlier frames is drawn where the fuse was then, which
 * is what makes a lobbed bomb trail sparks and smoke behind it.
 */

import type { CanvasSurface } from '../core/rendering/canvasSurface';
import {
  bakeSoftDisc,
  FLAME_EMBER_INK,
  FLAME_GLOW_INK,
  gradientStopRgba,
  hashUnit,
} from './flameStamps';

/** How the burn point is moving across the screen and how it burns this frame. */
export interface FuseBurnOptions {
  /** Frames since the fuse was lit. */
  readonly ageFrames: number;
  /** Tells two fuses apart, so no two spit in step. */
  readonly seed: number;
  /** The burn point's screen velocity in px per frame; zero for a fuse lying still. */
  readonly velocityX: number;
  readonly velocityY: number;
  /** The last stretch of a fuse: the bead burns brighter and spits harder. */
  readonly urgent: boolean;
}

const TAU = Math.PI * 2;
const GLOW_BAKE_PX = 48;

interface FuseStamps {
  readonly glow: CanvasSurface;
  readonly ember: CanvasSurface;
}

let bakedStamps: FuseStamps | null = null;

function fuseStamps(): FuseStamps {
  bakedStamps ??= {
    glow: bakeSoftDisc(FLAME_GLOW_INK, GLOW_BAKE_PX),
    ember: bakeSoftDisc({ ...FLAME_EMBER_INK, alpha: 1 }, GLOW_BAKE_PX),
  };
  return bakedStamps;
}

function stamp(
  ctx: CanvasRenderingContext2D,
  surface: CanvasSurface,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  if (alpha <= 0 || radiusX <= 0 || radiusY <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(surface, x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
}

// ── Burn point ───────────────────────────────────────────────────────────────

/** The bead's halo and core, as shares of a tile. */
const BEAD_HALO_TILES = 0.11;
const BEAD_CORE_TILES = 0.045;
const BEAD_HALO_ALPHA = 0.75;
const BEAD_URGENT_GROWTH = 1.45;
/** The bead's flicker: a fast and a slow wave, so it never pulses on a visible beat. */
const BEAD_FLICKER_FAST = 1.7;
const BEAD_FLICKER_SLOW = 0.43;
const BEAD_FLICKER_DEPTH = 0.25;
const BEAD_CENTRE_INK = '#fffbe8';
const BEAD_CENTRE_PX = 0.8;

/** The white-hot bead where the fuse is burning, with its orange halo. */
export function paintFuseBead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  opts: FuseBurnOptions,
): void {
  const { glow, ember } = fuseStamps();
  const phase = opts.ageFrames + opts.seed;
  const flicker =
    1 +
    BEAD_FLICKER_DEPTH *
      (Math.sin(phase * BEAD_FLICKER_FAST) * Math.sin(phase * BEAD_FLICKER_SLOW + opts.seed));
  const growth = opts.urgent ? BEAD_URGENT_GROWTH : 1;
  const halo = tileSize * BEAD_HALO_TILES * flicker * growth;
  const core = tileSize * BEAD_CORE_TILES * growth;
  const previousOp = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  stamp(ctx, glow, x, y, halo, halo, BEAD_HALO_ALPHA);
  stamp(ctx, ember, x, y, core, core, 1);
  ctx.globalCompositeOperation = previousOp;
  ctx.globalAlpha = 1;
  ctx.fillStyle = BEAD_CENTRE_INK;
  ctx.beginPath();
  ctx.arc(x, y, BEAD_CENTRE_PX, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = previousAlpha;
}

// ── Sparks ───────────────────────────────────────────────────────────────────

const SPARK_COUNT = 7;
const SPARK_URGENT_COUNT = 11;
const SALT_SPARK = 71;
/** Frames a spark lives before it is spat again in a new direction. */
const SPARK_MIN_LIFE = 5;
const SPARK_LIFE_SPREAD = 5;
/** Launch speed, as a share of a tile per frame. */
const SPARK_MIN_SPEED_TILES = 0.035;
const SPARK_SPEED_SPREAD_TILES = 0.05;
const SPARK_URGENT_SPEED = 1.35;
/** Sparks spray up and outward; this is the fan's full width round straight up. */
const SPARK_FAN = Math.PI * 1.5;
/** Fall per frame squared, as a share of a tile. */
const SPARK_GRAVITY_TILES = 0.012;
/** Frames of travel a streak spans: the blur that reads as a spark rather than a dot. */
const SPARK_TRAIL_FRAMES = 1.5;
const SPARK_WIDTH_PX = 1;
const SPARK_RED = 255;
const SPARK_GREEN_HOT = 246;
const SPARK_GREEN_COOL = 150;
const SPARK_BLUE_HOT = 200;
const SPARK_BLUE_COOL = 40;

function sparkAt(
  launchX: number,
  launchY: number,
  directionX: number,
  directionY: number,
  speed: number,
  gravity: number,
  lived: number,
): { x: number; y: number } {
  return {
    x: launchX + directionX * speed * lived,
    y: launchY + directionY * speed * lived + (gravity * lived * lived) / 2,
  };
}

/**
 * The fizzing shower off a burning fuse: short orange-white streaks spat up
 * and out of the bead, falling as they cool. Each spark was spat from where
 * the bead was when it left, so a moving fuse leaves its sparks behind it.
 */
export function paintFuseSparks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  opts: FuseBurnOptions,
): void {
  const count = opts.urgent ? SPARK_URGENT_COUNT : SPARK_COUNT;
  const speedScale = opts.urgent ? SPARK_URGENT_SPEED : 1;
  const gravity = tileSize * SPARK_GRAVITY_TILES;
  const previousOp = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineWidth = SPARK_WIDTH_PX;
  for (let index = 0; index < count; index++) {
    const life = SPARK_MIN_LIFE + hashUnit(opts.seed + SALT_SPARK, index) * SPARK_LIFE_SPREAD;
    const offset = hashUnit(opts.seed + SALT_SPARK + 1, index) * life;
    const clock = opts.ageFrames + offset;
    const lived = clock % life;
    const generation = Math.floor(clock / life);
    const angle = -Math.PI / 2 + (hashUnit(opts.seed + index, generation) - 1 / 2) * SPARK_FAN;
    const speed =
      tileSize *
      speedScale *
      (SPARK_MIN_SPEED_TILES +
        hashUnit(opts.seed + index, generation + SALT_SPARK) * SPARK_SPEED_SPREAD_TILES);
    const launchX = x - opts.velocityX * lived;
    const launchY = y - opts.velocityY * lived;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const head = sparkAt(launchX, launchY, directionX, directionY, speed, gravity, lived);
    const tail = sparkAt(
      launchX,
      launchY,
      directionX,
      directionY,
      speed,
      gravity,
      Math.max(0, lived - SPARK_TRAIL_FRAMES),
    );
    const heat = 1 - lived / life;
    const green = SPARK_GREEN_COOL + (SPARK_GREEN_HOT - SPARK_GREEN_COOL) * heat;
    const blue = SPARK_BLUE_COOL + (SPARK_BLUE_HOT - SPARK_BLUE_COOL) * heat;
    ctx.strokeStyle = gradientStopRgba(SPARK_RED, Math.round(green), Math.round(blue), heat);
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x + directionX * SPARK_WIDTH_PX, head.y + directionY * SPARK_WIDTH_PX);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = previousOp;
  ctx.globalAlpha = previousAlpha;
}

// ── Smoke thread ─────────────────────────────────────────────────────────────

const SMOKE_SEGMENTS = 7;
/** Frames between the thread's sample points: how old each step back along it is. */
const SMOKE_STEP_FRAMES = 1.6;
/** How fast the smoke rises off the fuse, as a share of a tile per frame. */
const SMOKE_RISE_TILES = 0.02;
/** Sideways wander of the thread, as a share of a tile at its far end. */
const SMOKE_WANDER_TILES = 0.09;
const SMOKE_WANDER_RATE = 0.21;
const SMOKE_WANDER_SPACING = 0.9;
const SMOKE_NEAR_WIDTH_PX = 1;
const SMOKE_FAR_WIDTH_PX = 2.4;
const SMOKE_PEAK_ALPHA = 0.42;
const SMOKE_GREY = 168;

/**
 * The thin grey thread a burning fuse trails: rising, wandering and thinning
 * away from the bead, or streaming out behind it when it is in the air.
 */
export function paintFuseSmoke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  opts: FuseBurnOptions,
): void {
  const rise = tileSize * SMOKE_RISE_TILES;
  const wander = tileSize * SMOKE_WANDER_TILES;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  let previousX = x;
  let previousY = y;
  for (let step = 1; step <= SMOKE_SEGMENTS; step++) {
    const along = step / SMOKE_SEGMENTS;
    const back = step * SMOKE_STEP_FRAMES;
    const sway = Math.sin(
      (opts.ageFrames - back) * SMOKE_WANDER_RATE + step * SMOKE_WANDER_SPACING + opts.seed,
    );
    const pointX = x - opts.velocityX * back + sway * wander * along;
    const pointY = y - opts.velocityY * back - rise * back;
    const fade = SMOKE_PEAK_ALPHA * (1 - along) * Math.min(1, opts.ageFrames / back);
    ctx.strokeStyle = gradientStopRgba(SMOKE_GREY, SMOKE_GREY, SMOKE_GREY, fade);
    ctx.lineWidth = SMOKE_NEAR_WIDTH_PX + (SMOKE_FAR_WIDTH_PX - SMOKE_NEAR_WIDTH_PX) * along;
    ctx.beginPath();
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(pointX, pointY);
    ctx.stroke();
    previousX = pointX;
    previousY = pointY;
  }
  ctx.globalAlpha = previousAlpha;
}

// ── Floor glow ───────────────────────────────────────────────────────────────

const FLOOR_GLOW_TILES = 0.75;
/** The floor is seen at an angle, so the glow's pool lies flattened. */
const FLOOR_GLOW_SQUASH = 0.55;
const FLOOR_GLOW_ALPHA = 0.28;
const FLOOR_GLOW_URGENT_ALPHA = 0.5;
const FLOOR_GLOW_FLICKER = 0.9;
const FLOOR_GLOW_FLICKER_DEPTH = 0.15;

/**
 * The soft orange pool a burning fuse casts on the floor around it. Drawn in
 * the ground pass, so it warms the floor and not the creatures standing on it.
 */
export function paintFuseFloorGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  opts: FuseBurnOptions,
): void {
  const flicker =
    1 + FLOOR_GLOW_FLICKER_DEPTH * Math.sin((opts.ageFrames + opts.seed) * FLOOR_GLOW_FLICKER);
  const reach = tileSize * FLOOR_GLOW_TILES;
  const alpha = (opts.urgent ? FLOOR_GLOW_URGENT_ALPHA : FLOOR_GLOW_ALPHA) * flicker;
  const previousOp = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  stamp(ctx, fuseStamps().glow, x, y, reach, reach * FLOOR_GLOW_SQUASH, alpha);
  ctx.globalCompositeOperation = previousOp;
  ctx.globalAlpha = previousAlpha;
}
