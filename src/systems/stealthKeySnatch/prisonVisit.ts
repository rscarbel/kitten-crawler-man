import type { StealthKeySnatchPhase } from './stealthKeySnatchCheckpoint';
import {
  partyHoldsPrisonKey,
  type PrisonKeyHolders,
  type StealthKeySnatchVisit,
} from './stealthKeySnatchVisit';

/**
 * A prison visit with no floor outside, for a harness or a dev route that
 * boots straight into the prison: the gate guard has already briefed the
 * party, the explainer is unread and the phase follows the inventories.
 */
export function detachedPrisonVisit(): StealthKeySnatchVisit {
  let phase: StealthKeySnatchPhase = 'briefed';
  let explainerSeen = false;
  return {
    get phase(): StealthKeySnatchPhase {
      return phase;
    },
    get explainerSeen(): boolean {
      return explainerSeen;
    },
    markExplainerSeen: () => {
      explainerSeen = true;
    },
    syncWithInventories: (party: PrisonKeyHolders) => {
      if (phase === 'opened' || phase === 'unmet') return;
      phase = partyHoldsPrisonKey(party) ? 'keyHeld' : 'briefed';
    },
  };
}
