/**
 * The shared "point of interest" light beam: a soft shaft of light standing on
 * the ground, with a glowing pool at its foot and motes rising through it.
 *
 * Every falloff is baked once per colour into a small texture and stretched to
 * size with `drawImage`, for two reasons:
 *
 * - **No hard edges.** A gradient-filled polygon has a crisp silhouette, and two
 *   overlapping polygons (a body and a core) read as stripes. The baked texture
 *   is a per-pixel product of a horizontal profile and a vertical fade, so it
 *   feathers to nothing on every side and the core blends into the body.
 * - **No per-frame allocation.** A `CanvasGradient` bakes in its coordinates, so
 *   one that follows the camera is rebuilt every frame. The textures here are
 *   position- and size-free; the pulse rides on `globalAlpha`, which is free to
 *   vary continuously without keying any cache.
 *
 * Everything draws with `'lighter'` so it reads as light added to the scene
 * rather than paint laid over it.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/** Where and how big one beam is, in screen pixels. */
export interface LightBeamPlacement {
  /** Screen-x of the beam's vertical axis. */
  readonly centreX: number;
  /** Screen-y of the ground line the beam stands on. */
  readonly groundY: number;
  /**
   * The width the beam must visibly cover. The feathered edges run past it on
   * both sides, so the thing being marked sits wholly inside the lit body.
   */
  readonly coverWidth: number;
  /** Height from the ground line to where the beam has faded out. */
  readonly height: number;
  /** `#rrggbb`. */
  readonly color: string;
  /** 0–1 overall strength: distance fades and moods scale the whole beam. */
  readonly strength: number;
  /** Monotonic clock driving the shimmer and the motes. */
  readonly timeMs: number;
  /**
   * Whether motes rise through the beam; defaults to true. A marker that has
   * a quieter "not yet" voice turns them off, so the moving sparkle stays a
   * sign that something can be done now.
   */
  readonly motes?: boolean;
}

// ── Texture shapes ───────────────────────────────────────────────────────
const BEAM_TEXTURE_WIDTH_PX = 64;
const BEAM_TEXTURE_HEIGHT_PX = 128;
const POOL_TEXTURE_PX = 64;
const MOTE_TEXTURE_PX = 16;

/** The top of the beam narrows to this fraction of its base, so it reads as a shaft rising away. */
const BEAM_TOP_WIDTH_FRACTION = 0.72;
/** The body falls off as `(1 - u²)^n`: zero slope at the edge, so there is no visible rim. */
const BODY_FALLOFF_EXPONENT = 1.6;
/** The core's Gaussian width, as a fraction of the half-width. */
const CORE_SIGMA = 0.24;
const BODY_WEIGHT = 0.5;
const CORE_WEIGHT = 0.55;
/** How far the core is lightened toward white, so the middle reads hot rather than merely thicker. */
const CORE_WHITENESS = 0.55;
/**
 * The shaft holds most of its strength up to this share of its height, then
 * eases to nothing at the top with a smoothstep, so there is no visible cut-off.
 */
const VERTICAL_FADE_START = 0.12;
/** The share of strength lost linearly across the plateau, so the base still reads as the source. */
const PLATEAU_DROOP = 0.3;
/** A hot band where the beam meets the ground, as if the light were striking it. */
const BASE_FLARE_WEIGHT = 0.35;
/** The flare's decay length, as a fraction of the beam's height. */
const BASE_FLARE_LENGTH = 0.07;

/** The pool's soft body, as `(1 - r²)^n`. */
const POOL_FALLOFF_EXPONENT = 2;
const POOL_BODY_WEIGHT = 0.55;
const POOL_CORE_SIGMA = 0.32;
const POOL_CORE_WEIGHT = 0.45;
const POOL_CORE_WHITENESS = 0.45;

const MOTE_CORE_SIGMA = 0.28;
const MOTE_WHITENESS = 0.75;

// ── Placement ────────────────────────────────────────────────────────────
/**
 * The drawn beam is this much wider than the width it has to cover: the body
 * falls to about a fifth of its peak where the covered width ends, so the
 * target's outer edges are still inside visible light and the feather lies
 * outside them.
 */
const FEATHER_OVERHANG = 1.4;
/** The ground pool's width against the beam's drawn width. */
const POOL_WIDTH_FRACTION = 1.25;
/** Ground seen at the game's slant: a circle on it is squashed to this height. */
const POOL_FLATTEN = 0.42;

// ── Motion ───────────────────────────────────────────────────────────────
const FULL_TURN_RADIANS = Math.PI * 2;
const SHIMMER_PERIOD_MS = 2100;
/** The pulse swings the whole beam by this fraction either way. */
const SHIMMER_DEPTH = 0.14;
const BREATHE_PERIOD_MS = 3300;
/** The beam's width breathes by this fraction either way, out of step with the pulse. */
const BREATHE_DEPTH = 0.04;

const MOTE_PERIOD_MS = 2600;
/** Motes rise this far up the beam before they have faded out. */
const MOTE_RISE_FRACTION = 0.72;
/** Motes start anywhere across this share of the beam's drawn width. */
const MOTE_SPREAD_FRACTION = 0.55;
const MOTE_SWAY_FRACTION = 0.05;
const MOTE_SWAY_CYCLES = 1.3;
const MOTE_SIZE_PX = 7;
/** The smallest mote shrinks to this share of the largest, so a column of them has depth. */
const MOTE_MIN_SIZE_FRACTION = 0.55;
const MIN_MOTES = 4;
const MAX_MOTES = 14;
/** One mote per this many pixels of drawn width, before the clamp. */
const MOTE_WIDTH_PX_PER_MOTE = 12;

// Independent low-discrepancy sequences, so a mote's column, phase and size are
// uncorrelated without any stored state.
const GOLDEN_RATIO_FRACTION = 0.618033988749895;
const SILVER_RATIO_FRACTION = 0.41421356237309503;
const PLASTIC_RATIO_FRACTION = 0.7548776662466927;

// ── Pixel plumbing ───────────────────────────────────────────────────────
const CHANNEL_MAX = 255;
const BYTES_PER_PIXEL = 4;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const HALF = 0.5;
const HEX_RADIX = 16;
const HEX_DIGITS = 6;
const HEX_PAIR = 2;

interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const WHITE: Rgb = { red: CHANNEL_MAX, green: CHANNEL_MAX, blue: CHANNEL_MAX };

function parseHex(color: string): Rgb {
  const body = color.startsWith('#') ? color.slice(1) : color;
  if (body.length !== HEX_DIGITS) return WHITE;
  const channel = (index: number): number =>
    Number.parseInt(body.slice(index * HEX_PAIR, index * HEX_PAIR + HEX_PAIR), HEX_RADIX);
  return { red: channel(0), green: channel(1), blue: channel(2) };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

/**
 * Bakes a texture by writing each pixel's colour straight into image data. A
 * canvas gradient quantizes its stops at eight bits before stretching, which is
 * exactly where a long, dim falloff turns into visible bands.
 */
function bakeTexture(
  width: number,
  height: number,
  shade: (x: number, y: number) => { readonly alpha: number; readonly whiteness: number },
  color: Rgb,
): CanvasSurface {
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { alpha, whiteness } = shade(x, y);
      const at = (y * width + x) * BYTES_PER_PIXEL;
      const white = clampUnit(whiteness);
      pixels[at + RED_OFFSET] = color.red + (CHANNEL_MAX - color.red) * white;
      pixels[at + GREEN_OFFSET] = color.green + (CHANNEL_MAX - color.green) * white;
      pixels[at + BLUE_OFFSET] = color.blue + (CHANNEL_MAX - color.blue) * white;
      pixels[at + ALPHA_OFFSET] = clampUnit(alpha) * CHANNEL_MAX;
    }
  }
  ctx.putImageData(image, 0, 0);
  return surface;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function verticalFade(rise: number): number {
  return (1 - smoothstep(VERTICAL_FADE_START, 1, rise)) * (1 - PLATEAU_DROOP * rise);
}

/** `u` runs -1..1 across a texture's width, sampled at pixel centres. */
function unitAcross(x: number, width: number): number {
  return ((x + HALF) / width) * 2 - 1;
}

function bakeBeam(color: Rgb): CanvasSurface {
  return bakeTexture(
    BEAM_TEXTURE_WIDTH_PX,
    BEAM_TEXTURE_HEIGHT_PX,
    (x, y) => {
      const rise = 1 - (y + HALF) / BEAM_TEXTURE_HEIGHT_PX;
      const halfWidthHere = 1 - (1 - BEAM_TOP_WIDTH_FRACTION) * rise;
      const across = unitAcross(x, BEAM_TEXTURE_WIDTH_PX) / halfWidthHere;
      if (Math.abs(across) >= 1) return { alpha: 0, whiteness: 0 };
      const body = Math.pow(1 - across * across, BODY_FALLOFF_EXPONENT);
      const core = Math.exp(-((across / CORE_SIGMA) ** 2));
      const fade = verticalFade(rise);
      const flare = 1 + BASE_FLARE_WEIGHT * Math.exp(-rise / BASE_FLARE_LENGTH);
      return {
        alpha: (BODY_WEIGHT * body + CORE_WEIGHT * core) * fade * flare,
        whiteness: core * CORE_WHITENESS,
      };
    },
    color,
  );
}

function bakePool(color: Rgb): CanvasSurface {
  return bakeTexture(
    POOL_TEXTURE_PX,
    POOL_TEXTURE_PX,
    (x, y) => {
      const dx = unitAcross(x, POOL_TEXTURE_PX);
      const dy = unitAcross(y, POOL_TEXTURE_PX);
      const radiusSq = dx * dx + dy * dy;
      if (radiusSq >= 1) return { alpha: 0, whiteness: 0 };
      const body = Math.pow(1 - radiusSq, POOL_FALLOFF_EXPONENT);
      const core = Math.exp(-radiusSq / (POOL_CORE_SIGMA * POOL_CORE_SIGMA));
      return {
        alpha: POOL_BODY_WEIGHT * body + POOL_CORE_WEIGHT * core,
        whiteness: core * POOL_CORE_WHITENESS,
      };
    },
    color,
  );
}

function bakeMote(color: Rgb): CanvasSurface {
  return bakeTexture(
    MOTE_TEXTURE_PX,
    MOTE_TEXTURE_PX,
    (x, y) => {
      const dx = unitAcross(x, MOTE_TEXTURE_PX);
      const dy = unitAcross(y, MOTE_TEXTURE_PX);
      const radiusSq = dx * dx + dy * dy;
      if (radiusSq >= 1) return { alpha: 0, whiteness: 0 };
      const halo = (1 - radiusSq) * (1 - radiusSq);
      const core = Math.exp(-radiusSq / (MOTE_CORE_SIGMA * MOTE_CORE_SIGMA));
      return { alpha: halo * HALF + core, whiteness: core * MOTE_WHITENESS };
    },
    color,
  );
}

interface BeamTextures {
  readonly beam: CanvasSurface;
  readonly pool: CanvasSurface;
  readonly mote: CanvasSurface;
}

/** Keyed on colour alone; the game uses a handful of marker colours, so this stays tiny. */
const texturesByColor = new Map<string, BeamTextures>();

function texturesFor(color: string): BeamTextures {
  const cached = texturesByColor.get(color);
  if (cached !== undefined) return cached;
  const rgb = parseHex(color);
  const textures = {
    beam: bakeBeam(rgb),
    pool: bakePool(rgb),
    mote: bakeMote(rgb),
  };
  texturesByColor.set(color, textures);
  return textures;
}

function shimmer(timeMs: number): number {
  return 1 + SHIMMER_DEPTH * Math.sin((timeMs / SHIMMER_PERIOD_MS) * FULL_TURN_RADIANS);
}

function breathe(timeMs: number): number {
  return 1 + BREATHE_DEPTH * Math.sin((timeMs / BREATHE_PERIOD_MS) * FULL_TURN_RADIANS);
}

function drawnWidth(placement: LightBeamPlacement): number {
  return placement.coverWidth * FEATHER_OVERHANG * breathe(placement.timeMs);
}

/** The screen rectangle a beam can light, pool and motes included. */
export function lightBeamBounds(placement: LightBeamPlacement): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const halfReach =
    placement.coverWidth * FEATHER_OVERHANG * (1 + BREATHE_DEPTH) * POOL_WIDTH_FRACTION * HALF;
  const poolHalfHeight = halfReach * POOL_FLATTEN;
  return {
    left: placement.centreX - halfReach,
    right: placement.centreX + halfReach,
    top: placement.groundY - placement.height,
    bottom: placement.groundY + poolHalfHeight,
  };
}

/**
 * The whole beam: pool, shaft and rising motes. Draw it *behind* whatever it
 * marks, so the marked figure or prop stands in front of its own light.
 */
export function drawLightBeam(ctx: CanvasRenderingContext2D, placement: LightBeamPlacement): void {
  const alpha = clampUnit(placement.strength * shimmer(placement.timeMs));
  if (alpha <= 0) return;
  const textures = texturesFor(placement.color);
  const width = drawnWidth(placement);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;

  const poolWidth = width * POOL_WIDTH_FRACTION;
  const poolHeight = poolWidth * POOL_FLATTEN;
  ctx.drawImage(
    textures.pool,
    placement.centreX - poolWidth * HALF,
    placement.groundY - poolHeight * HALF,
    poolWidth,
    poolHeight,
  );

  ctx.drawImage(
    textures.beam,
    placement.centreX - width * HALF,
    placement.groundY - placement.height,
    width,
    placement.height,
  );

  if (placement.motes !== false) drawMotes(ctx, textures.mote, placement, width, alpha);
  ctx.restore();
}

function drawMotes(
  ctx: CanvasRenderingContext2D,
  mote: CanvasSurface,
  placement: LightBeamPlacement,
  width: number,
  alpha: number,
): void {
  const count = Math.max(
    MIN_MOTES,
    Math.min(MAX_MOTES, Math.round(width / MOTE_WIDTH_PX_PER_MOTE)),
  );
  const cycle = placement.timeMs / MOTE_PERIOD_MS;
  const spread = width * MOTE_SPREAD_FRACTION;
  const rise = placement.height * MOTE_RISE_FRACTION;
  for (let index = 1; index <= count; index++) {
    const column = fractionalPart(index * GOLDEN_RATIO_FRACTION) - HALF;
    const age = fractionalPart(cycle + index * SILVER_RATIO_FRACTION);
    const sizeRoll = fractionalPart(index * PLASTIC_RATIO_FRACTION);
    const sway =
      Math.sin((age * MOTE_SWAY_CYCLES + column) * FULL_TURN_RADIANS) * width * MOTE_SWAY_FRACTION;
    const size = MOTE_SIZE_PX * (MOTE_MIN_SIZE_FRACTION + (1 - MOTE_MIN_SIZE_FRACTION) * sizeRoll);
    const x = placement.centreX + column * spread + sway;
    const y = placement.groundY - age * rise;
    // In off the ground and out near the top, never popping.
    ctx.globalAlpha = alpha * Math.sin(age * Math.PI);
    ctx.drawImage(mote, x - size * HALF, y - size * HALF, size, size);
  }
}
