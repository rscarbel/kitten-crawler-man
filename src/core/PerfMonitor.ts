/** Milliseconds per second. */
const MS_PER_SECOND = 1000;

/** Frames each reported average covers — roughly half a second at 60 fps. */
const SAMPLE_WINDOW_FRAMES = 30;

/** Sections of a frame that get their own timer. */
export const PERF_TIMERS = ['update', 'render', 'separation'] as const;
export type PerfTimer = (typeof PERF_TIMERS)[number];

/** Per-frame counts reported alongside the timers, so the ms figures can be read. */
const PERF_GAUGES = ['activeMobs', 'separationMobs', 'separationChecks'] as const;
export type PerfGauge = (typeof PERF_GAUGES)[number];

type TimerTotals = Record<PerfTimer, number>;
type GaugeTotals = Record<PerfGauge, number>;

function zeroTimers(): TimerTotals {
  return { update: 0, render: 0, separation: 0 };
}

function zeroGauges(): GaugeTotals {
  return { activeMobs: 0, separationMobs: 0, separationChecks: 0 };
}

/**
 * Frame-time and section-time measurement, off unless a dev entry point turns
 * it on (`?perf`). The game has no other profiling instrumentation, and tuning
 * spawn density without a number to point at is guesswork.
 *
 * Deliberately measurement only — it never draws. Rendering the numbers lives
 * in `src/dev/perfOverlay.ts`, which a release build has no import edge to, so
 * what ships is this class with `enabled` permanently false.
 */
class PerfMonitor {
  private on = false;
  private readonly frameTimers = zeroTimers();
  private readonly frameGauges = zeroGauges();
  private readonly windowTimers = zeroTimers();
  private readonly windowGauges = zeroGauges();
  private readonly reportedTimers = zeroTimers();
  private readonly reportedGauges = zeroGauges();
  private windowFrames = 0;
  private windowStartedAt = 0;
  private reportedFps = 0;

  get enabled(): boolean {
    return this.on;
  }

  enable(): void {
    this.on = true;
    this.windowStartedAt = performance.now();
  }

  /**
   * Start of a timed section. The returned timestamp is passed straight back to
   * `end`; while disabled this is a constant so no clock is read at all.
   */
  begin(): number {
    return this.on ? performance.now() : 0;
  }

  end(timer: PerfTimer, startedAt: number): void {
    if (!this.on) return;
    this.frameTimers[timer] += performance.now() - startedAt;
  }

  /** Adds to this frame's total for a counted quantity. */
  count(gauge: PerfGauge, amount: number): void {
    if (!this.on) return;
    this.frameGauges[gauge] += amount;
  }

  /**
   * Closes the frame, folding its totals into the reporting window and, once
   * the window is full, replacing the reported averages with it.
   */
  endFrame(): void {
    if (!this.on) return;
    for (const timer of PERF_TIMERS) {
      this.windowTimers[timer] += this.frameTimers[timer];
      this.frameTimers[timer] = 0;
    }
    for (const gauge of PERF_GAUGES) {
      this.windowGauges[gauge] += this.frameGauges[gauge];
      this.frameGauges[gauge] = 0;
    }
    this.windowFrames++;
    if (this.windowFrames < SAMPLE_WINDOW_FRAMES) return;

    const now = performance.now();
    const windowElapsedMs = now - this.windowStartedAt;
    this.reportedFps =
      windowElapsedMs > 0 ? (this.windowFrames * MS_PER_SECOND) / windowElapsedMs : 0;
    for (const timer of PERF_TIMERS) {
      this.reportedTimers[timer] = this.windowTimers[timer] / this.windowFrames;
      this.windowTimers[timer] = 0;
    }
    for (const gauge of PERF_GAUGES) {
      this.reportedGauges[gauge] = this.windowGauges[gauge] / this.windowFrames;
      this.windowGauges[gauge] = 0;
    }
    this.windowFrames = 0;
    this.windowStartedAt = now;
  }

  get fps(): number {
    return this.reportedFps;
  }

  /** Average milliseconds per frame spent in `timer`, over the last full window. */
  msPerFrame(timer: PerfTimer): number {
    return this.reportedTimers[timer];
  }

  /** Average per-frame total of `gauge`, over the last full window. */
  perFrame(gauge: PerfGauge): number {
    return this.reportedGauges[gauge];
  }
}

export const perfMonitor = new PerfMonitor();
