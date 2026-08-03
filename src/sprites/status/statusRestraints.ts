/**
 * The statuses that take control away: `stuck`, `stun` and `electrified`.
 *
 * These are the ones a player must read in a single glance, because each of
 * them changes what the player can do *right now*. So each gets one unmistakable
 * silhouette-level cue and nothing subtle: silk stretched from the body to the
 * floor, stars orbiting the head on a perspective ellipse, and lightning that
 * strobes the whole figure white.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import {
  bodyTop,
  bodyX,
  bodyY,
  drawEmbermote,
  drawGlow,
  drawGroundPool,
  drawStar,
  hashRange,
  particlePhase,
  rgba,
  traceBolt,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;

// -- stuck: cocooned in spider silk ----------------------------------------

const SILK: Rgb = [232, 238, 224];
const SILK_SHADOW: Rgb = [126, 140, 104];

const STRAND_COUNT = 9;
/** Strands leave the body between the knees and the shoulders. */
const STRAND_BODY_UP_MIN = 0.2;
const STRAND_BODY_UP_MAX = 0.8;
/** …and land on an ellipse on the floor, which is what pins the figure down. */
const STRAND_ANCHOR_RADIUS_X = 1.6;
const STRAND_ANCHOR_RADIUS_Y = 0.22;
const STRAND_WIDTH = 1.3;
const STRAND_ALPHA = 0.75;
/** How far a strand bows away from a straight line under its own weight. */
const STRAND_SAG = 0.08;
/** The dark underpass is offset by this many pixels, giving the silk an edge. */
const STRAND_SHADOW_OFFSET = 1;
/**
 * The target keeps testing the silk, so the strands tighten and slacken. Without
 * it the web is scenery; with it the character is visibly trapped in something.
 */
const STRUGGLE_SPEED = 0.0042;
const STRUGGLE_DEPTH = 0.16;

const WRAP_COUNT = 5;
/** Bands of silk wound across the torso, tilted so they read as wrapped. */
const WRAP_TOP_UP = 0.75;
const WRAP_SPACING_UP = 0.12;
const WRAP_HALF_WIDTH = 0.65;
const WRAP_TILT = 0.05;
const WRAP_LINE_WIDTH = 2.4;
const WRAP_ALPHA = 0.55;

/** Pale sheen laid over the art so the character looks coated, not merely fenced in. */
const SILK_COAT_ALPHA = 0.3;
const SILK_RIM_ALPHA = 0.5;

export function stuckBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(SILK, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    alpha: SILK_COAT_ALPHA * f.fade,
    rimColor: rgba(SILK, 1),
    rimAlpha: SILK_RIM_ALPHA * f.fade,
  };
}

export function drawStuck(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const tension = 1 - STRUGGLE_DEPTH * (HALF + HALF * Math.sin(f.timeMs * STRUGGLE_SPEED));

  ctx.lineCap = 'round';
  ctx.lineWidth = STRAND_WIDTH;

  for (let i = 0; i < STRAND_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const angle = (i / STRAND_COUNT) * Math.PI * 2 + hashRange(key, 0, 1);
    const bodyPointY = bodyY(f, hashRange(key + 1, STRAND_BODY_UP_MIN, STRAND_BODY_UP_MAX));
    const anchorX = f.centerX + Math.cos(angle) * f.width * STRAND_ANCHOR_RADIUS_X * tension;
    const anchorY = f.footY + Math.sin(angle) * f.height * STRAND_ANCHOR_RADIUS_Y * tension;
    const sagX = (f.centerX + anchorX) / 2;
    const sagY = (bodyPointY + anchorY) / 2 + f.height * STRAND_SAG;

    // Drawn twice: a dark pass one pixel down gives the silk an edge against a
    // pale floor, where a single white line disappears entirely.
    ctx.globalAlpha = STRAND_ALPHA * f.fade * HALF;
    ctx.strokeStyle = rgba(SILK_SHADOW, 1);
    ctx.beginPath();
    ctx.moveTo(f.centerX, bodyPointY + STRAND_SHADOW_OFFSET);
    ctx.quadraticCurveTo(
      sagX,
      sagY + STRAND_SHADOW_OFFSET,
      anchorX,
      anchorY + STRAND_SHADOW_OFFSET,
    );
    ctx.stroke();

    ctx.globalAlpha = STRAND_ALPHA * f.fade;
    ctx.strokeStyle = rgba(SILK, 1);
    ctx.beginPath();
    ctx.moveTo(f.centerX, bodyPointY);
    ctx.quadraticCurveTo(sagX, sagY, anchorX, anchorY);
    ctx.stroke();
  }

  ctx.lineWidth = WRAP_LINE_WIDTH;
  ctx.globalAlpha = WRAP_ALPHA * f.fade;
  ctx.strokeStyle = rgba(SILK, 1);
  for (let band = 0; band < WRAP_COUNT; band++) {
    const y = bodyY(f, WRAP_TOP_UP - band * WRAP_SPACING_UP);
    const tilt = f.height * WRAP_TILT * (band % 2 === 0 ? 1 : -1);
    ctx.beginPath();
    ctx.moveTo(bodyX(f, HALF - WRAP_HALF_WIDTH), y - tilt);
    ctx.quadraticCurveTo(f.centerX, y + tilt, bodyX(f, HALF + WRAP_HALF_WIDTH), y - tilt);
    ctx.stroke();
  }
}

// -- stun: seeing stars -----------------------------------------------------

const STAR_GOLD: Rgb = [255, 216, 92];
const STAR_GLOW: Rgb = [255, 248, 196];

const STAR_COUNT = 5;
/** One full lap of the head every two seconds or so. */
const STAR_ORBIT_RATE_PER_MS = 0.00055;
const STAR_ORBIT_RADIUS_X = 1.1;
/** Squashed hard, because a circle seen from the game's angle is an ellipse. */
const STAR_ORBIT_RADIUS_Y = 0.09;
/** How far above the head the ring floats. */
const STAR_ORBIT_ABOVE = 0.15;
const STAR_RADIUS = 0.28;
/**
 * A star on the near side of the orbit is drawn larger and brighter than one on
 * the far side, which is the only cue that makes a flat ellipse read as a ring
 * going around the head.
 */
const STAR_DEPTH_SCALE = 0.45;
const STAR_SPIN_SPEED = 0.004;
const STAR_TRAIL_ALPHA = 0.25;
const STAR_TRAIL_SCALE = 2;

export function drawStun(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const orbitY = bodyTop(f) - f.height * STAR_ORBIT_ABOVE;
  const lap = (f.timeMs * STAR_ORBIT_RATE_PER_MS) % 1;

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < STAR_COUNT; i++) {
    const angle = (lap + i / STAR_COUNT) * Math.PI * 2;
    const x = f.centerX + Math.cos(angle) * f.width * STAR_ORBIT_RADIUS_X;
    const y = orbitY + Math.sin(angle) * f.height * STAR_ORBIT_RADIUS_Y;
    // sin is +1 at the front of the orbit and -1 at the back.
    const nearness = HALF + HALF * Math.sin(angle);
    const scale = 1 - STAR_DEPTH_SCALE + STAR_DEPTH_SCALE * nearness;
    const radius = f.width * STAR_RADIUS * scale;

    drawGlow(ctx, STAR_GLOW, x, y, radius * STAR_TRAIL_SCALE, STAR_TRAIL_ALPHA * scale * f.fade);
    ctx.globalAlpha = f.fade * scale;
    ctx.fillStyle = rgba(STAR_GOLD, 1);
    drawStar(ctx, x, y, radius, f.timeMs * STAR_SPIN_SPEED + i);
  }
}

// -- electrified: current running through the body --------------------------

const ARC_CORE: Rgb = [244, 252, 255];
const ARC_HALO: Rgb = [96, 176, 255];

const ARC_COUNT = 3;
/** Each arc restrikes several times a second; anything slower reads as a ribbon. */
const ARC_RATE_PER_MS = 0.0065;
/** Fraction of an arc's cycle it is actually lit for. */
const ARC_DUTY = 0.45;
const ARC_SPREAD = 0.9;
const ARC_HALO_WIDTH = 3.5;
const ARC_CORE_WIDTH = 1.2;
const ARC_HALO_ALPHA = 0.5;
/** Contact points sit inside the figure's box so arcs land on it, not beside it. */
const ARC_ACROSS_MIN = 0.15;
const ARC_ACROSS_MAX = 0.85;
const ARC_UP_MIN = 0.1;
const ARC_UP_MAX = 0.95;

const SPARK_COUNT = 6;
const SPARK_RATE_PER_MS = 0.0016;
const SPARK_REACH = 1.6;
/** Sparks are thrown outward and then fall, so they arc instead of fleeing straight. */
const SPARK_GRAVITY = 0.9;
const SPARK_RADIUS = 0.12;
const SPARK_ORIGIN_UP = 0.5;

const SHOCK_POOL_RADIUS_X = 1.2;
const SHOCK_POOL_RADIUS_Y = 0.16;
const SHOCK_POOL_ALPHA = 0.32;

/** How white the body goes on the frames an arc is striking. */
const SHOCK_FLASH_ALPHA = 0.55;
const SHOCK_RIM_ALPHA = 0.6;

/** 1 while at least one arc is striking, 0 in the gaps between strikes. */
function strikeStrength(f: StatusVisualFrame): number {
  let strongest = 0;
  for (let i = 0; i < ARC_COUNT; i++) {
    const phase = particlePhase(f, i, ARC_RATE_PER_MS);
    if (phase >= ARC_DUTY) continue;
    strongest = Math.max(strongest, 1 - phase / ARC_DUTY);
  }
  return strongest;
}

export function electrifiedBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  const strike = strikeStrength(f);
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(ARC_CORE, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    blend: 'lighter',
    alpha: SHOCK_FLASH_ALPHA * strike * f.fade,
    rimColor: rgba(ARC_HALO, 1),
    rimAlpha: SHOCK_RIM_ALPHA * (HALF + HALF * strike) * f.fade,
  };
}

export function drawElectrified(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  ctx.globalCompositeOperation = 'lighter';
  drawGroundPool(
    ctx,
    ARC_HALO,
    f.centerX,
    f.footY,
    f.width * SHOCK_POOL_RADIUS_X,
    f.height * SHOCK_POOL_RADIUS_Y,
    SHOCK_POOL_ALPHA * f.fade,
  );

  ctx.lineCap = 'round';
  for (let i = 0; i < ARC_COUNT; i++) {
    const phase = particlePhase(f, i, ARC_RATE_PER_MS);
    if (phase >= ARC_DUTY) continue;
    const alpha = (1 - phase / ARC_DUTY) * f.fade;

    // The strike index advances every cycle, so each restrike picks fresh
    // contact points instead of retracing the same bolt.
    const strikeIndex = Math.floor(f.timeMs * ARC_RATE_PER_MS) + i;
    const key = f.seed + strikeIndex * PARTICLE_KEY_STRIDE;
    const fromX = bodyX(f, hashRange(key, ARC_ACROSS_MIN, ARC_ACROSS_MAX));
    const fromY = bodyY(f, hashRange(key + 1, ARC_UP_MIN, ARC_UP_MAX));
    const toX = bodyX(f, hashRange(key + 2, ARC_ACROSS_MIN, ARC_ACROSS_MAX));
    const toY = bodyY(f, hashRange(key + 3, ARC_UP_MIN, ARC_UP_MAX));

    // Opaque halo, additive core: the blue is what reads on a pale floor, the
    // white is what reads on a dark one.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha * ARC_HALO_ALPHA;
    ctx.strokeStyle = rgba(ARC_HALO, 1);
    ctx.lineWidth = ARC_HALO_WIDTH;
    traceBolt(ctx, fromX, fromY, toX, toY, f.width * ARC_SPREAD, key);

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rgba(ARC_CORE, 1);
    ctx.lineWidth = ARC_CORE_WIDTH;
    traceBolt(ctx, fromX, fromY, toX, toY, f.width * ARC_SPREAD, key);
  }

  for (let i = 0; i < SPARK_COUNT; i++) {
    const key = f.seed + (i + ARC_COUNT) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + ARC_COUNT, SPARK_RATE_PER_MS);
    const alpha = (1 - phase) * f.fade;
    if (alpha <= 0) continue;

    const angle = hashRange(key, 0, Math.PI * 2);
    const x = f.centerX + Math.cos(angle) * f.width * SPARK_REACH * phase;
    const y =
      bodyY(f, SPARK_ORIGIN_UP) +
      Math.sin(angle) * f.height * (SPARK_REACH * HALF) * phase +
      f.height * SPARK_GRAVITY * phase * phase;

    drawEmbermote(ctx, ARC_HALO, ARC_CORE, x, y, f.width * SPARK_RADIUS, alpha);
  }

  ctx.globalCompositeOperation = 'source-over';
}
