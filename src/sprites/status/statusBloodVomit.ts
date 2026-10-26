/**
 * The Wheel of Fortune's blood vomiting, on the body.
 *
 * Between bouts it is a sick crawler: skin drained to a pale green-grey and a
 * thread of blood hanging off the mouth. On each bout the body heaves forward
 * and squats under the retch while blood arcs from the mouth to the floor; the
 * floor splatter itself is gore laid by the scene, since it has to outlast the
 * status.
 *
 * The heave is a transform around the figure's own art rather than a painted
 * row: it plays every ten seconds on both crawlers in every view, and a bend
 * at the feet reads as a retch at this size without a frame of new anatomy.
 */

import type { SilhouetteLayer } from '../../core/spriteAssets/silhouetteComposite';
import { bloodVomitRetchProgress, type StatusEffect } from '../../core/combat/StatusEffect';
import {
  drawDroplet,
  hashRange,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;

/** Hue and saturation the skin is pulled toward: bloodless, faintly green. */
const SICKLY_HUE: Rgb = [146, 170, 134];
/** Light added over the top, which is what makes the sick colour pale rather than murky. */
const PALLOR: Rgb = [66, 74, 64];
const SICKLY_HUE_ALPHA = 0.45;
const PALLOR_ALPHA = 0.22;
const TINT_PULSE_SPEED = 0.0028;
const TINT_PULSE_DEPTH = 0.15;

const BLOOD_DARK: Rgb = [112, 8, 14];
const BLOOD: Rgb = [178, 22, 28];
const BLOOD_SHEEN: Rgb = [255, 150, 140];

/** Where in the retch the heave is deepest; it snaps in and eases back out. */
const RETCH_PEAK = 0.22;
/** Forward bend at the deepest heave: horizontal shift per pixel of height. */
const RETCH_LEAN = 0.3;
const RETCH_SQUASH = 0.09;
const RETCH_WIDEN = 0.05;
/** The lurch forward, in tiles, that comes with the bend. */
const RETCH_LURCH_TILES = 0.05;

/** The shape of the body at one instant of a retch. */
export interface RetchPose {
  /** Forward shear per pixel of height. */
  readonly lean: number;
  readonly squash: number;
  readonly widen: number;
  readonly lurchTiles: number;
}

const RESTING_POSE: RetchPose = { lean: 0, squash: 0, widen: 0, lurchTiles: 0 };

/** How deep into the heave the body is at `progress` through the retch, 0..1. */
function heaveDepth(progress: number): number {
  if (progress < RETCH_PEAK) return Math.sin((progress / RETCH_PEAK) * QUARTER_TURN);
  return Math.cos(((progress - RETCH_PEAK) / (1 - RETCH_PEAK)) * QUARTER_TURN);
}

export function retchPoseAt(progress: number): RetchPose {
  const depth = heaveDepth(progress);
  return {
    lean: RETCH_LEAN * depth,
    squash: RETCH_SQUASH * depth,
    widen: RETCH_WIDEN * depth,
    lurchTiles: RETCH_LURCH_TILES * depth,
  };
}

/** The pose this effect puts the body in now: resting between bouts. */
export function retchPoseOf(effect: StatusEffect): RetchPose {
  const progress = bloodVomitRetchProgress(effect);
  return progress === null ? RESTING_POSE : retchPoseAt(progress);
}

/** Bends the context about the figure's feet so whatever is drawn next heaves with the retch. */
export function applyRetchPose(
  ctx: CanvasRenderingContext2D,
  footX: number,
  footY: number,
  leanSign: number,
  tileSize: number,
  pose: RetchPose,
): void {
  ctx.translate(footX + leanSign * pose.lurchTiles * tileSize, footY);
  ctx.transform(1, 0, -leanSign * pose.lean, 1, 0, 0);
  ctx.scale(1 + pose.widen, 1 - pose.squash);
  ctx.translate(-footX, -footY);
}

/** Where a point on the figure lands once the body is bent by {@link applyRetchPose}. */
function posedPoint(
  x: number,
  y: number,
  footX: number,
  footY: number,
  leanSign: number,
  tileSize: number,
  pose: RetchPose,
): { x: number; y: number } {
  const scaledX = (x - footX) * (1 + pose.widen);
  const scaledY = (y - footY) * (1 - pose.squash);
  return {
    x: footX + leanSign * pose.lurchTiles * tileSize + scaledX - leanSign * pose.lean * scaledY,
    y: footY + scaledY,
  };
}

export function bloodVomitBodyLayers(f: StatusVisualFrame): SilhouetteLayer[] {
  const pulse = 1 - TINT_PULSE_DEPTH * (HALF + HALF * Math.sin(f.timeMs * TINT_PULSE_SPEED));
  return [
    {
      paint: (target, box) => {
        target.fillStyle = rgba(SICKLY_HUE, 1);
        target.fillRect(box.x, box.y, box.width, box.height);
      },
      blend: 'color',
      alpha: SICKLY_HUE_ALPHA * pulse * f.fade,
    },
    {
      paint: (target, box) => {
        target.fillStyle = rgba(PALLOR, 1);
        target.fillRect(box.x, box.y, box.width, box.height);
      },
      blend: 'screen',
      alpha: PALLOR_ALPHA * f.fade,
    },
  ];
}

const SMEAR_RADIUS_X = 0.05;
const SMEAR_RADIUS_Y = 0.03;
const SMEAR_ALPHA = 0.85;

const DRIP_RATE_PER_MS = 0.0006;
/** Share of a drip's life spent swelling at the lip before it lets go. */
const DRIP_HANG_SHARE = 0.65;
const DRIP_RADIUS = 0.055;
const DRIP_NECK = 0.12;
/** How far a drip falls, as a share of the figure's height, before it is gone. */
const DRIP_FALL = 0.32;
const DRIP_SHEEN_OFFSET = 0.35;
const DRIP_SHEEN_SCALE = 0.4;

const SPRAY_COUNT = 11;
/** The latest share of the retch a drop can leave the mouth at. */
const SPRAY_STAGGER = 0.3;
/** Share of the retch one drop spends in the air. */
const SPRAY_FLIGHT = 0.28;
/** How far ahead of the feet a side-on retch lands, as a share of figure width. */
const SPRAY_REACH_SIDE = 1.5;
/** How far in front of the feet, toward the camera, a face-on retch lands, in tiles. */
const SPRAY_REACH_FRONT_TILES = 0.18;
const SPRAY_SCATTER = 0.35;
const SPRAY_RADIUS_MIN = 0.04;
const SPRAY_RADIUS_MAX = 0.07;
/** Hash salts that give each drop its own independent scatter and size. */
const SPRAY_SCATTER_X_SALT = 1;
const SPRAY_SCATTER_Y_SALT = 2;
const SPRAY_RADIUS_SALT = 3;
/** The thick first gush, before the stream breaks up into drops. */
const GUSH_END = 0.26;
const GUSH_WIDTH = 0.14;
const GUSH_REACH = 0.55;
const GUSH_STEPS = 8;

export function drawBloodVomit(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  effect: StatusEffect,
): void {
  if (f.mouth === null) return;
  const pose = retchPoseOf(effect);
  const leanSign = f.mouth.lean;
  const mouth = posedPoint(f.mouth.x, f.mouth.y, f.centerX, f.footY, leanSign, f.tileSize, pose);

  drawMouthSmear(ctx, f, mouth);
  const progress = bloodVomitRetchProgress(effect);
  if (progress === null) {
    drawDrip(ctx, f, mouth);
    return;
  }
  const landing = {
    x: leanSign === 0 ? mouth.x : f.centerX + leanSign * f.width * SPRAY_REACH_SIDE,
    y: f.footY + (leanSign === 0 ? f.tileSize * SPRAY_REACH_FRONT_TILES : 0),
  };
  drawGush(ctx, f, mouth, landing, progress);
  drawSpray(ctx, f, mouth, landing, progress);
}

function drawMouthSmear(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  mouth: { x: number; y: number },
): void {
  ctx.globalAlpha = SMEAR_ALPHA * f.fade;
  ctx.fillStyle = rgba(BLOOD_DARK, 1);
  ctx.beginPath();
  ctx.ellipse(
    mouth.x,
    mouth.y,
    f.width * SMEAR_RADIUS_X,
    f.width * SMEAR_RADIUS_Y,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/** One thick drop at a time, swelling at the lip and then letting go. */
function drawDrip(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  mouth: { x: number; y: number },
): void {
  const phase = particlePhase(f, 0, DRIP_RATE_PER_MS);
  const radius = f.width * DRIP_RADIUS;
  let y = mouth.y + radius;
  let swell = 1;
  let alpha = f.fade;
  if (phase < DRIP_HANG_SHARE) {
    swell = phase / DRIP_HANG_SHARE;
  } else {
    const fall = (phase - DRIP_HANG_SHARE) / (1 - DRIP_HANG_SHARE);
    // Squared so the drop accelerates away rather than drifting off.
    y += f.height * DRIP_FALL * fall * fall;
    alpha *= 1 - fall;
  }
  if (alpha <= 0 || swell <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(BLOOD, 1);
  drawDroplet(ctx, mouth.x, y, radius * swell, f.width * DRIP_NECK * swell);
  ctx.fillStyle = rgba(BLOOD_SHEEN, 1);
  ctx.beginPath();
  ctx.arc(
    mouth.x - radius * swell * DRIP_SHEEN_OFFSET,
    y - radius * swell * DRIP_SHEEN_OFFSET,
    radius * swell * DRIP_SHEEN_SCALE,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}

/**
 * A point along a drop's flight from the mouth to the floor, `t` 0 at the lip
 * and 1 landed. Thrown level out of the mouth and then falling: steady across,
 * accelerating down, which is what reads as heaved rather than dribbled.
 */
function arcPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t * t };
}

/** The first heave: a rope of blood thinning as it reaches for the floor. */
function drawGush(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  mouth: { x: number; y: number },
  landing: { x: number; y: number },
  progress: number,
): void {
  if (progress >= GUSH_END) return;
  const life = progress / GUSH_END;
  const reach = Math.min(1, life * 2) * GUSH_REACH;
  const width = f.width * GUSH_WIDTH * (1 - life);
  ctx.globalAlpha = f.fade;
  ctx.strokeStyle = rgba(BLOOD, 1);
  ctx.lineCap = 'round';
  for (let step = 0; step < GUSH_STEPS; step++) {
    const t0 = (step / GUSH_STEPS) * reach;
    const t1 = ((step + 1) / GUSH_STEPS) * reach;
    const a = arcPoint(mouth, landing, t0);
    const b = arcPoint(mouth, landing, t1);
    ctx.lineWidth = Math.max(1, width * (1 - step / GUSH_STEPS));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** The stream broken into drops, each on its own arc to its own spot on the floor. */
function drawSpray(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  mouth: { x: number; y: number },
  landing: { x: number; y: number },
  progress: number,
): void {
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const launch = hashRange(key, 0, SPRAY_STAGGER);
    const t = (progress - launch) / SPRAY_FLIGHT;
    if (t < 0 || t > 1) continue;
    const target = {
      x: landing.x + hashRange(key + SPRAY_SCATTER_X_SALT, -SPRAY_SCATTER, SPRAY_SCATTER) * f.width,
      y:
        landing.y +
        hashRange(key + SPRAY_SCATTER_Y_SALT, -SPRAY_SCATTER, SPRAY_SCATTER) * f.tileSize * HALF,
    };
    const at = arcPoint(mouth, target, t);
    const radius = f.width * hashRange(key + SPRAY_RADIUS_SALT, SPRAY_RADIUS_MIN, SPRAY_RADIUS_MAX);
    ctx.globalAlpha = f.fade;
    ctx.fillStyle = rgba(i % 2 === 0 ? BLOOD : BLOOD_DARK, 1);
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
