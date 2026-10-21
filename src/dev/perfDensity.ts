/**
 * `globalThis.__perfDensity`: how many of a cache's pixels actually reach the
 * screen, measured from the `drawImage` calls that blit its surfaces.
 *
 * For each sampled draw the density ratio is the source pixels over the device
 * pixels they cover. Above 1.0 the cache holds pixels the screen never shows,
 * which can be cut without visible loss; at 1.0 it is exactly as sharp as the
 * screen and should be left alone.
 *
 * The ratio is the geometric mean of the two axes: the square root of source
 * area over drawn area. Memory scales with area, so this is the linear factor a
 * uniform downscale could remove, and a draw squashed on one axis only still
 * shows half its waste instead of none (min) or all of it (max).
 *
 * The probe wraps `CanvasRenderingContext2D.prototype.drawImage` only while a
 * measurement runs, so the wrapping costs nothing the rest of the time. Draws
 * onto the on-screen canvas are reported by the source's owner; draws from one
 * tracked surface into another (a cell blitted into a chunk) are reported
 * apart, as `source -> target`, since that pair is where an intermediate
 * cache's own density is decided. Installed from the `?perf` route in
 * `devBoot.ts`; it slows drawing slightly, so it is for a run that is not timed.
 */

import { surfaceOwnerOf } from '../core/canvasSurface';

/** Every draw is sampled until an owner has had this many. */
const FULL_SAMPLE_CALLS = 256;
/** After that, one draw in this many is. */
const SAMPLE_STRIDE = 16;
/** Bounds the memory one busy owner can take over a long run. */
const MAX_SAMPLES_PER_KEY = 4096;
/**
 * A ratio counts as above 1.0 only past this. A blit at exactly device scale
 * reads a hair off 1.0 once a fractional transform has been multiplied through.
 */
const OVER_ONE_TOLERANCE = 1.01;
const MEDIAN_PERCENTILE = 50;
const P90_PERCENTILE = 90;
const PERCENT = 100;
const SOURCE_RECT_REST_ARGS = 8;
const DEST_SIZE_REST_ARGS = 4;

interface DensityOwnerReport {
  /** The source's owner, or `source -> target` for a surface-to-surface draw. */
  readonly key: string;
  /** Draws seen, sampled or not. */
  readonly calls: number;
  readonly samples: number;
  readonly median: number;
  readonly p90: number;
  /** Samples drawn with more source pixels than device pixels. */
  readonly overOne: number;
}

interface DensityReport {
  readonly label: string;
  readonly durationMs: number;
  /** Draws onto the on-screen canvas, highest p90 first. */
  readonly onScreen: DensityOwnerReport[];
  /** Draws from one tracked surface into another, highest p90 first. */
  readonly intermediate: DensityOwnerReport[];
  /** On-screen draws whose source no owner was counted against. */
  readonly untrackedOnScreenDraws: number;
}

interface PerfDensity {
  /** Begins a measurement, ending any one already running. */
  start(label?: string): void;
  /** The measurement so far, without ending it; null when none is running. */
  report(): DensityReport | null;
  /** Ends the measurement and restores `drawImage`; null when none was running. */
  stop(): DensityReport | null;
}

declare global {
  var __perfDensity: PerfDensity | undefined;
}

interface KeySamples {
  calls: number;
  readonly ratios: number[];
}

interface SourceSize {
  readonly width: number;
  readonly height: number;
}

interface DrawExtent {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly destWidth: number;
  readonly destHeight: number;
}

function sourceSizeOf(image: CanvasImageSource): SourceSize | null {
  if (image instanceof HTMLCanvasElement) return { width: image.width, height: image.height };
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return null;
}

/** Reads the three `drawImage` forms: position only, destination size, or source rectangle too. */
function drawExtentOf(image: CanvasImageSource, rest: readonly number[]): DrawExtent | null {
  if (rest.length >= SOURCE_RECT_REST_ARGS) {
    const [, , sourceWidth, sourceHeight, , , destWidth, destHeight] = rest;
    return { sourceWidth, sourceHeight, destWidth, destHeight };
  }
  const size = sourceSizeOf(image);
  if (size === null) return null;
  if (rest.length >= DEST_SIZE_REST_ARGS) {
    const [, , destWidth, destHeight] = rest;
    return {
      sourceWidth: size.width,
      sourceHeight: size.height,
      destWidth,
      destHeight,
    };
  }
  return {
    sourceWidth: size.width,
    sourceHeight: size.height,
    destWidth: size.width,
    destHeight: size.height,
  };
}

/** Source pixels per device pixel; the target's backing store already carries the device ratio. */
function densityRatio(ctx: CanvasRenderingContext2D, extent: DrawExtent): number | null {
  const transform = ctx.getTransform();
  const deviceWidth = Math.abs(extent.destWidth) * Math.hypot(transform.a, transform.b);
  const deviceHeight = Math.abs(extent.destHeight) * Math.hypot(transform.c, transform.d);
  if (deviceWidth === 0 || deviceHeight === 0) return null;
  const ratioX = Math.abs(extent.sourceWidth) / deviceWidth;
  const ratioY = Math.abs(extent.sourceHeight) / deviceHeight;
  return Math.sqrt(ratioX * ratioY);
}

function percentile(sortedAscending: readonly number[], percent: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((percent / PERCENT) * sortedAscending.length) - 1;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank));
  return sortedAscending[index] ?? 0;
}

function summarise(byKey: ReadonlyMap<string, KeySamples>): DensityOwnerReport[] {
  const rows: DensityOwnerReport[] = [];
  for (const [key, { calls, ratios }] of byKey) {
    const sorted = [...ratios].sort((a, b) => a - b);
    rows.push({
      key,
      calls,
      samples: sorted.length,
      median: percentile(sorted, MEDIAN_PERCENTILE),
      p90: percentile(sorted, P90_PERCENTILE),
      overOne: sorted.filter((ratio) => ratio > OVER_ONE_TOLERANCE).length,
    });
  }
  return rows.sort((a, b) => b.p90 - a.p90);
}

class DensityMeasurement {
  private readonly startedMs = performance.now();
  private readonly onScreen = new Map<string, KeySamples>();
  private readonly intermediate = new Map<string, KeySamples>();
  private untrackedOnScreenDraws = 0;

  constructor(
    private readonly label: string,
    private readonly mainCanvas: HTMLCanvasElement,
  ) {}

  observe(ctx: CanvasRenderingContext2D, image: CanvasImageSource, rest: readonly number[]): void {
    const sourceOwner = surfaceOwnerOf(image);
    const onScreen = ctx.canvas === this.mainCanvas;
    if (sourceOwner === null) {
      if (onScreen) this.untrackedOnScreenDraws += 1;
      return;
    }
    if (onScreen) {
      this.sample(this.onScreen, sourceOwner, ctx, image, rest);
      return;
    }
    const targetOwner = surfaceOwnerOf(ctx.canvas);
    if (targetOwner === null) return;
    this.sample(this.intermediate, `${sourceOwner} -> ${targetOwner}`, ctx, image, rest);
  }

  private sample(
    byKey: Map<string, KeySamples>,
    key: string,
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    rest: readonly number[],
  ): void {
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { calls: 0, ratios: [] };
      byKey.set(key, entry);
    }
    entry.calls += 1;
    const sampled = entry.calls <= FULL_SAMPLE_CALLS || entry.calls % SAMPLE_STRIDE === 0;
    if (!sampled || entry.ratios.length >= MAX_SAMPLES_PER_KEY) return;
    const extent = drawExtentOf(image, rest);
    if (extent === null) return;
    const ratio = densityRatio(ctx, extent);
    if (ratio !== null) entry.ratios.push(ratio);
  }

  report(): DensityReport {
    return {
      label: this.label,
      durationMs: performance.now() - this.startedMs,
      onScreen: summarise(this.onScreen),
      intermediate: summarise(this.intermediate),
      untrackedOnScreenDraws: this.untrackedOnScreenDraws,
    };
  }
}

/**
 * Publishes `__perfDensity`, measuring draws onto `canvas` as the on-screen ones.
 *
 * The original `drawImage` is held as its property descriptor rather than read
 * off the prototype, so stopping puts back exactly what was there and the
 * forwarding call never treats it as a method detached from its object.
 */
export function installPerfDensity(canvas: HTMLCanvasElement): void {
  const prototype = CanvasRenderingContext2D.prototype;
  const unprobed = Object.getOwnPropertyDescriptor(prototype, 'drawImage');
  const unprobedDrawImage: unknown = unprobed?.value;
  if (unprobed === undefined || typeof unprobedDrawImage !== 'function') return;
  let active: DensityMeasurement | null = null;

  const probedDrawImage = function (
    this: CanvasRenderingContext2D,
    image: CanvasImageSource,
    ...rest: number[]
  ): void {
    active?.observe(this, image, rest);
    Reflect.apply(unprobedDrawImage, this, [image, ...rest]);
  };

  const end = (): DensityReport | null => {
    const measurement = active;
    if (measurement === null) return null;
    active = null;
    Object.defineProperty(prototype, 'drawImage', unprobed);
    return measurement.report();
  };

  globalThis.__perfDensity = {
    start(label = '') {
      end();
      active = new DensityMeasurement(label, canvas);
      Object.defineProperty(prototype, 'drawImage', { ...unprobed, value: probedDrawImage });
    },
    report() {
      return active?.report() ?? null;
    },
    stop: end,
  };
}
