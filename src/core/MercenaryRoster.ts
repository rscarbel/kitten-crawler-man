import type { MercenaryTemplateId } from './mercenaryTemplates';

/**
 * Cross-scene state for the Desperado Club's "Meat Shields" mercenary guild.
 *
 * Like `ClubMembership` and the questline progress objects, this is a plain
 * mutable object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors so a hired mercenary survives leaving
 * the club and returning to the overworld. The first pass supports a single
 * active hire at a time; the merc dies for good in combat (a coin sink with
 * stakes), which clears `active` back to `null`.
 */
export interface HiredMercenary {
  id: MercenaryTemplateId;
  name: string;
}

export interface MercenaryRoster {
  active: HiredMercenary | null;
}

export function createMercenaryRoster(): MercenaryRoster {
  return { active: null };
}
