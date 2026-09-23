import type { MercenaryTemplateId } from './mercenaryTemplates';

/**
 * Cross-scene state for the Desperado Club's "Meat Shields" mercenary desk.
 *
 * Like `ClubMembership` and the questline progress objects, this is a plain
 * mutable object threaded by reference through the `DungeonScene` ↔
 * `BuildingInteriorScene` constructors so a hired mercenary survives leaving
 * the club and returning to the overworld.
 *
 * A contract runs to the end of the floor it was signed on, or until the
 * mercenary dies, whichever comes first: that is how Meat Shields sells them.
 * There is one contract slot; `active` is a single field rather than a list
 * only because nothing yet lets two hires walk together.
 */
export interface HiredMercenary {
  id: MercenaryTemplateId;
  name: string;
  /** The floor the contract was signed on. It ends the moment the party is anywhere else. */
  contractLevelId: string;
  /** Set once the hire has said hello, so walking out of a shop does not repeat it. */
  introduced: boolean;
}

export interface MercenaryRoster {
  active: HiredMercenary | null;
  /**
   * The name of the last hire to die under contract, until the desk has spoken
   * about it. Kept so the next visit can open with Rosemarie's condolences —
   * and her reminder that the fee is not coming back.
   */
  lastDeceased: string | null;
  /**
   * The floor the party is standing on, stamped by each `DungeonScene` as it is
   * built. Not part of any snapshot: it describes where the roster is being
   * read, not what it holds. The desk signs contracts against it, and a
   * restore reads it to refuse a contract signed on another floor.
   */
  floorLevelId: string | null;
}

export function createMercenaryRoster(): MercenaryRoster {
  return { active: null, lastDeceased: null, floorLevelId: null };
}

/**
 * A point-in-time copy of the roster, for the in-run safe-room checkpoint and
 * the persisted save.
 *
 * Without it a merc hired after the checkpoint stayed hired through a death
 * while the player snapshot handed the hire fee back — a free mercenary for
 * anyone willing to die.
 */
export interface MercenaryRosterCheckpoint {
  active: HiredMercenary | null;
  lastDeceased: string | null;
}

function copyHire(hired: HiredMercenary | null): HiredMercenary | null {
  return hired === null ? null : { ...hired };
}

/** The hire itself is copied, not shared: one snapshot is restored many times. */
export function captureMercenaryRoster(roster: MercenaryRoster): MercenaryRosterCheckpoint {
  return { active: copyHire(roster.active), lastDeceased: roster.lastDeceased };
}

/**
 * Whether a contract is still in force on the floor the party is standing on.
 * A roster that has not been told its floor yet trusts the contract: only a
 * harness builds one without a scene around it.
 */
export function contractIsCurrent(roster: MercenaryRoster, hired: HiredMercenary): boolean {
  return roster.floorLevelId === null || hired.contractLevelId === roster.floorLevelId;
}

/**
 * Rewinds the roster in place — it is threaded by reference through every scene
 * and held by `MercenarySystem`, so replacing it would leave them on the old one.
 *
 * A snapshot taken on an earlier floor can name a contract that has since run
 * out; restoring it would hand back a hire the floor change already ended.
 */
export function restoreMercenaryRoster(
  roster: MercenaryRoster,
  snapshot: MercenaryRosterCheckpoint,
): void {
  const hired = copyHire(snapshot.active);
  roster.active = hired !== null && contractIsCurrent(roster, hired) ? hired : null;
  roster.lastDeceased = snapshot.lastDeceased;
}
