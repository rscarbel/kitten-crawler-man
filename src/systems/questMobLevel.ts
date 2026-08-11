import { MAX_MOB_LEVEL } from '../levels/spawner';

/**
 * How far under the party a scripted quest enemy is allowed to sit.
 *
 * Quest encounters are authored at fixed levels, which a party that arrives
 * late has long outgrown — the circus waves and the night swarm both turn into
 * free XP. Raising an under-levelled enemy to this floor keeps the fight worth
 * having without letting a levelled party rewrite an encounter that was already
 * pitched above them.
 */
export const QUEST_LEVEL_LAG_ALLOWANCE = 6;

/**
 * The most levels the party floor may add to an encounter's authored level.
 *
 * Without a ceiling the floor alone rewrites a fight. A circus wave is authored
 * at base stats and fielded five at a time; every level multiplies its bite by
 * 20% and its health by 30%, so lifting it the full lag allowance against a
 * late-floor party turned a warm-up into an unwinnable one. Four levels is
 * enough that the encounter is no longer free XP and small enough that the
 * numbers its designer picked still describe the fight.
 */
export const QUEST_LEVEL_MAX_LIFT = 4;

/**
 * The level a scripted quest enemy actually spawns at: its authored level,
 * lifted toward the party but never past {@link QUEST_LEVEL_MAX_LIFT}.
 *
 * Never lowers the authored level — an encounter tuned above the party stays
 * where its designer put it.
 */
export function questMobLevel(authoredLevel: number, partyLevel: number): number {
  const partyFloor = partyLevel - QUEST_LEVEL_LAG_ALLOWANCE;
  const highestLift = Math.min(authoredLevel + QUEST_LEVEL_MAX_LIFT, MAX_MOB_LEVEL);
  return Math.max(authoredLevel, Math.min(partyFloor, highestLift), 1);
}
