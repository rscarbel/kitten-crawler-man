/**
 * The fire engine shared by `burn` and `magic_burn`.
 *
 * What makes a character read as *actually on fire* rather than as a character
 * with a flame icon over its head is that the fire happens in four places at
 * once, and every one of them is doing something the others cannot:
 *
 * - the **body itself glows**, through its own silhouette, so the art is lit by
 *   the fire instead of merely standing next to it;
 * - **tongues** are rooted all the way up the figure, not just at its feet, so
 *   the fire has the shape of a burning person;
 * - **embers** break away and rise past the head, which is the cue that says
 *   "combustion" rather than "orange blob";
 * - **light pools on the floor** underneath, which is what fixes the fire in the
 *   world instead of leaving it floating in front of the camera.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import {
  bodyTop,
  bodyX,
  bodyY,
  drawEmbermote,
  drawFlameTongue,
  drawGlow,
  drawGroundPool,
  gradientContext,
  hash01,
  hashRange,
  particlePhase,
  rgba,
  PARTICLE_KEY_STRIDE,
  type Rgb,
  type StatusVisualFrame,
} from './statusPaint';

/** The colours one kind of fire burns in. */
export interface FlamePalette {
  /** Coolest, widest layer of a tongue. */
  readonly outer: Rgb;
  /** The body of the flame. */
  readonly mid: Rgb;
  /** The near-white heart, and the colour of the embers. */
  readonly core: Rgb;
  /** Light cast on the floor and on the character's own art. */
  readonly light: Rgb;
  /** Rising soot. `null` for fires that produce none, like arcane flame. */
  readonly smoke: Rgb | null;
}

export const NATURAL_FLAME: FlamePalette = {
  outer: [186, 42, 8],
  mid: [247, 130, 22],
  core: [255, 237, 168],
  light: [255, 146, 46],
  smoke: [48, 44, 42],
};

export const ARCANE_FLAME: FlamePalette = {
  outer: [92, 26, 168],
  mid: [178, 84, 255],
  core: [206, 246, 255],
  light: [168, 108, 255],
  smoke: null,
};

const TONGUE_COUNT = 11;
/** One tongue is born, rises and dies in a little under a second. */
const TONGUE_RATE_PER_MS = 0.0012;
/** Roots spread the full width of the figure and slightly past it. */
const TONGUE_ROOT_ACROSS_MIN = -0.15;
const TONGUE_ROOT_ACROSS_MAX = 1.15;
/**
 * Roots climb the whole figure. Fire on a person is not a bonfire at their feet;
 * it is on their arms and shoulders too, and the top third is what sells it.
 */
const TONGUE_ROOT_UP_MIN = 0.02;
const TONGUE_ROOT_UP_MAX = 0.92;
/** A tongue's reach, as a share of the figure's own height. */
const TONGUE_HEIGHT_MIN = 0.3;
const TONGUE_HEIGHT_MAX = 0.55;
/** …and its base width, as a share of the figure's width. */
const TONGUE_WIDTH_MIN = 0.4;
const TONGUE_WIDTH_MAX = 0.72;
/** How much of its width a tongue has lost by the time it dies. */
const TONGUE_NARROWING = 0.7;
const TONGUE_LEAN_SPEED = 0.006;
const TONGUE_LEAN_REACH = 0.35;
/** Nested passes: the mid layer at this fraction of the outer, the core smaller again. */
const TONGUE_MID_SCALE = 0.66;
const TONGUE_CORE_SCALE = 0.34;
/**
 * A tongue reaches full brightness in the first eighth of its life and spends
 * the rest fading — the asymmetry is what stops the group looking like it is
 * breathing in unison.
 */
const TONGUE_IGNITE_RATE = 8;
const TONGUE_DIE_RATE = 2;

const EMBER_COUNT = 9;
const EMBER_RATE_PER_MS = 0.00055;
/** Embers clear the head by a good margin, which is where the eye looks for them. */
const EMBER_RISE_MIN = 1;
const EMBER_RISE_MAX = 1.7;
const EMBER_DRIFT_REACH = 0.9;
const EMBER_RADIUS_MIN = 0.06;
const EMBER_RADIUS_MAX = 0.14;
const EMBER_ALPHA = 0.95;
const EMBER_SPAWN_SPREAD = 1.1;

const SMOKE_COUNT = 5;
const SMOKE_RATE_PER_MS = 0.00028;
const SMOKE_RISE = 1;
const SMOKE_DRIFT_REACH = 1.1;
const SMOKE_RADIUS_START = 0.3;
const SMOKE_RADIUS_END = 1.1;
const SMOKE_ALPHA = 0.34;
/** Soot only becomes visible once it has cleared the flame that made it. */
const SMOKE_FADE_IN = 0.3;
const SMOKE_SPAWN_SPREAD = 0.6;

const POOL_RADIUS_X = 1.5;
const POOL_RADIUS_Y = 0.22;
const POOL_ALPHA = 0.55;
/** Ground light rises and falls with the fire rather than sitting at one level. */
const POOL_FLICKER_SPEED = 0.011;
const POOL_FLICKER_DEPTH = 0.25;

/**
 * How hard the fire lights the character's own art. Two coats, because one
 * cannot do both jobs: the opaque coat carries the colour, which is all that
 * survives on snow or sand, and the additive coat carries the heat, which is
 * what makes the figure glow on a dark dungeon floor.
 */
const BODY_HUE_ALPHA = 0.42;
const BODY_HEAT_ALPHA = 0.7;
const BODY_GLOW_FLICKER_SPEED = 0.017;
const BODY_GLOW_FLICKER_DEPTH = 0.22;
/**
 * The glow runs hot at the feet and merely warm at the head. A flat wash makes
 * the figure look like a cut-out of one colour; the ramp keeps its own shading
 * readable while still saying the whole thing is alight.
 */
const BODY_GLOW_MID_ALPHA = 0.6;
const BODY_GLOW_TOP_ALPHA = 0.3;
const BODY_GLOW_RIM_ALPHA = 0.7;

const HALF = 0.5;

/** A 0..1 oscillation from a sine, which is what most flickers want. */
function flicker(timeMs: number, speed: number): number {
  return HALF + HALF * Math.sin(timeMs * speed);
}

/**
 * The vertical ramps, built once per palette and reused for the life of the
 * session.
 *
 * They are defined in a normalised space — the gradient runs from 0 to -1 — and
 * the caller scales the transform to the figure's height before filling. Canvas
 * resolves a gradient's coordinates in the user space in force when it is
 * *painted*, not when it is created, so one object serves a character at any
 * position on screen. Building them per frame instead would allocate two
 * gradients and six colour strings for every burning creature, every frame,
 * purely because the camera moved.
 */
const rampCache = new Map<FlamePalette, { hue: CanvasGradient; heat: CanvasGradient }>();

function buildRamp(hot: Rgb, warm: Rgb, cool: Rgb): CanvasGradient {
  const gradient = gradientContext().createLinearGradient(0, 0, 0, -1);
  gradient.addColorStop(0, rgba(hot, 1));
  gradient.addColorStop(HALF, rgba(warm, BODY_GLOW_MID_ALPHA));
  gradient.addColorStop(1, rgba(cool, BODY_GLOW_TOP_ALPHA));
  return gradient;
}

function ramps(palette: FlamePalette): { hue: CanvasGradient; heat: CanvasGradient } {
  const cached = rampCache.get(palette);
  if (cached !== undefined) return cached;
  const built = {
    hue: buildRamp(palette.outer, palette.mid, palette.mid),
    heat: buildRamp(palette.light, palette.mid, palette.core),
  };
  rampCache.set(palette, built);
  return built;
}

/**
 * Fills the whole layer box with one of the ramps, stretched so its span covers
 * the figure from sole to scalp. The box is filled rather than just that span
 * because a creature whose art overruns the figure box it declared should still
 * be coated to its edges rather than sliced off at the shoulders.
 */
function paintRamp(
  target: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  gradient: CanvasGradient,
  footY: number,
  height: number,
): void {
  target.save();
  target.translate(0, footY);
  target.scale(1, height);
  target.fillStyle = gradient;
  target.fillRect(box.x, (box.y - footY) / height, box.width, box.height / height);
  target.restore();
}

/**
 * The coats of fire painted through the character's own shape. Without these the
 * figure stays its normal colour while flames pass in front of it, which reads
 * as a costume rather than as burning.
 */
export function flameBodyLayers(f: StatusVisualFrame, palette: FlamePalette): SilhouetteLayer[] {
  const intensity =
    f.fade * (1 - BODY_GLOW_FLICKER_DEPTH * flicker(f.timeMs, BODY_GLOW_FLICKER_SPEED));

  return [
    {
      paint: (target, box) => {
        paintRamp(target, box, ramps(palette).hue, f.footY, f.height);
      },
      alpha: BODY_HUE_ALPHA * intensity,
    },
    {
      paint: (target, box) => {
        paintRamp(target, box, ramps(palette).heat, f.footY, f.height);
      },
      blend: 'lighter',
      alpha: BODY_HEAT_ALPHA * intensity,
      rimColor: rgba(palette.mid, 1),
      rimAlpha: BODY_GLOW_RIM_ALPHA * intensity,
    },
  ];
}

/** Fire drawn in world space: floor light, tongues, embers and soot. */
export function drawFlames(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  ctx.globalCompositeOperation = 'lighter';

  const poolStrength = 1 - POOL_FLICKER_DEPTH * flicker(f.timeMs, POOL_FLICKER_SPEED);
  drawGroundPool(
    ctx,
    palette.light,
    f.centerX,
    f.footY,
    f.width * POOL_RADIUS_X,
    f.height * POOL_RADIUS_Y,
    POOL_ALPHA * poolStrength * f.fade,
  );

  drawTongues(ctx, f, palette);
  drawEmbers(ctx, f, palette);

  ctx.globalCompositeOperation = 'source-over';
  if (palette.smoke !== null) drawSmoke(ctx, f, palette.smoke);
}

function drawTongues(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  for (let i = 0; i < TONGUE_COUNT; i++) {
    const key = f.seed + i * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i, TONGUE_RATE_PER_MS * hashRange(key + 4, 0.75, 1.3));
    const alpha =
      Math.min(1, phase * TONGUE_IGNITE_RATE) * Math.min(1, (1 - phase) * TONGUE_DIE_RATE) * f.fade;
    if (alpha <= 0) continue;

    const rootX = bodyX(f, hashRange(key, TONGUE_ROOT_ACROSS_MIN, TONGUE_ROOT_ACROSS_MAX));
    const rootY = bodyY(f, hashRange(key + 1, TONGUE_ROOT_UP_MIN, TONGUE_ROOT_UP_MAX));
    const reach = f.height * hashRange(key + 2, TONGUE_HEIGHT_MIN, TONGUE_HEIGHT_MAX);
    const baseWidth = f.width * hashRange(key + 3, TONGUE_WIDTH_MIN, TONGUE_WIDTH_MAX);

    const height = reach * phase;
    const width = baseWidth * (1 - TONGUE_NARROWING * phase);
    const lean = Math.sin(f.timeMs * TONGUE_LEAN_SPEED + key) * f.width * TONGUE_LEAN_REACH * phase;

    // The outer two passes are opaque so the flame keeps its colour over snow or
    // sand, where an additive one would simply go white; only the core adds
    // light, which is what still makes it glow on a dark floor.
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(palette.outer, 1);
    drawFlameTongue(ctx, rootX, rootY, width, height, lean);
    ctx.fillStyle = rgba(palette.mid, 1);
    drawFlameTongue(ctx, rootX, rootY, width * TONGUE_MID_SCALE, height * TONGUE_MID_SCALE, lean);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(palette.core, 1);
    drawFlameTongue(ctx, rootX, rootY, width * TONGUE_CORE_SCALE, height * TONGUE_CORE_SCALE, lean);
  }
}

function drawEmbers(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  for (let i = 0; i < EMBER_COUNT; i++) {
    const key = f.seed + (i + TONGUE_COUNT) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + TONGUE_COUNT, EMBER_RATE_PER_MS);
    const alpha = (1 - phase) * EMBER_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const rise = f.height * hashRange(key, EMBER_RISE_MIN, EMBER_RISE_MAX) * phase;
    const spawnX = f.centerX + (hash01(key + 1) - HALF) * f.width * EMBER_SPAWN_SPREAD;
    // Embers curl as they rise, which is what separates them from the tongues
    // they broke off: a straight-up spark reads as a lens flare.
    const drift = Math.sin(phase * Math.PI * 2 + key) * f.width * EMBER_DRIFT_REACH * phase;
    const radius = f.width * hashRange(key + 2, EMBER_RADIUS_MIN, EMBER_RADIUS_MAX);

    drawEmbermote(ctx, palette.mid, palette.core, spawnX + drift, f.footY - rise, radius, alpha);
  }
}

function drawSmoke(ctx: CanvasRenderingContext2D, f: StatusVisualFrame, smoke: Rgb): void {
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const key = f.seed + (i + TONGUE_COUNT + EMBER_COUNT) * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, i + TONGUE_COUNT + EMBER_COUNT, SMOKE_RATE_PER_MS);
    const visibility = Math.min(1, phase / SMOKE_FADE_IN) * (1 - phase);
    const alpha = visibility * SMOKE_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const rise = f.height * SMOKE_RISE * phase;
    const drift = Math.sin(phase * Math.PI + key) * f.width * SMOKE_DRIFT_REACH * phase;
    const radius = f.width * (SMOKE_RADIUS_START + (SMOKE_RADIUS_END - SMOKE_RADIUS_START) * phase);
    const spawnX = f.centerX + (hash01(key) - HALF) * f.width * SMOKE_SPAWN_SPREAD;

    drawGlow(ctx, smoke, spawnX + drift, bodyTop(f) - rise, radius, alpha);
  }
}
