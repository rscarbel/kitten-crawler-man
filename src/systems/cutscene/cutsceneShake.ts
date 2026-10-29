import type { CutscenePoint } from './cutsceneCamera';

/** The screen shakes a cutscene can ask for, by how hard they hit. */
export type ShakeProfileId = 'light' | 'heavy';

interface ShakeProfile {
  /** The camera's furthest kick, in pixels, on the first tick. */
  readonly peakPx: number;
  /** World ticks the kick takes to die away. */
  readonly frames: number;
}

const SHAKE_PROFILES = {
  light: { peakPx: 3, frames: 30 },
  heavy: { peakPx: 9, frames: 75 },
} as const satisfies Record<ShakeProfileId, ShakeProfile>;

/**
 * Incommensurate wobble rates, so the offset traces a jitter rather than a
 * circle, and deterministic, so a seeded run draws the same random stream with
 * or without a camera.
 */
const WOBBLE_RATE_X = 2.3;
const WOBBLE_RATE_Y = 3.1;

const STILL: CutscenePoint = { x: 0, y: 0 };

/**
 * A cutscene's screen shake. A new shake replaces one still dying away rather
 * than stacking, since a script asks for each on purpose. The scene adds
 * {@link offset} to the camera after clamping, like its other shakes.
 */
export class CutsceneShake {
  private profile: ShakeProfile | null = null;
  private framesLeft = 0;
  private age = 0;
  private current: CutscenePoint = STILL;

  start(id: ShakeProfileId): void {
    this.profile = SHAKE_PROFILES[id];
    this.framesLeft = this.profile.frames;
  }

  tick(): void {
    this.age++;
    const profile = this.profile;
    if (profile === null || this.framesLeft <= 0) {
      this.current = STILL;
      return;
    }
    this.framesLeft--;
    const remaining = this.framesLeft / profile.frames;
    const amplitude = profile.peakPx * remaining * remaining;
    this.current = {
      x: Math.sin(this.age * WOBBLE_RATE_X) * amplitude,
      y: Math.cos(this.age * WOBBLE_RATE_Y) * amplitude,
    };
  }

  get offset(): CutscenePoint {
    return this.current;
  }

  stop(): void {
    this.profile = null;
    this.framesLeft = 0;
    this.current = STILL;
  }
}
