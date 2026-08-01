/**
 * Resolves the player's quality preset into a concrete render scale, and — for
 * the `auto` preset — measures whether the machine can actually sustain it.
 *
 * Shape: static floor → one short probe under existing cover → latch for the
 * session. Deliberately not continuous adaptation, which oscillates and is more
 * annoying than a slightly-low setting. The one exception is a single late
 * downgrade, which is what catches thermal throttling on laptops and phones —
 * something no boot-time probe can see. Because it is one-way and capped it
 * cannot oscillate.
 *
 * Only ever the choice `'auto'` is persisted, never its resolved value:
 * hardware, thermal state and external displays all change between sessions.
 */

import type { SceneManager } from './Scene';
import {
  MAX_SHARP_RENDER_SCALE,
  PERFORMANCE_RENDER_SCALE,
  settings,
  type QualityPreset,
} from './Settings';
import { flushPersonFrameCache } from '../sprites/person/personFrameCache';

const MS_PER_SECOND = 1000;

/** The frame rate the game is expected to hold on any display. */
const TARGET_REFRESH_HZ = 60;
const TARGET_REFRESH_MS = MS_PER_SECOND / TARGET_REFRESH_HZ;

/**
 * Frames discarded before the probe starts sampling. Every cache is cold on
 * level entry — chunks, person cells, sprite sheets — and those first frames
 * are far slower than the steady state they would be taken to represent.
 */
const PROBE_WARMUP_FRAMES = 60;

/** How long the probe samples for, once warmed up. */
const PROBE_SAMPLE_MS = 2000;

/**
 * Frames per second below which the sample is discarded rather than acted on.
 * A browser throttling rAF for a hidden or occluded window delivers on the
 * order of one frame a second; no playable frame rate is anywhere near that, so
 * a count this low describes the browser's scheduling, not the game's cost.
 */
const MIN_UNTHROTTLED_FPS = 5;

/** Percentile of frame intervals compared against the budget. */
const BREACH_PERCENTILE = 0.95;

/**
 * How far past the target interval the p95 may sit before the scale is judged
 * unsustainable. Some slack: a scale change is disruptive and a display that
 * misses one frame in twenty is not visibly stuttering.
 */
const BREACH_TOLERANCE = 1.5;

/**
 * Frame interval at which the game reads as genuinely stuttering rather than
 * merely short of a high-refresh display's ceiling — about forty frames a
 * second.
 */
const STUTTER_INTERVAL_MS = TARGET_REFRESH_MS * BREACH_TOLERANCE;

/**
 * Length of the post-probe watch window. Long enough that only sustained
 * slowness trips it — a spike from a boss spawn or a chunk bake cannot.
 */
const SAFETY_NET_WINDOW_MS = 10000;

type ProbeState = 'idle' | 'warmup' | 'sampling' | 'done';

function percentile(sortedAscending: number[], fraction: number): number {
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.round(fraction * (sortedAscending.length - 1))),
  );
  return sortedAscending[index];
}

/**
 * The density `sharp` asks for: the display's own, capped — and rounded to a
 * whole number.
 *
 * Windows at 125–175% display scaling and most Android devices report
 * fractional ratios, and a fractional scale is exactly what the preset design
 * exists to avoid: adjacent chunk blits land on fractional device pixels and
 * leave hairline seams, and the person cache's cells stop being a whole number
 * of device pixels, so every citizen is resampled — undoing the sharpening the
 * scale was raised for.
 */
export function sharpRenderScale(): number {
  const rounded = Math.round(window.devicePixelRatio);
  return Math.min(Math.max(PERFORMANCE_RENDER_SCALE, rounded), MAX_SHARP_RENDER_SCALE);
}

class RenderQualityController {
  private sceneManager: SceneManager | null = null;

  private probeState: ProbeState = 'idle';
  private warmupFramesLeft = 0;
  private samplingStartedAt = 0;
  private probeIntervals: number[] = [];
  private lastFrameTime: number | null = null;

  /** Set once a probe or the safety net has lowered the scale, latching it. */
  private downgraded = false;

  /** The late downgrade is single-shot; this records that it has been spent. */
  private safetyNetSpent = false;
  private safetyNetWindowStartedAt: number | null = null;
  private safetyNetIntervals: number[] = [];

  /**
   * Wires the controller to the canvas owner and applies the stored preset.
   * `auto` starts optimistic — beginning low and upgrading later would make the
   * player's first impression the soft one.
   */
  attach(sceneManager: SceneManager): void {
    this.sceneManager = sceneManager;
    this.applyScale(this.resolveScale(settings.quality));
  }

  /** The scale a preset asks for before any measurement. */
  private resolveScale(preset: QualityPreset): number {
    switch (preset) {
      case 'performance':
        return PERFORMANCE_RENDER_SCALE;
      case 'sharp':
        return sharpRenderScale();
      case 'auto':
        return sharpRenderScale();
    }
  }

  /**
   * Records the player's explicit choice. A manual choice wins permanently on
   * this device: no probe, no safety net. `auto` stays selectable so control can
   * be handed back.
   */
  setPreset(preset: QualityPreset): void {
    settings.setQuality(preset);
    this.probeState = preset === 'auto' ? 'idle' : 'done';
    this.safetyNetSpent = preset !== 'auto';
    this.downgraded = false;
    this.resetSafetyNetWindow();
    this.applyScale(this.resolveScale(preset));
    // Handing control back mid-level would otherwise leave `auto` unmeasured
    // until the next level entry, with neither the probe nor the safety net
    // running for the rest of this one.
    if (preset === 'auto') this.requestProbe();
  }

  /**
   * Re-resolve the scale after the window moved or the display changed.
   *
   * `devicePixelRatio` is not fixed for the life of a page: dragging the window
   * from a retina laptop panel to a 1× external monitor would otherwise leave a
   * doubled backing store rendering four times the pixels for no visible gain,
   * and the reverse would leave the game soft on the sharper screen. A latched
   * downgrade is respected — that decision was about this machine's speed, not
   * about its display.
   */
  handleDisplayChange(): void {
    if (this.downgraded) return;
    this.applyScale(this.resolveScale(settings.quality));
  }

  /**
   * Ask for a probe at the start of a level. Called on scene entry rather than
   * from the intro banner itself, so levels entered without a banner are still
   * covered — the player cannot act during either.
   *
   * A display with no extra pixels to render has nothing to measure, and a
   * probe that has already run is never re-run: the choice is latched for the
   * session.
   */
  requestProbe(): void {
    if (settings.quality !== 'auto') return;
    if (this.probeState !== 'idle') return;
    if (sharpRenderScale() <= PERFORMANCE_RENDER_SCALE) {
      this.probeState = 'done';
      return;
    }
    this.probeState = 'warmup';
    this.warmupFramesLeft = PROBE_WARMUP_FRAMES;
    this.probeIntervals = [];
  }

  /** Called once per rendered frame with the rAF timestamp. */
  recordFrame(now: number): void {
    const previous = this.lastFrameTime;
    this.lastFrameTime = now;
    if (previous === null) return;
    const interval = now - previous;

    this.advanceProbe(now, interval);
    this.advanceSafetyNet(now, interval);
  }

  private advanceProbe(now: number, interval: number): void {
    switch (this.probeState) {
      case 'warmup':
        this.warmupFramesLeft--;
        if (this.warmupFramesLeft <= 0) {
          this.probeState = 'sampling';
          this.samplingStartedAt = now;
        }
        return;
      case 'sampling':
        // A hidden document gets throttled rAF, which would read as a machine
        // that cannot keep up. Abandon rather than act on it; the next level
        // entry gets another chance.
        if (document.hidden) {
          this.probeState = 'idle';
          return;
        }
        this.probeIntervals.push(interval);
        if (now - this.samplingStartedAt < PROBE_SAMPLE_MS) return;
        this.probeState = 'done';
        this.judgeProbe();
        return;
      case 'idle':
      case 'done':
        return;
    }
  }

  private judgeProbe(): void {
    const intervals = this.probeIntervals;
    this.probeIntervals = [];
    if (breachesBudget(intervals)) this.downgradeOnce();
  }

  /**
   * The one late downgrade. Watches whole windows rather than single frames so
   * only sustained slowness — thermal throttling, not a boss spawn — trips it.
   */
  private advanceSafetyNet(now: number, interval: number): void {
    if (this.safetyNetSpent) return;
    if (this.probeState !== 'done') return;
    // Nothing left to give up at the bottom of the ladder — but do not spend the
    // net here, because a move to a 1× display also lands in this branch and the
    // player may well move back to the sharper screen.
    if (this.currentScale() <= PERFORMANCE_RENDER_SCALE) {
      this.resetSafetyNetWindow();
      return;
    }
    if (document.hidden) {
      this.resetSafetyNetWindow();
      return;
    }
    if (this.safetyNetWindowStartedAt === null) {
      this.safetyNetWindowStartedAt = now;
      this.safetyNetIntervals = [];
    }
    this.safetyNetIntervals.push(interval);
    if (now - this.safetyNetWindowStartedAt < SAFETY_NET_WINDOW_MS) return;

    const intervals = this.safetyNetIntervals;
    this.resetSafetyNetWindow();
    if (!breachesBudget(intervals)) return;
    this.safetyNetSpent = true;
    this.downgradeOnce();
  }

  /**
   * Discards a part-collected window. Any interruption — a hidden tab, a move
   * to a 1× display, the player changing preset — makes the samples stale, and
   * a window left open would be judged the instant it resumes, on measurements
   * taken before whatever interrupted it.
   */
  private resetSafetyNetWindow(): void {
    this.safetyNetWindowStartedAt = null;
    this.safetyNetIntervals = [];
  }

  private currentScale(): number {
    return this.sceneManager?.renderScale ?? PERFORMANCE_RENDER_SCALE;
  }

  /** Steps down one rung of the ladder. There is only one rung below sharp. */
  private downgradeOnce(): void {
    this.downgraded = true;
    this.applyScale(PERFORMANCE_RENDER_SCALE);
  }

  private applyScale(scale: number): void {
    const manager = this.sceneManager;
    if (manager === null) return;
    if (manager.renderScale === scale) return;
    manager.setRenderScale(scale);
    // Baked cells are density-specific; keeping them would leave every citizen
    // resampled for the rest of the session.
    flushPersonFrameCache();
  }
}

/**
 * Whether a sample of frame intervals is slow enough to be worth giving up
 * density for: the p95 interval past an absolute stutter threshold.
 *
 * The plan asked for this to be measured against the display's own refresh
 * rate, estimated from the samples. That was implemented and then removed,
 * because it cannot do any work here. The estimate has to be capped at 60 Hz —
 * otherwise a machine pinned at half rate takes its own failure as the target
 * and always passes — and once capped, `estimate × tolerance` is never greater
 * than the absolute threshold, so the display-relative test can never be the
 * binding one. Leaving it in would have been arithmetic that reads as a
 * safeguard while deciding nothing.
 *
 * Judging against an absolute threshold is also the safer rule on the evidence:
 * floor 3 measures identically at 1× and 2×, so a 120 Hz machine held to
 * 12.5 ms would downgrade for a cost the density is not causing, giving up
 * sharpness and buying nothing.
 *
 * A sample too sparse to trust reads as no breach: throttled rAF describes the
 * browser's scheduling, not the game's cost.
 */
function breachesBudget(intervals: number[]): boolean {
  if (intervals.length === 0) return false;
  const elapsedSeconds = intervals.reduce((total, interval) => total + interval, 0) / MS_PER_SECOND;
  if (intervals.length < elapsedSeconds * MIN_UNTHROTTLED_FPS) return false;

  const sorted = [...intervals].sort((a, b) => a - b);
  return percentile(sorted, BREACH_PERCENTILE) > STUTTER_INTERVAL_MS;
}

export const renderQuality = new RenderQualityController();
