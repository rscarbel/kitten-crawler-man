/**
 * Each crawler's thrall-summon cooldown.
 *
 * Module state rather than a system field: the scene — and the thrall system
 * with it — is rebuilt on every door visit, and walking into a shop must not
 * reset the wait. Per crawler, because the skill is: Carl and Donut each
 * summon on their own clock, and one crawler's axe and pick summons share it.
 */

import type { CrawlerKind } from './SkillManager';

const TICKS_PER_SECOND = 60;
/** How long after a summon the same crawler can summon again. */
export const THRALL_COOLDOWN_SECONDS = 60;
/** How long a crawler must wait after their thralls run out of work before summoning again. */
export const THRALL_DEPLETION_COOLDOWN_SECONDS = 15;

const ticksLeft = new Map<CrawlerKind, number>();

/** Starts `crawler`'s cooldown from now, for `seconds` (a fresh summon's full wait by default). */
export function startThrallCooldown(
  crawler: CrawlerKind,
  seconds: number = THRALL_COOLDOWN_SECONDS,
): void {
  ticksLeft.set(crawler, seconds * TICKS_PER_SECOND);
}

/** Counts every cooldown down one fixed tick. */
export function tickThrallCooldowns(): void {
  for (const [crawler, ticks] of ticksLeft) {
    if (ticks > 0) ticksLeft.set(crawler, ticks - 1);
  }
}

/** Ticks until `crawler` can summon again, 0 when ready. */
export function thrallCooldownTicksLeft(crawler: CrawlerKind): number {
  return ticksLeft.get(crawler) ?? 0;
}

/** Seconds until `crawler` can summon again, rounded up; 0 when ready. */
export function thrallCooldownSecondsLeft(crawler: CrawlerKind): number {
  return Math.ceil(thrallCooldownTicksLeft(crawler) / TICKS_PER_SECOND);
}

/** Clears every cooldown. For headless verification only. */
export function resetThrallCooldownsForTests(): void {
  ticksLeft.clear();
}
