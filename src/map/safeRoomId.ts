import type { LevelId } from '../levels/levelIds';
import type { BuildingId } from './buildingIds';

/** Where a scene's safe rooms live: a floor's own map, or one building's interior. */
export type SafeRoomScope =
  | { readonly kind: 'floor'; readonly level: LevelId }
  | { readonly kind: 'interior'; readonly building: BuildingId };

/**
 * One safe room anywhere in a run: the scope of the map it is on and its
 * index in that map's `safeRooms`. Comparable across scenes, so a room the
 * party left for a building and came back to is still the same room.
 */
export type SafeRoomId = SafeRoomScope & { readonly index: number };

export function safeRoomIdIn(scope: SafeRoomScope, index: number): SafeRoomId {
  return { ...scope, index };
}

export function sameSafeRoom(a: SafeRoomId, b: SafeRoomId): boolean {
  if (a.index !== b.index) return false;
  switch (a.kind) {
    case 'floor':
      return b.kind === 'floor' && a.level === b.level;
    case 'interior':
      return b.kind === 'interior' && a.building === b.building;
    default: {
      const unhandled: never = a;
      return unhandled;
    }
  }
}
