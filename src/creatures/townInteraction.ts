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
 * How far from the person the player must get before an open conversation
 * closes itself. Several times the ~1.1-tile radius that opens one, so that a
 * tapped movement key never ends a conversation the player meant to keep
 * reading — only walking off does.
 */
export const CONVERSATION_WALK_AWAY_TILES = 3.5;

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
