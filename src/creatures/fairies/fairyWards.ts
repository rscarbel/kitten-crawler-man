/**
 * The rules for a shield fairy's wards, in one place, so the fairy that lays
 * them, the system that draws their tethers and strips them on its death, and
 * the gates all agree on who holds which ward.
 *
 * A ward makes its carrier invulnerable for as long as the fairy that laid it
 * lives. A mob holds at most one fairy ward: `applyStatus` replaces by type, so a
 * second fairy warding the same goblin would silently overwrite the first
 * fairy's ward — and killing the first would then strip nothing, which is the
 * one thing the player is promised it does.
 */

import type { Mob } from '../Mob';
import type { Player } from '../../Player';
import { FAIRY_WARD_STATUS, makeFairyWard, type StatusEffect } from '../../core/StatusEffect';
import { Fairy } from './Fairy';

/** The fairy ward `mob` carries, whoever laid it, or null. */
export function fairyWardOn(mob: Player): StatusEffect | null {
  for (const effect of mob.statusEffects) {
    if (effect.type === FAIRY_WARD_STATUS) return effect;
  }
  return null;
}

/** Whether `fairy` is holding a ward on `mob`. */
export function isWardedBy(mob: Player, fairy: Player): boolean {
  return fairyWardOn(mob)?.applier === fairy;
}

/**
 * Whether `mob` is a shield fairy, which no ward may ever be laid on. Two
 * shield fairies warding each other would both be invulnerable for as long as
 * the other lives, which is forever: a fight nobody can win.
 */
function isShieldFairy(mob: Mob): boolean {
  return mob instanceof Fairy && mob.kind === 'shield';
}

/**
 * Whether `fairy` may lay a ward on `mob` now: a living hostile that is not a
 * shield fairy (refused here, whatever candidate list the caller built) and
 * not refusing damage (a ward on an immune boss is a wasted cast), and whose
 * fairy ward slot is free — empty, left by a fairy that has died, or already
 * this fairy's.
 */
export function canTakeWardFrom(mob: Mob, fairy: Player): boolean {
  if (isShieldFairy(mob)) return false;
  if (!mob.isAlive || !mob.isHostile || mob.refusesDamage) return false;
  const ward = fairyWardOn(mob);
  if (ward === null || ward.applier?.isAlive !== true) return true;
  return ward.applier === fairy;
}

/**
 * Lays `fairy`'s ward on `mob`. Refused, returning false, when
 * {@link canTakeWardFrom} says the slot is not this fairy's to fill.
 */
export function applyFairyWardFrom(fairy: Player, mob: Mob): boolean {
  if (!canTakeWardFrom(mob, fairy)) return false;
  mob.applyStatus(makeFairyWard(fairy));
  return isWardedBy(mob, fairy);
}

/** Every mob in `mobs` that `fairy` is currently holding a ward on. */
export function mobsWardedBy(fairy: Player, mobs: readonly Mob[], out: Mob[]): void {
  out.length = 0;
  for (const mob of mobs) {
    if (mob.isAlive && isWardedBy(mob, fairy)) out.push(mob);
  }
}

/** Strips every ward `fairy` laid, from every mob in `mobs`. Returns how many came off. */
export function stripWardsHeldBy(fairy: Player, mobs: readonly Mob[]): number {
  let removed = 0;
  for (const mob of mobs) removed += mob.removeWardsAppliedBy(fairy);
  return removed;
}
