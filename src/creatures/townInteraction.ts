/**
 * Proximity helper shared by the two systems that host citizens
 * (`TownLifeSystem` on the streets, `InteriorOccupantSystem` in buildings): find
 * the closest talkable townsperson to the player so Space can open a
 * conversation. Kept separate from wander so both callers reuse the exact same
 * pick-nearest rule.
 */

import type { Townsperson } from './Townsperson';
import {
  pickByTalkPriority,
  TALK_TIER_AMBIENT,
  TALK_TIER_NAMED,
  TALK_TIER_QUEST,
} from './talkPriority';

/**
 * How close, in tiles, the player must stand to a citizen to talk to them —
 * on the streets and indoors alike. Also the range an open conversation with
 * one is measured against when the player walks off.
 */
export const CITIZEN_TALK_RADIUS_TILES = 1.1;

/** A citizen a questline has business with always outranks one that doesn't; a named resident with their own dialog outranks an anonymous one. */
function talkTierOf(person: Townsperson) {
  if (person.markerType !== 'none') return TALK_TIER_QUEST;
  return person.residentId !== null ? TALK_TIER_NAMED : TALK_TIER_AMBIENT;
}

/**
 * The best citizen to talk to within `maxDist` pixels of the point `(x, y)`
 * (the player's origin — the half-tile draw offsets cancel): a quest-marked
 * citizen first, then a named resident, then whoever is closest. `null` when
 * nobody is close enough to talk to.
 */
export function findNearestTownsperson(
  people: Iterable<Townsperson>,
  x: number,
  y: number,
  maxDist: number,
): Townsperson | null {
  return pickByTalkPriority(
    people,
    talkTierOf,
    (person) => Math.hypot(person.x - x, person.y - y),
    maxDist,
  );
}
