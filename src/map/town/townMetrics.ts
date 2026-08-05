/**
 * Measures a generated overworld against the layout numbers in `docs/town.md`.
 *
 * Lives apart from the `?townmap` scene that displays it so the same numbers can
 * be produced without a canvas — a headless run of `generateOverworld` is the
 * fastest way to tell whether a layout change moved the metrics.
 *
 * Takes a structural view of the map rather than importing `OverworldData`, so
 * this module measures the generator's output without the generator's own
 * package depending back on it.
 */

import type { TileContent } from '../tileTypes';
import {
  COBBLE_STREET,
  FloorTypeValue,
  LANE_STREET,
  MAIN_TOWER,
  PLAZA_STONE,
  SPRITE_BUILDING,
  VERGE_GRASS,
  YARD_GRAVEL,
} from '../tileTypes';
import { getSpriteDoorwayByKey, getSpriteFootprintByKey } from '../../core/SpriteLoader';
import type { BuildingKind, TilePoint, TileRect } from './townPlan';

/** Manifest key of the town's main tower, whose anchor tile carries no sprite key. */
const MAIN_TOWER_SPRITE_KEY = 'overworld_main_tower';

/** Tile types that read as a ground *material* rather than a prop sitting on one. */
const GROUND_MATERIAL_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.grass,
  FloorTypeValue.road,
  VERGE_GRASS,
  YARD_GRAVEL,
  LANE_STREET,
  COBBLE_STREET,
  PLAZA_STONE,
]);

/**
 * The tower's blocking base, as tile offsets from its anchor: the manifest
 * blocks the two rows above the anchor and nothing else, so those two rows are
 * the only ground the tower actually occupies.
 */
const TOWER_BASE_NORTH_OFFSET = 2;
const TOWER_BASE_ROWS = 2;

/** The parts of a generated overworld this module needs to measure it. */
export interface MeasurableOverworld {
  readonly grid: ReadonlyArray<ReadonlyArray<TileContent>>;
  readonly buildingEntries: ReadonlyArray<{
    readonly doorTile: TilePoint;
    readonly name: string;
    readonly type: BuildingKind;
  }>;
  readonly townSquareCentre: TilePoint;
  readonly townSafeRadiusTiles: number;
}

/** A named building together with the ground it occupies and the door into it. */
export interface BuildingPlot {
  /**
   * Ground the building occupies, which the bounding-box and density metrics
   * measure. For every sprite building this is its whole art rect, because the
   * art is opaque across the frame. For the **tower** it is only its two
   * blocking rows: the other 21 rows of the spire hang over the fields north of
   * the wall, so counting them would make a town measured at 55 x 40 report
   * itself as 61 tall and would attribute 138 tiles of ground to a building whose
   * base is a 6 x 2 rectangle — of which the manifest actually blocks 8 tiles, the
   * rest being its doorway and the gaps beside it.
   */
  readonly rect: TileRect;
  /** The full sprite art rect, including any overhang, for the `?townmap` view. */
  readonly artRect: TileRect;
  readonly name: string;
  readonly doorTile: TilePoint;
}

export interface TownMetrics {
  /** Bounding box of every named building's footprint. */
  readonly bounds: TileRect;
  /** Tiles covered by building footprints. */
  readonly builtTiles: number;
  /** `builtTiles` as a fraction of the bounding box — the compaction metric. */
  readonly density: number;
  readonly farthestDoorTiles: number;
  readonly farthestDoorName: string;
  /**
   * Distinct ground materials appearing inside the building bounding box.
   *
   * That box is inside the walls, so this can never count `grass`: the street
   * plan puts a made surface on every tile within the ring and leaves field grass
   * to the country outside it, by design rather than by omission. Six is
   * therefore the ceiling, not seven.
   */
  readonly groundTypeCount: number;
  readonly buildingCount: number;
}

const EMPTY_RECT: TileRect = { x: 0, y: 0, w: 0, h: 0 };

/** A building's art on the map, before it has been matched to its named entry. */
interface PlacedBuilding {
  readonly rect: TileRect;
  readonly artRect: TileRect;
  /**
   * Door the placement rule derives from the sprite, or undefined for the tower
   * — its door comes from the `TownPlan` rather than from its art.
   */
  readonly spriteDoorTile: TilePoint | undefined;
  readonly isTower: boolean;
}

function findPlacedBuildings(grid: MeasurableOverworld['grid']): PlacedBuilding[] {
  const placed: PlacedBuilding[] = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      const isTower = tile.type === MAIN_TOWER;
      if (tile.type !== SPRITE_BUILDING && !isTower) continue;
      const spriteKey = isTower ? MAIN_TOWER_SPRITE_KEY : tile.spriteKey;
      if (spriteKey === undefined) continue;
      const footprint = getSpriteFootprintByKey(spriteKey);
      if (footprint === undefined) continue;
      const doorway = getSpriteDoorwayByKey(spriteKey);
      const artRect: TileRect = {
        x: x + footprint.dx,
        y: y + footprint.dy,
        w: footprint.w,
        h: footprint.h,
      };
      placed.push({
        isTower,
        artRect,
        rect: isTower
          ? {
              x: artRect.x,
              y: y - TOWER_BASE_NORTH_OFFSET,
              w: artRect.w,
              h: TOWER_BASE_ROWS,
            }
          : artRect,
        spriteDoorTile:
          isTower || doorway === undefined ? undefined : { x: x + doorway.dx, y: y + doorway.dy },
      });
    }
  }
  return placed;
}

/**
 * Pairs each building's art on the map with its named entry.
 *
 * Matching is exact, not by containment: `placeSpriteBuilding` derives a door as
 * `anchor + manifest doorway`, so that mapping inverts with no ambiguity, and
 * the tower is the single entry of kind `tower`. Containment would look right
 * today and break the moment compaction puts one building's door inside a
 * neighbour's footprint — which is the normal outcome of packing a town
 * tighter, and would silently corrupt the density metric.
 *
 * Entries with no art (the circus Big Top is built from tiles, not a sprite) are
 * skipped; art with no entry is a real fault and is reported.
 */
export function collectBuildingPlots(data: MeasurableOverworld): BuildingPlot[] {
  const claimedEntries = new Set<number>();
  const plots: BuildingPlot[] = [];

  for (const building of findPlacedBuildings(data.grid)) {
    const index = data.buildingEntries.findIndex((entry, i) => {
      if (claimedEntries.has(i)) return false;
      if (building.isTower) return entry.type === 'tower';
      const door = building.spriteDoorTile;
      if (door === undefined) return false;
      return entry.doorTile.x === door.x && entry.doorTile.y === door.y;
    });
    if (index === -1) {
      console.warn('[townMetrics] building art with no matching entry', building.rect);
      continue;
    }
    claimedEntries.add(index);
    const entry = data.buildingEntries[index];
    plots.push({
      name: entry.name,
      doorTile: entry.doorTile,
      rect: building.rect,
      artRect: building.artRect,
    });
  }
  return plots;
}

export function measureTown(
  plots: ReadonlyArray<BuildingPlot>,
  data: MeasurableOverworld,
): TownMetrics {
  const bounds = boundingRect(plots.map((plot) => plot.rect));
  const builtTiles = plots.reduce((total, plot) => total + plot.rect.w * plot.rect.h, 0);

  let farthestDoorTiles = 0;
  let farthestDoorName = '—';
  for (const plot of plots) {
    const distance = Math.hypot(
      plot.doorTile.x - data.townSquareCentre.x,
      plot.doorTile.y - data.townSquareCentre.y,
    );
    if (distance <= farthestDoorTiles) continue;
    farthestDoorTiles = distance;
    farthestDoorName = plot.name;
  }

  const groundTypes = new Set<number>();
  const rowCount = data.grid.length;
  const columnCount = data.grid[0].length;
  for (let y = Math.max(0, bounds.y); y < Math.min(rowCount, bounds.y + bounds.h); y++) {
    const row = data.grid[y];
    for (let x = Math.max(0, bounds.x); x < Math.min(columnCount, bounds.x + bounds.w); x++) {
      if (GROUND_MATERIAL_TYPES.has(row[x].type)) groundTypes.add(row[x].type);
    }
  }

  const area = bounds.w * bounds.h;
  return {
    bounds,
    builtTiles,
    density: area === 0 ? 0 : builtTiles / area,
    farthestDoorTiles,
    farthestDoorName,
    groundTypeCount: groundTypes.size,
    buildingCount: plots.length,
  };
}

export function boundingRect(rects: ReadonlyArray<TileRect>): TileRect {
  if (rects.length === 0) return EMPTY_RECT;
  const first = rects[0];
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.w;
  let maxY = first.y + first.h;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const PERCENT = 100;
const DENSITY_DECIMALS = 1;
const DISTANCE_DECIMALS = 1;

/** Label/value pairs for display, in reading order. */
export function metricRows(
  metrics: TownMetrics,
  data: MeasurableOverworld,
): ReadonlyArray<readonly [string, string]> {
  const { bounds } = metrics;
  return [
    ['Bounding box (tiles)', `${bounds.w} x ${bounds.h}`],
    ['Area (tiles)', `${bounds.w * bounds.h}`],
    ['Built tiles', `${metrics.builtTiles}`],
    ['Built density', `${(metrics.density * PERCENT).toFixed(DENSITY_DECIMALS)}%`],
    ['Buildings', `${metrics.buildingCount}`],
    [
      'Farthest door',
      `${metrics.farthestDoorTiles.toFixed(DISTANCE_DECIMALS)} (${metrics.farthestDoorName})`,
    ],
    ['Ground materials in the walls', `${metrics.groundTypeCount}`],
    ['Town safe radius', `${data.townSafeRadiusTiles}`],
  ];
}
