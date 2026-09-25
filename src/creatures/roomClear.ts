import type { Mob } from './Mob';

/**
 * Whether a mob's presence should be treated as an unfinished fight by room
 * membership checks — the safe-descent gate, a chest's lock, and Mongo's pet
 * button all need to agree on this, rather than each rolling its own filter.
 *
 * Reads {@link Mob.countsTowardRoomClear}, which `BrindleGrub` overrides so
 * only a hatched vespa counts: larva and cow-tail stages are litter from the
 * last kill and shouldn't hold a room "in combat" on their own.
 */
export function countsTowardRoomClear(mob: Mob): boolean {
  return mob.countsTowardRoomClear;
}
