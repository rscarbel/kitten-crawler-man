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

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashText(text: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash;
}

function scopeKey(scope: SafeRoomScope): string {
  switch (scope.kind) {
    case 'floor':
      return `floor:${scope.level}`;
    case 'interior':
      return `interior:${scope.building}`;
    default: {
      const unhandled: never = scope;
      return unhandled;
    }
  }
}

/**
 * A stable non-negative integer per safe room anywhere in a run, for seeding
 * what a room keeps across visits (who its doctor is). The map's scope picks
 * where a run of seeds starts and the room's index steps along it, so rooms on
 * one map get consecutive seeds while each map's run starts somewhere else:
 * room 0 on floor one and room 0 on floor two do not share a seed.
 */
export function safeRoomSeed(room: SafeRoomId): number {
  return hashText(scopeKey(room)) + room.index;
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
