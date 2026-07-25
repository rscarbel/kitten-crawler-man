/**
 * Noise sampled on a torus.
 *
 * Every lattice index is taken modulo a period that divides the *wrap size*, so
 * the value at x = wrapSize is identical to the value at x = 0. That property is
 * what makes generated ground seamless by construction rather than by repairing
 * edges afterwards.
 *
 * ## Wrap size is a patch, not a tile
 *
 * The wrap size is the size of the whole generated **patch**, which may be
 * several tiles across. Wrapping at one tile forces every visible feature to be
 * smaller than a tile — which is exactly how you end up with a hard joint every
 * 16 screen pixels and a floor that reads as a grid. Generating, say, 4x4 tiles
 * as a single wrapped field and slicing it afterwards lets a flagstone span more
 * than one tile and lets the pattern only repeat every fourth tile, while the
 * slices still fit together perfectly in any arrangement the patch permits.
 */

const HASH_MULTIPLIER_X = 374761393;
const HASH_MULTIPLIER_Y = 668265263;
const HASH_MULTIPLIER_SEED = 2246822519;
const HASH_MIX_SHIFT_A = 13;
const HASH_MIX_SHIFT_B = 16;
const HASH_MIX_MULTIPLIER = 1274126177;
const UINT32_MAX = 4294967295;

/** Deterministic hash of a lattice point to [0, 1). */
export function hashLattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, HASH_MULTIPLIER_X) ^ Math.imul(y, HASH_MULTIPLIER_Y);
  h ^= Math.imul(seed, HASH_MULTIPLIER_SEED);
  h = Math.imul(h ^ (h >>> HASH_MIX_SHIFT_A), HASH_MIX_MULTIPLIER);
  return ((h ^ (h >>> HASH_MIX_SHIFT_B)) >>> 0) / UINT32_MAX;
}

function smoothstepUnit(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrapIndex(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export interface WorleySample {
  /** Distance to the nearest feature point, in cell widths. */
  readonly nearest: number;
  /** Distance to the second-nearest feature point, in cell widths. */
  readonly secondNearest: number;
  /** Stable per-cell random value, for tinting each stone individually. */
  readonly cellHash: number;
  /** Direction from the owning feature point to the sample, for relief lighting. */
  readonly offsetX: number;
  readonly offsetY: number;
}

const OCTAVE_SEED_STRIDE = 101;
const OCTAVE_AMPLITUDE_FALLOFF = 0.5;
const WORLEY_CELL_HASH_SEED_STRIDE = 7919;
const WORLEY_NEIGHBOURHOOD_RADIUS = 1;

/** Noise bound to one patch size, so callers can't accidentally mix wrap periods. */
export class NoiseField {
  constructor(readonly wrapSize: number) {}

  /**
   * Value noise on a `period` x `period` lattice spanning the patch.
   * `period` must divide the patch size so lattice cells land on whole pixels.
   */
  value(x: number, y: number, period: number, seed: number): number {
    const cellSize = this.wrapSize / period;
    const gx = x / cellSize;
    const gy = y / cellSize;
    const cellX = Math.floor(gx);
    const cellY = Math.floor(gy);
    const fracX = gx - cellX;
    const fracY = gy - cellY;

    const x0 = wrapIndex(cellX, period);
    const y0 = wrapIndex(cellY, period);
    const x1 = wrapIndex(cellX + 1, period);
    const y1 = wrapIndex(cellY + 1, period);

    const topLeft = hashLattice(x0, y0, seed);
    const topRight = hashLattice(x1, y0, seed);
    const bottomLeft = hashLattice(x0, y1, seed);
    const bottomRight = hashLattice(x1, y1, seed);

    const u = smoothstepUnit(fracX);
    const v = smoothstepUnit(fracY);
    const top = topLeft + (topRight - topLeft) * u;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * u;
    return top + (bottom - top) * v;
  }

  /** Fractal sum. `basePeriod * 2^(octaves-1)` must still divide the patch size. */
  fbm(x: number, y: number, seed: number, octaves: number, basePeriod: number): number {
    let sum = 0;
    let amplitude = 1;
    let amplitudeTotal = 0;
    let period = basePeriod;
    for (let octave = 0; octave < octaves; octave++) {
      sum += this.value(x, y, period, seed + octave * OCTAVE_SEED_STRIDE) * amplitude;
      amplitudeTotal += amplitude;
      amplitude *= OCTAVE_AMPLITUDE_FALLOFF;
      period *= 2;
    }
    return sum / amplitudeTotal;
  }

  /**
   * Cellular noise — the basis for anything made of discrete lumps: paving
   * stones, gravel chips, rubble. `secondNearest - nearest` is the joint between
   * adjacent cells, so joints come out closed and consistent without tracing any
   * outlines.
   */
  worley(x: number, y: number, cells: number, seed: number, jitter: number): WorleySample {
    const cellSize = this.wrapSize / cells;
    const gx = x / cellSize;
    const gy = y / cellSize;
    const baseX = Math.floor(gx);
    const baseY = Math.floor(gy);

    let nearest = Number.POSITIVE_INFINITY;
    let secondNearest = Number.POSITIVE_INFINITY;
    let nearestHash = 0;
    let nearestOffsetX = 0;
    let nearestOffsetY = 0;

    for (let dy = -WORLEY_NEIGHBOURHOOD_RADIUS; dy <= WORLEY_NEIGHBOURHOOD_RADIUS; dy++) {
      for (let dx = -WORLEY_NEIGHBOURHOOD_RADIUS; dx <= WORLEY_NEIGHBOURHOOD_RADIUS; dx++) {
        const cellX = baseX + dx;
        const cellY = baseY + dy;
        const wrappedX = wrapIndex(cellX, cells);
        const wrappedY = wrapIndex(cellY, cells);
        const jitterX = (hashLattice(wrappedX, wrappedY, seed) - 0.5) * jitter;
        const jitterY = (hashLattice(wrappedX, wrappedY, seed + 1) - 0.5) * jitter;
        const offsetX = gx - (cellX + 0.5 + jitterX);
        const offsetY = gy - (cellY + 0.5 + jitterY);
        const distance = Math.hypot(offsetX, offsetY);
        if (distance < nearest) {
          secondNearest = nearest;
          nearest = distance;
          nearestHash = hashLattice(wrappedX, wrappedY, seed + WORLEY_CELL_HASH_SEED_STRIDE);
          nearestOffsetX = offsetX;
          nearestOffsetY = offsetY;
        } else if (distance < secondNearest) {
          secondNearest = distance;
        }
      }
    }

    return {
      nearest,
      secondNearest,
      cellHash: nearestHash,
      offsetX: nearestOffsetX,
      offsetY: nearestOffsetY,
    };
  }

  /**
   * Displaces a sample point by a noise field, so straight boundaries wander
   * instead of reading as drawn with a ruler. The displacement is itself wrapped,
   * so warped features stay seamless.
   */
  warp(
    x: number,
    y: number,
    seed: number,
    amplitude: number,
    period: number,
  ): { readonly x: number; readonly y: number } {
    return {
      x: x + (this.value(x, y, period, seed) - 0.5) * 2 * amplitude,
      y: y + (this.value(x, y, period, seed + 1) - 0.5) * 2 * amplitude,
    };
  }
}
