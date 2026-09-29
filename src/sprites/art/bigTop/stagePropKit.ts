/**
 * The shared hand of the hall of mirrors, the finale and the interval rooms:
 * the ramps their props are painted from, the one outline, the contact shadow
 * under anything that stands, and the two live overlays every interactable
 * wears — the owner's pulse and the flash of a landed blow.
 *
 * The light is the town's single upper-left sun, which indoors is read as the
 * stage light from the flies: lit edges face up and left, shade falls down and
 * right.
 */

import { getCircusRamp, getTownRamp, TOWN_CONTACT_SHADOW, TOWN_INK } from '../town/townPalette';
import type { RGB } from '../town/townPalette';
import { OUTLINE_ALPHA, rgba } from '../town/townArt';
import { fillSoftEllipse } from '../softShade';

type Ctx = CanvasRenderingContext2D;

export const FULL_TURN = Math.PI * 2;
export const HALF_TURN = Math.PI;
export const QUARTER_TURN = Math.PI / 2;

export const BLOOD = getCircusRamp('circus_blood');
export const BONE = getCircusRamp('circus_bone');
export const BRUISE = getCircusRamp('circus_bruise');
export const BRASS = getCircusRamp('circus_brass');
export const NAVY = getCircusRamp('circus_navy');
export const VINE = getCircusRamp('circus_vine');
export const BACKSTAGE = getCircusRamp('circus_backstage');
export const ROT_TIMBER = getCircusRamp('circus_rot_timber');
export const STRAW = getCircusRamp('circus_straw');
export const LIMELIGHT = getCircusRamp('circus_limelight');
export const IRON = getTownRamp('iron_black');

/** Polished gilt: the one colour brighter than the brass ramp's accent, for gold leaf catching the light. */
export const GILT_GLINT: RGB = [246, 226, 160];

export { rgba };

/**
 * One screen pixel at the game's 32-pixel tile, whatever size the prop is
 * being baked at — the town's single outline, restated against a tile size
 * because these painters are handed pixels per tile, not a bake scale.
 */
const DISPLAY_TILE_PX = 32;
export function outlineWidth(size: number): number {
  return Math.max(1, size / DISPLAY_TILE_PX);
}

/** Strokes the current path as the silhouette outline: warm near-black, one screen pixel, one pass. */
export function inkCurrentPath(ctx: Ctx, size: number): void {
  ctx.strokeStyle = rgba(TOWN_INK, OUTLINE_ALPHA);
  ctx.lineWidth = outlineWidth(size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** A soft pool of contact shadow under something standing on the sawdust. */
export function paintContactShadow(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  fillSoftEllipse(ctx, centreX, centreY, radiusX, radiusY, rgba(TOWN_CONTACT_SHADOW, 1), alpha);
}

/** A value quantised to `steps` levels across 0..1, so a continuous input picks a cached frame. */
export function quantise(value: number, steps: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * steps);
}

/** A looping animation frame: `frames` evenly across a cycle of `periodFrames` game frames. */
export function loopFrame(phase: number, periodFrames: number, frames: number): number {
  const cycle = (((phase % periodFrames) + periodFrames) % periodFrames) / periodFrames;
  return Math.min(frames - 1, Math.floor(cycle * frames));
}

// ── The owner's pulse and a landed blow ─────────────────────────────────────

const PULSE_PERIOD_FRAMES = 60;
const HALO_RING_COUNT = 3;
const HALO_INNER_RADIUS = 0.33;
const HALO_RING_STEP = 0.08;
const HALO_RING_WIDTH = 0.05;
const HALO_PEAK_ALPHA = 0.55;
const MIN_VISIBLE_ALPHA = 0.02;

/** How strongly an interactable pulses this frame: a slow breath while it wants attention, else nothing. */
export function pulseStrength(phase: number, pulsing: boolean): number {
  if (!pulsing) return 0;
  return (1 + Math.sin((phase / PULSE_PERIOD_FRAMES) * FULL_TURN)) / 2;
}

/**
 * Concentric rings in the owner's metal round an interactable that wants
 * the player's attention. Strokes, not a gradient: this runs live on every
 * pulsing prop in view.
 */
export function paintPulseHalo(
  ctx: Ctx,
  centreX: number,
  centreY: number,
  size: number,
  strength: number,
  color: RGB,
): void {
  if (strength < MIN_VISIBLE_ALPHA) return;
  ctx.save();
  try {
    ctx.lineWidth = Math.max(1, size * HALO_RING_WIDTH);
    for (let ring = 0; ring < HALO_RING_COUNT; ring++) {
      ctx.strokeStyle = rgba(color, (HALO_PEAK_ALPHA * strength) / (ring + 1));
      ctx.beginPath();
      ctx.arc(centreX, centreY, size * (HALO_INNER_RADIUS + HALO_RING_STEP * ring), 0, FULL_TURN);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

const IMPACT_RADIUS = 0.36;
const IMPACT_GLOW_ALPHA = 0.3;
const IMPACT_RIM_ALPHA = 0.9;
const IMPACT_RIM_WIDTH = 0.055;
const IMPACT_SPARK_COUNT = 6;
const IMPACT_SPARK_LENGTH = 0.16;
const IMPACT_SPARK_ALPHA = 0.7;

/**
 * The flash over a prop that has just been hit: added light and a crisp rim
 * with sparks, never an opaque fill, so the prop stays legible through it.
 */
export function paintImpact(ctx: Ctx, centreX: number, centreY: number, size: number): void {
  const radius = size * IMPACT_RADIUS;
  ctx.save();
  try {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(LIMELIGHT.accent, IMPACT_GLOW_ALPHA);
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(LIMELIGHT.accent, IMPACT_RIM_ALPHA);
    ctx.lineWidth = Math.max(1, size * IMPACT_RIM_WIDTH);
    ctx.beginPath();
    ctx.arc(centreX, centreY, radius, 0, FULL_TURN);
    ctx.stroke();
    ctx.strokeStyle = rgba(LIMELIGHT.accent, IMPACT_SPARK_ALPHA);
    for (let spark = 0; spark < IMPACT_SPARK_COUNT; spark++) {
      const angle = (FULL_TURN / IMPACT_SPARK_COUNT) * spark;
      const outer = radius + size * IMPACT_SPARK_LENGTH;
      ctx.beginPath();
      ctx.moveTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
      ctx.lineTo(centreX + Math.cos(angle) * outer, centreY + Math.sin(angle) * outer);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
