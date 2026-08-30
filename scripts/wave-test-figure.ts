/**
 * The wave test: what a pack creature's densest spawn costs the frame it lands.
 *
 * A pack's cells are shared, so many bodies of one type are one row's worth of
 * bakes however many arrive — but they all ask for that row on the same frame,
 * and a cold row asked for by eight instances at once is the one moment a
 * converted pack can spike. This drives the real `figureFrameCache` through
 * that moment: a lead-in during which the spawn is only *scheduled*, then the
 * frame the bodies appear, then the seconds of fighting after it.
 *
 *   npm run wave:figure -- --module=src/sprites/art/tusklingFigure.ts \
 *     --export=TUSKLING_FIGURE --states=idle_side,walk_side --instances=8
 *
 * `--no-prewarm` runs the same wave with the scheduling hook removed, which is
 * the control: the difference between the two runs is what wiring prewarm at
 * every spawn site actually bought.
 *
 * The milliseconds are node-canvas's software rasteriser and run several times
 * slower than Chrome's — `?paintbench` is where the browser numbers live. Read
 * these as an upper bound and as the shape of the frame-cost curve.
 */

import {
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  beginFigureFrame,
  drawFigureCached,
  figurePrewarmDepth,
  flushFigureFrameCache,
  prewarmFigureState,
} from '../src/sprites/figure/figureFrameCache.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';

installCanvasGlobals();

/** Matches TILE_SIZE in src/core/constants.ts. */
const TILE_SIZE = 32;
/** The scratch surface the wave is drawn onto; nothing reads its pixels. */
const TARGET_SIZE_PX = 512;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MS_DECIMALS = 2;
/** Turns a 0-1 share into the percentage the summary reads in. */
const PERCENT = 100;

/**
 * Frames between the spawn being scheduled and the bodies appearing.
 *
 * Two thirds of a second at 60 Hz, which is less lead than any of the Tuskling's
 * own spawn sites give: the Ball of Swine's death burst is longer than this, and
 * a floor's spawner runs a whole level generation ahead of the first render. A
 * shorter default is the harder test.
 */
const DEFAULT_LEAD_FRAMES = 40;
/** Frames of fighting simulated after the wave lands. */
const DEFAULT_FIGHT_FRAMES = 180;
const DEFAULT_INSTANCES = 8;

/**
 * The per-frame paint the cache allows itself, from `figureFrameCache`. A frame
 * that spends more than this on the cache is the spike the test exists to find.
 */
const FRAME_BAKE_BUDGET_MS = 2;
/**
 * How much a frame may exceed that budget before it counts as a spike.
 *
 * The budget bounds what the cache *starts*; a bake already under way runs to
 * completion, so one cell's paint can land on top of a full budget. The margin
 * is one cell's worth of node-canvas software painting for the largest cells in
 * the fleet.
 */
const BUDGET_OVERRUN_MARGIN_MS = 8;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name}=${raw} is not a positive number`);
  }
  return Math.round(value);
}

function isFigureDef(value: unknown): value is FigureDef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Partial<Record<keyof FigureDef, unknown>> = value;
  return typeof candidate.id === 'string' && typeof candidate.paintFrame === 'function';
}

interface FrameSample {
  readonly frame: number;
  readonly ms: number;
  readonly hits: number;
  readonly misses: number;
  readonly bakes: number;
  readonly prewarmBakes: number;
  readonly directDraws: number;
  readonly megabytes: number;
}

async function main(): Promise<void> {
  const modulePath = parseFlag('module', '');
  const exportName = parseFlag('export', '');
  const statesFlag = parseFlag('states', '');
  if (modulePath === '' || exportName === '' || statesFlag === '') {
    throw new Error('--module, --export and --states are all required');
  }
  const states = statesFlag.split(',').filter((state) => state !== '');
  const instances = parseNumberFlag('instances', DEFAULT_INSTANCES);
  const leadFrames = parseNumberFlag('lead', DEFAULT_LEAD_FRAMES);
  const fightFrames = parseNumberFlag('fight', DEFAULT_FIGHT_FRAMES);
  const prewarms = !process.argv.includes('--no-prewarm');

  const loaded: unknown = await import(`../${modulePath}`);
  const exports: Record<string, unknown> =
    typeof loaded === 'object' && loaded !== null ? { ...loaded } : {};
  const def = exports[exportName];
  if (!isFigureDef(def)) {
    throw new Error(`${modulePath} exports no FigureDef named ${exportName}`);
  }
  for (const state of states) {
    if (def.states.has(state)) continue;
    throw new Error(`${def.id} paints no state "${state}"`);
  }

  flushFigureFrameCache();
  setFigureCacheStatsRecording(true);
  const ctx = gameContext(TARGET_SIZE_PX, TARGET_SIZE_PX);

  const samples: FrameSample[] = [];
  const totalFrames = leadFrames + fightFrames;
  const spawnFrame = leadFrames;

  for (let frame = 0; frame < totalFrames; frame++) {
    // The whole point of the exercise: the spawn is scheduled here, `leadFrames`
    // before the first body is drawn, exactly as a spawner or a boss's death
    // animation schedules it.
    if (frame === 0 && prewarms) {
      for (const state of states) prewarmFigureState(def, state);
    }
    const startedAt = performance.now();
    beginFigureFrame();
    if (frame >= spawnFrame) {
      for (let instance = 0; instance < instances; instance++) {
        // Every instance of a pack creature plays its own frame of the cycle,
        // which is what makes a wave ask for a whole row at once rather than
        // for one cell eight times.
        const animFrame = frame + instance;
        for (const state of states) {
          drawFigureCached(ctx, def, state, animFrame, 0, 0, TILE_SIZE);
        }
      }
    }
    const ms = performance.now() - startedAt;
    const stats = getFigureCacheStats();
    samples.push({
      frame,
      ms,
      hits: stats.hits,
      misses: stats.misses,
      bakes: stats.bakes,
      prewarmBakes: stats.prewarmBakes,
      directDraws: stats.directDraws,
      megabytes: stats.bytes / BYTES_PER_MEGABYTE,
    });
  }

  report(def, states, instances, spawnFrame, prewarms, samples);
  setFigureCacheStatsRecording(false);
}

function report(
  def: FigureDef,
  states: readonly string[],
  instances: number,
  spawnFrame: number,
  prewarms: boolean,
  samples: readonly FrameSample[],
): void {
  const label = prewarms ? 'prewarmed at scheduling' : 'no prewarm (control)';
  console.log(
    `${def.id} wave — ${instances} instances of [${states.join(', ')}], ${label}, ` +
      `spawn on frame ${spawnFrame}`,
  );

  const spawn = samples[spawnFrame];
  const fight = samples.slice(spawnFrame);
  const worst = fight.reduce((a, b) => (b.ms > a.ms ? b : a));
  const totalHits = fight.reduce((sum, s) => sum + s.hits, 0);
  const totalRequests = fight.reduce((sum, s) => sum + s.hits + s.misses, 0);
  const peakMegabytes = samples.reduce((peak, s) => Math.max(peak, s.megabytes), 0);
  const prewarmBakes = samples.reduce((sum, s) => sum + s.prewarmBakes, 0);
  const directDraws = fight.reduce((sum, s) => sum + s.directDraws, 0);

  console.log(
    `  spawn frame:   ${spawn.ms.toFixed(MS_DECIMALS)} ms, ${spawn.hits} hits / ` +
      `${spawn.misses} misses, ${spawn.bakes} bakes, ${spawn.directDraws} direct draws`,
  );
  console.log(
    `  worst frame:   ${worst.ms.toFixed(MS_DECIMALS)} ms (frame ${worst.frame}), against a ` +
      `${FRAME_BAKE_BUDGET_MS} ms bake budget`,
  );
  console.log(
    `  hit rate:      ${((totalHits / Math.max(1, totalRequests)) * PERCENT).toFixed(1)}% over ` +
      `${fight.length} frames of fighting`,
  );

  // How long the wave took to stop missing at all, which is the number the
  // player would feel: a row still baking is a row still painting directly.
  const settled = fight.findIndex((s) => s.misses === 0);
  console.log(
    settled < 0
      ? '  settled after: never — the wave was still missing when the run ended'
      : `  settled after: ${settled} frame${settled === 1 ? '' : 's'} past the spawn`,
  );
  console.log(
    `  peak bytes:    ${peakMegabytes.toFixed(2)} MB held; ${prewarmBakes} prewarm bakes, ` +
      `${directDraws} fallback paints during the fight`,
  );
  console.log(`  prewarm depth at the end: ${figurePrewarmDepth()}`);

  const spikes = fight.filter((s) => s.ms > FRAME_BAKE_BUDGET_MS + BUDGET_OVERRUN_MARGIN_MS);
  if (spikes.length > 0) {
    console.error(
      `  ${spikes.length} frame(s) over the budget by more than ${BUDGET_OVERRUN_MARGIN_MS} ms, ` +
        `worst ${worst.ms.toFixed(MS_DECIMALS)} ms on frame ${worst.frame}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('  no frame spiked past the bake budget.');
}

void main();
