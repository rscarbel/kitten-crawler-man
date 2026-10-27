/**
 * The circus grounds as the gates read them: the real generated third-floor
 * map for one world seed and the named places on it.
 *
 * Shared by `verify-circus-grounds.ts` (the geometry), the high striker's
 * gate and render, and `render-circus-grounds.ts` (the review render), so the
 * gate and the picture always describe the same site.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { level3 } from '../../src/levels/level3';
import { GameMap } from '../../src/map/GameMap';
import { OVERWORLD_BORDER_TILES, type BuildingEntry } from '../../src/map/OverworldGenerator';
import { STARLIGHT_TENT_NAME } from '../../src/map/overworld/circusGroundsLayout';
import { gateHighwayTiles, widenApproach } from '../../src/map/town/paintStreets';
import { circusApproachCentreLine } from '../../src/map/overworld/paintCircusGrounds';

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** The grounds of one generated world, with the places on it the gates read. */
export interface CircusSite {
  readonly seed: number;
  readonly map: GameMap;
  readonly centre: TilePoint;
  readonly radiusTiles: number;
  readonly starlightTent: BuildingEntry;
  /** Every tile the approach road is laid along, before anything else claims one. */
  readonly roadRoute: readonly TilePoint[];
  /** The road's centre line, from the Starlight Tent's doorstep out to the town gate. */
  readonly roadCentreLine: readonly TilePoint[];
  /**
   * Every tile of the grounds' disc a town gate's highway is laid along. Read
   * from the town plan, not the grid, so a lot pass that paints over the
   * highway cannot also hide it from the gate.
   */
  readonly highwayRoute: readonly TilePoint[];
}

/**
 * Builds the real third-floor overworld for a seed and names its circus.
 * Returns a reason instead when the map has no circus or no Starlight Tent, which a
 * gate must count as a failure rather than a skipped seed.
 */
export function buildCircusSite(seed: number): CircusSite | string {
  const map = new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
  });
  const centre = map.circusCentre;
  const radiusTiles = map.circusRadiusTiles;
  if (centre === undefined || radiusTiles === undefined) return 'the map has no circus';
  const starlightTent = map.buildingEntries.find((entry) => entry.name === STARLIGHT_TENT_NAME);
  if (starlightTent === undefined) return 'the circus has no Starlight Tent entry';
  const plan = map.townPlan;
  if (plan === undefined) return 'the map has no town plan to route the approach road from';
  return {
    seed,
    map,
    centre,
    radiusTiles,
    starlightTent,
    roadRoute: widenApproach(circusApproachCentreLine(plan, centre)),
    roadCentreLine: circusApproachCentreLine(plan, centre),
    highwayRoute: gateHighwayTiles(plan, map.structure.length, OVERWORLD_BORDER_TILES).filter(
      (tile) => Math.hypot(tile.x - centre.x, tile.y - centre.y) <= radiusTiles,
    ),
  };
}

/** Straight-line distance of a tile from the circus centre, in tiles. */
export function radiusOf(site: CircusSite, tile: TilePoint): number {
  return Math.hypot(tile.x - site.centre.x, tile.y - site.centre.y);
}

/** Every tile of the grounds' disc, centre outward by row. */
export function discTiles(site: CircusSite, radiusTiles: number = site.radiusTiles): TilePoint[] {
  const tiles: TilePoint[] = [];
  const reach = Math.ceil(radiusTiles);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) > radiusTiles) continue;
      tiles.push({ x: site.centre.x + dx, y: site.centre.y + dy });
    }
  }
  return tiles;
}

/**
 * Rewrites one tile's type in place, the way a fault injection or a future
 * stamper would. The tile keeps everything else it carried.
 */
export function stampTileType(map: GameMap, tile: TilePoint, type: number): void {
  const row = map.structure[tile.y];
  const cell = row[tile.x];
  row[tile.x] = { ...cell, type };
  map.markTileDirty(tile.x, tile.y);
}

/** The approach angle a site is reached from, as a compass word, for labels. */
export function approachHeading(site: CircusSite): string {
  const rim = roadRimCrossing(site);
  if (rim === null) return 'unknown';
  const angle = Math.atan2(rim.y - site.centre.y, rim.x - site.centre.x);
  const headings = [
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
    'north',
    'north-east',
  ];
  const sectorRadians = (Math.PI * 2) / headings.length;
  const index =
    ((Math.round(angle / sectorRadians) % headings.length) + headings.length) % headings.length;
  return headings[index];
}

/**
 * The route tile where the approach road crosses the grounds' rim, or null
 * when the route never leaves the disc.
 */
export function roadRimCrossing(site: CircusSite): TilePoint | null {
  let best: TilePoint | null = null;
  let bestGap = Infinity;
  for (const tile of site.roadRoute) {
    const gap = Math.abs(radiusOf(site, tile) - site.radiusTiles);
    if (gap < bestGap) {
      bestGap = gap;
      best = tile;
    }
  }
  return best;
}
