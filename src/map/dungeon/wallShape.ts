/**
 * What a dungeon wall tile shows, decided from the tiles around it.
 *
 * The dungeon is drawn from a 3/4 top-down camera: a wall with floor to its south
 * shows its whole front face, standing two tiles tall where the wall is thick
 * enough; a wall with floor beside it shows only a foreshortened sliver of its end;
 * a wall with floor to its north shows the lit rim of its top. Behind all of
 * those is the flat top of the rock, which falls away into darkness with distance
 * from the open floor (`src/map/dungeon/wallLight.ts`) until it is pure black, the
 * colour of the void border and the fog.
 *
 * This module is the classification alone, with no canvas, so the painter, the
 * `?tiles` review view and the wall gate all ask the same question the same way.
 *
 * ## What a tile's shape depends on
 *
 * Its eight neighbours and the three tiles two rows below it (an upper face is the
 * top of the face whose foot is two rows down, and a back corner's return rises
 * beside one). Its darkness depends on every open tile within the fade distance.
 * Nothing on floors 1 or 2 turns a wall into floor or back at runtime, so the
 * chunk bake never has to re-draw a wall. A system that ever does must dirty every
 * tile within the fade distance of the swapped one (see `WALL_FADE_TILES`), or a
 * chunk on the far side of a seam keeps its old light.
 */

import {
  ARENA_CAGE,
  CRAWLER_SIGN,
  FloorTypeValue,
  METAL_WALL,
  VOID_TYPE,
  type TileContent,
} from '../tileTypes';

/**
 * Tile types that are solid structure rather than something standing on a floor.
 *
 * The colosseum's metal ring is here so the rock around it is mass, not a face
 * looking at a wall; everything else that is not a wall — floors, props, doorways,
 * stairwells — is somewhere the player can see into, and so is open.
 */
const CLOSED_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.wall,
  VOID_TYPE,
  METAL_WALL,
  ARENA_CAGE,
]);

function typeAt(structure: TileContent[][], tx: number, ty: number): number | undefined {
  return structure[ty]?.[tx]?.type;
}

function isStructurallyClosed(structure: TileContent[][], tx: number, ty: number): boolean {
  const type = typeAt(structure, tx, ty);
  return type === undefined || CLOSED_TYPES.has(type);
}

/**
 * Whether a crawler sign is a plaque hung on a wall face rather than a board on
 * posts standing in a niche.
 *
 * The planner seats a hallway sign in a one-tile pocket cut into the wall beside a
 * junction. Where that pocket sits in a run of north wall — wall to its north, east
 * and west, floor to its south — it is exactly where a face is drawn, so the pocket
 * is drawn as face and the sign is mounted on it. Anywhere else the pocket is left
 * open and reads as an alcove holding a standing sign.
 */
export function isFaceMountedSign(structure: TileContent[][], tx: number, ty: number): boolean {
  if (typeAt(structure, tx, ty) !== CRAWLER_SIGN) return false;
  return (
    isStructurallyClosed(structure, tx, ty - 1) &&
    isStructurallyClosed(structure, tx - 1, ty) &&
    isStructurallyClosed(structure, tx + 1, ty) &&
    !isStructurallyClosed(structure, tx, ty + 1)
  );
}

/** Whether a tile is wall-like for classifying its neighbours: solid, off the map, or a face plaque. */
export function isWallClosed(structure: TileContent[][], tx: number, ty: number): boolean {
  return isStructurallyClosed(structure, tx, ty) || isFaceMountedSign(structure, tx, ty);
}

/**
 * Which part of a wall's front face a tile carries.
 *
 * - `lower`: floor to the south; the foot of the face and most of its height.
 * - `upper`: the top of the face below it, its lit cap, then the wall top.
 * - `compressed`: floor both north and south; the whole face squeezed into one
 *   tile, its cap at the top doubling as the north room's south rim.
 */
export type WallFacePart = 'none' | 'lower' | 'upper' | 'compressed';

export interface WallShape {
  readonly face: WallFacePart;
  readonly openN: boolean;
  readonly openS: boolean;
  readonly openE: boolean;
  readonly openW: boolean;
  readonly openNE: boolean;
  readonly openNW: boolean;
  readonly openSE: boolean;
  readonly openSW: boolean;
  /** Open two rows down and one across: a back corner whose return rises past this tile. */
  readonly openSE2: boolean;
  readonly openSW2: boolean;
}

/** Classifies a wall tile against its neighbours; see the module comment for the reading. */
export function classifyWallTile(
  isClosed: (tx: number, ty: number) => boolean,
  tx: number,
  ty: number,
): WallShape {
  const openN = !isClosed(tx, ty - 1);
  const openS = !isClosed(tx, ty + 1);
  const openE = !isClosed(tx + 1, ty);
  const openW = !isClosed(tx - 1, ty);
  const openBelowFace = !isClosed(tx, ty + 2);

  let face: WallFacePart = 'none';
  if (openS) face = openN ? 'compressed' : 'lower';
  else if (openBelowFace) face = 'upper';

  return {
    face,
    openN,
    openS,
    openE,
    openW,
    openNE: !isClosed(tx + 1, ty - 1),
    openNW: !isClosed(tx - 1, ty - 1),
    openSE: !isClosed(tx + 1, ty + 1),
    openSW: !isClosed(tx - 1, ty + 1),
    openSE2: !isClosed(tx + 1, ty + 2),
    openSW2: !isClosed(tx - 1, ty + 2),
  };
}

/**
 * Whether a tile is drawn by the dungeon wall painter: a wall, the void border
 * around a dungeon floor (more of the same rock), or a sign plaque hung on a wall.
 */
export function isDrawnWall(structure: TileContent[][], tx: number, ty: number): boolean {
  const type = typeAt(structure, tx, ty);
  return type === FloorTypeValue.wall || type === VOID_TYPE || isFaceMountedSign(structure, tx, ty);
}

const dungeonWallMaps = new WeakMap<TileContent[][], boolean>();

/**
 * Whether a map is one the dungeon wall painter draws: it has dungeon walls. A
 * town building interior has a void border too, and keeps it plain black.
 */
export function isDungeonWallMap(structure: TileContent[][]): boolean {
  const cached = dungeonWallMaps.get(structure);
  if (cached !== undefined) return cached;
  const found = structure.some((row) => row.some((tile) => tile.type === FloorTypeValue.wall));
  dungeonWallMaps.set(structure, found);
  return found;
}

/**
 * {@link classifyWallTile} against a map's own tiles. A face whose tile above is
 * solid but not drawn as wall — the colosseum's ring, the edge of the map — has no
 * upper tile to carry its top, so it is squeezed into its own tile, cap and all.
 */
export function wallShapeAt(structure: TileContent[][], tx: number, ty: number): WallShape {
  const shape = classifyWallTile((x, y) => isWallClosed(structure, x, y), tx, ty);
  if (shape.face === 'lower' && !isDrawnWall(structure, tx, ty - 1)) {
    return { ...shape, face: 'compressed' };
  }
  return shape;
}
