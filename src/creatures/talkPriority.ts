/**
 * Shared ranking for picking which of several talkable NPCs a single Space
 * press should reach when more than one is within range: a quest-marked NPC
 * always wins over an unmarked one, a named NPC with their own shop or lines
 * wins over an anonymous ambient one, and otherwise the closest one wins.
 * Every system that owns a crowd of talkable NPCs (`TownLifeSystem`,
 * `InteriorOccupantSystem`, `VillagerSystem`) ranks its own candidates through
 * this one function, so the highlighted NPC and the one Space actually
 * reaches always agree.
 */

export const TALK_TIER_QUEST = 0;
export const TALK_TIER_NAMED = 1;
export const TALK_TIER_AMBIENT = 2;

export type TalkTier = typeof TALK_TIER_QUEST | typeof TALK_TIER_NAMED | typeof TALK_TIER_AMBIENT;

/**
 * The best of `candidates` by ascending tier, then ascending distance; ties
 * keep whichever candidate was seen first. `distance` may be in any unit
 * (pixels, tiles) as long as it agrees with `maxDistance`.
 */
export function pickByTalkPriority<T>(
  candidates: Iterable<T>,
  tierOf: (candidate: T) => TalkTier,
  distanceOf: (candidate: T) => number,
  maxDistance: number,
): T | null {
  let best: T | null = null;
  let bestTier: TalkTier = TALK_TIER_AMBIENT;
  let bestDistance = maxDistance;
  for (const candidate of candidates) {
    const distance = distanceOf(candidate);
    if (distance > maxDistance) continue;
    const tier = tierOf(candidate);
    if (best === null || tier < bestTier || (tier === bestTier && distance < bestDistance)) {
      best = candidate;
      bestTier = tier;
      bestDistance = distance;
    }
  }
  return best;
}
