/**
 * `globalThis.__perfRecorder`: a numeric recording of a stretch of play, for
 * before/after comparisons that `__perfRows` cannot support — those are
 * formatted strings, averaged over half a second, with one frame's cache rate.
 *
 * Installed from the `?perf` route in `devBoot.ts`, so a release build has no
 * import edge to it. Everything in a recording is plain JSON.
 */

import {
  PERF_GAUGES,
  PERF_TIMERS,
  perfMonitor,
  type PerfFrameListener,
  type PerfGauge,
  type PerfTimer,
} from '../core/PerfMonitor';
import {
  emptyDirectDrawCauses,
  FIGURE_DIRECT_DRAW_CAUSES,
  type FigureDirectDrawCauseCounts,
  getFigureCacheStats,
} from '../sprites/figure/figureCacheStats';

/** A frame slower than this has missed a 60 Hz vsync at least once. */
const SLOW_FRAME_MS = 20;
/** A frame slower than this has missed two vsyncs, which reads as a stutter. */
const VERY_SLOW_FRAME_MS = 33;
const MEMORY_SAMPLE_INTERVAL_MS = 1000;
/** How deep into `__perfMemory`'s result numeric fields are collected. */
const MEMORY_FIELD_DEPTH = 3;
const MEDIAN_PERCENTILE = 50;
const P95_PERCENTILE = 95;
const P99_PERCENTILE = 99;
const PERCENT = 100;

const LONG_ANIMATION_FRAME = 'long-animation-frame';
const LONG_TASK = 'longtask';

type LongFrameSource = typeof LONG_ANIMATION_FRAME | typeof LONG_TASK | 'unsupported';

/** One script a long animation frame attributes time to. */
interface LongFrameScript {
  sourceURL: string;
  sourceFunctionName: string;
  invoker: string;
  durationMs: number;
}

interface LongFrame {
  /** Milliseconds after the recording started. */
  atMs: number;
  durationMs: number;
  /** Only a long animation frame reports this; a long task does not. */
  blockingDurationMs: number | null;
  scripts: LongFrameScript[];
}

interface TimerSummary {
  name: PerfTimer;
  totalMs: number;
  meanMs: number;
  worstMs: number;
  /** Index into the recording's rendered frames; -1 when the timer never ran. */
  worstFrame: number;
}

interface GaugeSummary {
  name: PerfGauge;
  total: number;
  mean: number;
  worst: number;
  worstFrame: number;
}

interface FrameIntervalSummary {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  overSlowCount: number;
  overVerySlowCount: number;
  /** The most consecutive frames each slower than `slowThresholdMs`. */
  longestSlowRun: number;
  slowThresholdMs: number;
  verySlowThresholdMs: number;
}

interface FigureCacheTotals {
  hits: number;
  misses: number;
  /** Hits over all lookups across the whole recording; null when nothing was looked up. */
  hitRatePercent: number | null;
  bakes: number;
  prewarmBakes: number;
  directDraws: number;
  /** {@link directDraws} by what refused each cell its bake. */
  directDrawCauses: FigureDirectDrawCauseCounts;
  approxDraws: number;
  bakeMs: number;
  evictions: number;
  peakBytes: number;
}

/** Numeric fields of `__perfMemory`'s result, keyed by their dotted path. */
type MemoryFields = Record<string, number>;

interface MemorySummary {
  available: boolean;
  samples: number;
  peak: MemoryFields;
  end: MemoryFields;
}

interface PerfRecording {
  label: string;
  url: string;
  /** Wall-clock start, as an ISO string, so runs can be told apart later. */
  startedAt: string;
  durationMs: number;
  /** Frames the game rendered; display frames it skipped are not counted. */
  frameCount: number;
  devicePixelRatio: number;
  canvas: { width: number; height: number; cssWidth: number; cssHeight: number };
  frames: FrameIntervalSummary;
  /** Every interval in order, for plotting or re-deriving other percentiles. */
  frameIntervalsMs: number[];
  timers: TimerSummary[];
  gauges: GaugeSummary[];
  figureCache: FigureCacheTotals;
  longFrames: { source: LongFrameSource; entries: LongFrame[] };
  memory: MemorySummary;
}

interface PerfRecorder {
  /** Starts a recording, discarding one already running. */
  start(label?: string): void;
  /** Ends the recording; null when none was running. */
  stop(): PerfRecording | null;
}

declare global {
  var __perfRecorder: PerfRecorder | undefined;
}

function percentile(sortedAscending: readonly number[], percent: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((percent / PERCENT) * sortedAscending.length) - 1;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank));
  return sortedAscending[index] ?? 0;
}

function summariseIntervals(intervals: readonly number[]): FrameIntervalSummary {
  const sorted = [...intervals].sort((a, b) => a - b);
  let overSlowCount = 0;
  let overVerySlowCount = 0;
  let currentSlowRun = 0;
  let longestSlowRun = 0;
  let sum = 0;
  for (const interval of intervals) {
    sum += interval;
    if (interval > VERY_SLOW_FRAME_MS) overVerySlowCount++;
    if (interval > SLOW_FRAME_MS) {
      overSlowCount++;
      currentSlowRun++;
      longestSlowRun = Math.max(longestSlowRun, currentSlowRun);
    } else {
      currentSlowRun = 0;
    }
  }
  return {
    p50Ms: percentile(sorted, MEDIAN_PERCENTILE),
    p95Ms: percentile(sorted, P95_PERCENTILE),
    p99Ms: percentile(sorted, P99_PERCENTILE),
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: intervals.length === 0 ? 0 : sum / intervals.length,
    overSlowCount,
    overVerySlowCount,
    longestSlowRun,
    slowThresholdMs: SLOW_FRAME_MS,
    verySlowThresholdMs: VERY_SLOW_FRAME_MS,
  };
}

function readNumber(source: object, key: string): number {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'number' ? value : 0;
}

function readString(source: object, key: string): string {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : '';
}

/**
 * The DOM lib this project compiles against predates long animation frames, so
 * their fields are read off the entry rather than typed.
 */
function longFrameScripts(entry: PerformanceEntry): LongFrameScript[] {
  if (!('scripts' in entry)) return [];
  const scripts: unknown = entry.scripts;
  if (!Array.isArray(scripts)) return [];
  const untrustedScripts: readonly unknown[] = scripts;
  const attributed: LongFrameScript[] = [];
  for (const script of untrustedScripts) {
    if (typeof script !== 'object' || script === null) continue;
    attributed.push({
      sourceURL: readString(script, 'sourceURL'),
      sourceFunctionName: readString(script, 'sourceFunctionName'),
      invoker: readString(script, 'invoker'),
      durationMs: readNumber(script, 'duration'),
    });
  }
  return attributed;
}

function blockingDuration(entry: PerformanceEntry): number | null {
  if (!('blockingDuration' in entry)) return null;
  const value: unknown = entry.blockingDuration;
  return typeof value === 'number' ? value : null;
}

function supportedLongFrameSource(): LongFrameSource {
  if (typeof PerformanceObserver === 'undefined') return 'unsupported';
  const supported = PerformanceObserver.supportedEntryTypes;
  if (supported.includes(LONG_ANIMATION_FRAME)) return LONG_ANIMATION_FRAME;
  if (supported.includes(LONG_TASK)) return LONG_TASK;
  return 'unsupported';
}

/**
 * Flattens whatever `__perfMemory` returns into numeric leaves keyed by path.
 * Read structurally rather than against its declared type so the recorder
 * keeps working as owners are added or the result's nesting changes.
 */
function collectNumericFields(
  value: unknown,
  path: string,
  depth: number,
  out: MemoryFields,
): void {
  if (typeof value === 'number') {
    if (path !== '') out[path] = value;
    return;
  }
  if (depth <= 0 || typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    collectNumericFields(child, path === '' ? key : `${path}.${key}`, depth - 1, out);
  }
}

function sampleMemory(): MemoryFields | null {
  const probe: unknown = Reflect.get(globalThis, '__perfMemory');
  if (typeof probe !== 'function') return null;
  const result: unknown = Reflect.apply(probe, globalThis, []);
  const fields: MemoryFields = {};
  collectNumericFields(result, '', MEMORY_FIELD_DEPTH, fields);
  return fields;
}

interface TimerAccumulator {
  name: PerfTimer;
  total: number;
  worst: number;
  worstFrame: number;
}

interface GaugeAccumulator {
  name: PerfGauge;
  total: number;
  worst: number;
  worstFrame: number;
}

class Recording {
  private readonly startedAtMs = performance.now();
  private readonly startedAtWallClock = new Date().toISOString();
  private readonly intervals: number[] = [];
  private lastFrameStartedAt: number | null = null;
  private frameCount = 0;
  private readonly timers: TimerAccumulator[] = PERF_TIMERS.map((name) => ({
    name,
    total: 0,
    worst: 0,
    worstFrame: -1,
  }));
  private readonly gauges: GaugeAccumulator[] = PERF_GAUGES.map((name) => ({
    name,
    total: 0,
    worst: 0,
    worstFrame: -1,
  }));
  private readonly figureCache: FigureCacheTotals = {
    hits: 0,
    misses: 0,
    hitRatePercent: null,
    bakes: 0,
    prewarmBakes: 0,
    directDraws: 0,
    directDrawCauses: emptyDirectDrawCauses(),
    approxDraws: 0,
    bakeMs: 0,
    evictions: 0,
    peakBytes: 0,
  };
  private readonly longFrameSource = supportedLongFrameSource();
  private readonly longFrames: LongFrame[] = [];
  private readonly observer: PerformanceObserver | null;
  private readonly memoryPeak: MemoryFields = {};
  private memoryEnd: MemoryFields = {};
  private memorySamples = 0;
  private readonly memoryTimer: number;

  constructor(
    private readonly label: string,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.observer = this.observeLongFrames();
    this.takeMemorySample();
    this.memoryTimer = window.setInterval(() => this.takeMemorySample(), MEMORY_SAMPLE_INTERVAL_MS);
  }

  /**
   * Fed from the game loop's rendered-frame close rather than from a rAF loop
   * of the recorder's own. Callbacks in one rAF batch share a timestamp, so an
   * own loop would see the same instants — but it would also count the display
   * frames the loop declines to render on a fast display, which show the
   * player no new image. Start-to-start intervals between rendered frames are
   * the cadence the player sees, and they take in everything the frame does,
   * including the cache frame hooks that sit outside every perf timer.
   */
  readonly onFrame: PerfFrameListener = (frameStartedAt, timers, gauges) => {
    if (this.lastFrameStartedAt !== null) {
      this.intervals.push(frameStartedAt - this.lastFrameStartedAt);
    }
    this.lastFrameStartedAt = frameStartedAt;
    const frame = this.frameCount++;

    for (const timer of this.timers) {
      const ms = timers[timer.name];
      timer.total += ms;
      if (ms > timer.worst) {
        timer.worst = ms;
        timer.worstFrame = frame;
      }
    }
    for (const gauge of this.gauges) {
      const amount = gauges[gauge.name];
      gauge.total += amount;
      if (amount > gauge.worst) {
        gauge.worst = amount;
        gauge.worstFrame = frame;
      }
    }

    // The cache's counters are per frame and cleared when the next one begins,
    // so they have to be summed here to give a rate for the whole recording.
    const stats = getFigureCacheStats();
    const totals = this.figureCache;
    totals.hits += stats.hits;
    totals.misses += stats.misses;
    totals.bakes += stats.bakes;
    totals.prewarmBakes += stats.prewarmBakes;
    totals.directDraws += stats.directDraws;
    for (const cause of FIGURE_DIRECT_DRAW_CAUSES) {
      totals.directDrawCauses[cause] += stats.directDrawCauses[cause];
    }
    totals.approxDraws += stats.approxDraws;
    totals.bakeMs += stats.bakeMs;
    totals.evictions += stats.evictions;
    totals.peakBytes = Math.max(totals.peakBytes, stats.bytes);
  };

  private observeLongFrames(): PerformanceObserver | null {
    const source = this.longFrameSource;
    if (source === 'unsupported') return null;
    const observer = new PerformanceObserver((list) => {
      this.keepLongFrames(list.getEntries());
    });
    observer.observe({ type: source, buffered: false });
    return observer;
  }

  private keepLongFrames(entries: readonly PerformanceEntry[]): void {
    for (const entry of entries) {
      if (entry.startTime < this.startedAtMs) continue;
      this.longFrames.push({
        atMs: entry.startTime - this.startedAtMs,
        durationMs: entry.duration,
        blockingDurationMs: blockingDuration(entry),
        scripts: longFrameScripts(entry),
      });
    }
  }

  private takeMemorySample(): void {
    const fields = sampleMemory();
    if (fields === null) return;
    this.memorySamples++;
    this.memoryEnd = fields;
    for (const [path, value] of Object.entries(fields)) {
      this.memoryPeak[path] = Math.max(this.memoryPeak[path] ?? value, value);
    }
  }

  finish(): PerfRecording {
    window.clearInterval(this.memoryTimer);
    this.takeMemorySample();
    // Entries still queued in the observer would otherwise be lost on disconnect.
    if (this.observer !== null) {
      this.keepLongFrames(this.observer.takeRecords());
      this.observer.disconnect();
    }

    const frames = Math.max(1, this.frameCount);
    const lookups = this.figureCache.hits + this.figureCache.misses;
    const cssRect = this.canvas.getBoundingClientRect();
    return {
      label: this.label,
      url: window.location.href,
      startedAt: this.startedAtWallClock,
      durationMs: performance.now() - this.startedAtMs,
      frameCount: this.frameCount,
      devicePixelRatio: window.devicePixelRatio,
      canvas: {
        width: this.canvas.width,
        height: this.canvas.height,
        cssWidth: cssRect.width,
        cssHeight: cssRect.height,
      },
      frames: summariseIntervals(this.intervals),
      frameIntervalsMs: [...this.intervals],
      timers: this.timers.map((timer) => ({
        name: timer.name,
        totalMs: timer.total,
        meanMs: timer.total / frames,
        worstMs: timer.worst,
        worstFrame: timer.worstFrame,
      })),
      gauges: this.gauges.map((gauge) => ({
        name: gauge.name,
        total: gauge.total,
        mean: gauge.total / frames,
        worst: gauge.worst,
        worstFrame: gauge.worstFrame,
      })),
      figureCache: {
        ...this.figureCache,
        directDrawCauses: { ...this.figureCache.directDrawCauses },
        hitRatePercent: lookups === 0 ? null : (this.figureCache.hits / lookups) * PERCENT,
      },
      longFrames: { source: this.longFrameSource, entries: [...this.longFrames] },
      memory: {
        available: this.memorySamples > 0,
        samples: this.memorySamples,
        peak: { ...this.memoryPeak },
        end: { ...this.memoryEnd },
      },
    };
  }
}

/**
 * Publishes `__perfRecorder`. Needs `perfMonitor` and the figure-cache counters
 * already switched on, which the `?perf` route does before calling this.
 */
export function installPerfRecorder(canvas: HTMLCanvasElement): void {
  let active: Recording | null = null;
  globalThis.__perfRecorder = {
    start(label = '') {
      active?.finish();
      const recording = new Recording(label, canvas);
      active = recording;
      perfMonitor.setFrameListener(recording.onFrame);
    },
    stop() {
      const recording = active;
      if (recording === null) return null;
      active = null;
      perfMonitor.setFrameListener(null);
      return recording.finish();
    },
  };
}
