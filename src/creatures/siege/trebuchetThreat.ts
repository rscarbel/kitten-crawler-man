/**
 * Lets a hostile treat a live trebuchet as a peer of a crawler or an ally: one
 * more body worth fighting, weighed by the same "whichever is nearest" rule
 * that already picks between a crawler and a companion, rather than a special
 * case that only fires when nothing else is going on.
 *
 * Two callers, one shared core:
 *
 * - `MarchDirective` (`VillageAssaultSystem.ts`) asks {@link nearestLiveTrebuchetTo}
 *   directly with the siege's own `DefenseStructures` (`mob.siegeCapable.world.defense`),
 *   and weighs the answer against the nearest defender it already computes,
 *   before falling back to the wall it was marching on.
 * - An ordinary hostile the assault never enlisted has no such reference, so
 *   {@link tryThreatenTrebuchet} is published a `DefenseStructures` per frame
 *   by `MobUpdateLoop`, in the same shape as `packAlert.ts`'s mob grid, and
 *   weighs it against the nearest of its own candidate targets before handing
 *   the frame to its own `updateAI` (which runs the real, per-species
 *   `acquireTarget` competition unchanged when a crawler or ally wins).
 */

import { TILE_SIZE } from '../../core/constants';
import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import {
  type DefenseStructures,
  type StructureRef,
  structureKey,
} from '../../systems/briarHollow/DefenseStructures';
import { isStandingStructure, nearestStructurePoint } from './siegeCapability';

let defense: DefenseStructures | null = null;

/**
 * Publish this frame's village defenses; null outside Briar Hollow, or once
 * its kit is rebuilt or torn down, so a stale instance can never be attacked
 * through.
 */
export function setTrebuchetThreatDefense(nextDefense: DefenseStructures | null): void {
  defense = nextDefense;
}

/**
 * How far an ordinary hostile weighs a trebuchet against a crawler or ally —
 * the same scale a floor-3 enemy notices either at (most run 6-11 tiles).
 */
export const TREBUCHET_THREAT_NOTICE_TILES = 8;
/** Close enough to swing at it rather than march another step closer. */
const TREBUCHET_STRIKE_REACH_TILES = 1.1;

const HALF_TILE = TILE_SIZE / 2;

export interface TrebuchetThreat {
  readonly ref: StructureRef;
  readonly x: number;
  readonly y: number;
  /** From `mob`'s centre to the structure's nearest point, in pixels. */
  readonly distance: number;
}

/** The nearest live (unbroken) trebuchet within `noticeRangePx` of `mob`, or null. */
export function nearestLiveTrebuchetTo(
  mob: Mob,
  activeDefense: DefenseStructures,
  noticeRangePx: number,
): TrebuchetThreat | null {
  const mobCentreX = mob.x + HALF_TILE;
  const mobCentreY = mob.y + HALF_TILE;
  let best: TrebuchetThreat | null = null;
  let bestDistance = Infinity;
  for (const record of activeDefense.trebuchets) {
    if (record.broken) continue;
    const ref: StructureRef = { kind: 'trebuchet', key: structureKey(record.x, record.y) };
    const point = nearestStructurePoint(activeDefense, ref, mob);
    if (point === null) continue;
    const distance = Math.hypot(point.x - mobCentreX, point.y - mobCentreY);
    if (distance > noticeRangePx || distance >= bestDistance) continue;
    bestDistance = distance;
    best = { ref, x: point.x, y: point.y, distance };
  }
  return best;
}

/**
 * One frame of a hostile's fight against a trebuchet it has chosen to engage:
 * march straight at it through the mob's own collision, or swing once close
 * enough, landing the blow through the same `defense.damage` path every other
 * source of structure damage uses. A siege-enlisted mob also records it as
 * its `siegeTarget`, so the village's own trebuchets return fire on it with
 * the same priority they give a mob already striking a wall.
 */
export function engageTrebuchet(
  mob: Mob,
  activeDefense: DefenseStructures,
  target: TrebuchetThreat,
): void {
  if (mob.siegeCapable !== null) mob.siegeCapable.siegeTarget = target.ref;
  const dx = target.x - (mob.x + HALF_TILE);
  const dy = target.y - (mob.y + HALF_TILE);
  const distance = Math.hypot(dx, dy);
  if (!mob.isStrikingStructure && distance > TREBUCHET_STRIKE_REACH_TILES * TILE_SIZE) {
    mob.marchStep(dx, dy);
    return;
  }
  if (mob.isStrikingStructure) return;
  if (distance > 0) {
    mob.facingX = dx / distance;
    mob.facingY = dy / distance;
  }
  mob.isMoving = false;
  // An enlisted mob strikes at the siege's scale, the same as it would a wall.
  const multiplier = mob.siegeCapable?.structureDamageMultiplier ?? mob.siegeStructureMultiplier;
  const damage = mob.structureStrikeDamage * multiplier;
  const ref = target.ref;
  mob.playStructureStrike(() => {
    if (mob.isHostile && isStandingStructure(activeDefense, ref)) {
      activeDefense.damage(ref, damage, mob, 'melee');
    }
  });
}

/**
 * The nearest of `targets` this mob could otherwise be fighting: alive, not a
 * defend-quest bystander, and either its current engagement (which persists
 * through a wall the way `canNotice` lets an engaged target) or in plain
 * sight. Infinity when none qualify, so a trebuchet with nothing else around
 * always wins the comparison.
 */
function nearestPeerDistance(mob: Mob, targets: readonly Player[]): number {
  let best = Infinity;
  for (const target of targets) {
    if (!target.isAlive || target.isDefendTarget === true) continue;
    const distance = Math.hypot(target.x - mob.x, target.y - mob.y);
    if (distance >= best) continue;
    if (target !== mob.currentTarget && !mob.hasSightOfPoint(target.x, target.y)) continue;
    best = distance;
  }
  return best;
}

/**
 * One frame of an ordinary hostile's fight, with a live trebuchet weighed in
 * as one more candidate: whichever of `targets` or the nearest trebuchet is
 * closer wins, exactly as two entries of `targets` would be weighed against
 * each other by `Mob.acquireTarget`. Answers false — leaving the mob's own
 * `updateAI` to run its real target competition — when a trebuchet is out of
 * reach, farther than the nearest peer, or for a mob:
 *
 * - governed by the assault's own siege behaviour already (`siegeCapable` or
 *   `siegeDirective`), which weighs this same choice itself, in `MarchDirective`;
 * - converted to the party's side, or built to leave structures alone
 *   (`siegeStructureMultiplier` of 0 — archers, casters).
 */
export function tryThreatenTrebuchet(mob: Mob, targets: readonly Player[]): boolean {
  if (
    defense === null ||
    !mob.isHostile ||
    !mob.isAlive ||
    mob.isConverted ||
    mob.siegeCapable !== null ||
    mob.siegeDirective !== null ||
    mob.siegeStructureMultiplier <= 0
  ) {
    return false;
  }
  const target = nearestLiveTrebuchetTo(mob, defense, TREBUCHET_THREAT_NOTICE_TILES * TILE_SIZE);
  if (target === null) return false;
  if (!mob.hasSightOfPoint(target.x, target.y)) return false;
  if (nearestPeerDistance(mob, targets) <= target.distance) return false;
  mob.currentTarget = null;
  engageTrebuchet(mob, defense, target);
  return true;
}
