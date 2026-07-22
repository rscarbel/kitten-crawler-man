/**
 * Proximity helper shared by the two systems that host citizens
 * (`TownLifeSystem` on the streets, `InteriorOccupantSystem` in buildings): find
 * the closest talkable townsperson to the player so Space can open a
 * conversation. Kept separate from wander so both callers reuse the exact same
 * pick-nearest rule.
 */

import type { Townsperson } from './Townsperson';

/**
 * The nearest citizen whose center lies within `maxDist` pixels of the point
 * `(x, y)` (the player's origin — the half-tile draw offsets cancel), or `null`
 * when nobody is close enough to talk to.
 */
export function findNearestTownsperson(
  people: ReadonlyArray<Townsperson>,
  x: number,
  y: number,
  maxDist: number,
): Townsperson | null {
  let best: Townsperson | null = null;
  let bestDist = maxDist;
  for (const person of people) {
    const dist = Math.hypot(person.x - x, person.y - y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = person;
    }
  }
  return best;
}
