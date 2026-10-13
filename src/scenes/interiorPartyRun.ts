import type { PlayerSnapshot } from '../core/PlayerSnapshot';
import type { SaveWriteOutcome } from '../core/progressPersistence';
import { createWheelLedger, type WheelLedger } from '../core/WheelLedger';
import { createAttackCowState, type AttackCowState } from '../core/AttackCowState';
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
   * Resolves once storage has answered.
   */
  readonly commitSave: (party: SaveParty) => Promise<SaveWriteOutcome>;
  /** The page's wipe, or null where nothing is saved (dev routes, harnesses). */
  readonly progressWipe: ProgressWipe | null;
}

/** For an interior with no floor behind it: fresh state and no storage. */
export function detachedPartyRun(): InteriorPartyRun {
  return {
    wheelLedger: createWheelLedger(),
    attackCowState: createAttackCowState(),
    commitSave: () => Promise.resolve('disabled'),
    progressWipe: null,
  };
}
