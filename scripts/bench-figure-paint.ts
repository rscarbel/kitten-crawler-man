/**
 * What a converted figure costs to paint at the size it is actually painted.
 *
 * `bench-procedural-draw.ts` measures the art modules directly, with the
 * context translated but never scaled by the figure's tile scale — so each
 * painter draws a figure a couple of pixels tall and the milliseconds are a
 * fraction of the real ones. That harness is still the right place to compare
 * one painter's shape against another's; this one measures the thing the cache
 * actually runs: `paintFrame` into the figure's own declared cell.
 *
 *   npx tsx scripts/bench-figure-paint.ts
 *
 * Two numbers per figure. The direct column is what a cache miss costs when it
 * falls back to painting straight into the frame; the bake column is that at
 * `SUPERSAMPLE = 2`, which is four times the area and therefore what admitting
 * one cell to the cache costs.
 *
 * These are node-canvas's software rasteriser, which is not Chrome's. The
 * fallback threshold is decided on Chrome numbers from the `?paintbench` dev
 * route; read these as ratios and as a ranking.
 */

import { PAINT_BENCH_SUBJECTS } from '../src/dev/paintBenchSubjects.js';
import { paintFigureCell } from './figureSheet.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

// A painter that composes on its own scratch surface reaches
// `document.createElement('canvas')`, which Node does not have.
installCanvasGlobals();

/** Density a cached cell is baked at, matching the figure cache. */
const SUPERSAMPLE = 2;

const WARMUP_ITERATIONS = 3;
const TIMED_ITERATIONS = 20;
const NANOSECONDS_PER_MILLISECOND = 1e6;
const MS_DECIMALS = 3;

/**
 * Desktop paint cost above which a figure is too expensive to fall back on,
 * chosen to survive a three-to-five-fold phone derate inside one frame's slack.
 * A figure over the line ships only with prewarm coverage for every state its
 * AI can enter.
 */
const FALLBACK_AFFORDABLE_MS = 1;

const NAME_COLUMN = 26;
const CELL_COLUMN = 12;
const MS_COLUMN = 10;

function timeAverageMs(run: () => void): number {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) run();
  const start = process.hrtime.bigint();
  for (let i = 0; i < TIMED_ITERATIONS; i++) run();
  const end = process.hrtime.bigint();
  return Number(end - start) / NANOSECONDS_PER_MILLISECOND / TIMED_ITERATIONS;
}

if (PAINT_BENCH_SUBJECTS.length === 0) {
  console.error('No painted figures are registered in src/dev/paintBenchSubjects.ts.');
  process.exitCode = 1;
}

console.log(
  `${'figure (state)'.padEnd(NAME_COLUMN)}${'cell'.padStart(CELL_COLUMN)}` +
    `${'direct'.padStart(MS_COLUMN)}${'bake'.padStart(MS_COLUMN)}  verdict`,
);

for (const subject of PAINT_BENCH_SUBJECTS) {
  const { def, state } = subject;
  const frames = def.states.get(state)?.frames;
  if (frames === undefined || frames < 1) {
    console.error(`  FAIL ${def.id} declares no state "${state}" to bench`);
    process.exitCode = 1;
    continue;
  }
  let frame = 0;
  const directMs = timeAverageMs(() => {
    paintFigureCell(def, state, frame % frames);
    frame++;
  });
  const bakeMs = timeAverageMs(() => {
    paintFigureCell(def, state, frame % frames, SUPERSAMPLE);
    frame++;
  });
  const label = `${def.id} (${state})`;
  const cell = `${def.frameWidth}×${def.frameHeight}`;
  const verdict = directMs <= FALLBACK_AFFORDABLE_MS ? 'fallback-affordable' : 'prewarm-required';
  console.log(
    `${label.padEnd(NAME_COLUMN)}${cell.padStart(CELL_COLUMN)}` +
      directMs.toFixed(MS_DECIMALS).padStart(MS_COLUMN) +
      `${bakeMs.toFixed(MS_DECIMALS).padStart(MS_COLUMN)}  ${verdict}`,
  );
}
