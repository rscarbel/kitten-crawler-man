/**
 * The village's two wood-processing machines, found from the site: the
 * sawmill machine that turns wood into boards and the rope frame that turns it
 * into rope. One machine per job, so a press on a machine is already the
 * choice of output.
 *
 * This is only the lookup — which machine, where, and whether a crawler is
 * close enough to work it. What a press does is the sawmill service's.
 */

import { TILE_SIZE } from '../../core/constants';
import type { VillagePropId } from '../../map/overworld/briarHollowLayout';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TileRect } from '../../map/town/townPlan';

export type ProcessingStationKind = 'boards' | 'rope';

/** How close a crawler's centre must be to a machine's footprint to work it, in tiles. */
export const PROCESSING_REACH_TILES = 1.5;

const STATION_PROPS: ReadonlyArray<{ prop: VillagePropId; kind: ProcessingStationKind }> = [
  { prop: 'sawmill_machine', kind: 'boards' },
  { prop: 'rope_frame', kind: 'rope' },
];

export interface ProcessingStation {
  readonly kind: ProcessingStationKind;
  /** The machine's whole footprint, in map tiles. */
  readonly footprint: TileRect;
}

/** Every processing machine the village stands up; empty with no village. */
export function processingStationsOf(site: BriarHollowSite | null): ProcessingStation[] {
  if (site === null) return [];
  const stations: ProcessingStation[] = [];
  for (const building of site.buildings) {
    for (const placement of building.furniture) {
      const station = STATION_PROPS.find((entry) => entry.prop === placement.prop);
      if (station === undefined) continue;
      stations.push({
        kind: station.kind,
        footprint: { x: placement.x, y: placement.y, w: placement.w, h: placement.h },
      });
    }
  }
  return stations;
}

/** Distance in tiles from a world point to the nearest point of a tile rect. */
function tilesToFootprint(worldX: number, worldY: number, footprint: TileRect): number {
  const tileX = worldX / TILE_SIZE;
  const tileY = worldY / TILE_SIZE;
  const dx = Math.max(footprint.x - tileX, 0, tileX - (footprint.x + footprint.w));
  const dy = Math.max(footprint.y - tileY, 0, tileY - (footprint.y + footprint.h));
  return Math.hypot(dx, dy);
}

/**
 * The machine a crawler whose body centre is at (`worldX`, `worldY`) can work,
 * the nearest one if both are in reach, or null.
 */
export function processingStationInReach(
  stations: readonly ProcessingStation[],
  worldX: number,
  worldY: number,
  reachTiles = PROCESSING_REACH_TILES,
): ProcessingStation | null {
  let best: ProcessingStation | null = null;
  let bestDistance = reachTiles;
  for (const station of stations) {
    const distance = tilesToFootprint(worldX, worldY, station.footprint);
    if (distance > bestDistance) continue;
    best = station;
    bestDistance = distance;
  }
  return best;
}
