/**
 * Lets the overworld's ground painters see the landform the wilderness was
 * generated from.
 *
 * The elevation field decides where the bands, rivers, cliffs and boulders go,
 * and the same field is what a painter needs to light and tint the ground so
 * it agrees with them. A painter is handed `structure` and a position, never
 * the `GameMap`, so the field is looked up by the grid it shaped — the same
 * arrangement as `hollowSiteRegistry`.
 *
 * The record also carries the places that must read as level ground whatever
 * the field does there: the town, Briar Hollow, the circus lot and the camps.
 * They are laid out on the assumption of flat ground, and the field is only
 * flattened under some of them.
 *
 * Keyed weakly on the grid, so a discarded map takes its entry with it, and a
 * scene rebuilt around the same map (stepping back out of a building) finds it
 * still there. A save reload regenerates the map from its world seed, which
 * registers afresh.
 */

import type { TilePoint, TileRect } from '../town/townPlan';
import type { TileContent } from '../tileTypes';
import type { CampSite } from '../overworld/camps';
import type { ElevationField } from '../overworld/elevation';
import type { KeepOut } from '../overworld/keepOut';

/** The town's footprint, as the ground that must stay level. */
export interface LevelTown {
  readonly centre: TilePoint;
  /** The wall ring, as the rectangle its stone occupies. */
  readonly wall: TileRect;
  /** Tiles from `centre` inside which the town is safe; the wall sits well within it. */
  readonly safeRadiusTiles: number;
}

/** A disc of ground that must stay level. */
export interface LevelDisc {
  readonly centre: TilePoint;
  readonly radiusTiles: number;
}

/** The generated landform of one overworld map, and the built places on it. */
export interface OverworldTerrain {
  readonly elevation: ElevationField;
  readonly town: LevelTown;
  /** Briar Hollow's whole footprint: what every natural pass keeps off. */
  readonly briarHollowKeepOut: KeepOut;
  /** The circus lot. The elevation field is not flattened under it. */
  readonly circus: LevelDisc;
  readonly camps: readonly CampSite[];
}

const terrains = new WeakMap<TileContent[][], OverworldTerrain>();

/** Records the landform `structure` was generated on. Called once, where the map is generated. */
export function registerOverworldTerrain(
  structure: TileContent[][],
  terrain: OverworldTerrain,
): void {
  terrains.set(structure, terrain);
}

/** The landform `structure` was generated on, if it is an overworld map. */
export function overworldTerrainFor(structure: TileContent[][]): OverworldTerrain | undefined {
  return terrains.get(structure);
}

/** The elevation field `structure` was generated on, if it is an overworld map. */
export function overworldElevationFor(structure: TileContent[][]): ElevationField | undefined {
  return terrains.get(structure)?.elevation;
}
