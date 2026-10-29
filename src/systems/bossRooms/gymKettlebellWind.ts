import type { AudioScope } from '../../audio/AudioScope';
import { KETTLEBELL_RAIN_WIND_LOOP } from '../../audio/loopLevels';

/** The wind's level at this many bells in the air; more bells push it toward the loop's full level. */
const WIND_LEVEL_ONE_BELL = 0.45;
/** Each further bell in the air adds this share of the full level. */
const WIND_LEVEL_PER_BELL = 0.04;
const WIND_LEVEL_CAP = 1;

/** The share of the loop's level for `bellsInAir` bells; zero when none are. */
export function kettlebellWindLevel(bellsInAir: number): number {
  if (bellsInAir <= 0) return 0;
  const level = WIND_LEVEL_ONE_BELL + (bellsInAir - 1) * WIND_LEVEL_PER_BELL;
  return Math.min(WIND_LEVEL_CAP, level);
}

/**
 * Keeps the rain's wind sounding while bells are in the air, louder the more
 * there are.
 *
 * The level is set only when the count of bells changes: every ramp clears
 * what is scheduled on the loop's gain, so asking for it each frame would cut
 * the loop's fade-in off on its first frame.
 */
export class KettlebellWind {
  /** The bells the wind was last levelled for; null while it is not wanted. */
  private levelledFor: number | null = null;

  update(scope: AudioScope | null, bellsInAir: number): void {
    if (scope === null) return;
    const level = kettlebellWindLevel(bellsInAir);
    if (level <= 0) {
      this.silence(scope);
      return;
    }
    const volume = KETTLEBELL_RAIN_WIND_LOOP.volume * level;
    // Asked of the scope each frame: a start declined while the buffer is
    // still decoding or the context is locked must be retried.
    if (!scope.isAmbientLoopRunning(KETTLEBELL_RAIN_WIND_LOOP.id)) {
      scope.startAmbientLoop(KETTLEBELL_RAIN_WIND_LOOP.id, volume, {
        fadeInMs: KETTLEBELL_RAIN_WIND_LOOP.fadeInMs,
      });
    } else if (this.levelledFor !== bellsInAir) {
      scope.setAmbientLoopVolume(KETTLEBELL_RAIN_WIND_LOOP.id, volume);
    }
    this.levelledFor = bellsInAir;
  }

  /** Stops the wind, for a frame the world does not run or a scene leaving the floor. */
  silence(scope: AudioScope | null): void {
    scope?.stopLoop(KETTLEBELL_RAIN_WIND_LOOP);
    this.levelledFor = null;
  }
}
