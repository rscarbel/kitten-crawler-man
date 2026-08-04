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

/**
 * A point-in-time copy of the roster, for the in-run safe-room checkpoint.
 *
 * Without it a merc hired after the checkpoint stayed hired through a death
 * while the player snapshot handed the hire fee back — a free mercenary for
 * anyone willing to die.
 */
export interface MercenaryRosterCheckpoint {
  active: HiredMercenary | null;
}

/** The hire itself is copied, not shared: one snapshot is restored many times. */
export function captureMercenaryRoster(roster: MercenaryRoster): MercenaryRosterCheckpoint {
  const hired = roster.active;
  return { active: hired === null ? null : { id: hired.id, name: hired.name } };
}

/**
 * Rewinds the roster in place — it is threaded by reference through every scene
 * and held by `MercenarySystem`, so replacing it would leave them on the old one.
 */
export function restoreMercenaryRoster(
  roster: MercenaryRoster,
  snapshot: MercenaryRosterCheckpoint,
): void {
  const hired = snapshot.active;
  roster.active = hired === null ? null : { id: hired.id, name: hired.name };
}
