import type { PlayerSnapshot } from '../core/save/PlayerSnapshot';
import type { SaveWriteOutcome } from '../core/save/progressPersistence';
import { createWheelLedger, type WheelLedger } from '../core/save/WheelLedger';
import { createAttackCowState, type AttackCowState } from '../core/state/AttackCowState';
import type { ProgressWipe } from '../ui/screens/dialogs/wipeHold';

/** The party as a save records it, wherever it is standing. */
export interface SaveParty {
  human: PlayerSnapshot;
  cat: PlayerSnapshot;
  mongoPetHp: number;
  mongoPetResting: boolean;
}

/**
 * What a building interior borrows from the floor outside to keep the run's
 * party state and to save it. The floor outside owns the save's world half,
 * so a save written indoors is composed there, from the party as it stands
 * inside.
 */
export interface InteriorPartyRun {
  readonly wheelLedger: WheelLedger;
  readonly attackCowState: AttackCowState;
  /**
   * Writes a save now and makes it the one a death or a reload returns to.
   * A reload resumes on the building's doorstep. Resolves once storage has
   * answered.
   */
  readonly commitSave: (party: SaveParty) => Promise<SaveWriteOutcome>;
  /**
   * Whether the floor outside allows a save right now. A building is no
   * refuge from a fight still running out there — a boss, or an attack on
   * the town — and a reload must not be able to skip it.
   */
  readonly maySave: () => boolean;
  /** The page's wipe, or null where nothing is saved (dev routes, harnesses). */
  readonly progressWipe: ProgressWipe | null;
}

/** For an interior with no floor behind it: fresh state and no storage. */
export function detachedPartyRun(): InteriorPartyRun {
  return {
    wheelLedger: createWheelLedger(),
    attackCowState: createAttackCowState(),
    commitSave: () => Promise.resolve('disabled'),
    maySave: () => true,
    progressWipe: null,
  };
}
