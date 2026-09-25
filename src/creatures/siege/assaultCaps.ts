/**
 * The two separate ceilings on the assault's living undead.
 *
 * The wave's scripted spawns are held to the assault's own live cap; the
 * necromancer's raises are held to his escort cap. Counted apart on purpose:
 * one shared ceiling is claimed first-come-first-served, and a caster raising
 * a batch every few seconds claims it far more often than a wave trickles in —
 * so a merged cap would hand the whole of it to his raises and starve the
 * wave of the bodies it was authored with.
 */

import type { Mob } from '../Mob';
import { RaisedRatkin } from '../RaisedRatkin';

/** Whether `mob` is one of the necromancer's raises rather than one of the wave's own spawns. */
export function isNecromancerRaise(mob: Mob): boolean {
  return mob instanceof RaisedRatkin && mob.raisedByNecromancer;
}

/**
 * Living hostile assault mobs the wave's live cap counts: every enlisted body
 * except the necromancer's raises.
 */
export function livingAssaultSpawns(mobs: readonly Mob[]): number {
  let living = 0;
  for (const mob of mobs) {
    if (!mob.isAlive || !mob.isHostile || mob.siegeCapable === null) continue;
    if (isNecromancerRaise(mob)) continue;
    living++;
  }
  return living;
}

/** Living raises the necromancer's own escort cap counts. */
export function livingNecromancerRaises(mobs: readonly Mob[]): number {
  let living = 0;
  for (const mob of mobs) {
    if (mob.isAlive && mob.isHostile && isNecromancerRaise(mob)) living++;
  }
  return living;
}
