/**
 * Who a fairy counts as a friend.
 *
 * Pack alerts only ever answer "my own species", and a fairy supports every
 * species in the room, so it reads the same per-frame roster through its own
 * filter instead.
 */

import type { Mob } from '../Mob';
import { collectMobsNear } from '../packAlert';
import { Fairy } from './Fairy';

export interface FairyAllyQuery {
  /**
   * Leave other fairies out. Shield and heal targeting set it, so two support
   * fairies never spend their casts on each other while the goblin they are
   * both hiding behind goes unwarded; the death wave and the aegis leave it
   * off, because "nearby enemies" means every one of them.
   */
  readonly excludeFairies?: boolean;
}

const nearbyScratch: Mob[] = [];

/**
 * Fill `out` with every living hostile mob within `radiusPx` of `caller`, the
 * caller excluded. `out` is emptied first.
 *
 * Always filtered on `isHostile`: the party's pet and its hirelings are mobs in
 * the same roster, and a healer that topped up the mercenary chopping at its
 * own goblin would be a fairy on the party's side.
 */
export function collectFairyAllies(
  caller: Mob,
  radiusPx: number,
  out: Mob[],
  query: FairyAllyQuery = {},
): void {
  out.length = 0;
  collectMobsNear(caller.x, caller.y, radiusPx, nearbyScratch);
  for (const mob of nearbyScratch) {
    if (mob === caller || !mob.isAlive || !mob.isHostile) continue;
    if (query.excludeFairies === true && mob instanceof Fairy) continue;
    if (Math.hypot(mob.x - caller.x, mob.y - caller.y) > radiusPx) continue;
    out.push(mob);
  }
  nearbyScratch.length = 0;
}
