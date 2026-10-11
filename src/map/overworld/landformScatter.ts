/**
 * Placement that follows the landform: where the wilderness's cover, rubble,
 * boulders and bare ground go, read off the same elevation field the bands,
 * rivers and cliffs are placed by.
 *
 * Two things make scatter read as growth rather than as salt. Each type comes
 * in drifts — a smooth noise field, thresholded, decides where it may grow,
 * so it clumps the way a plant spreading from its neighbours does — and each
 * drift is weighted toward the ground that type belongs on. Each type's total
 * is held to its base density, so drifting changes where cover goes, not how
 * much.
 *
 * Every choice here is a hash of the tile and a salt drawn from the elevation
 * seed, never the generator's shared random stream: a pass drawing from that
 * stream reshuffles every pass after it, so placing one more flower would move
 * the camps.
 */

import { mulberry32, subSeed } from '../../sprites/person/rng';
import { tileHash01 } from '../tiles/hollowTileHash';
import { NoiseOctave, smoothstepUnit, type ElevationField } from './elevation';

/** A landform quantity read once per tile and kept for the passes that share it. */
export class LandformSampler {
  private slopes: Float32Array | undefined;
  private heights: Float32Array | undefined;

  constructor(
    readonly elevation: ElevationField,
    readonly size: number,
  ) {}

  /** Normalised elevation of the plain field at a tile. */
  height(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return this.elevation.elevationAt(tx, ty);
    this.heights ??= this.sweep((x, y) => this.elevation.elevationAt(x, y));
    return this.heights[ty * this.size + tx];
  }

  /** Magnitude of the plain field's slope at a tile, per tile. */
  slope(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return this.elevation.gradientAt(tx, ty).magnitude;
    this.slopes ??= this.sweep((x, y) => this.elevation.gradientAt(x, y).magnitude);
    return this.slopes[ty * this.size + tx];
  }

  private inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
  }

  private sweep(read: (tx: number, ty: number) => number): Float32Array {
    const values = new Float32Array(this.size * this.size);
    for (let ty = 0; ty < this.size; ty++) {
      for (let tx = 0; tx < this.size; tx++) values[ty * this.size + tx] = read(tx, ty);
    }
    return values;
  }
}

/** One octave of a drift field: its period in tiles and its share of the sum. */
export interface DriftOctave {
  readonly periodTiles: number;
  readonly weight: number;
}

/**
 * A smooth 0..1 field a few tiles across, from its own sub-seed of the
 * elevation seed, thresholded into the drifts a scatter type grows in.
 */
export class DriftField {
  private readonly octaves: ReadonlyArray<{ octave: NoiseOctave; weight: number }>;
  private readonly weightTotal: number;

  constructor(seed: number, salt: number, size: number, octaves: readonly DriftOctave[]) {
    this.octaves = octaves.map(({ periodTiles, weight }, index) => ({
      octave: new NoiseOctave(periodTiles, size, mulberry32(subSeed(seed, salt + index))),
      weight,
    }));
    this.weightTotal = octaves.reduce((total, { weight }) => total + weight, 0);
  }

  sample(tx: number, ty: number): number {
    let sum = 0;
    for (const { octave, weight } of this.octaves) sum += octave.sample(tx, ty) * weight;
    return this.weightTotal > 0 ? sum / this.weightTotal : 0;
  }

  /**
   * How far inside a drift a tile is: 0 below `threshold`, rising to 1 over
   * `softness` above it, so a drift's edge thins out rather than stopping.
   */
  presence(tx: number, ty: number, threshold: number, softness: number): number {
    const above = (this.sample(tx, ty) - threshold) / softness;
    return smoothstepUnit(above < 0 ? 0 : above > 1 ? 1 : above);
  }
}

/** A tile a scatter pass may place on, and how strongly it is drawn there. */
export interface WeightedTile {
  readonly x: number;
  readonly y: number;
  readonly weight: number;
}

/**
 * The tiles to place on, from candidates weighted by where the type belongs.
 *
 * Each candidate's chance is its weight over the candidates' mean weight,
 * times `density`, so the expected total is `density` times the candidate
 * count however the weights are shaped. A chance is capped at `maxChance`,
 * which keeps a drift's heart from going solid; the little the cap trims comes
 * off the total.
 */
export function chooseWeighted(
  candidates: readonly WeightedTile[],
  density: number,
  maxChance: number,
  salt: number,
): WeightedTile[] {
  let weightSum = 0;
  for (const candidate of candidates) weightSum += candidate.weight;
  if (weightSum <= 0) return [];
  const scale = (density * candidates.length) / weightSum;
  return candidates.filter(
    ({ x, y, weight }) => tileHash01(x, y, salt) < Math.min(maxChance, weight * scale),
  );
}

/** A salt for one pass, from the elevation seed, so each pass draws its own stream. */
export function scatterSalt(seed: number, salt: number): number {
  return subSeed(seed, salt) | 0;
}
