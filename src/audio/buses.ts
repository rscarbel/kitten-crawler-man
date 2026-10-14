import { dbToGain } from './voiceFades';

/**
 * The mix buses, each feeding the master bus:
 *
 *   music, sfx, ambience, ui → master → limiter → destination
 *
 * (with a mono downmix path beside the last step; see `AudioManager`)
 *
 * Every bus sits at unity at full slider. Each recording is trimmed to its
 * bus's loudness target (`BUS_TARGET_LUFS` in `loudnessTargets.ts`), and
 * those targets are what place the buses against each other: music under
 * the effects it accompanies, ambience under both.
 */
export type BusId = 'music' | 'sfx' | 'ambience' | 'ui';

/** The buses a one-shot may play on; music and ambience voices are owned by their own APIs. */
export type OneShotBus = Extract<BusId, 'sfx' | 'ui'>;

/**
 * The master limiter: a brickwall just under full scale. A safety net for
 * pile-ups, not a substitute for levelling the recordings.
 */
export const LIMITER = {
  thresholdDb: -3,
  kneeDb: 0,
  ratio: 20,
  attackS: 0.001,
  releaseS: 0.1,
} as const;

/** How long any volume slider change takes to land, short enough to feel immediate. */
export const VOLUME_RAMP_MS = 50;

/**
 * dB of attenuation per decade of slider travel. At 40 the taper is a square
 * law: half the slider is −12 dB, which the ear hears as about half as loud,
 * where a linear slider would put nearly all its audible range in the top tenth.
 */
const SLIDER_TAPER_DB_PER_DECADE = 40;

/** The gain a 0–1 volume slider position stands for: silence at 0, unity at 1. */
export function sliderGain(position: number): number {
  if (!(position > 0)) return 0;
  const clamped = Math.min(1, position);
  return dbToGain(SLIDER_TAPER_DB_PER_DECADE * Math.log10(clamped));
}
