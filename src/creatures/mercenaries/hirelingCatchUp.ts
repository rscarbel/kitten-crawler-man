import { TILE_SIZE } from '../../core/constants';

/**
 * When a hireling that has fallen behind is put back beside the party.
 *
 * A hire walks slower than a crawler, and its route home is capped at the
 * pathfinder's search distance, so a long run leaves it somewhere it can no
 * longer path from. It then stands there for the rest of the floor, off
 * screen, which reads to the player as a hire that vanished.
 */

const UPDATE_FRAMES_PER_SECOND = 60;

/**
 * Past this straight-line distance from the crawler it follows, a hireling the
 * player cannot see is put back beside them. Well beyond any follow band or
 * leash, so a hire that is merely lagging is left to walk.
 */
export const HIRELING_CATCH_UP_TILES = 14;

const STUCK_SECONDS = 3;
/**
 * Frames a hireling may spend trying to walk home without covering ground
 * before it is put back beside the party, on screen or not: a hire grinding
 * into a wall in plain view is as lost as one out of sight.
 */
export const HIRELING_STUCK_FRAMES = STUCK_SECONDS * UPDATE_FRAMES_PER_SECOND;

/**
 * Pixels a tick must carry the hireling to count as progress on the way home.
 * Measured from position rather than read from `isMoving`, which stays true
 * for a body walking into a wall.
 */
export const HIRELING_STUCK_MIN_STEP_PX = 0.25;

/** What the system knows about a standing hireling on the frame it asks. */
export interface CatchUpReading {
  /** Straight-line pixels between the hireling and the crawler it follows. */
  readonly distancePx: number;
  /** Whether the hireling is inside the visible screen. */
  readonly onScreen: boolean;
  /** Frames it has spent trying to walk home without covering ground. */
  readonly followStallFrames: number;
  /** Whether a hostile has it as a target — a hire mid-fight is never moved. */
  readonly engagedByHostile: boolean;
}

export function hirelingShouldCatchUp(reading: CatchUpReading): boolean {
  if (reading.engagedByHostile) return false;
  const farAndUnseen =
    reading.distancePx > HIRELING_CATCH_UP_TILES * TILE_SIZE && !reading.onScreen;
  const stuck = reading.followStallFrames >= HIRELING_STUCK_FRAMES;
  return farAndUnseen || stuck;
}
