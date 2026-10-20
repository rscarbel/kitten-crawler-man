/**
 * The challenge under way, as a card in the top band: its name, what it asks
 * with the kills so far, and its clock as a draining bar that turns to
 * warning colour in the last seconds.
 */

import { secondsLabel } from '../../systems/questTracker';
import type { TopBandEntry } from './topBand';
import { stackedBandEntry, TOP_BAND_WIDTH, type BandRow } from './topBandStack';

/** What the card shows of a running challenge. */
export interface AIChallengeBandModel {
  readonly title: string;
  readonly objective: string;
  /** "2/5", for a challenge that counts kills; null otherwise. */
  readonly progress: string | null;
  /** Frames left and the clock's full length; null for an untimed challenge. */
  readonly clock: { readonly framesLeft: number; readonly framesLimit: number } | null;
  /** The clock is nearly out. */
  readonly urgent: boolean;
}

export function aiChallengeBandEntry(model: AIChallengeBandModel): TopBandEntry {
  const detail =
    model.progress === null ? model.objective : `${model.objective} · ${model.progress}`;
  const rows: BandRow[] = [
    { kind: 'text', text: `Challenge: ${model.title}`, role: 'label', tone: 'accent' },
    { kind: 'text', text: detail, role: 'caption', tone: 'neutral' },
  ];
  const clock = model.clock;
  if (clock !== null) {
    rows.push({
      kind: 'meter',
      id: 'ai-challenge/clock',
      value: clock.framesLeft,
      max: clock.framesLimit,
      meterKind: model.urgent ? 'warning' : 'progress',
      valueText: secondsLabel(clock.framesLeft),
    });
  }
  return stackedBandEntry({
    id: 'ai-challenge',
    priority: 'countdown',
    maxWidth: TOP_BAND_WIDTH.regular,
    accentTone: model.urgent ? 'warning' : 'accent',
    rows,
  });
}
