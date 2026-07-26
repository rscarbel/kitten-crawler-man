/**
 * A frame-wide quota on A* searches. Without it, a pack that aggroes together
 * repaths together and the whole cost lands on one frame as a visible hitch;
 * mobs denied a search simply follow their existing path one frame longer.
 */

/** A* searches mobs may start in a single frame. */
const MAX_PATHFINDS_PER_FRAME = 3;

let pathfindsThisFrame = 0;

/** Call once per frame, before mobs update. */
export function resetPathfindBudget(): void {
  pathfindsThisFrame = 0;
}

/** Claims one of this frame's searches; false when the budget is spent. */
export function tryConsumePathfind(): boolean {
  if (pathfindsThisFrame >= MAX_PATHFINDS_PER_FRAME) return false;
  pathfindsThisFrame++;
  return true;
}
