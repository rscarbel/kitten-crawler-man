/**
 * The levels `npm run measure:audio` trims every recording towards, and the
 * shape of the table it writes to `loudness.generated.ts`. Kept apart from
 * that table so the script can import the targets before the table exists.
 */

import type { SoundId } from './sounds';

export type LoudnessBus = 'music' | 'ambience' | 'sfx';

/** Integrated loudness each bus is levelled to, in LUFS. */
export const BUS_TARGET_LUFS = {
  music: -18,
  ambience: -24,
  sfx: -16,
} as const satisfies Record<LoudnessBus, number>;

/** Top-level `src/audio/` folders whose files are sound effects. */
export const SFX_FAMILIES = [
  'bosses',
  'casino',
  'characters',
  'combat',
  'effects',
  'enemies',
  'events',
  'menu',
] as const;
export type SfxFamily = (typeof SFX_FAMILIES)[number];

/**
 * Per-family departures from the SFX target, in LUFS. Menu taps sit under
 * gameplay so a flurry of clicks never competes with combat.
 */
export const SFX_FAMILY_TARGET_LUFS = {
  menu: -20,
} as const satisfies Partial<Record<SfxFamily, number>>;

/**
 * Integrated loudness needs at least one 400 ms gating block, so anything
 * shorter is levelled by its true peak instead.
 */
export const SHORT_ONE_SHOT_MAX_S = 0.4;

/**
 * True peak a short one-shot is levelled to: the SFX target plus the typical
 * crest (true peak minus integrated loudness) of the measurable effects.
 */
export const SHORT_ONE_SHOT_PEAK_TARGET_DBTP = -3;

/** No trim may push a file's true peak above this. */
export const TRIMMED_TRUE_PEAK_CEILING_DBTP = -1;

/**
 * A trim larger than this either way is capped and the file flagged for
 * re-export. The peak ceiling still wins over the cap.
 */
export const MAX_TRIM_DB = 12;

/**
 * Sound effects that must punch above the sfx bus: a featured moment the
 * player is meant to feel. Each is levelled to its own integrated target
 * instead of the bus's.
 */
export const FEATURED_SFX_TARGET_LUFS = {
  shark_breach_bite: -10,
  /** A key fragment's reveal: the most enticing reward in the game after the Golden Key's own. */
  key_fragment_fanfare: -11,
  /** The Golden Key forged whole: the biggest reward sound in the game. */
  golden_key_fanfare: -9,
} as const satisfies Partial<Record<SoundId, number>>;

/**
 * Peak ceiling for a featured effect. A featured sting leans on the master
 * limiter on purpose: its transient is allowed past full scale in the trimmed
 * signal and the brickwall limiter catches it, which is what lets a short,
 * peaky recording reach a loudness the ordinary ceiling would forbid.
 */
export const FEATURED_TRUE_PEAK_CEILING_DBTP = 4;

/** Which measurement a trim was derived from. */
export type LoudnessBasis = 'integrated' | 'peak';

/** One recording's measurement, as written by `npm run measure:audio`. */
export interface LoudnessEntry {
  readonly bus: LoudnessBus;
  readonly basis: LoudnessBasis;
  /** Integrated loudness in LUFS; −70 when the file is too short or quiet to gate. */
  readonly lufs: number;
  readonly truePeakDbtp: number;
  /** Truncated SHA-256 of the file, so a swapped file without a re-measure is caught. */
  readonly hash: string;
  /** Gain to apply on playback, in dB, after the peak ceiling and the cap. */
  readonly trimDb: number;
}
