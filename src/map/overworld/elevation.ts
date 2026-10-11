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
export const ELEVATION_BANDS = ['lowland', 'meadow', 'highland', 'ridge'] as const;
export type ElevationBand = (typeof ELEVATION_BANDS)[number];

/**
 * Upper bound of each band, in normalised elevation. Chosen so a typical map is
 * mostly meadow — the floor's established look — with lowland only in the
 * valley bottoms the rivers find, and ridge rare enough that a cliff line is a
 * landmark rather than scenery.
 */
export const LOWLAND_MAX = 0.36;
export const MEADOW_MAX = 0.6;
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
 * How far the band thresholds may be nudged, in normalised elevation, and the
 * period of the field that nudges them.
 *
 * Without it a band boundary is an exact iso-contour of a smooth field, and a
 * smooth field's contours are clean curves — so the map grows a hard outline
 * where the turf turns highland, which reads as a painted zone rather than as
 * ground. The nudge is itself a smooth field a few tiles across, so the edge
 * grows lobes and tongues; a per-tile nudge instead breaks it into single
 * tiles, each of which the fringe rounds into an isolated blotch. It belongs
 * on `bandAt` rather than on `elevationAt` because only classification wants
 * it: the river router descends the smooth field, and a nudged one would make
 * it stagger.
 */
const BAND_DITHER_RANGE = 0.1;
const BAND_DITHER_PERIOD_TILES = 7;
const BAND_DITHER_SEED_SALT = 4831;

/** Centre of a noise octave's 0..1 range, so the nudge raises a threshold as often as it lowers it. */
const NOISE_MIDPOINT = 0.5;

/**
 * A nudged tile stays in its nudged band only with at least this many
 * cardinal neighbours in the same band; any fewer and it is a speck or a
 * one-tile spur, which goes back to the band its own elevation gives it.
 */
const MIN_SAME_BAND_NEIGHBOURS = 2;
const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function bandForElevation(elevation: number): ElevationBand {
  if (elevation < LOWLAND_MAX) return 'lowland';
  if (elevation < MEADOW_MAX) return 'meadow';
  if (elevation < HIGHLAND_MAX) return 'highland';
  return 'ridge';
}

function bandIndex(band: ElevationBand): number {
  return ELEVATION_BANDS.indexOf(band);
}

/** Off-map neighbours count as the same band, so the map edge never makes a tile look stranded. */
function sameBandNeighbourCount(bands: Uint8Array, size: number, tx: number, ty: number): number {
  const band = bands[ty * size + tx];
  let count = 0;
  for (const [stepX, stepY] of CARDINAL_STEPS) {
    const nx = tx + stepX;
    const ny = ty + stepY;
    const offMap = nx < 0 || ny < 0 || nx >= size || ny >= size;
    if (offMap || bands[ny * size + nx] === band) count++;
  }
  return count;
}

/**
 * Returns every nudged tile without enough same-band support to the band its
 * own elevation gives it, repeating until nothing changes: reverting one
 * speck can strip the support a neighbouring nudged tile was counting on, and
 * a single pass over the original grid would leave that neighbour stranded.
 */
function revertUnsupportedNudges(bands: Uint8Array, ownBands: Uint8Array, size: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const index = ty * size + tx;
        if (bands[index] === ownBands[index]) continue;
        if (sameBandNeighbourCount(bands, size, tx, ty) >= MIN_SAME_BAND_NEIGHBOURS) continue;
        bands[index] = ownBands[index];
        changed = true;
      }
    }
  }
}

/**
 * Moves any tile with no same-band cardinal neighbour into the band most of
 * its neighbours share, since the corner-mask fringe rounds such a tile into
 * a lone dot. Reverting a nudge can leave a tile whose own elevation band is
 * stranded, and the raw field occasionally produces one too. Ties go to the
 * band nearest the tile's own, so a meadow tile among highland and lowland
 * never jumps two bands. A move never strands another tile, because nothing
 * around the moved tile shared its old band, so one pass is enough.
 */
function absorbIsolatedTiles(bands: Uint8Array, ownBands: Uint8Array, size: number): void {
  const neighbourCounts = new Array<number>(ELEVATION_BANDS.length);
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      if (sameBandNeighbourCount(bands, size, tx, ty) > 0) continue;
      neighbourCounts.fill(0);
      for (const [stepX, stepY] of CARDINAL_STEPS) {
        neighbourCounts[bands[(ty + stepY) * size + tx + stepX]]++;
      }
      const index = ty * size + tx;
      const ownBand = ownBands[index];
      let chosen = bands[index];
      let chosenCount = 0;
      for (let band = 0; band < ELEVATION_BANDS.length; band++) {
        const count = neighbourCounts[band];
        const isCloserTie =
          count === chosenCount && Math.abs(band - ownBand) < Math.abs(chosen - ownBand);
        if (count > chosenCount || isCloserTie) {
          chosen = band;
          chosenCount = count;
        }
      }
      bands[index] = chosen;
    }
  }
}

/** Hermite coefficients of `3t² - 2t³`, the standard smoothstep. */
const SMOOTHSTEP_QUADRATIC_TERM = 3;
const SMOOTHSTEP_CUBIC_TERM = 2;

export function smoothstepUnit(t: number): number {
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
export class NoiseOctave {
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
 * Ground held level for a landmark laid out on the assumption of flat ground:
 * a disc or a rectangle, held flat out to its edge and released back to the
 * noise over `falloffTiles`.
 */
export type FlattenZone =
  | {
      readonly kind: 'disc';
      readonly centreTileX: number;
      readonly centreTileY: number;
      readonly radiusTiles: number;
      readonly falloffTiles: number;
    }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly falloffTiles: number;
    };

/** How far outside a zone a tile lies, in tiles; 0 inside it. */
function distanceOutside(zone: FlattenZone, tx: number, ty: number): number {
  if (zone.kind === 'disc') {
    return Math.max(0, Math.hypot(tx - zone.centreTileX, ty - zone.centreTileY) - zone.radiusTiles);
  }
  const dx = Math.max(zone.x - tx, 0, tx - (zone.x + zone.w - 1));
  const dy = Math.max(zone.y - ty, 0, ty - (zone.y + zone.h - 1));
  return Math.hypot(dx, dy);
}

/** How much of the raw field survives near one zone: 0 inside, rising to 1 past its falloff. */
function zoneReliefWeight(zone: FlattenZone, tx: number, ty: number): number {
  const past = distanceOutside(zone, tx, ty);
  if (past <= 0) return 0;
  if (past >= zone.falloffTiles) return 1;
  return smoothstepUnit(past / zone.falloffTiles);
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
  /**
   * Every zone held flat. The town is always the first; a landmark sited
   * later adds its own with `flatten`, which must happen before anything reads
   * the field for painting — the band pass and the river router both do.
   */
  private readonly flattenZones: FlattenZone[];
  private readonly ditherOctave: NoiseOctave;
  /**
   * Every tile's band, cleaned of specks, built on the first `bandAt` and
   * dropped whenever a zone is flattened, since flattening moves the bands.
   */
  private bandIndices: Uint8Array | undefined;

  constructor(
    readonly seed: number,
    private readonly mapSizeTiles: number,
    town: TownFlattening,
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
    this.ditherOctave = new NoiseOctave(
      BAND_DITHER_PERIOD_TILES,
      mapSizeTiles,
      mulberry32(subSeed(seed, BAND_DITHER_SEED_SALT)),
    );
    this.flattenZones = [
      {
        kind: 'disc',
        centreTileX: town.centreTileX,
        centreTileY: town.centreTileY,
        radiusTiles: town.safeRadiusTiles + TOWN_FLATTEN_MARGIN_TILES,
        falloffTiles: TOWN_FLATTEN_FALLOFF_TILES,
      },
    ];
  }

  /** Holds another zone level, at the same meadow height as the town. */
  flatten(zone: FlattenZone): void {
    this.flattenZones.push(zone);
    this.bandIndices = undefined;
  }

  /**
   * How much of the raw field survives at this position: 0 inside any
   * flattened zone, rising smoothly to 1 once past every zone's falloff band.
   */
  reliefWeightAt(tx: number, ty: number): number {
    let weight = 1;
    for (const zone of this.flattenZones) {
      weight = Math.min(weight, zoneReliefWeight(zone, tx, ty));
      if (weight === 0) return 0;
    }
    return weight;
  }

  /** Normalised elevation in [0, 1]. Flat at `MEADOW_LEVEL` over every flattened zone. */
  elevationAt(tx: number, ty: number): number {
    return this.elevationWithRelief(tx, ty, this.reliefWeightAt(tx, ty));
  }

  /** `elevationAt` for a caller that already holds `reliefWeightAt` for this position. */
  elevationWithRelief(tx: number, ty: number, relief: number): number {
    let sum = 0;
    let amplitude = 1;
    for (const octave of this.octaves) {
      sum += octave.sample(tx, ty) * amplitude;
      amplitude *= OCTAVE_AMPLITUDE_FALLOFF;
    }
    const fractal = sum / this.amplitudeTotal;
    const contrasted = clamp01((fractal - FIELD_MIDPOINT) * FIELD_CONTRAST + FIELD_MIDPOINT);
    return MEADOW_LEVEL + (contrasted - MEADOW_LEVEL) * relief;
  }

  /**
   * The band this tile is painted as: its elevation classified against
   * thresholds nudged by a smooth field, so band edges meander rather than
   * following a clean iso-contour, with any speck the nudge leaves behind
   * returned to its own elevation's band.
   */
  bandAt(tx: number, ty: number): ElevationBand {
    const size = this.mapSizeTiles;
    if (tx < 0 || ty < 0 || tx >= size || ty >= size) {
      return this.nudgedBandAt(tx, ty, this.elevationAt(tx, ty));
    }
    const indices = this.bandIndices ?? this.buildBandIndices();
    return ELEVATION_BANDS[indices[ty * size + tx]];
  }

  private nudgedBandAt(tx: number, ty: number, elevation: number): ElevationBand {
    const nudge = (this.ditherOctave.sample(tx, ty) - NOISE_MIDPOINT) * BAND_DITHER_RANGE;
    return bandForElevation(elevation + nudge);
  }

  private buildBandIndices(): Uint8Array {
    const size = this.mapSizeTiles;
    const ownBands = new Uint8Array(size * size);
    const bands = new Uint8Array(size * size);
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const index = ty * size + tx;
        const elevation = this.elevationAt(tx, ty);
        ownBands[index] = bandIndex(bandForElevation(elevation));
        bands[index] = bandIndex(this.nudgedBandAt(tx, ty, elevation));
      }
    }
    revertUnsupportedNudges(bands, ownBands, size);
    absorbIsolatedTiles(bands, ownBands, size);
    this.bandIndices = bands;
    return bands;
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
