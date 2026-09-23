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
 * worst-cell gate below uses, so a figure that opts out of supersampling is
 * timed the way the cache actually bakes it rather than at four times the area.
 *
 * These are node-canvas's software rasteriser, which is not Chrome's. The
 * fallback threshold is decided on Chrome numbers from the `?paintbench` dev
 * route; read these as ratios and as a ranking.
 */

import { PAINT_BENCH_SUBJECTS } from '../src/dev/paintBenchSubjects.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { humanFigureWearing } from '../src/sprites/art/human/appearance.js';
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

// ── Carl's worst cell ────────────────────────────────────────────────────────

/**
 * How many times slower node-canvas paints a figure cell than Chrome does.
 * Measured at three to five times across this project's figures; the low end
 * is taken, so the node budget below is the stricter reading of the Chrome one.
 */
const NODE_TO_CHROME_PAINT_FACTOR = 3;
/**
 * Carl's slowest cell must bake inside the cache's per-frame bake budget in
 * Chrome, which is this in node. He is on screen continuously and a strike's
 * row can go cold, so a cell that overruns it is a hitch on the impact frame.
 */
const HUMAN_WORST_CELL_BUDGET_MS = FRAME_BAKE_BUDGET_MS * NODE_TO_CHROME_PAINT_FACTOR;
/** Timed bakes per cell in the screening pass over every cell. */
const SCREEN_REPEATS = 3;
/**
 * How many of the screening pass's slowest cells are re-timed before the gate
 * judges. A screening median of three is cheap enough to run over all ~1200
 * cells, but one scheduler stall across two of the three samples is enough to
 * make an ordinary cell look like the worst: a single max over such a screen
 * swings between five and eleven milliseconds from run to run on unchanged art.
 * The true worst cell is always among the screen's slowest handful, so only
 * those need the expensive measurement.
 */
const CONFIRM_CANDIDATES = 12;
/**
 * Timed bakes per candidate in the confirming pass. The gate reads each
 * candidate's minimum: load on the machine only ever adds time to a bake, so
 * the fastest of many is the closest reading of what the cell itself costs,
 * and a cell that is genuinely slow is slow on every one of them.
 */
const CONFIRM_REPEATS = 15;

/**
 * A synthetic cell slow enough that the gate must fail it, run on every
 * invocation so a gate that has stopped being able to go red is caught here
 * rather than trusted.
 */
const SELF_TEST_SLOW_CELL_MS = 10;

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

function busyWaitMs(ms: number): void {
  const startedAt = performance.now();
  while (performance.now() - startedAt < ms) {
    // Burning the time is the point: this cell stands in for a slow painter.
  }
}

/**
 * One row of the figure with one of its cells made deliberately slower than the
 * budget. One row rather than all of them, so the self-test costs a fraction of
 * the real measurement while still running its screen and its confirmation.
 */
function withOneSlowCell(def: FigureDef, slowState: string, slowFrame: number): FigureDef {
  const slowRow = def.states.get(slowState);
  return {
    ...def,
    id: `${def.id}_self_test`,
    states: new Map(slowRow === undefined ? [] : [[slowState, slowRow]]),
    paintFrame: (ctx, state, frame) => {
      if (state === slowState && frame === slowFrame) busyWaitMs(SELF_TEST_SLOW_CELL_MS);
      def.paintFrame(ctx, state, frame);
    },
  };
}

function describe(cell: TimedCell): string {
  return `${cell.state}[${cell.frame}] bakes in ${cell.ms.toFixed(MS_DECIMALS)} ms`;
}

const budgetNote =
  `against ${HUMAN_WORST_CELL_BUDGET_MS} ms in node — the ${FRAME_BAKE_BUDGET_MS} ms Chrome ` +
  `bake budget × ${NODE_TO_CHROME_PAINT_FACTOR}`;
const method =
  `fastest of ${CONFIRM_REPEATS} on the slowest ${CONFIRM_CANDIDATES} of a median-of-` +
  `${SCREEN_REPEATS} screen`;

/**
 * His default outfit, and every piece of visible gear at once: gear only ever
 * adds paint to a cell, so the outfit wearing all of it holds the slowest.
 */
const HUMAN_OUTFITS_TIMED: readonly FigureDef[] = [
  HUMAN_FIGURE,
  humanFigureWearing({
    gauntlet: true,
    cloak: true,
    trollskinShirt: true,
    toeRing: true,
    pedicure: true,
  }),
];

const firstState = HUMAN_FIGURE.states.keys().next().value;
if (firstState === undefined) {
  console.error(`  FAIL ${HUMAN_FIGURE.id} declares no cells to time`);
  process.exitCode = 1;
} else {
  const selfTestFrame = 0;
  const slowFigure = withOneSlowCell(HUMAN_FIGURE, firstState, selfTestFrame);
  const selfTest = worstBakedCell(slowFigure).worst;
  const selfTestCaught =
    selfTest !== null &&
    selfTest.state === firstState &&
    selfTest.frame === selfTestFrame &&
    selfTest.ms > HUMAN_WORST_CELL_BUDGET_MS;
  console.log(
    `\n  ${selfTestCaught ? 'ok  ' : 'FAIL'} self-test: a ${SELF_TEST_SLOW_CELL_MS} ms cell at ` +
      `${firstState}[${selfTestFrame}] is judged over budget` +
      (selfTest === null ? ' (nothing was timed)' : ` (measured ${describe(selfTest)})`),
  );
  if (!selfTestCaught) process.exitCode = 1;

  for (const figure of HUMAN_OUTFITS_TIMED) {
    const { worst, cellsTimed } = worstBakedCell(figure);
    if (worst === null) {
      console.error(`  FAIL ${figure.id} declares no cells to time`);
      process.exitCode = 1;
      continue;
    }
    const withinBudget = worst.ms <= HUMAN_WORST_CELL_BUDGET_MS;
    console.log(
      `  ${withinBudget ? 'ok  ' : 'FAIL'} ${figure.id} worst cell: ${describe(worst)} ` +
        `(${method}, over ${cellsTimed} cells) ${budgetNote}`,
    );
    if (!withinBudget) process.exitCode = 1;
  }
}
