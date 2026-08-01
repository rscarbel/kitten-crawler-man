/**
 * Proximity helper shared by the two systems that host citizens
 * (`TownLifeSystem` on the streets, `InteriorOccupantSystem` in buildings): find
 * the closest talkable townsperson to the player so Space can open a
 * conversation. Kept separate from wander so both callers reuse the exact same
 * pick-nearest rule.
 */

import type { Townsperson } from './Townsperson';

/**
 * How far from the person the player must get before an open conversation
 * closes itself. Several times the ~1.1-tile radius that opens one, so that a
 * tapped movement key never ends a conversation the player meant to keep
 * reading — only walking off does.
 */
export const CONVERSATION_WALK_AWAY_TILES = 3.5;

/**
 * The nearest citizen whose center lies within `maxDist` pixels of the point
 * `(x, y)` (the player's origin — the half-tile draw offsets cancel), or `null`
 * when nobody is close enough to talk to.
 */
export function findNearestTownsperson(
  people: Iterable<Townsperson>,
  x: number,
  y: number,
  maxDist: number,
): Townsperson | null {
  let best: Townsperson | null = null;
  let bestDistSq = maxDist * maxDist;
  for (const person of people) {
    const dx = person.x - x;
    const dy = person.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      best = person;
    }
  }
  return best;
}
