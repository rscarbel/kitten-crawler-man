/**
 * A tile-sized RGB pixel buffer whose every drawing primitive wraps.
 *
 * Wrapping is not a convenience here, it is the whole contract: a single
 * non-wrapping write near an edge reintroduces the seam that the noise lattice
 * was designed to avoid. Nothing in this file may clamp or discard out-of-range
 * coordinates — it must always fold them back onto the tile.
 */

/** Source-pixel size of one generated tile. The game renders these at TILE_SIZE. */
export const TILE_PX = 64;

/**
 * Patch sizes, in tiles. A patch is generated as one wrapped field and sliced
 * into tiles afterwards, so the pattern's repeat period is the patch, not the
 * tile. Bigger patches buy larger features (a slab spanning more than one tile)
 * and longer stretches before anything repeats; they cost patch^2 frames.
 */
export type PatchTiles = 1 | 2 | 4;

export type RGB = readonly [number, number, number];

const CHANNELS_PER_PIXEL = 3;
const RGBA_CHANNELS_PER_PIXEL = 4;
const OPAQUE_ALPHA = 255;

/**
 * Modulo that stays non-negative. JavaScript's `%` returns a negative result for
 * negative operands, which silently breaks any pattern keyed on cell parity —
 * a course index of -1 would flip a running bond the wrong way and tear the
 * joint exactly at the tile edge, where noise-warped coordinates go negative.
 */
export function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function wrapCoord(value: number, size: number): number {
  return positiveMod(Math.floor(value), size);
}

export class Surface {
  readonly size: number;
  private readonly channels: Float64Array;

  constructor(size: number = TILE_PX) {
    this.size = size;
    this.channels = new Float64Array(size * size * CHANNELS_PER_PIXEL);
  }

  private index(x: number, y: number): number {
    return (wrapCoord(y, this.size) * this.size + wrapCoord(x, this.size)) * CHANNELS_PER_PIXEL;
  }

  get(x: number, y: number): RGB {
    const i = this.index(x, y);
    return [this.channels[i], this.channels[i + 1], this.channels[i + 2]];
  }

  set(x: number, y: number, color: RGB): void {
    const i = this.index(x, y);
    this.channels[i] = color[0];
    this.channels[i + 1] = color[1];
    this.channels[i + 2] = color[2];
  }

  /** Alpha-composites `color` over the existing pixel. Coordinates wrap. */
  blend(x: number, y: number, color: RGB, alpha: number): void {
    if (alpha <= 0) return;
    const a = alpha >= 1 ? 1 : alpha;
    const i = this.index(x, y);
    this.channels[i] += (color[0] - this.channels[i]) * a;
    this.channels[i + 1] += (color[1] - this.channels[i + 1]) * a;
    this.channels[i + 2] += (color[2] - this.channels[i + 2]) * a;
  }

  /** Multiplies a pixel's brightness — the cheap way to apply relief shading. */
  scale(x: number, y: number, factor: number): void {
    const i = this.index(x, y);
    this.channels[i] *= factor;
    this.channels[i + 1] *= factor;
    this.channels[i + 2] *= factor;
  }

  /** Fills every pixel from a function of its coordinates. */
  fill(shader: (x: number, y: number) => RGB): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        this.set(x, y, shader(x, y));
      }
    }
  }

  /** Composites `other` over this surface using a per-pixel alpha mask. */
  compositeMasked(other: Surface, mask: Float64Array): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        this.blend(x, y, other.get(x, y), mask[y * this.size + x]);
      }
    }
  }

  clone(): Surface {
    const copy = new Surface(this.size);
    copy.channels.set(this.channels);
    return copy;
  }

  toRgba(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.size * this.size * RGBA_CHANNELS_PER_PIXEL);
    for (let p = 0; p < this.size * this.size; p++) {
      out[p * RGBA_CHANNELS_PER_PIXEL] = this.channels[p * CHANNELS_PER_PIXEL];
      out[p * RGBA_CHANNELS_PER_PIXEL + 1] = this.channels[p * CHANNELS_PER_PIXEL + 1];
      out[p * RGBA_CHANNELS_PER_PIXEL + 2] = this.channels[p * CHANNELS_PER_PIXEL + 2];
      out[p * RGBA_CHANNELS_PER_PIXEL + 3] = OPAQUE_ALPHA;
    }
    return out;
  }
}

/**
 * Draws a soft-edged disc. Radius is in pixels; `softness` is the fraction of the
 * radius spent fading out, so 0 is a hard dot and 1 is a pure gradient blob.
 */
export function wrappedDisc(
  surface: Surface,
  centreX: number,
  centreY: number,
  radius: number,
  color: RGB,
  alpha: number,
  softness: number,
): void {
  const extent = Math.ceil(radius);
  const innerRadius = radius * (1 - softness);
  for (let dy = -extent; dy <= extent; dy++) {
    for (let dx = -extent; dx <= extent; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const falloff =
        distance <= innerRadius ? 1 : 1 - (distance - innerRadius) / (radius - innerRadius);
      surface.blend(centreX + dx, centreY + dy, color, alpha * falloff);
    }
  }
}

/**
 * An irregular lump built from a few overlapping discs, with a contact shadow
 * cast down-right and a lit crown up-left.
 *
 * A single disc reads as a bubble, which is what makes naive scatter look like
 * polka dots rather than debris. Overlapping lobes break the circular silhouette
 * and the shadow anchors the lump to the ground beneath it.
 */
export function wrappedChunk(
  surface: Surface,
  centreX: number,
  centreY: number,
  radius: number,
  faceColor: RGB,
  crownColor: RGB,
  shadowColor: RGB,
  lobeSeeds: ReadonlyArray<readonly [number, number, number]>,
): void {
  const SHADOW_OFFSET = 0.55;
  const SHADOW_ALPHA = 0.45;
  const SHADOW_SOFTNESS = 0.7;
  const CROWN_OFFSET = -0.3;
  const CROWN_RADIUS_SCALE = 0.5;
  const CROWN_ALPHA = 0.55;

  for (const [lobeX, lobeY, lobeScale] of lobeSeeds) {
    wrappedDisc(
      surface,
      centreX + lobeX * radius + radius * SHADOW_OFFSET,
      centreY + lobeY * radius + radius * SHADOW_OFFSET,
      radius * lobeScale,
      shadowColor,
      SHADOW_ALPHA,
      SHADOW_SOFTNESS,
    );
  }
  for (const [lobeX, lobeY, lobeScale] of lobeSeeds) {
    wrappedDisc(
      surface,
      centreX + lobeX * radius,
      centreY + lobeY * radius,
      radius * lobeScale,
      faceColor,
      1,
      0.15,
    );
  }
  wrappedDisc(
    surface,
    centreX + radius * CROWN_OFFSET,
    centreY + radius * CROWN_OFFSET,
    radius * CROWN_RADIUS_SCALE,
    crownColor,
    CROWN_ALPHA,
    1,
  );
}

/**
 * Draws a tapering stroke from a point along a direction — grass blades, cracks,
 * scratches. `taper` fades alpha toward the far end.
 */
export function wrappedStroke(
  surface: Surface,
  startX: number,
  startY: number,
  stepX: number,
  stepY: number,
  length: number,
  color: RGB,
  alpha: number,
  taper: number,
): void {
  for (let step = 0; step < length; step++) {
    const progress = length <= 1 ? 0 : step / (length - 1);
    surface.blend(
      startX + stepX * step,
      startY + stepY * step,
      color,
      alpha * (1 - taper * progress),
    );
  }
}
