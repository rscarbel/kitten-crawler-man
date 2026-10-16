/**
 * The title screen's one source of time. Every layer reads time from a
 * {@link TitleClock} and never from `performance.now()`, so a review render can
 * freeze any moment of any state and get the same picture every time.
 */

/** Milliseconds per second. */
const MS_PER_SECOND = 1000;

/** The scene loop's fixed update rate. */
const UPDATES_PER_SECOND = 60;

/** How much time one fixed update advances the clock. */
export const TITLE_STEP_MS = MS_PER_SECOND / UPDATES_PER_SECOND;

/**
 * Where the title sequence is:
 * - `dormant`: before the audio context runs; nearly dark, silent.
 * - `ignition`: the one-shot reveal as the music starts.
 * - `alive`: the idle loop, for as long as the player stays.
 * - `dive`: a menu choice was taken; the picture collapses before the scene is replaced.
 */
export type TitleState = 'dormant' | 'ignition' | 'alive' | 'dive';

/** What layers read of the clock. Read-only: only the scene advances time. */
export interface TitleClock {
  readonly state: TitleState;
  /** Since the scene was entered, frozen moments included. */
  readonly elapsedMs: number;
  /** Since {@link state} began. */
  readonly stateElapsedMs: number;
  /** How far the last update advanced the clock; 0 while frozen. */
  readonly dt: number;
  /** 0 before ignition, rising to 1 as it finishes; 1 from `alive` on. */
  readonly ignitionProgress: number;
  /** 0 until a choice is taken, rising to 1 as the dive finishes. */
  readonly diveProgress: number;
  /** 0..1, the music's current energy; drives light and glow intensity. */
  readonly musicPulse: number;
  /** The player asked the system for less motion: drop shake, drift and sweeps. */
  readonly reducedMotion: boolean;
}

/** One instant of the title sequence, as a review render or dev route asks for it. */
export interface TitleMoment {
  readonly state: TitleState;
  readonly stateElapsedMs: number;
  /** Defaults to {@link stateElapsedMs}. */
  readonly elapsedMs?: number;
  /**
   * For a `dive`: the state the choice was taken in. Defaults to `alive`, the
   * whole reveal already played; `dormant` dives before any of it.
   */
  readonly diveFrom?: Extract<TitleState, 'dormant' | 'alive'>;
}

/** How long each timed state lasts, for the progress values. */
export interface TitleStateDurations {
  readonly ignitionMs: number;
  readonly diveMs: number;
}

function progressThrough(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

/** The scene's side of the clock: the only code that moves time on. */
export class TitleClockSource implements TitleClock {
  state: TitleState = 'dormant';
  elapsedMs = 0;
  stateElapsedMs = 0;
  dt = 0;
  musicPulse = 0;
  private frozen = false;

  constructor(
    private readonly durations: TitleStateDurations,
    readonly reducedMotion: boolean,
  ) {}

  get ignitionProgress(): number {
    if (this.state === 'dormant') return 0;
    if (this.state === 'ignition') {
      return progressThrough(this.stateElapsedMs, this.durations.ignitionMs);
    }
    return 1;
  }

  get diveProgress(): number {
    if (this.state !== 'dive') return 0;
    return progressThrough(this.stateElapsedMs, this.durations.diveMs);
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Advances one fixed update; does nothing to a frozen clock but zero its `dt`. */
  tick(stepMs: number): void {
    if (this.frozen) {
      this.dt = 0;
      return;
    }
    this.dt = stepMs;
    this.elapsedMs += stepMs;
    this.stateElapsedMs += stepMs;
  }

  enterState(state: TitleState, stateElapsedMs = 0): void {
    this.state = state;
    this.stateElapsedMs = stateElapsedMs;
  }

  /** Pins the clock to `moment` for good: later ticks leave it there. */
  freezeAt(moment: TitleMoment): void {
    this.state = moment.state;
    this.stateElapsedMs = moment.stateElapsedMs;
    this.elapsedMs = moment.elapsedMs ?? moment.stateElapsedMs;
    this.dt = 0;
    this.frozen = true;
  }
}
