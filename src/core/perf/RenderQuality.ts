/**
 * Resolves the player's quality preset into a concrete render scale and a
 * starting variety tier, and — when the device turns out not to keep up —
 * steps down a one-way ladder of rungs for the rest of the session.
 *
 * Shape: static floor → one short probe under existing cover → a safety net
 * that keeps watching whole windows of play. Each breached window takes one
 * rung, and the next window is sampled afresh, so a machine that is still
 * slow after a rung takes the next one. Two kinds of rung:
 *
 *  - render rungs (`auto` only): the render scale, then optional scenery
 *    detail (`fullDetail`);
 *  - variety rungs: the next {@link VarietyTier}, fewer distinct looks to bake.
 *
 * A window whose bakes take a large share of the frame is paint-bound and
 * takes a variety rung first, since fewer looks is what shrinks bake work;
 * any other window takes a render rung first. When the preferred kind is used
 * up the other kind is taken. `sharp` never gives up variety for lag: the
 * player asked for the full picture, and lag alone does not justify less.
 *
 * Deliberately not continuous adaptation, which oscillates and is more
 * annoying than a slightly-low setting. Every rung is latched and the ladder
 * only goes down, so it cannot oscillate; the windows are long enough that
 * only sustained slowness — thermal throttling, not a boss spawn — trips it.
 *
 * Only ever the choice `'auto'` is persisted, never its resolved value:
 * hardware, thermal state and external displays all change between sessions.
 */

import type { FrameCost } from './frameCost';
import {
  MAX_SHARP_RENDER_SCALE,
  PERFORMANCE_RENDER_SCALE,
  settings,
  type QualityPreset,
} from '../input/Settings';
import { FULL_SCALE, HALF_DENSITY_SCALE, deviceMemoryBudgetScale } from './deviceMemoryBudget';
import {
  FULL_VARIETY_TIER,
  MINIMAL_VARIETY_TIER,
  SHARED_LOOKS_TIER,
  TRIMMED_VARIETY_TIER,
  forceVarietyTier,
  lowerVarietyTierTo,
  stepVarietyTierDown,
  varietyTier,
  type VarietyTier,
} from './varietyTier';
import { onCanvasRecovery } from '../rendering/canvasRecovery';

const MS_PER_SECOND = 1000;

/** The frame rate the game is expected to hold on any display. */
const TARGET_REFRESH_HZ = 60;
const TARGET_REFRESH_MS = MS_PER_SECOND / TARGET_REFRESH_HZ;

/**
 * Frames discarded before the probe starts sampling. Every cache is cold on
 * level entry — chunks, person cells, sprite sheets — and those first frames
 * are far slower than the steady state they would be taken to represent.
 */
export const PROBE_WARMUP_FRAMES = 60;

/** How long the probe samples for, once warmed up. */
export const PROBE_SAMPLE_MS = 2000;

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
export const STUTTER_INTERVAL_MS = TARGET_REFRESH_MS * BREACH_TOLERANCE;

/**
 * Length of each post-probe watch window. Long enough that only sustained
 * slowness trips it — a spike from a boss spawn or a chunk bake cannot.
 */
export const SAFETY_NET_WINDOW_MS = 10000;

/**
 * Share of the mean frame interval that the mean bake time must reach for a
 * breached window to count as paint-bound. Bakes are only part of a frame's
 * paint, so a third already means caching looks is what the frame is waiting
 * on, more than the pixels or the simulation.
 */
const PAINT_BOUND_PARTS_OF_FRAME = 3;
export const PAINT_BOUND_SHARE = 1 / PAINT_BOUND_PARTS_OF_FRAME;

/**
 * How long after a canvas recovery frames go unmeasured. The recovery repaints
 * every cache it dropped, so the frames after it are slow and bake-heavy by
 * design; read as play, they would take a lag rung on top of whatever the
 * recovery itself asked of the device.
 */
export const RECOVERY_SETTLE_MS = 4000;

/** Where `performance` starts: the player asked for smoothness over the full set of looks. */
export const PERFORMANCE_PRESET_VARIETY_TIER = TRIMMED_VARIETY_TIER;

type ProbeState = 'idle' | 'warmup' | 'sampling' | 'done';

/** The two kinds of rung a breached window can take. */
type LagRung = 'variety' | 'render';

/**
 * The tier a session starts at before anything is measured. A device whose
 * caches already hold less has less room for distinct looks; the
 * `performance` preset starts lower still.
 */
export function startingVarietyTier(preset: QualityPreset, deviceMemoryScale: number): VarietyTier {
  if (preset === 'performance') return PERFORMANCE_PRESET_VARIETY_TIER;
  if (deviceMemoryScale >= FULL_SCALE) return FULL_VARIETY_TIER;
  if (deviceMemoryScale >= HALF_DENSITY_SCALE) return SHARED_LOOKS_TIER;
  return TRIMMED_VARIETY_TIER;
}

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

/** What the controller drives: the canvas owner, or a harness's stand-in. */
interface RenderScaleTarget {
  readonly renderScale: number;
  setRenderScale(scale: number): void;
}

/** Everything the controller reads from outside, injectable for a headless harness. */
interface RenderQualityEnvironment {
  readonly preset: () => QualityPreset;
  readonly storePreset: (preset: QualityPreset) => void;
  readonly documentHidden: () => boolean;
  readonly deviceMemoryScale: () => number;
  readonly sharpRenderScale: () => number;
  /** Registers `handler` to run after every canvas recovery, whatever its cause. */
  readonly subscribeCanvasRecovery: (handler: () => void) => void;
}

/** One sampled stretch of play: its frame intervals and what the frames spent baking. */
class LagWindow {
  readonly intervals: number[] = [];
  private intervalMsTotal = 0;
  private bakeMsTotal = 0;

  add(interval: number, cost: FrameCost): void {
    this.intervals.push(interval);
    this.intervalMsTotal += interval;
    this.bakeMsTotal += cost.bakeMs;
  }

  get breached(): boolean {
    return breachesBudget(this.intervals);
  }

  /** Mean bake time at least {@link PAINT_BOUND_SHARE} of the mean interval; the counts cancel. */
  get paintBound(): boolean {
    return this.bakeMsTotal >= PAINT_BOUND_SHARE * this.intervalMsTotal;
  }

  clear(): void {
    this.intervals.length = 0;
    this.intervalMsTotal = 0;
    this.bakeMsTotal = 0;
  }
}

export class RenderQualityController {
  private target: RenderScaleTarget | null = null;

  private probeState: ProbeState = 'idle';
  private warmupFramesLeft = 0;
  private samplingStartedAt = 0;
  private readonly probeWindow = new LagWindow();
  private lastFrameTime: number | null = null;

  /** Set once a probe or the safety net has lowered the scale, latching it. */
  private downgraded = false;

  /**
   * Set once a probe or the safety net has given up optional scenery detail,
   * latching it. The rung below the scale: on a 1× display, or once the scale
   * is already down, it is the only thing left to give.
   */
  private detailDowngraded = false;

  /** Set by {@link pinVarietyTier}; lag and the starting tier leave the tier alone. */
  private varietyPinned = false;

  private safetyNetWindowStartedAt: number | null = null;
  private readonly safetyNetWindow = new LagWindow();

  /**
   * Whether a loading screen owns the frames. Its frames are slow on purpose —
   * each spends its whole budget on the work it is covering — so neither the
   * probe nor the safety net may read them as the cost of playing.
   */
  private loadingCover = false;

  /** Set by a canvas recovery; the next measured frame starts the settle period. */
  private recoverySettlePending = false;
  private recoverySettleEndsAt: number | null = null;

  constructor(private readonly env: RenderQualityEnvironment) {
    env.subscribeCanvasRecovery(() => this.noteCanvasRecovery());
  }

  /**
   * Wires the controller to the canvas owner and applies the stored preset.
   * `auto` starts optimistic — beginning low and upgrading later would make the
   * player's first impression the soft one.
   */
  attach(target: RenderScaleTarget): void {
    this.target = target;
    this.applyScale(this.resolveScale(this.env.preset()));
    this.applyStartingVarietyTier();
  }

  /** The scale a preset asks for before any measurement. */
  private resolveScale(preset: QualityPreset): number {
    switch (preset) {
      case 'performance':
        return PERFORMANCE_RENDER_SCALE;
      case 'sharp':
        return this.env.sharpRenderScale();
      case 'auto':
        return this.env.sharpRenderScale();
    }
  }

  /**
   * Lowers the tier to where this preset and device start. Re-applied at each
   * level entry as well as at attach, because the device's memory report can
   * be overridden after the canvas owner exists (`?deviceMemory=`); it only
   * ever lowers, so a repeat is harmless.
   */
  private applyStartingVarietyTier(): void {
    if (this.varietyPinned) return;
    lowerVarietyTierTo(startingVarietyTier(this.env.preset(), this.env.deviceMemoryScale()));
  }

  /**
   * Records the player's explicit choice. A manual choice wins permanently on
   * this device: no probe, and no render rungs — though `performance` still
   * gives up variety under sustained lag, since smoothness is what it asked
   * for. `auto` stays selectable so control can be handed back.
   */
  setPreset(preset: QualityPreset): void {
    this.env.storePreset(preset);
    this.probeState = preset === 'auto' ? 'idle' : 'done';
    this.downgraded = false;
    this.detailDowngraded = false;
    this.resetSafetyNetWindow();
    this.applyScale(this.resolveScale(preset));
    this.applyStartingVarietyTier();
    // Handing control back mid-level would otherwise leave `auto` unmeasured
    // until the next level entry, with neither the probe nor the safety net
    // running for the rest of this one.
    if (preset === 'auto') this.requestProbe();
  }

  /**
   * Holds the tier where a dev override put it: lag no longer takes variety
   * rungs and the starting tier no longer lowers it, so a measurement at one
   * tier stays at that tier. A canvas recovery still steps it down, since that
   * frees memory the device has run out of.
   */
  pinVarietyTier(tier: VarietyTier): void {
    this.varietyPinned = true;
    forceVarietyTier(tier);
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
    if (this.downgraded || this.detailDowngraded) return;
    this.applyScale(this.resolveScale(this.env.preset()));
  }

  /**
   * Ask for a probe at the start of a level. Called on scene entry rather than
   * from the intro banner itself, so levels entered without a banner are still
   * covered — the player cannot act during either.
   *
   * A display with no extra pixels to render is measured all the same: the
   * cost is painting, not pixel fill, so detail is still there to give up. A
   * probe that has already run is never re-run: the choice is latched for the
   * session. A manual preset skips the probe and arms the safety net directly.
   */
  requestProbe(): void {
    this.applyStartingVarietyTier();
    if (this.probeState !== 'idle') return;
    if (this.env.preset() !== 'auto') {
      this.probeState = 'done';
      return;
    }
    this.probeState = 'warmup';
    this.warmupFramesLeft = PROBE_WARMUP_FRAMES;
    this.probeWindow.clear();
  }

  /**
   * Marks the frames from now until {@link endLoadingCover} as a loading
   * screen's. A probe in warm-up or sampling starts over once the cover lifts,
   * and a safety-net window is discarded, so only frames of play are measured.
   */
  beginLoadingCover(): void {
    this.loadingCover = true;
    this.discardMeasurements();
  }

  /**
   * Treats the {@link RECOVERY_SETTLE_MS} after a canvas recovery like a
   * loading cover. The recovery has already lowered what the game asks of the
   * device when it had to; its repaint must not be judged as lag on top.
   */
  private noteCanvasRecovery(): void {
    this.recoverySettlePending = true;
    this.recoverySettleEndsAt = null;
    this.discardMeasurements();
  }

  /** Drops a part-collected safety-net window and starts a running probe over. */
  private discardMeasurements(): void {
    this.resetSafetyNetWindow();
    if (this.probeState === 'warmup' || this.probeState === 'sampling') {
      this.probeState = 'warmup';
      this.warmupFramesLeft = PROBE_WARMUP_FRAMES;
      this.probeWindow.clear();
    }
  }

  /** Whether `now` falls in the settle period after a canvas recovery. */
  private settlingAfterRecovery(now: number): boolean {
    if (this.recoverySettlePending) {
      this.recoverySettlePending = false;
      this.recoverySettleEndsAt = now + RECOVERY_SETTLE_MS;
    }
    if (this.recoverySettleEndsAt === null) return false;
    if (now < this.recoverySettleEndsAt) return true;
    this.recoverySettleEndsAt = null;
    return false;
  }

  /** Whether a loading screen's cover is in force — see {@link beginLoadingCover}. */
  get isLoadingCovered(): boolean {
    return this.loadingCover;
  }

  /**
   * Whether optional per-frame scenery work — additive light glows, ambient
   * critters, flies, motes, glints — should run, read live so a preset change
   * mid-floor takes effect on the next frame.
   *
   * Keyed off the player's preset rather than the render scale: `sharp` on a
   * 1× display resolves to the same scale as `performance`, yet the player
   * asked for the richer picture and nothing says the machine is slow. Nor does
   * it follow `SpriteLoader`'s display-ratio rule, which picks a sheet's pixel
   * density — a question about the screen. This is a question about the frame
   * budget, which only the preset and `auto`'s measurement answer.
   */
  get fullDetail(): boolean {
    switch (this.env.preset()) {
      case 'performance':
        return false;
      case 'sharp':
        return true;
      case 'auto':
        return !this.detailDowngraded;
    }
  }

  /** Ends {@link beginLoadingCover}; the next frame of play is measured normally. */
  endLoadingCover(): void {
    this.loadingCover = false;
  }

  /**
   * Called once per rendered frame with the rAF timestamp and the cost of the
   * frame the interval up to it was spent on.
   */
  recordFrame(now: number, cost: FrameCost): void {
    const previous = this.lastFrameTime;
    this.lastFrameTime = now;
    if (previous === null) return;
    if (this.loadingCover) return;
    if (this.settlingAfterRecovery(now)) return;
    const interval = now - previous;

    this.advanceProbe(now, interval, cost);
    this.advanceSafetyNet(now, interval, cost);
  }

  private advanceProbe(now: number, interval: number, cost: FrameCost): void {
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
        if (this.env.documentHidden()) {
          this.probeState = 'idle';
          return;
        }
        this.probeWindow.add(interval, cost);
        if (now - this.samplingStartedAt < PROBE_SAMPLE_MS) return;
        this.probeState = 'done';
        this.judgeWindow(this.probeWindow);
        this.probeWindow.clear();
        return;
      case 'idle':
      case 'done':
        return;
    }
  }

  private judgeWindow(window: LagWindow): void {
    if (window.breached) this.takeLagRung(window.paintBound);
  }

  /**
   * Watches whole windows of play once the probe is done, opening a fresh one
   * after each judgement, so every breach — including one that persists after
   * a rung was taken — takes the next rung.
   */
  private advanceSafetyNet(now: number, interval: number, cost: FrameCost): void {
    if (this.probeState !== 'done') return;
    // Nothing left to give up — but keep watching, because a move to a 1×
    // display also lands here and the player may well move back to the sharper
    // screen, which brings the scale rung back.
    if (!this.hasLagRungLeft()) {
      this.resetSafetyNetWindow();
      return;
    }
    if (this.env.documentHidden()) {
      this.resetSafetyNetWindow();
      return;
    }
    this.safetyNetWindowStartedAt ??= now;
    this.safetyNetWindow.add(interval, cost);
    if (now - this.safetyNetWindowStartedAt < SAFETY_NET_WINDOW_MS) return;

    const { breached, paintBound } = this.safetyNetWindow;
    this.resetSafetyNetWindow();
    if (breached) this.takeLagRung(paintBound);
  }

  /**
   * Discards a part-collected window. Any interruption — a hidden tab, a move
   * to a 1× display, the player changing preset — makes the samples stale, and
   * a window left open would be judged the instant it resumes, on measurements
   * taken before whatever interrupted it.
   */
  private resetSafetyNetWindow(): void {
    this.safetyNetWindowStartedAt = null;
    this.safetyNetWindow.clear();
  }

  private currentScale(): number {
    return this.target?.renderScale ?? PERFORMANCE_RENDER_SCALE;
  }

  private rungLeft(rung: LagRung): boolean {
    switch (rung) {
      case 'render':
        return (
          this.env.preset() === 'auto' &&
          (this.currentScale() > PERFORMANCE_RENDER_SCALE || !this.detailDowngraded)
        );
      case 'variety':
        return (
          this.env.preset() !== 'sharp' &&
          !this.varietyPinned &&
          varietyTier() < MINIMAL_VARIETY_TIER
        );
    }
  }

  private hasLagRungLeft(): boolean {
    return this.rungLeft('render') || this.rungLeft('variety');
  }

  /**
   * Takes one rung for a breached window: variety first when the window was
   * paint-bound, render first otherwise, and the other kind when the preferred
   * one is used up.
   */
  private takeLagRung(paintBound: boolean): void {
    const preferred: LagRung = paintBound ? 'variety' : 'render';
    const fallback: LagRung = paintBound ? 'render' : 'variety';
    if (this.rungLeft(preferred)) this.takeRung(preferred);
    else if (this.rungLeft(fallback)) this.takeRung(fallback);
  }

  private takeRung(rung: LagRung): void {
    switch (rung) {
      case 'render':
        this.downgradeRenderOnce();
        return;
      case 'variety':
        stepVarietyTierDown();
        return;
    }
  }

  /**
   * Steps down one render rung: the render scale first, while there is any to
   * give, then optional scenery detail. Scale goes first because it is the
   * change a player notices least on a fast phone's dense screen; detail is
   * what is left on a 1× display, where the frame's cost is painting alone.
   */
  private downgradeRenderOnce(): void {
    if (this.currentScale() > PERFORMANCE_RENDER_SCALE) {
      this.downgraded = true;
      this.applyScale(PERFORMANCE_RENDER_SCALE);
      return;
    }
    this.detailDowngraded = true;
  }

  private applyScale(scale: number): void {
    const target = this.target;
    if (target === null) return;
    if (target.renderScale === scale) return;
    target.setRenderScale(scale);
  }
}

/**
 * Whether a sample of frame intervals is slow enough to be worth giving up
 * density for: the p95 interval past an absolute stutter threshold.
 *
 * There is deliberately no test relative to the display's own refresh rate.
 * Any such estimate would have to be capped at 60 Hz — otherwise a machine
 * pinned at half rate takes its own failure as the target and always passes —
 * and once capped, `estimate × tolerance` is never greater than the absolute
 * threshold, so a display-relative test could never be the binding one.
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

const browserEnvironment: RenderQualityEnvironment = {
  preset: () => settings.quality,
  storePreset: (preset) => settings.setQuality(preset),
  documentHidden: () => document.hidden,
  deviceMemoryScale: deviceMemoryBudgetScale,
  sharpRenderScale,
  subscribeCanvasRecovery: (handler) => onCanvasRecovery(handler),
};

export const renderQuality = new RenderQualityController(browserEnvironment);
