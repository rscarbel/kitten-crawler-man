/**
 * Ice on a character: `chilled` and `frozen`.
 *
 * Chilled has to read as "slowed, not stopped" — a frost rim and a pale coat,
 * with breath fogging in front of the face so the cold reads even on a figure
 * turned away. Frozen has to read as "stopped, and for how long": the figure is
 * sealed in a block of ice whose cracks spread as the freeze runs out, so the
 * time left is on the block itself rather than only on a HUD pill.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import type { StatusEffect } from '../../core/StatusEffect';
import {
  bodyTop,
  bodyX,
  bodyY,
  drawGlow,
  drawGroundPool,
  hash01,
  hashRange,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;

const FROST_WHITE: Rgb = [236, 248, 255];
const FROST_BLUE: Rgb = [150, 206, 250];
/** Deep enough to hold an edge on snow, where a white rim disappears entirely. */
const FROST_DEEP: Rgb = [56, 118, 186];

// -- chilled: frost rim and fogged breath -------------------------------------

const CHILL_COAT_ALPHA = 0.28;
const CHILL_RIM_ALPHA = 0.7;

const BREATH_PUFF_COUNT = 3;
/** One puff every ~1.1 s per slot, staggered so the breath is a rhythm, not a pulse. */
const BREATH_RATE_PER_MS = 0.0009;
/** Where the mouth sits on the figure. */
const BREATH_MOUTH_UP = 0.86;
/** How far along the facing a puff drifts before it is gone, in figure widths. */
const BREATH_DRIFT_WIDTHS = 0.9;
const BREATH_RISE_HEIGHTS = 0.12;
const BREATH_RADIUS_START = 0.08;
const BREATH_RADIUS_END = 0.2;
const BREATH_ALPHA = 0.55;
/** A puff is visible only over the first part of its cycle: breath comes in bursts. */
const BREATH_DUTY = 0.6;
/** Facing straight up or down, the puff still leans a little sideways so it shows. */
const BREATH_MIN_SIDE_LEAN = 0.35;

const FLAKE_COUNT = 4;
const FLAKE_RATE_PER_MS = 0.0006;
const FLAKE_FALL_HEIGHTS = 0.7;
const FLAKE_SPREAD = 0.7;
const FLAKE_RADIUS_TILES = 0.035;
const FLAKE_ALPHA = 0.8;

export function chilledBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(FROST_BLUE, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    alpha: CHILL_COAT_ALPHA * f.fade,
    rimColor: rgba(FROST_WHITE, 1),
    rimAlpha: CHILL_RIM_ALPHA * f.fade,
  };
}

export function drawChilled(ctx: CanvasRenderingContext2D, f: StatusVisualFrame): void {
  const facesLeft = f.facingX < 0;
  const minimumLean = facesLeft ? -BREATH_MIN_SIDE_LEAN : BREATH_MIN_SIDE_LEAN;
  const leanX = Math.abs(f.facingX) < BREATH_MIN_SIDE_LEAN ? minimumLean : f.facingX;
  const mouthX = f.centerX + leanX * f.width * HALF;
  const mouthY = bodyY(f, BREATH_MOUTH_UP);

  for (let i = 0; i < BREATH_PUFF_COUNT; i++) {
    const phase = particlePhase(f, i, BREATH_RATE_PER_MS);
    if (phase >= BREATH_DUTY) continue;
    const life = phase / BREATH_DUTY;
    const x = mouthX + leanX * life * f.width * BREATH_DRIFT_WIDTHS;
    const y = mouthY - life * f.height * BREATH_RISE_HEIGHTS;
    const radius =
      f.width * (BREATH_RADIUS_START + (BREATH_RADIUS_END - BREATH_RADIUS_START) * life);
    drawGlow(ctx, FROST_WHITE, x, y, radius, BREATH_ALPHA * (1 - life) * f.fade);
  }

  for (let i = 0; i < FLAKE_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + BREATH_PUFF_COUNT, FLAKE_RATE_PER_MS);
    const x = bodyX(f, HALF + hashRange(key, -FLAKE_SPREAD, FLAKE_SPREAD) * HALF);
    const y = bodyTop(f) + phase * f.height * FLAKE_FALL_HEIGHTS;
    const twinkle = HALF + HALF * Math.sin(phase * Math.PI);
    ctx.globalAlpha = FLAKE_ALPHA * twinkle * f.fade;
    ctx.fillStyle = rgba(FROST_WHITE, 1);
    const size = Math.max(1, f.tileSize * FLAKE_RADIUS_TILES);
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
}

// -- frozen: sealed in a block of ice ----------------------------------------

const FROZEN_COAT_ALPHA = 0.45;
const FROZEN_RIM_ALPHA = 0.9;

/** The block stands a little wider and taller than the figure it holds. */
const BLOCK_PAD_WIDTH_FRACTION = 0.22;
const BLOCK_PAD_TOP_FRACTION = 0.12;
/** The front face is drawn as a slanted top plane plus a face, so it reads as a solid. */
const BLOCK_TOP_DEPTH_FRACTION = 0.14;
const BLOCK_FACE_ALPHA = 0.32;
const BLOCK_TOP_ALPHA = 0.5;
const BLOCK_EDGE_ALPHA = 0.85;
const BLOCK_EDGE_WIDTH = 1.5;
/** A diagonal sheen across the face: the cue that it is glass-clear ice, not paint. */
const SHEEN_WIDTH_FRACTION = 0.16;
const SHEEN_ALPHA = 0.35;
const FLOOR_POOL_RADIUS_X = 0.75;
const FLOOR_POOL_RADIUS_Y = 0.16;
const FLOOR_POOL_ALPHA = 0.4;

/**
 * Cracks appear only once the freeze is part-way spent, then spread: the block
 * is whole when it forms, which is when it has the most time left.
 */
const CRACK_START_FRACTION = 0.25;
const CRACK_MAX_COUNT = 5;
const CRACK_SEGMENTS = 4;
const CRACK_SEGMENT_JITTER = 0.35;
const CRACK_LINE_WIDTH = 1.2;
const CRACK_ALPHA = 0.9;

/** 0 while the block is fresh, rising to 1 as the freeze runs out. */
function crackSpread(effect: StatusEffect): number {
  if (effect.totalTicks <= 0) return 1;
  const spent = 1 - effect.ticksRemaining / effect.totalTicks;
  return Math.max(0, Math.min(1, (spent - CRACK_START_FRACTION) / (1 - CRACK_START_FRACTION)));
}

export function frozenBodyLayer(f: StatusVisualFrame): SilhouetteLayer {
  return {
    paint: (target, box) => {
      target.fillStyle = rgba(FROST_BLUE, 1);
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    alpha: FROZEN_COAT_ALPHA * f.fade,
    rimColor: rgba(FROST_DEEP, 1),
    rimAlpha: FROZEN_RIM_ALPHA * f.fade,
  };
}

export function drawFrozen(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  effect: StatusEffect,
): void {
  const padX = f.width * BLOCK_PAD_WIDTH_FRACTION;
  const left = f.centerX - f.width * HALF - padX;
  const right = f.centerX + f.width * HALF + padX;
  const top = bodyTop(f) - f.height * BLOCK_PAD_TOP_FRACTION;
  const bottom = f.footY;
  const depth = f.height * BLOCK_TOP_DEPTH_FRACTION;
  const faceWidth = right - left;
  const faceHeight = bottom - top;

  drawGroundPool(
    ctx,
    FROST_BLUE,
    f.centerX,
    f.footY,
    faceWidth * FLOOR_POOL_RADIUS_X,
    f.height * FLOOR_POOL_RADIUS_Y,
    FLOOR_POOL_ALPHA * f.fade,
  );

  ctx.globalAlpha = BLOCK_FACE_ALPHA * f.fade;
  ctx.fillStyle = rgba(FROST_BLUE, 1);
  ctx.fillRect(left, top, faceWidth, faceHeight);

  ctx.globalAlpha = BLOCK_TOP_ALPHA * f.fade;
  ctx.fillStyle = rgba(FROST_WHITE, 1);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + depth, top - depth);
  ctx.lineTo(right + depth, top - depth);
  ctx.lineTo(right, top);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = SHEEN_ALPHA * f.fade;
  const sheenWidth = faceWidth * SHEEN_WIDTH_FRACTION;
  ctx.beginPath();
  ctx.moveTo(left + sheenWidth, top);
  ctx.lineTo(left + sheenWidth * 2, top);
  ctx.lineTo(left, top + faceHeight * HALF + sheenWidth);
  ctx.lineTo(left, top + faceHeight * HALF);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = BLOCK_EDGE_ALPHA * f.fade;
  ctx.strokeStyle = rgba(FROST_DEEP, 1);
  ctx.lineWidth = BLOCK_EDGE_WIDTH;
  ctx.strokeRect(left, top, faceWidth, faceHeight);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + depth, top - depth);
  ctx.lineTo(right + depth, top - depth);
  ctx.lineTo(right, top);
  ctx.moveTo(right + depth, top - depth);
  ctx.lineTo(right + depth, bottom - depth);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  drawCracks(ctx, f, effect, left, top, faceWidth, faceHeight);
}

/**
 * Jagged cracks running in from the block's edges. Each crack's route is fixed
 * by the character's seed, and only its length and the number drawn grow with
 * time, so the ice visibly fractures further rather than re-randomising.
 */
function drawCracks(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  effect: StatusEffect,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const spread = crackSpread(effect);
  if (spread <= 0) return;
  const crackCount = Math.ceil(spread * CRACK_MAX_COUNT);

  ctx.globalAlpha = CRACK_ALPHA * f.fade;
  ctx.strokeStyle = rgba(FROST_WHITE, 1);
  ctx.lineWidth = CRACK_LINE_WIDTH;
  ctx.lineCap = 'round';

  for (let crack = 0; crack < crackCount; crack++) {
    const key = f.seed + crack * PARTICLE_KEY_STRIDE;
    const startX = left + hash01(key) * width;
    const startsAtTop = hash01(key + 1) < HALF;
    const startY = startsAtTop ? top : top + height;
    const heading = startsAtTop ? 1 : -1;
    const reach = height * spread;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    let x = startX;
    let y = startY;
    for (let segment = 1; segment <= CRACK_SEGMENTS; segment++) {
      const step = reach / CRACK_SEGMENTS;
      x += hashRange(key + segment * 2, -CRACK_SEGMENT_JITTER, CRACK_SEGMENT_JITTER) * width * HALF;
      x = Math.max(left, Math.min(left + width, x));
      y += heading * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
