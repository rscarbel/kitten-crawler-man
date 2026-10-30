import type { BuildingId, PlannedBuildingId } from './buildingIds';
import type { BuildingKind, ShopSignEmblem, TilePoint } from './town/townPlan';

/** The span of tiles a door opens on, as `[x0, x0 + width)` along its door row. */
interface DoorwaySpan {
  /**
   * Westmost column of the opening, so the whole of it can be walked into.
   * `doorTile` is one tile of an opening up to four tiles wide, and every tile
   * of that opening is walkable ground with the door apron painted across it:
   * an entrance that only triggers on its centre column is an entrance the
   * player can stand squarely inside and not be offered.
   */
  readonly x0: number;
  /**
   * Tiles wide. The town's fronts open from one to four tiles, and anything
   * hung beside a door has to know, because `computeDoorway` reports the
   * *centre* of the opening — so for a four-tile front, the tile immediately
   * west of `doorTile` is still doorway.
   */
  readonly width: number;
}

interface BuildingEntryBase {
  doorTile: TilePoint;
  type: BuildingKind;
  readonly doorway: DoorwaySpan;
}

/** A door of one of the `TownPlan`'s sprite buildings. */
interface PlannedBuildingEntry extends BuildingEntryBase {
  readonly id: PlannedBuildingId;
  /**
   * Whether this building's interior hosts the town's safe room.
   *
   * Carried on the entry rather than derived from `type`; see
   * `PlannedBuilding.hasSafeRoom`.
   */
  readonly hasSafeRoom?: boolean;
  /**
   * Device on the sign hanging over this door. Carried on the entry rather than
   * re-derived by id in the renderer, so the sign is stated once — in the
   * `TownPlan` — and a building added without one is a compile error there.
   */
  readonly sign: ShopSignEmblem;
}

/** A door that is not a planned sprite building: the tower, the Starlight Tent or the prison. */
interface LandmarkEntry extends BuildingEntryBase {
  readonly id: Exclude<BuildingId, PlannedBuildingId>;
  readonly hasSafeRoom?: never;
  readonly sign?: never;
}

export type BuildingEntry = PlannedBuildingEntry | LandmarkEntry;

/**
 * Rows south of a building's door that its front step sits: outside, and off
 * the door tile, so stepping out never re-triggers the "Enter building?" prompt.
 */
const DOORSTEP_ROWS_SOUTH = 1;

/** The street tile in front of a building's door, where a party leaving it stands. */
export function doorstepOf(entry: Pick<BuildingEntry, 'doorTile'>): TilePoint {
  return { x: entry.doorTile.x, y: entry.doorTile.y + DOORSTEP_ROWS_SOUTH };
}
