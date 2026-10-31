import type { LevelId } from '../../levels/levelIds';
import { getMercenaryTemplate, type MercenaryTemplateId } from './mercenaryTemplates';

/**
 * Cross-scene state for The Barracks Mercenaries' hire desk.
 *
 * Like the questline progress objects, this is a plain mutable object threaded
 * by reference through the `DungeonScene` ↔ `BuildingInteriorScene`
 * constructors so a hired mercenary survives leaving the Barracks and
 * returning to the overworld.
 *
 * A contract runs to the end of the floor it was signed on, or until the
 * mercenary dies, whichever comes first: that is how the desk sells them. A
 * hire brought into a new game is the exception: it walks with the party for
 * the whole run (see {@link HireContract}).
 * There is one contract slot; `active` is a single field rather than a list
 * only because nothing yet lets two hires walk together.
 */
/**
 * How a contract was signed: paid for at the desk, or lent free for the
 * party's way under the tower, which ends when the Warden does.
 */
export const MERCENARY_CONTRACT_TERMS = ['paid', 'tower_loan'] as const;
export type MercenaryContractTerms = (typeof MERCENARY_CONTRACT_TERMS)[number];

/**
 * How long a contract runs. `floor`: signed at the desk, it ends the moment
 * the party is on any other floor. `carried`: the hire came into a new game
 * with the party and walks with it through every floor change of the run.
 */
export type HireContract =
  { readonly kind: 'floor'; readonly levelId: LevelId } | { readonly kind: 'carried' };

export interface HiredMercenary {
  id: MercenaryTemplateId;
  name: string;
  terms: MercenaryContractTerms;
  contract: HireContract;
  /** Set once the hire has said hello, so walking out of a shop does not repeat it. */
  introduced: boolean;
  /**
   * The hire's health as of the last frame it stood, so walking through a door
   * is not a free heal. Absent means full: a contract fresh from the desk.
   */
  hp?: number;
}

export interface MercenaryRoster {
  active: HiredMercenary | null;
  /**
   * The name of the last hire to die under contract, until the desk has spoken
   * about it. Kept so the next visit can open with Sydney's condolences.
   */
  lastDeceased: string | null;
  /** Whether the desk has already lent this run its one tower loan. */
  towerLoanSigned: boolean;
  /**
   * The floor the party is standing on, stamped by each `DungeonScene` as it is
   * built. Not part of any snapshot: it describes where the roster is being
   * read, not what it holds. The desk signs contracts against it, and a
   * restore reads it to refuse a contract signed on another floor.
   */
  floorLevelId: LevelId | null;
  /**
   * The name of a hire that died for good and has not yet been announced.
   *
   * On the roster rather than the system because a death at a door happens in
   * the scene being left, whose toast strip is torn down with it; the scene the
   * party arrives in announces it instead. Not part of any snapshot: it is a
   * notice waiting for a screen, not state a save describes.
   */
  unannouncedDeath?: string | null;
}

export function createMercenaryRoster(): MercenaryRoster {
  return { active: null, lastDeceased: null, towerLoanSigned: false, floorLevelId: null };
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
  towerLoanSigned: boolean;
}

/**
 * The health a hire is stood up with: what it last had, held to at least one
 * point — a hire the roster still names is alive, whatever a save caught it
 * at — and at most its template's maximum.
 */
export function hirelingStartingHp(hired: HiredMercenary): number {
  const maxHp = getMercenaryTemplate(hired.id).hp;
  if (hired.hp === undefined) return maxHp;
  return Math.min(maxHp, Math.max(1, Math.round(hired.hp)));
}

/** A hire copied deep enough that editing the copy never reaches the original. */
export function copyHire(hired: HiredMercenary | null): HiredMercenary | null {
  return hired === null ? null : { ...hired, contract: { ...hired.contract } };
}

/** The hire itself is copied, not shared: one snapshot is restored many times. */
export function captureMercenaryRoster(roster: MercenaryRoster): MercenaryRosterCheckpoint {
  return {
    active: copyHire(roster.active),
    lastDeceased: roster.lastDeceased,
    towerLoanSigned: roster.towerLoanSigned,
  };
}

/**
 * Whether a contract is still in force on the floor the party is standing on.
 * A roster that has not been told its floor yet trusts the contract: only a
 * harness builds one without a scene around it.
 */
export function contractIsCurrent(roster: MercenaryRoster, hired: HiredMercenary): boolean {
  const { contract } = hired;
  switch (contract.kind) {
    case 'floor':
      return roster.floorLevelId === null || contract.levelId === roster.floorLevelId;
    case 'carried':
      return true;
    default: {
      const unhandled: never = contract;
      return unhandled;
    }
  }
}

/** Whether a floor's end finishes this hire's contract: true for a desk hire, false for one carried into the run. */
export function contractEndsWithFloor(hired: HiredMercenary): boolean {
  const { contract } = hired;
  switch (contract.kind) {
    case 'floor':
      return true;
    case 'carried':
      return false;
    default: {
      const unhandled: never = contract;
      return unhandled;
    }
  }
}

/**
 * The hire as a new game takes it over: on a carried contract, which no floor
 * change ends, and on plain paid terms. A tower loan belonged to the missing
 * cats questline, which a new game starts again, so the Warden's death must
 * not end it.
 */
export function carriedHire(hired: HiredMercenary): HiredMercenary {
  return { ...hired, terms: 'paid', contract: { kind: 'carried' } };
}

/**
 * Rewinds the roster in place — it is threaded by reference through every scene
 * and held by `MercenarySystem`, so replacing it would leave them on the old one.
 *
 * A snapshot taken on an earlier floor can name a floor contract that has
 * since run out; restoring it would hand back a hire the floor change already
 * ended. A carried contract never runs out that way, so it is kept.
 */
export function restoreMercenaryRoster(
  roster: MercenaryRoster,
  snapshot: MercenaryRosterCheckpoint,
): void {
  const hired = copyHire(snapshot.active);
  roster.active = hired !== null && contractIsCurrent(roster, hired) ? hired : null;
  roster.lastDeceased = snapshot.lastDeceased;
  roster.towerLoanSigned = snapshot.towerLoanSigned;
}
