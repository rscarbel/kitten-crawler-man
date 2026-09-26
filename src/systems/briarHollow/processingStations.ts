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
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import { villagePropArtTopTilesAboveFootprint } from '../../sprites/sheets/villageSheets';
import type { VillageStandingPropId } from '../../sprites/art/villageArt';
import type { TileRect } from '../../map/town/townPlan';

export type ProcessingStationKind = 'boards' | 'rope';

/** How close a crawler's centre must be to a machine's footprint to work it, in tiles. */
export const PROCESSING_REACH_TILES = 1.5;

const STATION_PROPS: ReadonlyArray<{ prop: VillageStandingPropId; kind: ProcessingStationKind }> = [
  { prop: 'sawmill_machine', kind: 'boards' },
  { prop: 'rope_frame', kind: 'rope' },
];

export interface ProcessingStation {
  readonly kind: ProcessingStationKind;
  /** The machine's whole footprint, in map tiles. */
  readonly footprint: TileRect;
  readonly prop: VillageStandingPropId;
}

/**
 * The tile row a station's painted pixels actually reach up to, measured from
 * its rendered art rather than the sheet's declared headroom. Anything
 * anchored "above this machine" should clear this row, not the footprint's.
 * Measured on first ask rather than at lookup, because measuring paints the
 * prop and headless callers of `processingStationsOf` have no canvas.
 */
export function stationArtTopTileY(station: ProcessingStation): number {
  return station.footprint.y - villagePropArtTopTilesAboveFootprint(station.prop);
}

/** Every processing machine the village stands up; empty with no village. */
export function processingStationsOf(site: BriarHollowSite | null): ProcessingStation[] {
  if (site === null) return [];
  const stations: ProcessingStation[] = [];
  for (const building of site.buildings) {
    for (const placement of building.furniture) {
      const station = STATION_PROPS.find((entry) => entry.prop === placement.prop);
      if (station === undefined) continue;
      const footprint: TileRect = {
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      };
      stations.push({
        kind: station.kind,
        footprint,
        prop: station.prop,
      });
    }
  }
  return stations;
}

/** The tile a machine's footprint centres on, for minimap and marker placement. */
export function footprintCentreTile(footprint: TileRect): { x: number; y: number } {
  return {
    x: Math.floor(footprint.x + footprint.w / 2),
    y: Math.floor(footprint.y + footprint.h / 2),
  };
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
