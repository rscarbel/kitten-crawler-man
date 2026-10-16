/**
 * The scene's side of the {@link TitleCamera}: the slow parallax drift of the
 * idle loop, the shake that sells the logo slam, and the dive's push toward
 * the stairwell. Layers only ever see the read-only camera. A player who asked
 * for less motion gets none of the three.
 */

import type { TitleClock } from './titleClock';
import type { TitleCamera, TitleDepth, TitlePoint } from './titleLayer';
import type { TitleStage } from './titleStage';
import type { TitleCue } from './titleTimeline';

/** How far the nearest plane wanders at the drift's widest, in CSS pixels. */
const DRIFT_AMPLITUDE_PX = { x: 14, y: 5 } as const;
/** One full sway of the drift; slow enough to read as breathing, not motion. */
const DRIFT_PERIOD_MS = { x: 23000, y: 17000 } as const;

/** The shake's strength the instant it fires, in CSS pixels at the nearest plane. */
const SHAKE_PEAK_PX = 9;
/** How long the shake takes to die away. */
const SHAKE_DURATION_MS = 420;
/** Shake frequency: fast enough to read as a jolt. */
const SHAKE_PERIOD_MS = 46;

/** The zoom the dive ends on: a push into the stairwell, not a fly-through. */
const DIVE_END_ZOOM = 1.6;

const FULL_TURN = Math.PI * 2;
/** Offsets the vertical shake from the horizontal so it never moves on a straight line. */
const SHAKE_VERTICAL_PHASE = 1.7;

const REST_ZOOM = 1;
const NO_OFFSET: TitlePoint = { x: 0, y: 0 };

export class TitleCameraRig implements TitleCamera {
  zoom = REST_ZOOM;
  zoomOrigin: TitlePoint = NO_OFFSET;
  private drift: TitlePoint = NO_OFFSET;
  private shake: TitlePoint = NO_OFFSET;
  private shakeStartedAtMs: number | null = null;

  offsetFor(depth: TitleDepth): TitlePoint {
    return {
      x: (this.drift.x + this.shake.x) * depth,
      y: (this.drift.y + this.shake.y) * depth,
    };
  }

  /**
   * `firedAtElapsedMs` is when the cue's keyframe fell on the scene clock,
   * which is earlier than now when a sequence is entered part-way: a moment
   * frozen after the slam shows the shake already dying, not just starting.
   */
  onCue(cue: TitleCue, firedAtElapsedMs: number, reducedMotion: boolean): void {
    if (cue === 'shake' && !reducedMotion) this.shakeStartedAtMs = firedAtElapsedMs;
  }

  /** Re-derives the camera from the clock; call after every tick and before a frozen render. */
  update(clock: TitleClock, stage: TitleStage): void {
    this.zoomOrigin = stage.stairwell;
    // Under reduced motion the dive is the fade to black alone, with no push.
    const push = clock.reducedMotion ? 0 : easeInCubic(clock.diveProgress);
    this.zoom = REST_ZOOM + (DIVE_END_ZOOM - REST_ZOOM) * push;
    this.drift = clock.reducedMotion ? NO_OFFSET : driftAt(clock.elapsedMs);
    this.shake = this.shakeAt(clock.elapsedMs);
  }

  private shakeAt(elapsedMs: number): TitlePoint {
    const startedAt = this.shakeStartedAtMs;
    if (startedAt === null) return NO_OFFSET;
    const sinceMs = elapsedMs - startedAt;
    if (sinceMs < 0 || sinceMs >= SHAKE_DURATION_MS) return NO_OFFSET;
    const strength = SHAKE_PEAK_PX * (1 - sinceMs / SHAKE_DURATION_MS);
    const phase = (sinceMs / SHAKE_PERIOD_MS) * FULL_TURN;
    return {
      x: Math.sin(phase) * strength,
      y: Math.sin(phase + SHAKE_VERTICAL_PHASE) * strength,
    };
  }
}

function driftAt(elapsedMs: number): TitlePoint {
  return {
    x: Math.sin((elapsedMs / DRIFT_PERIOD_MS.x) * FULL_TURN) * DRIFT_AMPLITUDE_PX.x,
    y: Math.sin((elapsedMs / DRIFT_PERIOD_MS.y) * FULL_TURN) * DRIFT_AMPLITUDE_PX.y,
  };
}

function easeInCubic(t: number): number {
  return t * t * t;
}
