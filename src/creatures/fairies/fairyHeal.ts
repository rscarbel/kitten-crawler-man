/**
 * How a fairy's healing lands on a mob. One function for the living heal and
 * the death wave alike, so neither can lift a phased boss past a threshold the
 * party already fought it through.
 */

import type { Mob } from '../Mob';
import { makeOverheal } from '../../core/StatusEffect';
import { OVERHEAL_DURATION_FRAMES, OVERHEAL_MAX_HP_FRACTION } from './fairyTuning';

/** How long a healed mob's health bar stays up, so the player sees the heal land. */
const HEAL_BAR_SHOW_FRAMES = 90;

/**
 * Restores up to `amount` HP to `target`, never past its `fairyHealCeiling`.
 * A dead target, or one refusing damage (a boss between phases), gets nothing.
 * Nor does one already at zero HP: a body playing out its death (the Ball of
 * Swine bursting) still counts as alive, and a heal then would leave it
 * standing past the death it had already begun.
 * Returns the HP actually restored.
 */
export function applyFairyHeal(target: Mob, amount: number): number {
  if (!target.isAlive || target.hp <= 0 || target.refusesDamage || amount <= 0) return 0;
  const ceiling = Math.min(target.maxHp, target.fairyHealCeiling);
  if (target.hp >= ceiling) return 0;
  const healed = Math.min(amount, ceiling - target.hp);
  target.hp += healed;
  target.healthBarTimer = Math.max(target.healthBarTimer, HEAL_BAR_SHOW_FRAMES);
  return healed;
}

/** What the death wave did to one mob. */
export type HealingWaveOutcome = 'healed' | 'overhealed' | 'untouched';

/**
 * The healer's death wave on one mob: a wounded regular mob is healed to full;
 * one already at full gains an overheal ward worth a share of its max HP.
 * Bosses are left alone entirely — no heal and no ward — so the wave is a
 * reason to kill the healer away from the adds, never a boss's second wind.
 */
export function applyHealingWave(target: Mob): HealingWaveOutcome {
  if (!target.isAlive || !target.isHostile || target.isBoss || target.refusesDamage) {
    return 'untouched';
  }
  const ceiling = Math.min(target.maxHp, target.fairyHealCeiling);
  if (target.hp < ceiling) {
    applyFairyHeal(target, ceiling - target.hp);
    return 'healed';
  }
  if (!target.acceptsWards) return 'untouched';
  const overheal = Math.max(1, Math.round(target.maxHp * OVERHEAL_MAX_HP_FRACTION));
  target.applyStatus(makeOverheal(overheal, OVERHEAL_DURATION_FRAMES));
  return 'overhealed';
}
