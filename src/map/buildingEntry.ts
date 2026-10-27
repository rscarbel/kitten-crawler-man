import {
  PLANNED_BUILDING_NAMES,
  TOWN_TOWER_NAME,
  type BuildingKind,
  type PlannedBuildingName,
  type ShopSignEmblem,
  type TilePoint,
} from './town/townPlan';
import { STARLIGHT_TENT_NAME } from './overworld/circusGroundsLayout';
import { PRISON_BUILDING_NAME } from './stealthGateLayout';

/**
 * Every name a door in `GameMap.buildingEntries` can carry: the town's buildings
 * and tower, the circus's Starlight Tent, and floor 2's prison door.
 */
export const BUILDING_NAMES = [
  ...PLANNED_BUILDING_NAMES,
  TOWN_TOWER_NAME,
  STARLIGHT_TENT_NAME,
  PRISON_BUILDING_NAME,
] as const;

export type BuildingName = (typeof BUILDING_NAMES)[number];

/** Narrows a name read from outside the type system, such as a save or a command line. */
export function isBuildingName(value: string): value is BuildingName {
  return BUILDING_NAMES.some((name) => name === value);
}

/**
 * A building-keyed table as a map, in `BUILDING_NAMES` order. `Object.entries`
 * would widen its keys to `string`; this keeps them `BuildingName`.
 */
export function mapByBuildingName<V>(
  table: Readonly<Partial<Record<BuildingName, V>>>,
): ReadonlyMap<BuildingName, V> {
  const byName = new Map<BuildingName, V>();
  for (const name of BUILDING_NAMES) {
    const value = table[name];
    if (value !== undefined) byName.set(name, value);
  }
  return byName;
}

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
  name: PlannedBuildingName;
  /**
   * Whether this building's interior hosts the town's safe room.
   *
   * Carried on the entry rather than derived from `type`; see
   * `PlannedBuilding.hasSafeRoom`.
   */
  readonly hasSafeRoom?: boolean;
  /**
   * Device on the sign hanging over this door. Carried on the entry rather than
   * re-derived by name in the renderer, so the sign is stated once — in the
   * `TownPlan` — and a building added without one is a compile error there.
   */
  readonly sign: ShopSignEmblem;
}

/** A door that is not a planned sprite building: the tower, the Starlight Tent or the prison. */
interface LandmarkEntry extends BuildingEntryBase {
  name: Exclude<BuildingName, PlannedBuildingName>;
  readonly hasSafeRoom?: never;
  readonly sign?: never;
}

export type BuildingEntry = PlannedBuildingEntry | LandmarkEntry;
