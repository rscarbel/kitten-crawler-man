#!/usr/bin/env tsx
/**
 * Measures the two mob-separation strategies against each other, so
 * `SEPARATION_GRID_MIN_MOBS` is a number somebody measured rather than guessed.
 *
 * It times the two accumulation shapes and nothing else, because they are the
 * only thing the size gate chooses between — the work around them (building the
 * roster, zeroing the force arrays, applying the forces) is identical either way
 * and would only dilute the comparison. The grid's rebuild *is* timed with its
 * lookups: the grid is thrown away every frame, so billing only the lookups
 * would be measuring half a strategy.
 *
 * A max-delta column rides along beside the timings. A faster shape that quietly
 * computed different forces would be worse than no change at all, and the two
 * are only ever allowed to differ by floating-point rounding.
 *
 * The numbers are wall-clock on whatever machine runs this, so treat the
 * *crossover* as the result and the absolute microseconds as scenery. In-game
 * frame pacing still needs a human with `?perf` — see the plan's §4 step 6.
 *
 * Run: npx tsx scripts/bench-separation.ts
 */

import { SeparationGrid } from '../src/core/SeparationGrid';
import { TILE_SIZE } from '../src/core/constants';
import {
  accumulateFromAllPairs,
  accumulateFromGrid,
  SEPARATION_GRID_MIN_MOBS,
  SEPARATION_RADIUS,
} from '../src/systems/mobSeparation';

interface BenchBody {
  x: number;
  y: number;
  mass: number;
}

/** Roster sizes to sweep — spanning well below and well above the current gate. */
const MOB_COUNTS = [8, 12, 16, 20, 24, 32, 48, 64, 96, 128, 192];

/**
 * Crowding levels, as map area per mob. A mob's separation radius sweeps ~3.1
 * tiles², so 8 tiles²/mob is a patrol strung out across a room, 2 is a camp
 * clustered on its fire, and 0.8 is the wall of bodies a doorway funnel makes —
 * roughly the d≈4 the plan estimates as the practical ceiling on crowding.
 */
const DENSITIES = [
  { label: 'loose', tilesPerMob: 8 },
  { label: 'camp', tilesPerMob: 2 },
  { label: 'packed', tilesPerMob: 0.8 },
];

/** Wall-clock budget per measured cell. Long enough to smooth out scheduler noise. */
const MEASURE_BUDGET_MS = 250;

/** Untimed repetitions before each measurement, to let the JIT settle. */
const WARMUP_ITERATIONS = 50;

const MS_PER_SECOND = 1000;

/** Bodies are laid out well clear of the origin, as a real map position would be. */
const LAYOUT_ORIGIN_TILES = 40;

/** Deterministic PRNG, so a re-run compares against the same layouts. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBodies(count: number, tilesPerMob: number, seed: number): BenchBody[] {
  const random = makeRandom(seed);
  const spanPx = Math.sqrt(count * tilesPerMob) * TILE_SIZE;
  const originPx = LAYOUT_ORIGIN_TILES * TILE_SIZE;
  const bodies: BenchBody[] = [];
  for (let i = 0; i < count; i++) {
    bodies.push({
      x: originPx + random() * spanPx,
      y: originPx + random() * spanPx,
      mass: 1,
    });
  }
  return bodies;
}

/** Average milliseconds per call of `run`, measured over a fixed time budget. */
function timePerCall(run: () => void): number {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) run();
  const startedAt = performance.now();
  let calls = 0;
  let elapsed = 0;
  while (elapsed < MEASURE_BUDGET_MS) {
    run();
    calls++;
    elapsed = performance.now() - startedAt;
  }
  return elapsed / calls;
}

interface Measurement {
  pairsMs: number;
  gridMs: number;
  maxForceDelta: number;
}

/** Largest disagreement between the two strategies over one layout. */
function largestForceDelta(bodies: readonly BenchBody[], grid: SeparationGrid<BenchBody>): number {
  const count = bodies.length;
  const pairsDx = new Array<number>(count).fill(0);
  const pairsDy = new Array<number>(count).fill(0);
  accumulateFromAllPairs(bodies, pairsDx, pairsDy);
  const gridDx = new Array<number>(count).fill(0);
  const gridDy = new Array<number>(count).fill(0);
  grid.build(bodies, SEPARATION_RADIUS);
  accumulateFromGrid(bodies, gridDx, gridDy, grid);
  let worst = 0;
  for (let i = 0; i < count; i++) {
    worst = Math.max(worst, Math.abs(pairsDx[i] - gridDx[i]), Math.abs(pairsDy[i] - gridDy[i]));
  }
  return worst;
}

function measure(count: number, tilesPerMob: number, seed: number): Measurement {
  const bodies = buildBodies(count, tilesPerMob, seed);
  const grid = new SeparationGrid<BenchBody>();
  const outDx = new Array<number>(count).fill(0);
  const outDy = new Array<number>(count).fill(0);

  const pairsMs = timePerCall(() => {
    outDx.fill(0);
    outDy.fill(0);
    accumulateFromAllPairs(bodies, outDx, outDy);
  });
  // The rebuild is timed with the lookups because the grid is thrown away each
  // frame — billing only the queries would be measuring half the strategy.
  const gridMs = timePerCall(() => {
    outDx.fill(0);
    outDy.fill(0);
    grid.build(bodies, SEPARATION_RADIUS);
    accumulateFromGrid(bodies, outDx, outDy, grid);
  });

  return { pairsMs, gridMs, maxForceDelta: largestForceDelta(bodies, grid) };
}

function formatMs(ms: number): string {
  const MICRO_DECIMALS = 3;
  return `${(ms * MS_PER_SECOND).toFixed(MICRO_DECIMALS)}us`;
}

function pad(text: string, width: number): string {
  return text.padStart(width);
}

const COLUMN_WIDTH = 12;
const SPEEDUP_DECIMALS = 2;
const DELTA_DECIMALS = 1;

console.log('Mob separation: all-pairs vs per-frame separation grid');
console.log(
  `(budget ${MEASURE_BUDGET_MS}ms per cell, current gate = ${SEPARATION_GRID_MIN_MOBS} mobs)\n`,
);

const crossovers: string[] = [];

DENSITIES.forEach((density, densityIndex) => {
  console.log(`density: ${density.label} (${density.tilesPerMob} tiles per mob)`);
  console.log(
    [
      pad('mobs', 6),
      pad('all-pairs', COLUMN_WIDTH),
      pad('grid', COLUMN_WIDTH),
      pad('speedup', COLUMN_WIDTH),
      pad('max delta', COLUMN_WIDTH),
    ].join(''),
  );
  let crossover: number | null = null;
  for (const count of MOB_COUNTS) {
    const seed = densityIndex * MOB_COUNTS.length + count;
    const result = measure(count, density.tilesPerMob, seed);
    const speedup = result.pairsMs / result.gridMs;
    if (crossover === null && speedup > 1) crossover = count;
    console.log(
      [
        pad(String(count), 6),
        pad(formatMs(result.pairsMs), COLUMN_WIDTH),
        pad(formatMs(result.gridMs), COLUMN_WIDTH),
        pad(`${speedup.toFixed(SPEEDUP_DECIMALS)}x`, COLUMN_WIDTH),
        pad(result.maxForceDelta.toExponential(DELTA_DECIMALS), COLUMN_WIDTH),
      ].join(''),
    );
  }
  crossovers.push(`${density.label}: ${crossover === null ? 'never' : `>= ${crossover} mobs`}`);
  console.log('');
});

console.log('grid overtakes all-pairs at — ' + crossovers.join(', '));
