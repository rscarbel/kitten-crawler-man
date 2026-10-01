/**
 * Which static dressing a dungeon wall face carries, chosen per tile.
 *
 * A face takes its dressing from the character of the room or hallway it faces —
 * the region of the open tile at its foot — so an ossuary's walls hold skull
 * niches and a locker room's hold lockers. Anywhere with no character (special
 * rooms, the tutorial, a floor without a region map) takes its floor's default.
 *
 * The tile painters see only a map's tile grid, so a map's characters are
 * registered against that grid when the map is built. Keyed weakly on the grid
 * itself, so a lookup can never answer from a floor that is no longer loaded.
 */

import type { TileContent } from '../tileTypes';
import { FACE_CLIMBING_PROP_TILE_TYPES } from '../cellarProps';
import type { DungeonFloorThemeId } from './floorTheme';
import type { RegionCharacter } from './roomCharacters';
import type { WallShape } from './wallShape';
import {
  defaultWallDressing,
  wallDressingFor,
  type WallDressingSet,
} from '../../sprites/art/dungeonWallDressing';

/** What the wall painter asks of a map's characters. */
export interface WallCharacterSource {
  characterAt(tileX: number, tileY: number): RegionCharacter | null;
}

const sources = new WeakMap<TileContent[][], WallCharacterSource>();

/** Makes a map's room and hallway characters visible to the walls drawn from its grid. */
export function registerWallCharacters(
  structure: TileContent[][],
  source: WallCharacterSource,
): void {
  sources.set(structure, source);
}

/**
 * The foot tiles of every face a fixture hangs on, keyed `y * width + x`. A
 * fixture is drawn live over its face, so the baked dressing leaves that face
 * bare and its neighbours free of spots: a sconce flame inside a cage grille
 * or a camera on a conduit pole reads as two things fighting for one place.
 */
const fixtureFeet = new WeakMap<TileContent[][], ReadonlySet<number>>();

/** Makes the faces a map's wall fixtures hang on known to the dressing baked onto its walls. */
export function registerWallFixtureFeet(
  structure: TileContent[][],
  feet: Iterable<{ readonly x: number; readonly y: number }>,
): void {
  const width = structure[0]?.length ?? 0;
  const keys = new Set<number>();
  for (const foot of feet) keys.add(foot.y * width + foot.x);
  fixtureFeet.set(structure, keys);
}

/** Whether a fixture hangs on this face column, or on the column either side of it. */
function fixtureNear(
  structure: TileContent[][],
  tx: number,
  footY: number,
): 'on' | 'beside' | null {
  const feet = fixtureFeet.get(structure);
  if (feet === undefined || feet.size === 0) return null;
  const key = footY * (structure[0]?.length ?? 0) + tx;
  if (feet.has(key)) return 'on';
  return feet.has(key - 1) || feet.has(key + 1) ? 'beside' : null;
}

/** Rows from a face tile down to the open tile its face stands on. */
function rowsToFoot(shape: WallShape): number {
  return shape.face === 'upper' ? 2 : 1;
}

export function wallDressingAt(
  structure: TileContent[][],
  theme: DungeonFloorThemeId,
  shape: WallShape,
  tx: number,
  ty: number,
): WallDressingSet {
  const source = sources.get(structure);
  if (source === undefined || shape.face === 'none') return defaultWallDressing(theme);
  const footY = ty + rowsToFoot(shape);
  const character = source.characterAt(tx, footY);
  const dressing =
    character === null ? defaultWallDressing(theme) : wallDressingFor(character.wallDressing);
  const fixture = fixtureNear(structure, tx, footY);
  if (fixture === 'on') return bare(dressing);
  return standsInFrontOfFace(structure, tx, footY) || fixture === 'beside'
    ? withoutSpots(dressing)
    : dressing;
}

/** Whether a prop that climbs up over the face stands at this face column's foot. */
function standsInFrontOfFace(structure: TileContent[][], tx: number, footY: number): boolean {
  if (footY < 0 || footY >= structure.length) return false;
  const row = structure[footY];
  if (tx < 0 || tx >= row.length) return false;
  return FACE_CLIMBING_PROP_TILE_TYPES.has(row[tx].type);
}

/**
 * A face column hidden behind a rack keeps the stretch's continuous fittings —
 * a pipe or a row of bars running behind it — but loses its own spot, which
 * the rack would otherwise stand straight through.
 */
function withoutSpots(dressing: WallDressingSet): WallDressingSet {
  return { ...dressing, spots: [], spotChance: 0 };
}

/**
 * The face a fixture hangs on loses its run of bars or lockers as well: the
 * fixture is mounted on the wall itself, in the gap between two cages.
 */
function bare(dressing: WallDressingSet): WallDressingSet {
  return { ...withoutSpots(dressing), run: null };
}
