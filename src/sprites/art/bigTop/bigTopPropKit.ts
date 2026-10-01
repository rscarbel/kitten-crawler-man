/**
 * The shared hand of the Big Top's act props: the ramps they are painted from,
 * the town vocabulary (upper-left light, one ink outline, contact shadow, ramp
 * jitter) scaled to a prop tile, and the live ownership overlays drawn over a
 * cached prop.
 *
 * Ownership is load-bearing for the two-crawler split. Donut's props are stage
 * red and bone stripes with a gilt hoop; Carl's are ringmaster blue and brass
 * on timber with brass strike chevrons. A player names the prop and its owner
 * from the colours alone at a 32-pixel tile, under the stage lights.
 */

import { mulberry32, range, type Rng } from '../../person/rng';
import { drawTownContactShadow, inkOutline, rgba } from '../town/townArt';
import {
  TOWN_INK,
  getCircusRamp,
  getTownRamp,
  mix,
  type Ramp,
  type RGB,
} from '../town/townPalette';

export type Ctx = CanvasRenderingContext2D;
export type { Ramp, RGB, Rng };

export const TAU = Math.PI * 2;

export const STAGE_RED = getCircusRamp('circus_stage_red');
export const BONE = getCircusRamp('circus_bone');
export const GILT = getCircusRamp('circus_gilt');
export const RINGMASTER = getCircusRamp('circus_ringmaster');
export const BRASS = getCircusRamp('circus_brass');
export const ROT_TIMBER = getCircusRamp('circus_rot_timber');
export const STRAW = getCircusRamp('circus_straw');
export const BACKSTAGE = getCircusRamp('circus_backstage');
export const LIMELIGHT = getCircusRamp('circus_limelight');
export const MILDEW = getCircusRamp('circus_mildew');
export const NAVY = getCircusRamp('circus_navy');
export const BLOOD = getCircusRamp('circus_blood');
export const IRON = getTownRamp('iron_black');
export const TIMBER = getTownRamp('oc_timber');
export const INK: RGB = TOWN_INK;

/** One `rgba()` string for a ramp stop or any colour. */
export function paint(color: RGB, alpha = 1): string {
  return rgba(color, alpha);
}

/** A colour part way between two, for in-between ramp tones. */
export function blend(from: RGB, to: RGB, amount: number): RGB {
  return mix(from, to, amount);
}

const HASH_MULTIPLIER = 31;
const UINT32_MASK = 0xffffffff;

/** A deterministic generator for one cached frame, so a prop paints the same picture every bake. */
export function propRng(seedText: string): Rng {
  let hash = 0;
  for (let index = 0; index < seedText.length; index++) {
    hash = (hash * HASH_MULTIPLIER + seedText.charCodeAt(index)) & UINT32_MASK;
  }
  return mulberry32(hash >>> 0);
}

/** A ramp tone nudged by a few levels, so repeated boards and bars are never one flat colour. */
export function jitterTone(color: RGB, rng: Rng, amount: number): RGB {
  const shift = range(rng, -amount, amount);
  return [color[0] + shift, color[1] + shift, color[2] + shift];
}

/**
 * A fill lit from the upper left: the ramp's light at the lit corner, mid
 * across the body, shadow at the far corner.
 */
export function litFill(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  ramp: Ramp,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, paint(ramp.light));
  gradient.addColorStop(LIT_MID_STOP, paint(ramp.mid));
  gradient.addColorStop(1, paint(ramp.shadow));
  return gradient;
}
const LIT_MID_STOP = 0.5;

/** A cylinder lit from the left: bars, posts, poles, rope. */
export function litColumn(ctx: Ctx, x: number, width: number, ramp: Ramp): CanvasGradient {
  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  gradient.addColorStop(0, paint(ramp.mid));
  gradient.addColorStop(COLUMN_HIGHLIGHT_STOP, paint(ramp.accent));
  gradient.addColorStop(COLUMN_BODY_STOP, paint(ramp.mid));
  gradient.addColorStop(1, paint(ramp.shadow));
  return gradient;
}
const COLUMN_HIGHLIGHT_STOP = 0.28;
const COLUMN_BODY_STOP = 0.55;

/** The one silhouette outline, one screen pixel at the game's 32 px tile. */
export function outline(ctx: Ctx, size: number): void {
  inkOutline(ctx, size);
}

/** A soft pool of shadow where a prop meets the floor or the drape it hangs on. */
export function contactShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  alpha: number = CONTACT_SHADOW_ALPHA,
): void {
  drawTownContactShadow(ctx, cx, cy, radiusX, radiusY, alpha);
}
const CONTACT_SHADOW_ALPHA = 0.6;

// ── Live ownership overlays ──────────────────────────────────────────────────

/**
 * The "the act wants this one" glow, at roughly one breath a second. Slow on
 * purpose: a fast pulse on several props at once turns a lane into a strobe.
 */
const PULSE_PERIOD_FRAMES = 60;
export const PULSE_RADIANS_PER_FRAME = TAU / PULSE_PERIOD_FRAMES;
const PULSE_MIDPOINT = 0.5;

export function pulseStrength(phase: number, pulsing: boolean): number {
  if (!pulsing) return 0;
  return PULSE_MIDPOINT + PULSE_MIDPOINT * Math.sin(phase * PULSE_RADIANS_PER_FRAME);
}

const MIN_OVERLAY_ALPHA = 0.02;
const HALO_RING_COUNT = 3;
const HALO_INNER_RADIUS = 0.33;
const HALO_RING_STEP = 0.08;
const HALO_RING_WIDTH = 0.05;
const HALO_PEAK_ALPHA = 0.55;

/** Concentric strokes rather than a gradient: this runs on several tiles a frame. */
export function paintPulseHalo(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  strength: number,
  color: RGB,
): void {
  if (strength < MIN_OVERLAY_ALPHA) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, size * HALO_RING_WIDTH);
  for (let ring = 0; ring < HALO_RING_COUNT; ring++) {
    ctx.strokeStyle = paint(color, (HALO_PEAK_ALPHA * strength) / (ring + 1));
    ctx.beginPath();
    ctx.arc(cx, cy, size * (HALO_INNER_RADIUS + HALO_RING_STEP * ring), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

const HOOP_RADIUS = 0.44;
const HOOP_WIDTH = 0.05;
const HOOP_TICK_COUNT = 4;
const HOOP_TICK_LENGTH = 0.07;
const HOOP_IDLE_ALPHA = 0.65;

/** The gilt hoop that marks a prop as Donut's to shoot. */
export function paintDonutHoop(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  strength: number,
): void {
  const radius = size * HOOP_RADIUS;
  const alpha = HOOP_IDLE_ALPHA + (1 - HOOP_IDLE_ALPHA) * strength;
  ctx.save();
  ctx.lineWidth = Math.max(1, size * HOOP_WIDTH);
  ctx.strokeStyle = paint(GILT.accent, alpha);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  for (let tick = 0; tick < HOOP_TICK_COUNT; tick++) {
    const angle = (TAU / HOOP_TICK_COUNT) * tick;
    const outer = radius + size * HOOP_TICK_LENGTH;
    ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
  }
  ctx.stroke();
  ctx.restore();
}

const CHEVRON_COUNT = 2;
const CHEVRON_HALF_HEIGHT = 0.09;
const CHEVRON_DEPTH = 0.09;
const CHEVRON_GAP = 0.13;
const CHEVRON_WIDTH = 0.05;
const CHEVRON_IDLE_ALPHA = 0.75;

/** The brass chevrons that mark a prop as Carl's to smash, pointing where the blow goes. */
export function paintCarlChevrons(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  facing: 'west' | 'east',
  strength: number,
): void {
  const approach = facing === 'east' ? 1 : -1;
  const tipX = cx - approach * size * HOOP_RADIUS;
  ctx.save();
  ctx.strokeStyle = paint(BRASS.accent, CHEVRON_IDLE_ALPHA + (1 - CHEVRON_IDLE_ALPHA) * strength);
  ctx.lineWidth = Math.max(1, size * CHEVRON_WIDTH);
  ctx.beginPath();
  for (let index = 0; index < CHEVRON_COUNT; index++) {
    const backX = tipX + approach * size * (CHEVRON_DEPTH + CHEVRON_GAP * index);
    ctx.moveTo(backX, cy - size * CHEVRON_HALF_HEIGHT);
    ctx.lineTo(tipX + approach * size * CHEVRON_GAP * index, cy);
    ctx.lineTo(backX, cy + size * CHEVRON_HALF_HEIGHT);
  }
  ctx.stroke();
  ctx.restore();
}

const IMPACT_DEFAULT_RADIUS = 0.36;
const IMPACT_GLOW_RINGS = 3;
const IMPACT_GLOW_ALPHA = 0.34;
const IMPACT_GLOW_SPREAD = 0.35;
const IMPACT_RIM_ALPHA = 0.9;
const IMPACT_RIM_WIDTH = 0.055;
const IMPACT_SPARK_COUNT = 6;
const IMPACT_SPARK_LENGTH = 0.16;
const IMPACT_SPARK_ALPHA = 0.7;

/**
 * The flash over a prop just hit: added light, a crisp rim and sparks. Never
 * an opaque fill, which would hide the prop the player just hit.
 */
export function paintImpact(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  struck: boolean,
  radiusFraction: number = IMPACT_DEFAULT_RADIUS,
): void {
  if (!struck) return;
  const radius = size * radiusFraction;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ring = IMPACT_GLOW_RINGS; ring > 0; ring--) {
    ctx.fillStyle = paint(LIMELIGHT.accent, IMPACT_GLOW_ALPHA / (ring * ring));
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 - IMPACT_GLOW_SPREAD + IMPACT_GLOW_SPREAD * ring), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = paint(LIMELIGHT.accent, IMPACT_RIM_ALPHA);
  ctx.lineWidth = Math.max(1, size * IMPACT_RIM_WIDTH);
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = paint(LIMELIGHT.accent, IMPACT_SPARK_ALPHA);
  ctx.beginPath();
  for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark++) {
    const angle = (TAU / IMPACT_SPARK_COUNT) * spark;
    const outer = radius + size * IMPACT_SPARK_LENGTH;
    ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Which way the wall a prop is fixed to lies from its own tile: +1 east, -1
 * west. A prop faces the crawler who can reach it, so its wall is on the far
 * side.
 */
export function wallDirectionFor(facing: 'west' | 'east'): number {
  return facing === 'east' ? -1 : 1;
}

/** A frame index into an `frames`-long loop, `framesPerStep` game frames per step. */
export function loopFrame(phase: number, frames: number, framesPerStep: number): number {
  const step = Math.floor(phase / framesPerStep);
  return ((step % frames) + frames) % frames;
}
