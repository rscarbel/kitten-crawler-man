/**
 * Slope scars: exposed earth on the steepest upland ground, where the turf
 * has slipped and torn away.
 *
 * A scar is a streak running down the slope, the way soil is carried — so each
 * one starts at a seed tile and is walked downhill along the field's gradient
 * until the ground eases. Seeds are thresholded from a smooth drift field and
 * weighted by steepness, so scars come in patches of near-parallel streaks on
 * the steepest faces and never as single tiles dotted over a hillside.
 *
 * Purely cosmetic: `BARE_EARTH` is walkable, so nothing about where a crawler
 * can go changes.
 */

import { BARE_EARTH, HIGHLAND_GRASS, SCREE } from '../tileTypes';
import type { TileGrid } from '../town/tileGrid';
import type { TownPlan } from '../town/townPlan';
import { isWithinCamp, type CampSite } from './camps';
import type { KeepOut } from './keepOut';
import { tileHash01 } from '../tiles/hollowTileHash';
import { DriftField, scatterSalt, type LandformSampler } from './landformScatter';
import { smoothstepUnit } from './elevation';

/**
 * The slope range, per tile, over which a tile's chance to seed a scar rises
 * to full. The bottom is about the upland's steepest fifth; the top is where
 * the cliffs begin.
 */
const SCAR_SLOPE_FLAT = 0.012;
const SCAR_SLOPE_STEEP = 0.022;
/** A streak keeps running down while the ground is at least this steep. */
const SCAR_CONTINUE_SLOPE = 0.009;
/** Chance a fully steep tile in the heart of a drift seeds a scar. */
const SCAR_SEED_CHANCE = 0.05;
const SCAR_MIN_LENGTH_TILES = 3;
const SCAR_LENGTH_RANGE_TILES = 6;
const SCAR_DRIFT_OCTAVES = [
  { periodTiles: 12, weight: 0.65 },
  { periodTiles: 5, weight: 0.35 },
] as const;
const SCAR_DRIFT_THRESHOLD = 0.5;
const SCAR_DRIFT_SOFTNESS = 0.15;
const SCAR_DRIFT_SALT = 9501;
const SCAR_SEED_SALT = 9511;
const SCAR_LENGTH_SALT = 9521;
/** Rounding a walked position to the tile it lies in. */
const TILE_CENTRE = 0.5;

function steepness(slope: number): number {
  const t = (slope - SCAR_SLOPE_FLAT) / (SCAR_SLOPE_STEEP - SCAR_SLOPE_FLAT);
  return smoothstepUnit(t < 0 ? 0 : t > 1 ? 1 : t);
}

/** Upland ground a scar may open in. */
function canScar(
  grid: TileGrid,
  plan: TownPlan,
  camps: ReadonlyArray<CampSite>,
  keepOut: KeepOut,
  border: number,
  tx: number,
  ty: number,
): boolean {
  if (tx <= border || ty <= border || tx >= grid.size - border - 1 || ty >= grid.size - border - 1)
    return false;
  const type = grid.typeAt(tx, ty);
  if (type !== HIGHLAND_GRASS && type !== SCREE) return false;
  if (keepOut.contains(tx, ty)) return false;
  if (Math.hypot(tx - plan.centre.x, ty - plan.centre.y) <= plan.safeRadiusTiles) return false;
  return !isWithinCamp(camps, tx, ty);
}

/** Tears the turf off the steepest upland ground in streaks running down the slope. */
export function paintSlopeScars(
  grid: TileGrid,
  plan: TownPlan,
  landform: LandformSampler,
  camps: ReadonlyArray<CampSite>,
  border: number,
  keepOut: KeepOut,
): void {
  const { elevation } = landform;
  const seed = elevation.seed;
  const drift = new DriftField(seed, SCAR_DRIFT_SALT, grid.size, SCAR_DRIFT_OCTAVES);
  const seedSalt = scatterSalt(seed, SCAR_SEED_SALT);
  const lengthSalt = scatterSalt(seed, SCAR_LENGTH_SALT);

  const seeds: Array<{ x: number; y: number }> = [];
  for (let ty = border + 1; ty < grid.size - border - 1; ty++) {
    for (let tx = border + 1; tx < grid.size - border - 1; tx++) {
      if (!canScar(grid, plan, camps, keepOut, border, tx, ty)) continue;
      const chance =
        SCAR_SEED_CHANCE *
        steepness(landform.slope(tx, ty)) *
        drift.presence(tx, ty, SCAR_DRIFT_THRESHOLD, SCAR_DRIFT_SOFTNESS);
      if (tileHash01(tx, ty, seedSalt) < chance) seeds.push({ x: tx, y: ty });
    }
  }

  for (const start of seeds) {
    const length =
      SCAR_MIN_LENGTH_TILES +
      Math.floor(tileHash01(start.x, start.y, lengthSalt) * SCAR_LENGTH_RANGE_TILES);
    let x = start.x + TILE_CENTRE;
    let y = start.y + TILE_CENTRE;
    for (let step = 0; step < length; step++) {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (!canScar(grid, plan, camps, keepOut, border, tx, ty)) break;
      const gradient = elevation.gradientAt(tx, ty);
      if (step > 0 && gradient.magnitude < SCAR_CONTINUE_SLOPE) break;
      grid.set(tx, ty, BARE_EARTH);
      if (gradient.magnitude <= 0) break;
      // Downhill is against the gradient; one tile per step along it.
      x -= gradient.dx / gradient.magnitude;
      y -= gradient.dy / gradient.magnitude;
    }
  }
}
