/**
 * An encounter's standing objective ("Cleanse the cult — 3 remaining") as a
 * row of its top-band card, or as a card of its own when the encounter has no
 * other bar to carry it.
 */

import type { TopBandEntry } from './topBand';
import { stackedBandEntry, TOP_BAND_WIDTH, type BandTextRow, type BandTone } from './topBandStack';

/** What the encounter is asking of the party right now. */
export interface ObjectiveLine {
  readonly text: string;
  /** `warning` while the party still has work to do, `success` once the way is open. */
  readonly tone: BandTone;
}

export function objectiveRow(line: ObjectiveLine): BandTextRow {
  return { kind: 'text', text: line.text, role: 'label', tone: line.tone };
}

/** The objective on a card of its own, for an encounter with no boss bar to ride on. */
export function objectiveBandEntry(id: string, line: ObjectiveLine): TopBandEntry {
  return stackedBandEntry({
    id,
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.wide,
    rows: [objectiveRow(line)],
  });
}
