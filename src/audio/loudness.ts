import { LOUDNESS } from './loudness.generated';
import type { LoudnessBus } from './loudnessTargets';
import type { SoundId } from './sounds';

/**
 * Playback gain in dB that levels `id` to its bus target, as measured by
 * `npm run measure:audio`. Apply it on top of the bus gain; never re-encode.
 */
export function loudnessTrimDb(id: SoundId): number {
  return LOUDNESS[id].trimDb;
}

/** The bus whose target `id` was levelled to. */
export function loudnessBus(id: SoundId): LoudnessBus {
  return LOUDNESS[id].bus;
}
