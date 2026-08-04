/**
 * The Evil Clown's gas vials: the bottle in flight, the shatter, and the cloud
 * it leaves on the ground.
 *
 * Painting lives here and geometry lives in
 * `scripts/generate-clown-gas-sprites.ts`, matching the lava-ball split. All
 * drawing is in **tile units** about the effect's own anchor, so the caller can
 * bake at any resolution by scaling once.
 *
 * Two constraints shape everything below:
 *
 * 1. **Glow is radial gradients, never `shadowBlur`.** Shadow blur is measured
 *    in device pixels and would not survive the caller's scale.
 * 2. **Tiny alphas are clamped to zero.** node-canvas serialises a very small
 *    computed alpha in exponent notation (`5e-17`), which is not valid CSS, so
 *    the whole `rgba()` is dropped and the shape bakes as an opaque smear.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

const TWO_PI = Math.PI * 2;

/** Below this an alpha is not visible anyway, and is the exponent-notation trap. */
const MIN_VISIBLE_ALPHA = 0.004;

function alpha(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped < MIN_VISIBLE_ALPHA ? 0 : clamped;
}

function gas(a: number): string {
  return `rgba(168,201,54,${alpha(a)})`;
}

function gasPale(a: number): string {
  return `rgba(215,232,106,${alpha(a)})`;
}

function gasDeep(a: number): string {
  return `rgba(84,110,32,${alpha(a)})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Deterministic per-index jitter in [0, 1), so a re-bake is byte-identical.
 *
 * The `abs` is load-bearing: `%` in JavaScript keeps the sign of its left
 * operand, so without it this returns (-1, 1) and every `lerp` fed by it
 * silently reaches below its stated minimum.
 */
const JITTER_SIN_X = 12.9898;
const JITTER_SIN_Y = 78.233;
const JITTER_SCALE = 43758.5453;

function jitter(index: number, salt: number): number {
  return Math.abs((Math.sin(index * JITTER_SIN_X + salt * JITTER_SIN_Y) * JITTER_SCALE) % 1);
}

// ── The vial in flight ───────────────────────────────────────────────────────

/** Half the vial's height, in tile units. Also the sheet's envelope. */
export const VIAL_HALF_HEIGHT = 0.19;
const VIAL_HALF_WIDTH = 0.075;
const VIAL_NECK_HALF_WIDTH = 0.026;
const VIAL_NECK_HEIGHT = 0.06;
const VIAL_GLASS = 'rgba(186,209,192,0.78)';
const VIAL_OUTLINE = '#0b070e';
const VIAL_OUTLINE_WIDTH = 0.016;
const VIAL_CORK = '#6b4d2c';
const VIAL_SPIN_TURNS = 1;
/** Trail of gas weeping from the cork as the bottle tumbles. */
const WEEP_PUFFS = 4;
const WEEP_REACH = 0.34;

/**
 * One frame of the thrown vial. `phase` runs 0→1 over one full tumble; the
 * sprite is drawn about its own centre and the system supplies the arc.
 */
export function drawClownVial(ctx: Ctx, phase: number): void {
  // The weeping trail is painted in world-upright space so it always streams
  // the same way, no matter where the bottle is in its spin.
  for (let i = 0; i < WEEP_PUFFS; i++) {
    const t = (i + phase) / WEEP_PUFFS;
    const reach = WEEP_REACH * t;
    const radius = lerp(0.04, 0.1, t);
    const puff = ctx.createRadialGradient(0, reach, 0, 0, reach, radius);
    puff.addColorStop(0, gas(0.4 * (1 - t)));
    puff.addColorStop(1, gas(0));
    ctx.fillStyle = puff;
    ctx.beginPath();
    ctx.arc(jitter(i, 3) * 0.05, reach, radius, 0, TWO_PI);
    ctx.fill();
  }

  ctx.save();
  ctx.rotate(phase * TWO_PI * VIAL_SPIN_TURNS);

  const top = -VIAL_HALF_HEIGHT + VIAL_NECK_HEIGHT;
  const bottom = VIAL_HALF_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(-VIAL_HALF_WIDTH, top);
  ctx.lineTo(VIAL_HALF_WIDTH, top);
  ctx.quadraticCurveTo(VIAL_HALF_WIDTH * 1.2, bottom, 0, bottom);
  ctx.quadraticCurveTo(-VIAL_HALF_WIDTH * 1.2, bottom, -VIAL_HALF_WIDTH, top);
  ctx.closePath();
  ctx.fillStyle = VIAL_GLASS;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = gas(0.95);
  ctx.fillRect(-VIAL_HALF_WIDTH, top + VIAL_HALF_HEIGHT * 0.35, VIAL_HALF_WIDTH * 2, VIAL_HALF_HEIGHT * 2);
  ctx.fillStyle = gasPale(0.85);
  ctx.fillRect(-VIAL_HALF_WIDTH, top + VIAL_HALF_HEIGHT * 0.35, VIAL_HALF_WIDTH * 0.5, VIAL_HALF_HEIGHT * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(-VIAL_HALF_WIDTH, top);
  ctx.lineTo(VIAL_HALF_WIDTH, top);
  ctx.quadraticCurveTo(VIAL_HALF_WIDTH * 1.2, bottom, 0, bottom);
  ctx.quadraticCurveTo(-VIAL_HALF_WIDTH * 1.2, bottom, -VIAL_HALF_WIDTH, top);
  ctx.closePath();
  ctx.strokeStyle = VIAL_OUTLINE;
  ctx.lineWidth = VIAL_OUTLINE_WIDTH;
  ctx.stroke();

  ctx.fillStyle = VIAL_GLASS;
  ctx.fillRect(-VIAL_NECK_HALF_WIDTH, top - VIAL_NECK_HEIGHT, VIAL_NECK_HALF_WIDTH * 2, VIAL_NECK_HEIGHT);
  ctx.fillStyle = VIAL_CORK;
  ctx.fillRect(
    -VIAL_NECK_HALF_WIDTH * 1.5,
    top - VIAL_NECK_HEIGHT * 1.5,
    VIAL_NECK_HALF_WIDTH * 3,
    VIAL_NECK_HEIGHT * 0.7,
  );

  ctx.restore();
}

// ── The shatter ──────────────────────────────────────────────────────────────

/** How far the shatter throws glass, in tile units. */
export const SHATTER_REACH = 0.72;
const SHARD_COUNT = 11;
const SHARD_GLASS = '#c9dcc8';

/** One frame of the impact, `progress` 0→1 across the whole burst. */
export function drawClownVialShatter(ctx: Ctx, progress: number): void {
  const fade = 1 - progress;

  // The gas going up first, so the shards fly in front of it.
  const bloomRadius = lerp(0.1, SHATTER_REACH * 0.95, progress);
  const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, bloomRadius);
  bloom.addColorStop(0, gasPale(0.8 * fade));
  bloom.addColorStop(0.5, gas(0.55 * fade));
  bloom.addColorStop(1, gas(0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(0, 0, bloomRadius, 0, TWO_PI);
  ctx.fill();

  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = (i / SHARD_COUNT) * TWO_PI + jitter(i, 1) * 0.5;
    // Shards decelerate: they leave fast and are already slowing by mid-burst.
    const reach = SHATTER_REACH * (1 - (1 - progress) * (1 - progress)) * lerp(0.6, 1, jitter(i, 2));
    const size = lerp(0.05, 0.09, jitter(i, 4)) * fade;
    ctx.save();
    ctx.translate(Math.cos(angle) * reach, Math.sin(angle) * reach);
    ctx.rotate(angle + progress * TWO_PI);
    ctx.fillStyle = SHARD_GLASS;
    ctx.globalAlpha = alpha(fade);
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.4);
    ctx.lineTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ── The lingering cloud ──────────────────────────────────────────────────────

/** Radius of the drawn cloud in tile units; matches the system's damage radius. */
export const GAS_RADIUS = 1.5;
const LOBE_COUNT = 7;
/** Lobes orbit this fraction of the cloud's radius as it billows. */
const LOBE_ORBIT = 0.46;
const LOBE_RADIUS = 0.62;
const CORE_ALPHA = 0.4;
const LOBE_ALPHA = 0.3;
/** Darker curls of heavier vapour rolling inside the cloud. */
const CURL_COUNT = 5;
const CURL_ALPHA = 0.22;

/**
 * One frame of the cloud. `phase` runs 0→1 over the billow loop; `intensity`
 * fades the whole thing in as it settles and out as it thins.
 */
export function drawClownGas(ctx: Ctx, phase: number, intensity: number): void {
  const strength = alpha(intensity);
  if (strength === 0) return;
  const spin = phase * TWO_PI;

  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, GAS_RADIUS);
  core.addColorStop(0, gas(CORE_ALPHA * strength));
  core.addColorStop(0.55, gas(CORE_ALPHA * 0.7 * strength));
  core.addColorStop(1, gas(0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, GAS_RADIUS, 0, TWO_PI);
  ctx.fill();

  for (let i = 0; i < LOBE_COUNT; i++) {
    const angle = (i / LOBE_COUNT) * TWO_PI + spin * (i % 2 === 0 ? 1 : -1) * 0.35;
    const swell = 0.75 + 0.25 * Math.sin(spin + i);
    const orbit = GAS_RADIUS * LOBE_ORBIT * lerp(0.7, 1, jitter(i, 5));
    const radius = GAS_RADIUS * LOBE_RADIUS * swell;
    const cx = Math.cos(angle) * orbit;
    // Squashed vertically, because the cloud lies on the ground rather than
    // hanging in the air in front of the party.
    const cy = Math.sin(angle) * orbit * 0.55;
    const lobe = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    lobe.addColorStop(0, gasPale(LOBE_ALPHA * strength));
    lobe.addColorStop(0.6, gas(LOBE_ALPHA * 0.8 * strength));
    lobe.addColorStop(1, gas(0));
    ctx.fillStyle = lobe;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.68, 0, 0, TWO_PI);
    ctx.fill();
  }

  for (let i = 0; i < CURL_COUNT; i++) {
    const angle = (i / CURL_COUNT) * TWO_PI - spin * 0.6;
    const orbit = GAS_RADIUS * 0.3 * lerp(0.5, 1, jitter(i, 7));
    const radius = GAS_RADIUS * 0.3 * (0.8 + 0.2 * Math.cos(spin * 2 + i));
    const cx = Math.cos(angle) * orbit;
    const cy = Math.sin(angle) * orbit * 0.55;
    const curl = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    curl.addColorStop(0, gasDeep(CURL_ALPHA * strength));
    curl.addColorStop(1, gasDeep(0));
    ctx.fillStyle = curl;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * 0.7, 0, 0, TWO_PI);
    ctx.fill();
  }
}
