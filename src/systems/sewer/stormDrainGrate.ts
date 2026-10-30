import type { BuildingEntry } from '../../map/buildingEntry';
import { STORM_DRAIN_ID } from '../../map/buildingIds';

/** What the storm-drain grate says to a party it will not let down. */
const STORM_DRAIN_SHUT_REFUSAL = 'The grate is bolted shut from below.';

/**
 * The storm-drain grate's refusal for `BuildingEntryGate.blockedMessage`, or
 * null when it opens. It is bolted from the sewer side, so it stays shut
 * until someone below has opened it; once open it stays open.
 */
export function stormDrainRefusal(entry: BuildingEntry, open: boolean): string | null {
  if (entry.id !== STORM_DRAIN_ID) return null;
  return open ? null : STORM_DRAIN_SHUT_REFUSAL;
}
