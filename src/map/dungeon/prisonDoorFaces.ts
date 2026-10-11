/**
 * Which wall tiles carry the prison door and its sign on floor 2's stealth gate
 * room, for the wall painter.
 *
 * The door never changes its tiles: they stay `FloorTypeValue.wall`, solid and
 * sight-blocking, and the door is painted over their face. The painter sees
 * only the grid, so the door is registered against the grid when the map is
 * built. Keyed weakly on the grid, so a lookup can never answer from a floor
 * that is no longer loaded.
 */

import type { TileContent } from '../tileTypes';
import type { StealthGateRoomData } from '../stealthGateLayout';
import type { PrisonDoorPart } from '../../sprites/art/prisonDoorArt';

export type PrisonWallArt =
  | { readonly kind: 'door'; readonly part: PrisonDoorPart }
  | { readonly kind: 'sign'; readonly arrow: 'west' | 'east' };

const registry = new WeakMap<TileContent[][], ReadonlyMap<string, PrisonWallArt>>();

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

/** Makes a map's prison door and sign visible to the walls drawn from its grid. */
export function registerPrisonWallArt(
  structure: TileContent[][],
  room: Pick<StealthGateRoomData, 'prisonDoor' | 'signTile' | 'signArrow'> | null,
): void {
  const art = new Map<string, PrisonWallArt>();
  if (room !== null) {
    const { prisonDoor } = room;
    prisonDoor.faceTiles.forEach((tile, column) => {
      art.set(keyOf(tile.x, tile.y), { kind: 'door', part: { column, row: 'lower' } });
    });
    prisonDoor.upperFaceTiles.forEach((tile, column) => {
      art.set(keyOf(tile.x, tile.y), { kind: 'door', part: { column, row: 'upper' } });
    });
    art.set(keyOf(room.signTile.x, room.signTile.y), { kind: 'sign', arrow: room.signArrow });
  }
  registry.set(structure, art);
}

/** The prison art a wall tile carries, or null for every other wall. */
export function prisonWallArtAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): PrisonWallArt | null {
  return registry.get(structure)?.get(keyOf(tx, ty)) ?? null;
}
