/**
 * The damaging ground a tactic must never walk a mob onto — acid, gas, a
 * falling orb's warning ring — as published by the systems that own it.
 *
 * Published per frame by `MobUpdateLoop`, for the same reason the pack roster
 * is (see {@link module:creatures/packAlert}): a mob has no reference to the
 * world it lives in, and a tactic is the only mob behaviour that ever asks.
 *
 * Hostile mobs have no hazard-flee of their own, so "hazards outrank tactics"
 * means a tactic refuses or abandons any step onto marked ground, and the mob's
 * ordinary fight takes over. Abandoning always spends the tactic's cooldown,
 * so a retreat and the hazard can never take turns on alternate frames.
 *
 * The party's allies among the mobs — Mongo and the hirelings — do flee it,
 * through {@link markedGroundEscape}; see `Mob.avoidsMarkedGround`.
 */

import {
  hazardEscapeAmong,
  type GroundHazardSource,
  type HazardEscape,
} from '../../systems/GroundHazardSource';

const NO_SOURCES: readonly GroundHazardSource[] = [];

let sources: readonly GroundHazardSource[] = NO_SOURCES;

/**
 * Publish this frame's hazard owners. Pass an empty list when tearing a scene
 * down so a disposed system can never be asked about its ground again.
 */
export function setMarkedGroundSources(published: readonly GroundHazardSource[]): void {
  sources = published;
}

/** Which way out of marked ground a body whose top-left is at (x, y) should go, or null when it stands clear. */
export function markedGroundEscape(x: number, y: number): HazardEscape | null {
  return hazardEscapeAmong(sources, x, y);
}

/** Whether a body whose top-left is at (x, y) would be standing on marked ground. */
export function isMarkedGround(x: number, y: number): boolean {
  return markedGroundEscape(x, y) !== null;
}

/**
 * Whether walking the straight line from one top-left position to another
 * would cross marked ground anywhere, sampled every `stepPx`.
 */
export function lineCrossesMarkedGround(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  stepPx: number,
): boolean {
  if (sources.length === 0) return false;
  const length = Math.hypot(toX - fromX, toY - fromY);
  const samples = Math.max(1, Math.ceil(length / stepPx));
  for (let sample = 0; sample <= samples; sample++) {
    const along = sample / samples;
    if (isMarkedGround(fromX + (toX - fromX) * along, fromY + (toY - fromY) * along)) return true;
  }
  return false;
}
