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
 * falls back to painting straight into the frame; the bake column is what
 * admitting one cell to the cache costs — `bakeFigureCell`, the same helper the
 * worst-cell measurement below uses, so a figure that opts out of supersampling
 * is timed the way the cache actually bakes it rather than at four times the
 * area.
 *
 * These are node-canvas's software rasteriser, which is not Chrome's. The
 * fallback threshold is decided on Chrome numbers from the `?paintbench` dev
 * route; read these as ratios and as a ranking. Every number is wall-clock on
 * whatever machine runs it, so none of them decides the exit code: it fails
 * only when a figure declares nothing to time.
 */

import { PAINT_BENCH_SUBJECTS } from '../src/dev/paintBenchSubjects.js';
import { humanFigureWearing } from '../src/sprites/art/human/appearance.js';
import { humanItemGarments } from '../src/sprites/garments/itemLooks.js';
import { outfitOf } from '../src/sprites/garments/outfit.js';
import { HUMAN_LOOKS } from './humanLooks.js';
import { defaultOutfitOf } from '../src/sprites/garments/human/humanDressing.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { FRAME_BAKE_BUDGET_MS } from '../src/sprites/figure/figureFrameCache.js';
import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

// A painter that composes on its own scratch surface reaches
// `document.createElement('canvas')`, which Node does not have.
installCanvasGlobals();

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
    bakeFigureCell(def, state, frame % frames);
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

// ── The human figure's worst cell ────────────────────────────────────────────

/** Timed bakes per cell in the screening pass over every cell. */
const SCREEN_REPEATS = 3;
/**
 * How many of the screening pass's slowest cells are re-timed before the worst
 * is reported. A screening median of three is cheap enough to run over all ~1200
 * cells, but one scheduler stall across two of the three samples is enough to
 * make an ordinary cell look like the worst: a single max over such a screen
 * swings between five and eleven milliseconds from run to run on unchanged art.
 * The true worst cell is always among the screen's slowest handful, so only
 * those need the expensive measurement.
 */
const CONFIRM_CANDIDATES = 12;
/**
 * Timed bakes per candidate in the confirming pass. Each candidate reads as its
 * minimum: load on the machine only ever adds time to a bake, so
 * the fastest of many is the closest reading of what the cell itself costs,
 * and a cell that is genuinely slow is slow on every one of them.
 */
const CONFIRM_REPEATS = 15;

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeOnceMs(run: () => void): number {
  const start = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - start) / NANOSECONDS_PER_MILLISECOND;
}

interface TimedCell {
  readonly state: string;
  readonly frame: number;
  readonly ms: number;
}

/**
 * The figure's slowest cell to bake as the cache bakes it — supersampled paint
 * and the downsampling blit into the kept cell — screened cheaply over every
 * cell and then confirmed on the slowest few.
 */
function worstBakedCell(def: FigureDef): { worst: TimedCell | null; cellsTimed: number } {
  const screened: TimedCell[] = [];
  for (const [state, declared] of def.states) {
    for (let frame = 0; frame < declared.frames; frame++) {
      bakeFigureCell(def, state, frame);
      const samples = Array.from({ length: SCREEN_REPEATS }, () =>
        timeOnceMs(() => bakeFigureCell(def, state, frame)),
      );
      screened.push({ state, frame, ms: medianOf(samples) });
    }
  }
  const candidates = [...screened].sort((a, b) => b.ms - a.ms).slice(0, CONFIRM_CANDIDATES);
  let worst: TimedCell | null = null;
  for (const { state, frame } of candidates) {
    const samples = Array.from({ length: CONFIRM_REPEATS }, () =>
      timeOnceMs(() => bakeFigureCell(def, state, frame)),
    );
    const ms = Math.min(...samples);
    if (worst === null || ms > worst.ms) worst = { state, frame, ms };
  }
  return { worst, cellsTimed: screened.length };
}

function describe(cell: TimedCell): string {
  return `${cell.state}[${cell.frame}] bakes in ${cell.ms.toFixed(MS_DECIMALS)} ms`;
}

const budgetNote = `(the cache's per-frame bake budget is ${FRAME_BAKE_BUDGET_MS} ms in Chrome)`;
const method =
  `fastest of ${CONFIRM_REPEATS} on the slowest ${CONFIRM_CANDIDATES} of a median-of-` +
  `${SCREEN_REPEATS} screen`;

/**
 * Each human look in its default outfit, and in every piece of visible gear at
 * once: gear only ever adds paint to a cell, so the outfit wearing all of it
 * holds the slowest.
 */
const HUMAN_OUTFITS_TIMED: readonly FigureDef[] = HUMAN_LOOKS.flatMap((look) => [
  humanFigureWearing(look, defaultOutfitOf(look)),
  humanFigureWearing(
    look,
    outfitOf(
      look,
      humanItemGarments().filter((garment) => !garment.base),
    ),
  ),
]);

console.log('');
for (const figure of HUMAN_OUTFITS_TIMED) {
  const { worst, cellsTimed } = worstBakedCell(figure);
  if (worst === null) {
    console.error(`  FAIL ${figure.id} declares no cells to time`);
    process.exitCode = 1;
    continue;
  }
  console.log(
    `  ${figure.id} worst cell: ${describe(worst)} ` +
      `(${method}, over ${cellsTimed} cells) ${budgetNote}`,
  );
}
