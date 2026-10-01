/**
 * Which finish a town building's own walls are dressed in, for the wall-face
 * overlay `src/sprites/art/townInterior/interiorWallFace.ts` paints.
 *
 * Held as module state and set once, on `GameMap.generateInterior`, for the
 * same reason `src/map/dungeon/floorTheme.ts`'s active theme is: nothing
 * between `GameMap.renderCanvas` and `drawTerrainTile` carries the building's
 * own identity, and exactly one interior map is live at a time, so a value
 * set on entry and read by the painter needs no threading through every call
 * site in between.
 */

import type { TownInteriorWallMaterialId } from '../../sprites/art/townInterior/interiorWallFace';

/** What a building with no entry below is dressed in. */
export const DEFAULT_TOWN_INTERIOR_WALL_MATERIAL: TownInteriorWallMaterialId = 'plaster';

/**
 * Per-building material choice. Most rooms stay on the town's own plaster
 * (the default every gate and every existing render already assumes); a
 * room whose walls should read as a different finish gets an entry here, keyed
 * by building name exactly like `INTERIOR_BY_NAME`.
 */
const WALL_MATERIAL_BY_BUILDING_NAME: ReadonlyMap<string, TownInteriorWallMaterialId> = new Map([
  // Wood floor, wood counter, wood shelving throughout — timber panelling
  // instead of plaster carries the same material the whole way to the wall.
  ['General Store', 'timber'],
  // A forge hall is built of stone around the fire it holds, not plaster.
  ['The Rusty Anvil', 'stone'],
  // A joiner's shop, timber floor to timber wall, the same reasoning as the
  // General Store's own entry.
  ["Cartwright's Workshop", 'timber'],
  // The garrison's armoury and drill hall read as stone the way the smithy
  // does — a working building, not a plastered house.
  ['The Barracks', 'stone'],
  // A cosy taproom, timber panelled the way the bar and the guest-wing beds
  // already are — the one warm finish among the town's three taverns.
  ['The Sleeping Cat Inn', 'timber'],
  // The "respectable house": dressed stone rather than plaster, matching a
  // mead hall built to look like it has stood for generations.
  ['The Horned Flagon', 'stone'],
  // A board floor, a plank counter and drying racks throughout — timber the
  // whole way to the wall, the same reasoning as the General Store's entry.
  ['Herb & Remedy', 'timber'],
  // A one-room cabin built of logs, not plastered lath — a hedge-witch's
  // cottage reads as a woodsman's build from the walls in.
  ["Old Hilda's Cottage", 'timber'],
  // A dome carried on dressed stone, inside and out — the one finish that
  // matches eighty years of standing.
  ['Temple of the Sky', 'stone'],
  // Wendell panelled his own walls, and fitted them better than the house
  // deserves.
  ['Plumbline Farm', 'timber'],
  // A garrison post in a timber lodge: dark boarded walls to match the
  // stained timber it is built of outside, not a townhouse's plaster.
  ['Blackwood Lodge', 'timber'],
  // A tent has no walls, only sidewall canvas hung in the dark: striped drapes
  // on every face that looks onto the ring or a corridor, and the black back
  // of the tent everywhere else.
  ['Big Top', 'canvas'],
  // The tower is dressed stone outside to the top of its spire, and the
  // magistrate's seat is not a building anyone plastered over.
  ['Town Center Tower', 'stone'],
]);

let activeMaterial: TownInteriorWallMaterialId = DEFAULT_TOWN_INTERIOR_WALL_MATERIAL;

/** Sets the wall finish every `INTERIOR_WALL` tile is drawn in from now on. */
export function setTownInteriorWallMaterial(buildingName: string): void {
  activeMaterial =
    WALL_MATERIAL_BY_BUILDING_NAME.get(buildingName) ?? DEFAULT_TOWN_INTERIOR_WALL_MATERIAL;
}

/** The finish every `INTERIOR_WALL` tile is currently drawn in. */
export function townInteriorWallMaterial(): TownInteriorWallMaterialId {
  return activeMaterial;
}
