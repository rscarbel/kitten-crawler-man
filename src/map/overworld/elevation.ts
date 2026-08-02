/**
 * The floor-3 wilderness's elevation field.
 *
 * **There is no z-axis in this game and this module does not add one.** Nothing
 * here affects movement, line of sight, damage or pathing. It is a scalar field
 * over the map that the generator consults so that everything natural it paints
 * *agrees with itself*: rivers run down it into the valleys, the turf goes thin
 * and then bare as it climbs, cliffs sit on the steepest contours, and boulders
 * cluster where the ground is already rough. One field is the whole point — two
 * independent noise sources would put a cliff in a riverbed.
 *
 * The field is seeded and pure: the same seed yields the same field, on any
 * machine, for as long as `mulberry32` does. `OverworldGenerator` is otherwise
 * unseeded `Math.random()`, so the seed is drawn there and the field built from
 * it once per generation.
 */

import { mulberry32, subSeed, type Rng } from '../../sprites/person/rng';

/**
 * Bands, lowest to highest. Named rather than numeric because every consumer
 * asks "what kind of ground is this", not "how high is it" — the numbers are an
 * implementation detail of this module and the thresholds below are the only
 * place they are compared.
 */
export type ElevationBand = 'lowland' | 'meadow' | 'highland' | 'ridge';

/**
 * Upper bound of each band, in normalised elevation. Chosen so a typical map is
 * mostly meadow — the floor's established look — with lowland only in the
 * valley bottoms the rivers find, and ridge rare enough that a cliff line is a
 * landmark rather than scenery.
 */
const LOWLAND_MAX = 0.36;
const MEADOW_MAX = 0.6;
const HIGHLAND_MAX = 0.81;

/** The value the town is flattened to: dead centre of the meadow band. */
const MEADOW_LEVEL = (LOWLAND_MAX + MEADOW_MAX) / 2;

/**
 * Octave periods in tiles, coarsest first. The coarsest is a good fraction of
 * the 280-tile map, so a map has a handful of broad uplands rather than a rash
 * of hillocks; the finer two only wrinkle their edges, which is what stops the
 * band boundaries reading as contour lines drawn with a compass.
 */
const COARSE_OCTAVE_PERIOD_TILES = 96;
const MID_OCTAVE_PERIOD_TILES = 41;
const FINE_OCTAVE_PERIOD_TILES = 17;
const OCTAVE_PERIODS_TILES: readonly number[] = [
  COARSE_OCTAVE_PERIOD_TILES,
  MID_OCTAVE_PERIOD_TILES,
  FINE_OCTAVE_PERIOD_TILES,
];
const OCTAVE_AMPLITUDE_FALLOFF = 0.45;

/**
 * Contrast applied around the midpoint after the octaves are summed. Fractal
 * sums crowd toward 0.5, which would leave a map with almost no lowland and
 * almost no ridge; this spreads the histogram back out over the bands.
 */
const FIELD_CONTRAST = 1.55;
/** What the contrast is applied around: the midpoint of the normalised range. */
const FIELD_MIDPOINT = 0.5;

/**
 * Tile step used for the central difference in `gradientAt`, and the span that
 * difference is taken over (twice the step, since it reaches both ways).
 */
const GRADIENT_STEP_TILES = 1;
const GRADIENT_SPAN_TILES = GRADIENT_STEP_TILES * 2;

/**
 * How far past the town's own safe radius the field is held flat, and how wide
 * the band over which it is released back to the noise.
 *
 * The town is fixed data laid out on the assumption of level ground, so the
 * wilderness must not push a ridge into it. Flattening only to the safe radius
 * would put the full range of the field immediately outside the walls; the
 * margin is what turns that into a slope the town sits at the foot of.
 */
const TOWN_FLATTEN_MARGIN_TILES = 12;
const TOWN_FLATTEN_FALLOFF_TILES = 26;

/** Sub-seed salts, so each octave draws from an independent stream. */
const OCTAVE_SEED_SALT_BASE = 4801;

/**
 * How far a single tile's band threshold may be nudged, in normalised
 * elevation.
 *
 * Without it a band boundary is an exact iso-contour of a smooth field, and a
 * smooth field's contours are clean curves — so the map grows a hard outline
 * where the turf turns highland, which reads as a painted zone rather than as
 * ground. Dithering the threshold per tile frays that line into an interlocking
 * edge a few tiles deep, which the fringe then blends. It belongs on `bandAt`
 * rather than on `elevationAt` because only classification wants it: the river
 * router descends the smooth field, and a jittered one would make it stagger.
 */
const BAND_DITHER_RANGE = 0.055;

/** Position-hash mixing constants — the idiom used across the tile renderers. */
const HASH_MIX_X = 2654435761;
const HASH_MIX_Y = 2246822519;
const HASH_UINT32 = 0x100000000;

/** Centre of the hash's [0, 1) range, so a dither is signed rather than one-sided. */
const HASH_MIDPOINT = 0.5;

/** Stable per-tile value in [0, 1), independent of the field's seed. */
function tileHash01(tx: number, ty: number): number {
  const mixed = Math.imul(tx, HASH_MIX_X) ^ Math.imul(ty, HASH_MIX_Y);
  return (mixed >>> 0) / HASH_UINT32;
}

/** Hermite coefficients of `3t² - 2t³`, the standard smoothstep. */
const SMOOTHSTEP_QUADRATIC_TERM = 3;
const SMOOTHSTEP_CUBIC_TERM = 2;

function smoothstepUnit(t: number): number {
  return t * t * (SMOOTHSTEP_QUADRATIC_TERM - SMOOTHSTEP_CUBIC_TERM * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * One octave of value noise: a lattice of random values, bilinearly interpolated
 * with a smoothstep on each axis.
 *
 * The lattice is materialised rather than hashed per sample because every
 * consumer sweeps the map — the generator's band pass alone reads every tile —
 * so paying once for `(size / period)²` floats is cheaper than hashing per
 * lookup, and it keeps the field trivially deterministic.
 */
class NoiseOctave {
  private readonly values: Float64Array;
  private readonly cells: number;

  constructor(
    private readonly periodTiles: number,
    mapSizeTiles: number,
    rng: Rng,
  ) {
    // One extra cell on each axis so the far edge has a lattice corner to
    // interpolate toward without wrapping into the near edge.
    this.cells = Math.ceil(mapSizeTiles / periodTiles) + 2;
    this.values = new Float64Array(this.cells * this.cells);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng();
  }

  private cornerAt(cellX: number, cellY: number): number {
    const x = cellX < 0 ? 0 : cellX >= this.cells ? this.cells - 1 : cellX;
    const y = cellY < 0 ? 0 : cellY >= this.cells ? this.cells - 1 : cellY;
    return this.values[y * this.cells + x];
  }

  sample(tx: number, ty: number): number {
    const gx = tx / this.periodTiles;
    const gy = ty / this.periodTiles;
    const cellX = Math.floor(gx);
    const cellY = Math.floor(gy);
    const u = smoothstepUnit(gx - cellX);
    const v = smoothstepUnit(gy - cellY);

    const topLeft = this.cornerAt(cellX, cellY);
    const topRight = this.cornerAt(cellX + 1, cellY);
    const bottomLeft = this.cornerAt(cellX, cellY + 1);
    const bottomRight = this.cornerAt(cellX + 1, cellY + 1);

    const top = topLeft + (topRight - topLeft) * u;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * u;
    return top + (bottom - top) * v;
  }
}

interface TownFlattening {
  /** Tile the town is centred on. */
  readonly centreTileX: number;
  readonly centreTileY: number;
  /** The town's own safe radius; the field is held flat well past it. */
  readonly safeRadiusTiles: number;
}

/**
 * A seeded elevation field over one generated map.
 *
 * Construct once per generation and pass it to every pass that wants to know
 * what the ground is doing. Every method is a pure function of the seed and the
 * position.
 */
export class ElevationField {
  private readonly octaves: readonly NoiseOctave[];
  private readonly amplitudeTotal: number;
  private readonly flattenRadiusTiles: number;

  constructor(
    readonly seed: number,
    mapSizeTiles: number,
    private readonly town: TownFlattening,
  ) {
    const octaves: NoiseOctave[] = [];
    let amplitude = 1;
    let amplitudeTotal = 0;
    OCTAVE_PERIODS_TILES.forEach((period, index) => {
      const rng = mulberry32(subSeed(seed, OCTAVE_SEED_SALT_BASE + index));
      octaves.push(new NoiseOctave(period, mapSizeTiles, rng));
      amplitudeTotal += amplitude;
      amplitude *= OCTAVE_AMPLITUDE_FALLOFF;
    });
    this.octaves = octaves;
    this.amplitudeTotal = amplitudeTotal;
    this.flattenRadiusTiles = town.safeRadiusTiles + TOWN_FLATTEN_MARGIN_TILES;
  }

  /**
   * How much of the raw field survives at this position: 0 inside the town's
   * flattened disc, rising smoothly to 1 once past the falloff band.
   */
  private reliefWeightAt(tx: number, ty: number): number {
    const distance = Math.hypot(tx - this.town.centreTileX, ty - this.town.centreTileY);
    if (distance <= this.flattenRadiusTiles) return 0;
    const past = distance - this.flattenRadiusTiles;
    if (past >= TOWN_FLATTEN_FALLOFF_TILES) return 1;
    return smoothstepUnit(past / TOWN_FLATTEN_FALLOFF_TILES);
  }

  /** Normalised elevation in [0, 1]. Flat at `MEADOW_LEVEL` over the town. */
  elevationAt(tx: number, ty: number): number {
    let sum = 0;
    let amplitude = 1;
    for (const octave of this.octaves) {
      sum += octave.sample(tx, ty) * amplitude;
      amplitude *= OCTAVE_AMPLITUDE_FALLOFF;
    }
    const fractal = sum / this.amplitudeTotal;
    const contrasted = clamp01((fractal - FIELD_MIDPOINT) * FIELD_CONTRAST + FIELD_MIDPOINT);
    const relief = this.reliefWeightAt(tx, ty);
    return MEADOW_LEVEL + (contrasted - MEADOW_LEVEL) * relief;
  }

  /**
   * The band this tile is painted as, with the per-tile dither of
   * `BAND_DITHER_RANGE` applied so band edges interlock rather than following a
   * clean iso-contour.
   */
  bandAt(tx: number, ty: number): ElevationBand {
    const dither = (tileHash01(tx, ty) - HASH_MIDPOINT) * BAND_DITHER_RANGE;
    const elevation = this.elevationAt(tx, ty) + dither;
    if (elevation < LOWLAND_MAX) return 'lowland';
    if (elevation < MEADOW_MAX) return 'meadow';
    if (elevation < HIGHLAND_MAX) return 'highland';
    return 'ridge';
  }

  /**
   * Magnitude of the field's slope, per tile. Cliffs go where this is high, and
   * a river steers by the direction its components point.
   */
  gradientAt(tx: number, ty: number): { dx: number; dy: number; magnitude: number } {
    const step = GRADIENT_STEP_TILES;
    const dx =
      (this.elevationAt(tx + step, ty) - this.elevationAt(tx - step, ty)) / GRADIENT_SPAN_TILES;
    const dy =
      (this.elevationAt(tx, ty + step) - this.elevationAt(tx, ty - step)) / GRADIENT_SPAN_TILES;
    return { dx, dy, magnitude: Math.hypot(dx, dy) };
  }
}
