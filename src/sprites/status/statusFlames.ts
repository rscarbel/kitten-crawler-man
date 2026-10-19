/**
 * The fire engine shared by `burn` and `magic_burn`.
 *
 * What makes a character read as *actually on fire* rather than as a character
 * with flame icons stuck to it is that the fire behaves like burning gas, in
 * five places at once:
 *
 * - the **body itself glows**, through its own silhouette, so the art is lit by
 *   the fire instead of merely standing next to it;
 * - **parcels of flame** are born all over the figure, rise, neck in, cool from
 *   yellow to red and go out. They are soft baked stamps rather than filled
 *   paths: a filled path has a hard edge whatever curve it follows, and a dozen
 *   of them scattered over a figure read as candy corn, not fire;
 * - **every parcel answers the same draft**, and a running figure drags its fire
 *   behind it. Flames that each lean their own way read as a scatter of darts;
 * - **embers and soot** break away and rise past the head, which is the cue that
 *   says "combustion" rather than "orange blob";
 * - **light pools on the floor** underneath, which is what fixes the fire in the
 *   world instead of leaving it floating in front of the camera.
 *
 * The parcels are the same baked stamps as the Big Top's flame vents
 * ({@link ../flameStamps}), so a burning crawler and a burning vent are visibly
 * the same fire.
 */

import type { SilhouetteLayer } from '../../core/silhouetteComposite';
import type { CanvasSurface } from '../../core/canvasSurface';
import { onCanvasRecovery } from '../../core/canvasRecovery';
import {
  FLAME_BODY_TIERS,
  MIN_VISIBLE_ALPHA,
  bakeFlameBodyTiers,
  flameStamps,
  hashUnit,
  stampTeardrop,
  type FlameInk,
} from '../flameStamps';
import {
  bodyTop,
  drawEmbermote,
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
  /** Coolest layer: the colour the body glow fades to at the head. */
  readonly outer: Rgb;
  /** The body of the flame. */
  readonly mid: Rgb;
  /** The near-white heart, and the colour of the embers. */
  readonly core: Rgb;
  /** Light cast on the floor and on the character's own art. */
  readonly light: Rgb;
  /** Rising soot. `null` for fires that produce none, like arcane flame. */
  readonly smoke: Rgb | null;
  /**
   * The heat ramp a parcel cools through as it climbs, hottest first. The
   * opacity falls with the heat, which is what lets the tips of the fire go out
   * rather than end in a cut-off edge.
   */
  readonly tiers: ReadonlyArray<FlameInk>;
}

export const NATURAL_FLAME: FlamePalette = {
  outer: [186, 42, 8],
  mid: [247, 130, 22],
  core: [255, 237, 168],
  light: [255, 146, 46],
  smoke: [36, 32, 30],
  tiers: FLAME_BODY_TIERS,
};

export const ARCANE_FLAME: FlamePalette = {
  outer: [92, 26, 168],
  mid: [178, 84, 255],
  core: [206, 246, 255],
  light: [168, 108, 255],
  smoke: null,
  tiers: [
    { red: 226, green: 168, blue: 255, alpha: 0.95 },
    { red: 208, green: 132, blue: 255, alpha: 0.95 },
    { red: 192, green: 104, blue: 255, alpha: 0.94 },
    { red: 176, green: 86, blue: 255, alpha: 0.92 },
    { red: 164, green: 86, blue: 250, alpha: 0.88 },
    { red: 146, green: 64, blue: 236, alpha: 0.82 },
    { red: 126, green: 46, blue: 214, alpha: 0.72 },
    { red: 104, green: 32, blue: 186, alpha: 0.56 },
    { red: 84, green: 22, blue: 156, alpha: 0.34 },
    { red: 64, green: 14, blue: 124, alpha: 0.16 },
  ],
};

/**
 * Parcels alive at once on one figure. Fewer and the gaps between them show the
 * figure as a stack of separate flames; more and the fire turns to a solid slab
 * that hides who is burning.
 */
const PARCEL_COUNT = 22;
/** One parcel is born, rises and goes out in a little over half a second. */
const PARCEL_LIFETIME_MS = 620;
/**
 * How far a parcel's release may slip inside its own slot. A free offset clumps
 * the releases and the whole fire throbs on a cycle one lifetime long.
 */
const PARCEL_RELEASE_JITTER = 0.8;
/** A parcel grows in from nothing over the first slice of its life. */
const PARCEL_BIRTH_FRACTION = 0.14;
const PARCEL_ALPHA_FLOOR = 0.55;

/** Roots spread across the whole width of the figure, as a share of that width. */
const PARCEL_ROOT_SPREAD = 0.8;
/**
 * Roots climb to the shoulders, weighted toward the legs and waist: the
 * figure is engulfed from below, and the head only ever has fire licking past
 * it, which keeps the face readable.
 */
const PARCEL_ROOT_UP_MAX = 0.78;
const PARCEL_ROOT_UP_BIAS = 1.2;
/** How far a parcel climbs over its life, as a share of the figure's height. */
const PARCEL_RISE = 0.64;
/** Burning gas accelerates as it rises; at 0 the climb would be linear. */
const PARCEL_RISE_ACCELERATION = 0.45;
/** Parcel foot half-width and body height at birth, as shares of the figure. */
const PARCEL_HALF_WIDTH = 0.36;
const PARCEL_BODY_HEIGHT = 0.4;
const PARCEL_SIZE_JITTER = 0.5;
/** A parcel holds its girth until here in its life, then necks in to nothing. */
const PARCEL_WAIST_START = 0.3;
const PARCEL_TAPER_EXPONENT = 1.4;
/** How much of its height a parcel keeps at the end of its life. */
const PARCEL_BODY_SURVIVAL = 0.45;
/**
 * How much of the heat ramp a parcel has used up by the time it dies. Short of
 * the whole ramp so the topmost licks are still faintly lit as they vanish.
 */
const PARCEL_TIER_REACH = 0.95;
/** Roots higher on the figure start a little cooler: heat collects low. */
const PARCEL_TIER_ROOT_SHARE = 0.2;
/** A parcel's own wander on top of the shared draft, as a share of figure width. */
const PARCEL_SWAY_REACH = 0.14;
const PARCEL_SWAY_CYCLES = 1.6;
const PARCEL_MAX_TILT = 0.55;
/** Below this many pixels a stamp is a speck that only adds noise. */
const PARCEL_MIN_HALF_WIDTH = 0.6;

/** The air the whole fire leans in. Two sines so it never settles into a rhythm. */
const DRAFT_SLOW_SPEED = 0.0021;
const DRAFT_FAST_SPEED = 0.0053;
const DRAFT_FAST_SHARE = 0.35;
const DRAFT_REACH = 0.16;
/** A running figure drags its flames behind it, as a share of its width. */
const DRAFT_RUN_TRAIL = 0.75;

/**
 * Hot spots buried in the fire: where the fuel is. Fixed on the figure rather
 * than travelling, and flickering hard, because that is what the inside of a
 * fire does — a uniform orange mass with no hotter heart reads as a costume.
 */
const HOTSPOT_COUNT = 4;
const HOTSPOT_ROOT_UP_MIN = 0.12;
const HOTSPOT_ROOT_UP_MAX = 0.6;
const HOTSPOT_SPREAD = 0.6;
const HOTSPOT_RADIUS = 0.34;
const HOTSPOT_ALPHA = 0.32;
const HOTSPOT_FLICKER_SPEED_MIN = 0.011;
const HOTSPOT_FLICKER_SPEED_MAX = 0.024;
const HOTSPOT_FLICKER_DEPTH = 0.7;

const EMBER_COUNT = 10;
const EMBER_RATE_PER_MS = 0.0009;
/** Embers clear the head by a good margin, which is where the eye looks for them. */
/** Each spark climbs at its own pace, so the shower never rises as a rank. */
const EMBER_RATE_SPREAD_MIN = 0.7;
const EMBER_RATE_SPREAD_MAX = 1.3;
const EMBER_RISE_MIN = 0.9;
const EMBER_RISE_MAX = 1.6;
const EMBER_DRIFT_REACH = 0.7;
/** Embers are sparks: a fraction of the size of the parcels they broke off. */
const EMBER_RADIUS_MIN = 0.035;
const EMBER_RADIUS_MAX = 0.075;
const EMBER_ALPHA = 1;
const EMBER_SPAWN_SPREAD = 0.9;
const EMBER_SPAWN_UP_MAX = 0.7;
/** Sparks twinkle as they tumble, rather than dimming in a smooth line. */
const EMBER_TWINKLE_SPEED = 0.031;
const EMBER_TWINKLE_DEPTH = 0.5;

const SMOKE_COUNT = 6;
const SMOKE_RATE_PER_MS = 0.0003;
const SMOKE_RISE = 1.2;
const SMOKE_DRIFT_REACH = 1;
const SMOKE_RADIUS_START = 0.5;
const SMOKE_RADIUS_END = 1.5;
const SMOKE_ALPHA = 0.24;
/** Soot only becomes visible once it has cleared the flame that made it. */
const SMOKE_FADE_IN = 0.25;
const SMOKE_SPAWN_SPREAD = 0.6;
/** Smoke is born below the crown, inside the tallest licks, not above them. */
const SMOKE_BIRTH_DROP = 0.15;

const POOL_RADIUS_X = 1.6;
const POOL_RADIUS_Y = 0.24;
const POOL_ALPHA = 0.5;
/** Ground light rises and falls with the fire rather than sitting at one level. */
const POOL_FLICKER_SLOW_SPEED = 0.009;
const POOL_FLICKER_FAST_SPEED = 0.023;
const POOL_FLICKER_DEPTH = 0.3;

/**
 * Distinct offsets into the hash so a parcel's size, brightness, sway, root and
 * bend are independent draws rather than readings of one number — reusing a
 * draw ties the shape to the lean and the fire starts to look combed.
 */
const SALT_SIZE = 101;
const SALT_BRIGHTNESS = 211;
const SALT_SWAY = 307;
const SALT_ROOT_ACROSS = 401;
const SALT_ROOT_UP = 509;
const SALT_BEND = 709;
const SALT_MIRROR = 811;
/** Spreads one figure's parcel lanes away from its neighbour's. */
const SEED_LANE_STRIDE = 97;

const HALF = 0.5;
const TAU = Math.PI * 2;

/**
 * How hard the fire lights the character's own art. Two coats, because one
 * cannot do both jobs: the opaque coat carries the colour, which is all that
 * survives on snow or sand, and the additive coat carries the heat, which is
 * what makes the figure glow on a dark dungeon floor.
 */
const BODY_HUE_ALPHA = 0.3;
const BODY_HEAT_ALPHA = 0.38;
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

const tierCache = new Map<FlamePalette, ReadonlyArray<ReadonlyArray<CanvasSurface>>>();
// Baked once and kept; a purge would leave it blank for good.
onCanvasRecovery(() => tierCache.clear());

function parcelStamps(palette: FlamePalette): ReadonlyArray<ReadonlyArray<CanvasSurface>> {
  if (palette.tiers === FLAME_BODY_TIERS) return flameStamps().body;
  const cached = tierCache.get(palette);
  if (cached !== undefined) return cached;
  const baked = bakeFlameBodyTiers(palette.tiers);
  tierCache.set(palette, baked);
  return baked;
}

/** Fire drawn in world space: floor light, soot, flame parcels, hot spots and embers. */
export function drawFlames(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  ctx.globalCompositeOperation = 'lighter';
  const poolBreath =
    (Math.sin(f.timeMs * POOL_FLICKER_SLOW_SPEED) + Math.sin(f.timeMs * POOL_FLICKER_FAST_SPEED)) *
    HALF;
  const poolStrength = 1 - POOL_FLICKER_DEPTH * (HALF + HALF * poolBreath);
  drawGroundPool(
    ctx,
    palette.light,
    f.centerX,
    f.footY,
    f.width * POOL_RADIUS_X,
    f.height * POOL_RADIUS_Y,
    POOL_ALPHA * poolStrength * f.fade,
  );

  // Soot goes down before the flames so the licks it rises out of stay in front.
  ctx.globalCompositeOperation = 'source-over';
  if (palette.smoke !== null) drawSmoke(ctx, f, palette.smoke);

  drawParcels(ctx, f, palette);

  ctx.globalCompositeOperation = 'lighter';
  drawHotspots(ctx, f, palette);
  drawEmbers(ctx, f, palette);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * The sideways push every parcel shares, in pixels at the top of its climb.
 * Running trails the fire behind the runner; standing still leaves only the
 * wander of the air.
 */
function sharedDraft(f: StatusVisualFrame): number {
  const slow = Math.sin(f.timeMs * DRAFT_SLOW_SPEED + f.seed);
  const fast = Math.sin(f.timeMs * DRAFT_FAST_SPEED + f.seed);
  const wander = (slow * (1 - DRAFT_FAST_SHARE) + fast * DRAFT_FAST_SHARE) * DRAFT_REACH;
  const trail = f.moving ? -f.facingX * DRAFT_RUN_TRAIL : 0;
  return (wander + trail) * f.width;
}

function drawParcels(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  const tiers = parcelStamps(palette);
  const topTier = tiers.length - 1;
  const draft = sharedDraft(f);
  const clock = f.timeMs / PARCEL_LIFETIME_MS + hash01(f.seed);
  const lane = f.seed * SEED_LANE_STRIDE;

  for (let i = 0; i < PARCEL_COUNT; i++) {
    const parcel = lane + i;
    const slot = i + (hashUnit(parcel, i) - HALF) * PARCEL_RELEASE_JITTER;
    const release = clock + slot / PARCEL_COUNT;
    const birth = Math.floor(release);
    const age = release - birth;

    const brightness =
      PARCEL_ALPHA_FLOOR + (1 - PARCEL_ALPHA_FLOOR) * hashUnit(birth + SALT_BRIGHTNESS, parcel);
    const birthFade = Math.min(1, age / PARCEL_BIRTH_FRACTION);
    const alpha = brightness * birthFade * f.fade;
    if (alpha < MIN_VISIBLE_ALPHA) continue;

    const rootAcross = (hashUnit(birth + SALT_ROOT_ACROSS, parcel) - HALF) * PARCEL_ROOT_SPREAD;
    const rootUp =
      Math.pow(hashUnit(birth + SALT_ROOT_UP, parcel), PARCEL_ROOT_UP_BIAS) * PARCEL_ROOT_UP_MAX;
    const climb = age * (1 - PARCEL_RISE_ACCELERATION + PARCEL_RISE_ACCELERATION * age);

    const sizeJitter = 1 + (hashUnit(birth + SALT_SIZE, parcel) - HALF) * PARCEL_SIZE_JITTER;
    const pastWaist = Math.max(0, age - PARCEL_WAIST_START) / (1 - PARCEL_WAIST_START);
    const girth = Math.pow(1 - pastWaist, PARCEL_TAPER_EXPONENT);
    const halfWidth = f.width * PARCEL_HALF_WIDTH * sizeJitter * girth;
    if (halfWidth < PARCEL_MIN_HALF_WIDTH) continue;
    const bodyHeight =
      f.height *
      PARCEL_BODY_HEIGHT *
      sizeJitter *
      (PARCEL_BODY_SURVIVAL + (1 - PARCEL_BODY_SURVIVAL) * (1 - age));

    const swaySeed = hashUnit(birth + SALT_SWAY, parcel) * TAU;
    const sway = Math.sin(age * TAU * PARCEL_SWAY_CYCLES + swaySeed) * f.width * PARCEL_SWAY_REACH;
    const drift = sway * age + draft * climb;
    const footX = f.centerX + rootAcross * f.width + drift;
    const footY = f.footY - (rootUp + PARCEL_RISE * climb) * f.height;

    const heat = Math.min(1, climb * PARCEL_TIER_REACH + rootUp * PARCEL_TIER_ROOT_SHARE);
    const bends = tiers[Math.min(topTier, Math.floor(heat * tiers.length))];
    const bendIndex = Math.min(
      bends.length - 1,
      Math.floor(hashUnit(birth + SALT_BEND, parcel) * bends.length),
    );
    const mirrored = hashUnit(birth + SALT_MIRROR, parcel) < HALF;
    // Tilted by the air that has pushed it, so a parcel leans the way it is
    // travelling and the whole fire combs one way rather than bristling.
    const tilt = Math.max(-PARCEL_MAX_TILT, Math.min(PARCEL_MAX_TILT, drift / bodyHeight));

    stampTeardrop(
      ctx,
      bends[bendIndex],
      footX,
      footY,
      halfWidth,
      bodyHeight,
      tilt,
      Math.min(1, alpha),
      mirrored,
    );
  }
}

function drawHotspots(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  for (let i = 0; i < HOTSPOT_COUNT; i++) {
    const key = f.seed + (i + PARCEL_COUNT) * PARTICLE_KEY_STRIDE;
    const speed = hashRange(key, HOTSPOT_FLICKER_SPEED_MIN, HOTSPOT_FLICKER_SPEED_MAX);
    const pulse = HALF + HALF * Math.sin(f.timeMs * speed + key);
    const alpha = HOTSPOT_ALPHA * (1 - HOTSPOT_FLICKER_DEPTH * pulse) * f.fade;
    const x = f.centerX + (hash01(key + 1) - HALF) * f.width * HOTSPOT_SPREAD;
    const y = f.footY - hashRange(key + 2, HOTSPOT_ROOT_UP_MIN, HOTSPOT_ROOT_UP_MAX) * f.height;
    drawGlow(ctx, palette.mid, x, y, f.width * HOTSPOT_RADIUS, alpha);
  }
}

function drawEmbers(
  ctx: CanvasRenderingContext2D,
  f: StatusVisualFrame,
  palette: FlamePalette,
): void {
  const draft = sharedDraft(f);
  for (let i = 0; i < EMBER_COUNT; i++) {
    const index = i + PARCEL_COUNT + HOTSPOT_COUNT;
    const key = f.seed + index * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(
      f,
      index,
      EMBER_RATE_PER_MS * hashRange(key + 3, EMBER_RATE_SPREAD_MIN, EMBER_RATE_SPREAD_MAX),
    );
    const twinkle =
      1 - EMBER_TWINKLE_DEPTH * (HALF + HALF * Math.sin(f.timeMs * EMBER_TWINKLE_SPEED + key));
    const alpha = (1 - phase) * twinkle * EMBER_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const rise = f.height * hashRange(key, EMBER_RISE_MIN, EMBER_RISE_MAX) * phase;
    const spawnX = f.centerX + (hash01(key + 1) - HALF) * f.width * EMBER_SPAWN_SPREAD;
    const spawnY = f.footY - hash01(key + 4) * EMBER_SPAWN_UP_MAX * f.height;
    // Embers curl as they rise, which is what separates them from the parcels
    // they broke off: a straight-up spark reads as a lens flare.
    const curl = Math.sin(phase * TAU + key) * f.width * EMBER_DRIFT_REACH * phase;
    const radius =
      f.width * hashRange(key + 2, EMBER_RADIUS_MIN, EMBER_RADIUS_MAX) * (1 - phase * HALF);

    drawEmbermote(
      ctx,
      palette.mid,
      palette.core,
      spawnX + curl + draft * phase,
      spawnY - rise,
      radius,
      alpha,
    );
  }
}

function drawSmoke(ctx: CanvasRenderingContext2D, f: StatusVisualFrame, smoke: Rgb): void {
  const draft = sharedDraft(f);
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const index = i + PARCEL_COUNT + HOTSPOT_COUNT + EMBER_COUNT;
    const key = f.seed + index * PARTICLE_KEY_STRIDE;
    const phase = particlePhase(f, index, SMOKE_RATE_PER_MS);
    const visibility = Math.min(1, phase / SMOKE_FADE_IN) * (1 - phase);
    const alpha = visibility * SMOKE_ALPHA * f.fade;
    if (alpha <= 0) continue;

    const rise = f.height * SMOKE_RISE * phase;
    const curl = Math.sin(phase * Math.PI + key) * f.width * SMOKE_DRIFT_REACH * phase;
    const radius = f.width * (SMOKE_RADIUS_START + (SMOKE_RADIUS_END - SMOKE_RADIUS_START) * phase);
    const spawnX = f.centerX + (hash01(key) - HALF) * f.width * SMOKE_SPAWN_SPREAD;
    const spawnY = bodyTop(f) + f.height * SMOKE_BIRTH_DROP;

    drawGlow(ctx, smoke, spawnX + curl + draft * phase, spawnY - rise, radius, alpha);
  }
}
