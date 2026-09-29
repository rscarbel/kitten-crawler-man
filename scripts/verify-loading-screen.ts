#!/usr/bin/env tsx
/**
 * Headless gate for the loading screen's task runner and host.
 *
 * Drives `LoadRunner` and `LoadingOverlay` with fake tasks on a fake clock, so
 * every claim below is about the pacing logic itself rather than about how fast
 * this machine happens to be:
 *
 *  1. Progress never moves backwards and ends at exactly 1.
 *  2. No frame spends more than its budget plus one small unit — the overrun a
 *     unit with no cost estimate can cause — and a stepped task that is told
 *     it may not overrun does not.
 *  3. A unit bigger than a whole frame still makes progress, alone in its frame.
 *  4. The runner resolves: `finished` settles, including past a rejected promise.
 *  5. The screen stays up at least its minimum display time, then fades and goes.
 *  6. While it is up, the world does not update: the overlay's claim halts the
 *     world and locks the keyboard through the same `OverlayClaims` functions the
 *     scenes read, and `DungeonScene.update` returns on it before anything else.
 *  7. The screen draws at any canvas size, clock and progress it can be
 *     handed — a 0 px window, a rAF timestamp from before the load started, a
 *     progress of NaN — without throwing, without geometry a browser rejects or
 *     skips, and without leaving the save stack pushed.
 *
 *   npm run verify:loading-screen
 *   npx tsx scripts/verify-loading-screen.ts --fault=no-budget   # must fail
 *   npx tsx scripts/verify-loading-screen.ts --fault=no-halt     # must fail
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { gameContext } from './nodeGameContext.js';
import { watchCanvas } from './strictCanvas.js';

installCanvasGlobals();

const { LoadRunner, steppedWork, iteratorWork, promiseWork, DEFAULT_MIN_LOAD_DISPLAY_MS } =
  await import('../src/core/LoadRunner.js');
const { LoadingOverlay, drawLoadingScreen } = await import('../src/ui/LoadingScreen.js');
const { worldHalted, keyboardSuppressed } = await import('../src/systems/kits/OverlayClaims.js');

type Fault = 'none' | 'no-budget' | 'no-halt';
const faultArg = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);
const fault: Fault = faultArg === 'no-budget' || faultArg === 'no-halt' ? faultArg : 'none';

/** The fake clock every task advances by what its unit "costs". */
let clockMs = 0;
const now = (): number => clockMs;

const FRAME_BUDGET_MS = 10;
/** The largest fake unit whose cost the runner cannot know in advance. */
const SMALL_UNIT_MS = 2;
/** Real frames also pass time between ticks, which the fake clock must too. */
const FRAME_INTERVAL_MS = 16;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/**
 * A stepped task of `units` pieces, each costing `unitMs`, that honours
 * `mustProgress` as the contract asks: with it false, a unit starts only if it
 * fits what is left. `--fault=no-budget` makes it ignore the budget entirely.
 */
function fakeSteppedTask(
  units: number,
  unitMs: number,
): { step: (budgetMs: number, mustProgress: boolean) => number } {
  let done = 0;
  return {
    step(budgetMs, mustProgress) {
      let spent = 0;
      let started = false;
      while (done < units) {
        const owedFirst = mustProgress && !started;
        const fits = spent + unitMs <= budgetMs;
        if (fault !== 'no-budget' && !owedFirst && !fits) break;
        clockMs += unitMs;
        spent += unitMs;
        started = true;
        done++;
      }
      return done / units;
    },
  };
}

function* fakeIterator(units: number, unitMs: number): Generator<number, void, undefined> {
  for (let index = 0; index < units; index++) {
    clockMs += unitMs;
    yield (index + 1) / units;
  }
}

// ── Scenario 1: mixed tasks, budget, monotonic progress, resolution ──────────

const STEPPED_UNITS = 60;
const STEPPED_UNIT_MS = 1.5;
const ITERATOR_UNITS = 40;
const ITERATOR_UNIT_MS = SMALL_UNIT_MS;
/** One indivisible unit bigger than a whole frame. */
const HUGE_UNIT_MS = 25;
/** Frames after which the fake fetch resolves. */
const PROMISE_RESOLVES_AFTER_FRAMES = 12;

let resolveFetch: () => void = () => undefined;
const fetchPromise = new Promise<void>((resolveIt) => {
  resolveFetch = resolveIt;
});
const rejectedPromise = Promise.reject(new Error('fake fetch failure the runner must survive'));
// Handled by the runner; this only stops node reporting it before the runner attaches.
rejectedPromise.catch(() => undefined);

const hugeTask = fakeSteppedTask(1, HUGE_UNIT_MS);
const runner = new LoadRunner(
  [
    {
      label: 'stepped',
      weight: 3,
      work: steppedWork(fakeSteppedTask(STEPPED_UNITS, STEPPED_UNIT_MS).step),
    },
    { label: 'fetch', work: promiseWork(fetchPromise) },
    {
      label: 'iterator',
      weight: 2,
      work: iteratorWork(fakeIterator(ITERATOR_UNITS, ITERATOR_UNIT_MS)),
    },
    { label: 'huge', work: steppedWork(hugeTask.step) },
    { label: 'rejected', work: promiseWork(rejectedPromise) },
  ],
  { frameBudgetMs: FRAME_BUDGET_MS, now },
);

let finishedSettled = false;
void runner.finished.then(() => {
  finishedSettled = true;
});

const MAX_FRAMES = 2000;
const progressSeen: number[] = [];
const overBudget: string[] = [];
let hugeFrameSpent = -1;
let frame = 0;
for (; frame < MAX_FRAMES && !runner.isFinished; frame++) {
  if (frame === PROMISE_RESOLVES_AFTER_FRAMES) resolveFetch();
  const labelBefore = runner.statusLabel;
  runner.tick();
  const spent = runner.lastTickMs;
  if (labelBefore === 'huge') hugeFrameSpent = Math.max(hugeFrameSpent, spent);
  else if (spent > FRAME_BUDGET_MS + SMALL_UNIT_MS) {
    overBudget.push(`frame ${frame} (${labelBefore}) spent ${spent} ms`);
  }
  progressSeen.push(runner.progress);
  clockMs += FRAME_INTERVAL_MS;
  // Let the promise callbacks run between frames, as the event loop would.
  await Promise.resolve();
  await Promise.resolve();
}

check(runner.isFinished, `runner never finished within ${MAX_FRAMES} frames`);
check(
  frame > PROMISE_RESOLVES_AFTER_FRAMES,
  'runner finished before the fetch it had to wait for resolved',
);
for (let index = 1; index < progressSeen.length; index++) {
  if (progressSeen[index] < progressSeen[index - 1]) {
    failures.push(
      `progress went backwards at frame ${index}: ${progressSeen[index - 1]} → ${progressSeen[index]}`,
    );
    break;
  }
}
check(
  progressSeen[progressSeen.length - 1] === 1,
  `progress ended at ${progressSeen[progressSeen.length - 1]}, not 1`,
);
check(
  overBudget.length === 0,
  `frames over budget + one small unit: ${overBudget.slice(0, 5).join('; ')}`,
);
check(
  hugeFrameSpent >= HUGE_UNIT_MS && hugeFrameSpent <= HUGE_UNIT_MS + SMALL_UNIT_MS,
  `the frame-sized unit did not run alone in its frame (spent ${hugeFrameSpent} ms)`,
);
await Promise.resolve();
check(finishedSettled, '`finished` never settled');

// ── Scenario 2: minimum display time on work that is already done ───────────

clockMs = 0;
const instant = new LoadRunner([{ label: 'nothing', work: steppedWork(() => 1) }], { now });
instant.tick();
check(instant.tasksDone, 'a task reporting 1 was not marked done');
check(!instant.isFinished, 'a runner finished before its minimum display time');
clockMs = DEFAULT_MIN_LOAD_DISPLAY_MS;
instant.tick();
check(instant.isFinished, 'a runner was still up after its minimum display time');

// ── Scenario 3: the host halts the world while it is up ─────────────────────

clockMs = 0;
const overlay = new LoadingOverlay({
  title: 'Test Floor',
  kicker: 'Floor 0',
  tips: ['A tip.'],
  now,
  tasks: [{ label: 'work', work: steppedWork(fakeSteppedTask(30, STEPPED_UNIT_MS).step) }],
  runner: { frameBudgetMs: FRAME_BUDGET_MS },
});
const VIEW_W = 390;
const VIEW_H = 844;
const ctx = gameContext(VIEW_W, VIEW_H);

/** A stand-in scene following the rule `DungeonScene` follows: no update while a world-halting claim is open. */
let worldUpdates = 0;
let worldUpdatesWhileOpen = 0;
let keyboardOpenWhileUp = 0;
let hostFrames = 0;
for (; hostFrames < MAX_FRAMES && overlay.isVisible; hostFrames++) {
  const claims = fault === 'no-halt' ? [] : [overlay.overlayClaim()];
  const openBefore = overlay.isOpen;
  if (!worldHalted(claims)) {
    worldUpdates++;
    if (openBefore) worldUpdatesWhileOpen++;
  }
  if (openBefore && !keyboardSuppressed(claims)) keyboardOpenWhileUp++;
  overlay.renderFrame(ctx, VIEW_W, VIEW_H);
  clockMs += FRAME_INTERVAL_MS;
}
check(!overlay.isVisible, 'the overlay never finished fading out');
check(
  keyboardOpenWhileUp === 0,
  `the keyboard was left unlocked on ${keyboardOpenWhileUp} frame(s) while the loading screen was up`,
);
check(
  worldUpdatesWhileOpen === 0,
  `the world updated ${worldUpdatesWhileOpen} time(s) while the loading screen was up`,
);
check(worldUpdates > 0, 'the world never resumed after the loading screen closed');

// The scene half of the same rule, read from the source: `DungeonScene.update`
// must return on the loading screen before it does anything else.
const dungeonSource = readFileSync(resolve('src/scenes/DungeonScene.ts'), 'utf8');
const updateBody = /\n {2}update\(\): void \{\n([\s\S]*?)\n {2}\}\n/.exec(dungeonSource)?.[1] ?? '';
const firstStatement = updateBody
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line !== '' && !line.startsWith('//'));
check(
  firstStatement === 'if (this.arrivalLoading?.isOpen === true) return;',
  `DungeonScene.update's first statement is not the loading-screen guard (found: ${firstStatement ?? 'nothing'})`,
);

// ── Scenario 4: any size, any clock, any progress ───────────────────────────

/** Width, height in CSS px: degenerate, a sliver, phones, desktop, 4K. */
const EXTREME_VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 1],
  [16, 16],
  [40, 900],
  [900, 40],
  [320, 568],
  [390, 844],
  [1280, 720],
  [3840, 2160],
];
/**
 * Clocks in ms. A rAF timestamp marks the start of the frame, which can come
 * before the `performance.now()` a caller took as the load's start, so the
 * first frame's clock can be a little negative.
 */
const EXTREME_TIMES = [-100000, -1, -0.5, 0, 399, 400, 1e12, Number.NaN];
const EXTREME_PROGRESS = [-1, 0, 0.5, 1, 2, Number.NaN];
const EXTREME_CANVAS = 64;
const extremeCtx = gameContext(EXTREME_CANVAS, EXTREME_CANVAS);
const extremeWatch = watchCanvas(extremeCtx);
const extremeReported = new Set<string>();
let extremeDraws = 0;
for (const [width, height] of EXTREME_VIEWPORTS) {
  for (const timeMs of EXTREME_TIMES) {
    for (const progress of EXTREME_PROGRESS) {
      for (const withText of [true, false]) {
        const where = `${width}x${height} t=${timeMs} progress=${progress}${withText ? '' : ' bare'}`;
        extremeWatch.clear();
        try {
          drawLoadingScreen(
            extremeCtx,
            {
              title: 'Kitten Crawler Man',
              kicker: withText ? 'Floor 3' : undefined,
              tip: withText
                ? 'A tip long enough to wrap onto a second line on a phone.'
                : undefined,
              status: 'Unpacking the dungeon',
              progress,
              timeMs,
            },
            width,
            height,
          );
          extremeDraws++;
        } catch (error) {
          const key = `throw ${String(error)}`;
          if (!extremeReported.has(key)) {
            extremeReported.add(key);
            check(false, `the screen threw at ${where}: ${String(error)}`);
          }
        }
        for (const violation of extremeWatch.violations) {
          const key = violation.split('(')[0];
          if (extremeReported.has(key)) continue;
          extremeReported.add(key);
          check(false, `the screen at ${where}: ${violation}`);
        }
        if (extremeWatch.saveDepth() !== 0) {
          check(
            false,
            `the screen at ${where} left the save stack ${extremeWatch.saveDepth()} deep`,
          );
          while (extremeWatch.saveDepth() > 0) extremeCtx.restore();
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`FAIL verify:loading-screen (fault=${fault})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `PASS verify:loading-screen — ${frame} frames to load, ${hostFrames} host frames, ` +
      `worst non-huge frame within ${FRAME_BUDGET_MS} + ${SMALL_UNIT_MS} ms, huge unit alone at ${hugeFrameSpent} ms, ` +
      `${extremeDraws} draws at extreme sizes, clocks and progress`,
  );
}
