/**
 * Lets a mob shout for its own kind.
 *
 * Enemies with a single-target aggro scan have no way to tell each other
 * anything, so a room of four goblins is four separate fights that happen to
 * share a floor — pull them one at a time from a doorway and the "group" never
 * exists. A pack alert is what makes the spawn counts already in the level defs
 * *behave* like groups, before a single extra body is spawned.
 *
 * The roster is published per frame by `MobUpdateLoop`, in the same shape and
 * for the same reason as {@link module:creatures/pathfindBudget}: a mob has no
 * reference to the world it lives in, and threading a spatial grid through
 * `updateAI` for a call that happens a handful of times per fight would cost
 * every mob a parameter it never reads.
 */

import type { Player } from '../Player';
import type { Mob } from './Mob';
import type { SpatialGrid } from '../core/SpatialGrid';

let mobGrid: SpatialGrid<Mob> | null = null;

/**
 * Publish this frame's mob grid. Called once per frame before mobs update;
 * pass null when tearing a scene down so a stale grid can never be searched.
 */
export function setPackAlertGrid(grid: SpatialGrid<Mob> | null): void {
  mobGrid = grid;
  // The scratch set holds the last query's mobs, so dropping the grid alone
  // still leaves a torn-down scene's roster — and through it its map — alive.
  nearbyScratch.clear();
}

/** Scratch set reused across calls so an alert allocates nothing. */
const nearbyScratch = new Set<Mob>();

/**
 * Point every living mob of `caller`'s own pack within `radiusPx` at `target`.
 *
 * Only mobs that are not already fighting something are moved, which is also
 * what bounds the whole mechanism: an alerted mob has a target, so it never
 * re-broadcasts, and one shout can never cascade across a floor.
 */
export function alertPackAround(caller: Mob, radiusPx: number, target: Player): void {
  if (mobGrid === null) return;
  nearbyScratch.clear();
  mobGrid.queryCircle(caller.x, caller.y, radiusPx, nearbyScratch);
  for (const ally of nearbyScratch) {
    if (ally === caller) continue;
    if (ally.packKind !== caller.packKind) continue;
    ally.noticeTarget(target);
  }
}
