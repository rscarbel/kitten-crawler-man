/**
 * Board-level checks for the clogged bathroom's pipe puzzle: the win check
 * and the solver against brute force on tiny boards, the generator's sweep per
 * tier, the committed fallbacks, determinism, the real turn API, and the
 * generation time that decides when the runtime builds a board.
 *
 * Pure checks over `src/systems/cloggedBathroom/`: nothing here builds a
 * scene. Each fault swaps one deliberate breakage into the shipped code path
 * through the modules' own `fault` option, so a check that stays green under
 * its fault is a check that cannot see what it claims to guard.
 */

import { writeFileSync } from 'node:fs';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles';
import { withWorldSeed, worldRandom } from '../src/core/world/WorldRandom';
import { seededStream } from '../src/map/bigTop/mirrorBoard';
import {
  assessPipeBoard,
  cellIndex,
  countPipeSolutions,
  createPipeBoard,
  currentMask,
  FOLLOW_THE_WATER_RUNS,
  followTheWaterPlayer,
  followTheWaterSeed,
  KIND_DISTINCT_ROTATIONS,
  kindOfMask,
  PIPE_BOARD_DIFFICULTIES,
  PIPE_BOARD_TIERS,
  PIPE_CONTRACT_ROWS,
  PIPE_ROTATIONS,
  resetToScramble,
  rotationOfMask,
  serializePipeBoardLayout,
  tileMask,
  traceFlow,
  turnTile,
  type PipeBoard,
  type PipeBoardAssessment,
  type PipeBoardFault,
  type PipeBoardLayout,
  type PipeBoardOptions,
  type PipeFixture,
  type PipeTile,
} from '../src/systems/cloggedBathroom/pipeBoard';
import {
  attemptSeed,
  buildPipeAttempt,
  GENERATION_ATTEMPTS_MAX,
  createPipeBoardGeneration,
  generatePipeBoardNow,
  pipeBoardSeed,
  runPipeAttempt,
  type GeneratedPipeBoard,
} from '../src/systems/cloggedBathroom/pipeBoardGenerator';
import {
  PIPE_BOARD_FALLBACK_WORLD_SEED,
  PIPE_BOARD_FALLBACKS,
} from '../src/systems/cloggedBathroom/pipeBoardFallback';

/** World seeds each tier's sweep generates, by default. */
export const SWEEP_WORLDS = 100;
/** Above this share of worlds landing on the fallback, a tier leans on it in play. */
const FALLBACK_SHARE_MAX = 0.1;
/** A board generated at most this slowly may be built with the floor; slower ones wait for the board to open. */
const FLOOR_BUILD_MS_MAX = 20;
const FIRST_SWEEP_WORLD = 1;
const FIRST_DETERMINISM_WORLD = 7;
const SECOND_DETERMINISM_WORLD = 0x5eed;
const THIRD_DETERMINISM_WORLD = 0xbadc0de;
const DETERMINISM_WORLD_SEEDS: ReadonlyArray<number> = [
  FIRST_DETERMINISM_WORLD,
  SECOND_DETERMINISM_WORLD,
  THIRD_DETERMINISM_WORLD,
];
const PERCENT = 100;
const HEX_RADIX = 16;
const MS_DIGITS = 1;

const TINY_EXHAUSTIVE_SIZE = 3;
const TINY_PRUNED_SIZE = 4;
const TINY_EXHAUSTIVE_BOARDS = 10;
const TINY_PRUNED_BOARDS = 60;
const TINY_FIXTURES: Readonly<Record<number, number>> = { 3: 1, 4: 2 };
/** Extra edges a looped tiny board gets beyond its spanning tree. */
const LOOP_EDGES = 2;
/** Tiny boards for the follow-the-water player's own sanity check. */
const CANARY_BOARDS = 20;
const TINY_SEED_BASE = 0x7e57;
/** Keeps each tiny size's seeds apart from the other's. */
const TINY_SIZE_SEED_STRIDE = 0x1000;
/** Every other tiny board gets one extra edge, so looped answers are in the cross-check too. */
const LOOPED_BOARD_PERIOD = 2;
/** Cross-checked boards with a second solution, at least, for the counts to prove anything. */
const AMBIGUOUS_BOARDS_MIN = 3;
/** Sweep worlds per tier whose stepped board is also rebuilt by the one-shot attempt loop. */
const ONE_SHOT_WORLDS = 25;
/** Generator-drawn easy-size boards the pruned brute force also counts. */
const GENERATOR_SHAPED_BOARDS = 120;
const GENERATOR_SHAPED_WORLD = 0x5a9e;
/** Solutions the pruned enumeration counts before it stops. */
const BRUTE_FORCE_COUNT_CAP = 1000;
const SIDE_COUNT = 4;
const HALF_TURN = 2;
const STEP_X: ReadonlyArray<number> = [0, 1, 0, -1];
const STEP_Y: ReadonlyArray<number> = [-1, 0, 1, 0];
const EAST = 1;
const SOUTH = 2;
const NORTH_BIT = 1;
const EAST_BIT = 2;
const SOUTH_BIT = 4;
const WEST_BIT = 8;
const SIDE_OF_EDGE: Readonly<Record<PipeFixture['edge'], number>> = {
  top: NORTH_BIT,
  right: EAST_BIT,
  bottom: SOUTH_BIT,
};

/** Collects pass/fail lines and the failures among them. */
export class PipeBoardReport {
  readonly failures: string[] = [];

  check(ok: boolean, message: string): void {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`);
    if (!ok) this.failures.push(message);
  }

  note(message: string): void {
    console.log(`       ${message}`);
  }

  section(title: string): void {
    console.log(`\n── ${title}`);
  }
}

function describeRows(assessment: PipeBoardAssessment): string {
  return PIPE_CONTRACT_ROWS.map((row) => {
    const result = assessment.rows[row];
    if (result === undefined) return `${row}: -`;
    return `${row}: ${result.pass ? 'pass' : `FAIL (${result.detail})`}`;
  }).join('; ');
}

// ── Tiny boards and the reference rules ──────────────────────────────────────

/** Port sides per cell, worked out here rather than read from the module under test. */
function referencePorts(layout: PipeBoardLayout): Uint8Array {
  const { size } = layout;
  const ports = new Uint8Array(size * size);
  ports[cellIndex(size, 0, layout.inletRow)] |= WEST_BIT;
  for (const fixture of layout.fixtures) {
    const x = fixture.edge === 'right' ? size - 1 : fixture.index;
    const y = fixture.edge === 'top' ? 0 : fixture.edge === 'bottom' ? size - 1 : fixture.index;
    ports[cellIndex(size, x, y)] |= SIDE_OF_EDGE[fixture.edge];
  }
  return ports;
}

/**
 * The win written out on its own: flood from the main through ends that meet,
 * and the board is won when every fixture is full and no wet end meets
 * nothing. Returns the winning wet network (each tile's mask, 0 for a dry
 * tile), or null when the board is not won.
 */
function referenceNetwork(
  layout: PipeBoardLayout,
  ports: Uint8Array,
  masks: Uint8Array,
): Uint8Array | null {
  const { size } = layout;
  const inlet = cellIndex(size, 0, layout.inletRow);
  if ((masks[inlet] & WEST_BIT) === 0) return null;
  const wet = new Uint8Array(size * size);
  wet[inlet] = 1;
  const stack = [inlet];
  while (stack.length > 0) {
    const cell = stack.pop() ?? inlet;
    const x = cell % size;
    const y = Math.floor(cell / size);
    for (let side = 0; side < SIDE_COUNT; side++) {
      const bit = 1 << side;
      if ((masks[cell] & bit) === 0) continue;
      const nx = x + STEP_X[side];
      const ny = y + STEP_Y[side];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
        if ((ports[cell] & bit) === 0) return null;
        continue;
      }
      const next = cellIndex(size, nx, ny);
      const facing = 1 << ((side + HALF_TURN) % SIDE_COUNT);
      if ((masks[next] & facing) === 0) return null;
      if (wet[next] === 1) continue;
      wet[next] = 1;
      stack.push(next);
    }
  }
  for (let cell = 0; cell < size * size; cell++) {
    const fixtureSides = ports[cell] & ~(cell === inlet ? WEST_BIT : 0);
    if (fixtureSides === 0) continue;
    if (wet[cell] === 0 || (masks[cell] & fixtureSides) !== fixtureSides) return null;
  }
  return Uint8Array.from(masks, (mask, cell) => (wet[cell] === 1 ? mask : 0));
}

/** A small board from a random spanning tree, sometimes with one extra edge to close a loop. */
function tinyLayout(size: number, seed: number, looped: boolean): PipeBoardLayout {
  const random = seededStream(seed);
  const count = size * size;
  const masks = new Uint8Array(count);
  const edges: Array<{ cell: number; side: number }> = [];
  for (let cell = 0; cell < count; cell++) {
    if (cell % size < size - 1) edges.push({ cell, side: EAST });
    if (Math.floor(cell / size) < size - 1) edges.push({ cell, side: SOUTH });
  }
  for (let index = edges.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [edges[index], edges[swap]] = [edges[swap], edges[index]];
  }
  const group = Array.from({ length: count }, (_, cell) => cell);
  const root = (cell: number): number => (group[cell] === cell ? cell : root(group[cell]));
  const join = (edge: { cell: number; side: number }): void => {
    const next = edge.cell + (edge.side === EAST ? 1 : size);
    masks[edge.cell] |= 1 << edge.side;
    masks[next] |= 1 << ((edge.side + HALF_TURN) % SIDE_COUNT);
  };
  const spare: Array<{ cell: number; side: number }> = [];
  for (const edge of edges) {
    const next = edge.cell + (edge.side === EAST ? 1 : size);
    const a = root(edge.cell);
    const b = root(next);
    if (a === b) {
      spare.push(edge);
      continue;
    }
    group[a] = b;
    join(edge);
  }
  if (looped) spare.slice(0, LOOP_EDGES).forEach(join);

  const inletRow = Math.floor(size / HALF_TURN);
  masks[cellIndex(size, 0, inletRow)] |= WEST_BIT;
  const slots: PipeFixture[] = (['top', 'right', 'bottom'] as const).flatMap((edge) =>
    Array.from({ length: size }, (_, index) => ({ edge, index, kind: 'toilet' as const })),
  );
  const fixtures: PipeFixture[] = [];
  const wanted = TINY_FIXTURES[size] ?? 1;
  while (fixtures.length < wanted) {
    const slot = slots[Math.floor(random() * slots.length)];
    if (fixtures.some((fixture) => fixture.edge === slot.edge && fixture.index === slot.index)) {
      continue;
    }
    fixtures.push(slot);
  }
  const layoutPorts = referencePorts({ size, inletRow, fixtures, tiles: [] });
  const tiles: PipeTile[] = Array.from(masks, (treeMask, cell) => {
    const mask = treeMask | layoutPorts[cell];
    const kind = kindOfMask(mask) ?? 'cap';
    const answer = rotationOfMask(kind, mask);
    const distinct = KIND_DISTINCT_ROTATIONS[kind];
    const scramble = PIPE_ROTATIONS[Math.floor(random() * distinct)];
    const bolted = kind === 'cross';
    return { kind, answer, scramble: bolted ? answer : scramble, bolted, decoy: false };
  });
  return { size, inletRow, fixtures, tiles };
}

/** A board whose tiles stand on `masks`, scrambled to them too. */
function layoutFromMasks(
  size: number,
  inletRow: number,
  fixtures: PipeFixture[],
  masks: ReadonlyArray<number>,
): PipeBoardLayout {
  const tiles: PipeTile[] = masks.map((mask) => {
    const kind = kindOfMask(mask) ?? 'cap';
    const rotation = rotationOfMask(kind, mask);
    return {
      kind,
      answer: rotation,
      scramble: rotation,
      bolted: kind === 'cross',
      decoy: false,
    };
  });
  return { size, inletRow, fixtures, tiles };
}

/**
 * A 3×3 board with an arrangement that fills its one fixture with no leak
 * while the two caps in the top corner stay dry, whichever way they face.
 */
function dryIslandLayout(): PipeBoardLayout {
  return layoutFromMasks(
    TINY_EXHAUSTIVE_SIZE,
    1,
    [{ edge: 'right', index: 1, kind: 'toilet' }],
    [
      EAST_BIT,
      WEST_BIT,
      SOUTH_BIT,
      WEST_BIT | EAST_BIT,
      WEST_BIT | EAST_BIT | SOUTH_BIT,
      WEST_BIT | EAST_BIT | NORTH_BIT,
      EAST_BIT,
      NORTH_BIT | WEST_BIT | EAST_BIT,
      WEST_BIT,
    ],
  );
}

function tinyLayouts(size: number, howMany: number): PipeBoardLayout[] {
  return Array.from({ length: howMany }, (_, index) =>
    tinyLayout(
      size,
      TINY_SEED_BASE + size * TINY_SIZE_SEED_STRIDE + index,
      index % LOOPED_BOARD_PERIOD === 1,
    ),
  );
}

function distinctMasks(tile: PipeTile): number[] {
  if (tile.bolted) return [tileMask(tile.kind, tile.scramble)];
  return PIPE_ROTATIONS.slice(0, KIND_DISTINCT_ROTATIONS[tile.kind]).map((rotation) =>
    tileMask(tile.kind, rotation),
  );
}

function setMasks(board: PipeBoard, masks: Uint8Array): void {
  board.tiles.forEach(
    (tile, cell) => (board.rotations[cell] = rotationOfMask(tile.kind, masks[cell])),
  );
}

/**
 * Every arrangement of a 3×3 board: `traceFlow`'s win against the edge-rule
 * win on each one, and the number of wins against the solver's count.
 */
export function checkWinAndSolverExhaustively(
  report: PipeBoardReport,
  options: PipeBoardOptions,
): number {
  report.section(
    `Win check and solver against every arrangement (${TINY_EXHAUSTIVE_SIZE}×${TINY_EXHAUSTIVE_SIZE})`,
  );
  let boardsWithSeveral = 0;
  const layouts = [
    dryIslandLayout(),
    ...tinyLayouts(TINY_EXHAUSTIVE_SIZE, TINY_EXHAUSTIVE_BOARDS),
    ...generatorShapedLayouts(TINY_EXHAUSTIVE_SIZE, TINY_EXHAUSTIVE_BOARDS),
  ];
  for (const layout of layouts) {
    const choices = layout.tiles.map(distinctMasks);
    const ports = referencePorts(layout);
    const board = createPipeBoard(layout);
    const masks = new Uint8Array(layout.tiles.length);
    const digits = new Array<number>(layout.tiles.length).fill(0);
    const networks = new Set<string>();
    let disagreements = 0;
    let arrangements = 0;
    for (;;) {
      digits.forEach((digit, cell) => (masks[cell] = choices[cell][digit]));
      setMasks(board, masks);
      const traced = traceFlow(board, options).won;
      const network = referenceNetwork(layout, ports, masks);
      if (network !== null) networks.add(network.join(','));
      if (traced !== (network !== null)) disagreements++;
      arrangements++;
      let cell = 0;
      while (cell < digits.length && ++digits[cell] === choices[cell].length) digits[cell++] = 0;
      if (cell === digits.length) break;
    }
    const solve = countPipeSolutions(layout, options);
    const wins = networks.size;
    if (wins >= HALF_TURN) boardsWithSeveral++;
    report.check(
      disagreements === 0,
      `traceFlow agrees with the written-out win on all ${arrangements} arrangements (${disagreements} differ)`,
    );
    report.check(
      !solve.exhausted && solve.solutionCount === Math.min(wins, HALF_TURN),
      `solver counts ${solve.solutionCount}, brute force finds ${wins} winning networks`,
    );
  }
  return boardsWithSeveral;
}

/** A tile's masks as the network sees them: each distinct rotation, or 0 for dry. */
function networkChoices(tile: PipeTile): number[] {
  return [...distinctMasks(tile), 0];
}

/**
 * Counts a board's winning wet networks by enumerating every network the
 * edges allow: each tile dry (0) or one of its rotations, every join agreeing
 * on both sides, the panel edge open only at ports, and every tile with an
 * open end joined to the main. Each one is then set up on a real board, dry
 * tiles left on their scramble, and must be won by `traceFlow` with exactly
 * that network wet.
 */
function prunedCount(
  layout: PipeBoardLayout,
  options: PipeBoardOptions,
): { wins: number; traceMisses: number } {
  const { size } = layout;
  const ports = referencePorts(layout);
  const choices = layout.tiles.map(networkChoices);
  const masks = new Uint8Array(size * size);
  const board = createPipeBoard(layout);
  let wins = 0;
  let traceMisses = 0;
  const place = (cell: number): void => {
    if (wins >= BRUTE_FORCE_COUNT_CAP) return;
    if (cell === size * size) {
      if (!joinedToMain(layout, masks)) return;
      wins++;
      board.tiles.forEach((tile, index) => {
        board.rotations[index] =
          masks[index] === 0 ? tile.scramble : rotationOfMask(tile.kind, masks[index]);
      });
      const trace = traceFlow(board, options);
      const wetIsNetwork = trace.wet.every((wet, index) => wet === (masks[index] !== 0));
      if (!trace.won || !wetIsNetwork) traceMisses++;
      return;
    }
    const x = cell % size;
    const y = Math.floor(cell / size);
    for (const mask of choices[cell]) {
      const westOpen = (mask & WEST_BIT) !== 0;
      const westWanted =
        x === 0 ? (ports[cell] & WEST_BIT) !== 0 : (masks[cell - 1] & EAST_BIT) !== 0;
      if (westOpen !== westWanted) continue;
      const northOpen = (mask & NORTH_BIT) !== 0;
      const northWanted =
        y === 0 ? (ports[cell] & NORTH_BIT) !== 0 : (masks[cell - size] & SOUTH_BIT) !== 0;
      if (northOpen !== northWanted) continue;
      const eastMismatch = ((mask & EAST_BIT) !== 0) !== ((ports[cell] & EAST_BIT) !== 0);
      if (x === size - 1 && eastMismatch) continue;
      const southMismatch = ((mask & SOUTH_BIT) !== 0) !== ((ports[cell] & SOUTH_BIT) !== 0);
      if (y === size - 1 && southMismatch) continue;
      masks[cell] = mask;
      place(cell + 1);
    }
  };
  place(0);
  return { wins, traceMisses };
}

/** Every tile with an open end is reached from the main through open joins. */
function joinedToMain(layout: PipeBoardLayout, masks: Uint8Array): boolean {
  const { size } = layout;
  const inlet = cellIndex(size, 0, layout.inletRow);
  const reached = new Uint8Array(size * size);
  reached[inlet] = 1;
  const stack = [inlet];
  while (stack.length > 0) {
    const cell = stack.pop() ?? inlet;
    for (let side = 0; side < SIDE_COUNT; side++) {
      if ((masks[cell] & (1 << side)) === 0) continue;
      const nx = (cell % size) + STEP_X[side];
      const ny = Math.floor(cell / size) + STEP_Y[side];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = cellIndex(size, nx, ny);
      if (reached[next] === 1) continue;
      reached[next] = 1;
      stack.push(next);
    }
  }
  return masks.every((mask, cell) => mask === 0 || reached[cell] === 1);
}

export function checkSolverAgainstPrunedBruteForce(
  report: PipeBoardReport,
  options: PipeBoardOptions,
  label: string,
  layouts: ReadonlyArray<PipeBoardLayout>,
): number {
  report.section(`Solver against brute force (${label})`);
  let boardsWithSeveral = 0;
  let disagreements = 0;
  let traceMisses = 0;
  for (const layout of layouts) {
    const brute = prunedCount(layout, options);
    const solve = countPipeSolutions(layout, options);
    if (brute.wins >= HALF_TURN) boardsWithSeveral++;
    traceMisses += brute.traceMisses;
    if (solve.exhausted || solve.solutionCount !== Math.min(brute.wins, HALF_TURN)) {
      disagreements++;
      report.note(`solver ${solve.solutionCount}, brute force ${brute.wins}`);
    }
  }
  report.check(
    disagreements === 0,
    `solver count matches brute force on ${layouts.length} boards (${disagreements} differ)`,
  );
  report.check(
    traceMisses === 0,
    `traceFlow wins every brute-force solution (${traceMisses} missed)`,
  );
  return boardsWithSeveral;
}

/**
 * Boards the generator itself draws at the easy size, without hint bolts: its
 * real port and tree shapes, where a second solution is common enough that a
 * solution counter that stops at one is caught.
 */
function generatorShapedLayouts(size: number, howMany: number): PipeBoardLayout[] {
  const tier = {
    ...PIPE_BOARD_TIERS.easy,
    size,
    fixtures: TINY_FIXTURES[size] ?? PIPE_BOARD_TIERS.easy.fixtures,
    hintTiles: 0,
    minTees: 0,
    maxStraightRun: size,
  };
  const boardSeed = pipeBoardSeed(GENERATOR_SHAPED_WORLD + size, 'easy');
  return Array.from(
    { length: howMany },
    (_, index) => buildPipeAttempt(attemptSeed(boardSeed, index), tier).layout,
  ).flatMap((layout) => (layout === null ? [] : [layout]));
}

/** The cross-checks are only worth something if some tiny boards have more than one solution. */
export function checkTinyBoardsIncludeAmbiguity(report: PipeBoardReport, several: number): void {
  report.check(
    several >= AMBIGUOUS_BOARDS_MIN,
    `${several} cross-checked boards have two or more solutions (min ${AMBIGUOUS_BOARDS_MIN})`,
  );
}

/**
 * The follow-the-water player is the anti-"brain dead" gate, so a player that
 * never wins anything would pass every board for the wrong reason. It must win
 * some scrambled tiny boards, which are small enough to fall to it.
 */
export function checkFollowTheWaterCanWin(
  report: PipeBoardReport,
  options: PipeBoardOptions,
): void {
  report.section('The follow-the-water player is live');
  let wins = 0;
  const layouts = tinyLayouts(TINY_EXHAUSTIVE_SIZE, CANARY_BOARDS).filter(
    (_, index) => index % LOOPED_BOARD_PERIOD === 0,
  );
  for (const layout of layouts) {
    for (let run = 0; run < FOLLOW_THE_WATER_RUNS; run++) {
      if (followTheWaterPlayer(layout, followTheWaterSeed(run), options).won) wins++;
    }
  }
  const runs = layouts.length * FOLLOW_THE_WATER_RUNS;
  report.check(
    wins > 0,
    `won ${wins} of ${runs} runs on scrambled ${TINY_EXHAUSTIVE_SIZE}×${TINY_EXHAUSTIVE_SIZE} trees`,
  );
}

// ── The turn API ─────────────────────────────────────────────────────────────

/** Bolted tiles refuse, anticlockwise undoes clockwise, four turns come home, and a reset restores the scramble. */
export function checkTurnApi(report: PipeBoardReport, layout: PipeBoardLayout): void {
  report.section('The turn API');
  const board = createPipeBoard(layout);
  const bolted = layout.tiles.findIndex((tile) => tile.bolted);
  const turnable = layout.tiles.findIndex((tile) => !tile.bolted);
  if (bolted >= 0) {
    const before = board.rotations[bolted];
    report.check(
      !turnTile(board, bolted) && board.rotations[bolted] === before,
      'a bolted tile refuses to turn',
    );
  } else {
    report.note('no bolted tile on this board');
  }
  report.check(!turnTile(board, layout.tiles.length), 'a cell off the board refuses to turn');
  const start = currentMask(board, turnable);
  turnTile(board, turnable, 'clockwise');
  const once = currentMask(board, turnable);
  turnTile(board, turnable, 'anticlockwise');
  report.check(currentMask(board, turnable) === start, 'anticlockwise undoes clockwise');
  for (let turn = 0; turn < SIDE_COUNT; turn++) turnTile(board, turnable);
  report.check(currentMask(board, turnable) === start, 'four clockwise turns come home');
  report.check(
    once !== start || layout.tiles[turnable].kind === 'cross',
    'a quarter turn changes the tile',
  );
  layout.tiles.forEach((tile, cell) => {
    if (!tile.bolted) turnTile(board, cell);
  });
  resetToScramble(board);
  report.check(
    board.rotations.every((rotation, cell) => rotation === layout.tiles[cell].scramble),
    'resetToScramble restores the opening scramble',
  );
}

// ── The sweep ────────────────────────────────────────────────────────────────

export interface TierSweep {
  readonly layouts: PipeBoardLayout[];
  readonly worstMs: number;
  /** The longest one `step()` took: what a frame stepping the generation can stall for. */
  readonly worstStepMs: number;
  readonly fallbacks: number;
  readonly worlds: number;
}

/**
 * Generates `worlds` worlds' boards for one tier. Every generated board must
 * pass every row in full, start off its answer on every turnable tile, and
 * fall to the solver through `turnTile`; few worlds may land on the fallback.
 */
export function checkTierSweep(
  report: PipeBoardReport,
  difficulty: Difficulty,
  worlds: number,
  options: PipeBoardOptions,
): TierSweep {
  const tier = PIPE_BOARD_TIERS[difficulty];
  report.section(`Sweep: ${difficulty} (${tier.size}×${tier.size}, ${worlds} worlds)`);
  const layouts: PipeBoardLayout[] = [];
  const fallbackLimit = Math.floor(worlds * FALLBACK_SHARE_MAX);
  let fallbacks = 0;
  let failedFull = 0;
  let onAnswer = 0;
  let worstMs = 0;
  let totalMs = 0;
  let totalAttempts = 0;
  let swept = 0;
  let worstStepMs = 0;
  let oneShotDisagreements = 0;
  for (let world = FIRST_SWEEP_WORLD; world < FIRST_SWEEP_WORLD + worlds; world++) {
    const generation = createPipeBoardGeneration(world, difficulty, tier, options);
    let elapsed = 0;
    let settled = false;
    while (!settled) {
      const stepStarted = performance.now();
      settled = generation.step();
      const stepMs = performance.now() - stepStarted;
      elapsed += stepMs;
      worstStepMs = Math.max(worstStepMs, stepMs);
    }
    const generated = generation.result;
    if (generated === null) {
      report.check(false, `world ${world}: the generation settled without a board`);
      continue;
    }
    if (world < FIRST_SWEEP_WORLD + ONE_SHOT_WORLDS) {
      const oneShot = oneShotGeneration(world, difficulty, options);
      const same =
        oneShot.source === generated.source &&
        oneShot.attempts === generated.attempts &&
        serializePipeBoardLayout(oneShot.layout) === serializePipeBoardLayout(generated.layout);
      if (!same) oneShotDisagreements++;
    }
    swept++;
    totalMs += elapsed;
    worstMs = Math.max(worstMs, elapsed);
    totalAttempts += generated.attempts;
    if (generated.source === 'fallback') {
      fallbacks++;
      if (fallbacks > fallbackLimit) {
        report.note(`stopped after world ${world}: ${fallbacks} fallbacks already`);
        break;
      }
      continue;
    }
    const { layout } = generated;
    layouts.push(layout);
    const full = assessPipeBoard(layout, tier, options);
    if (!full.passed) {
      failedFull++;
      report.note(`world ${world}: ${describeRows(full)}`);
    }
    onAnswer += layout.tiles.filter(
      (tile) =>
        !tile.bolted &&
        !tile.decoy &&
        tileMask(tile.kind, tile.scramble) === tileMask(tile.kind, tile.answer),
    ).length;
  }
  const share = swept === 0 ? 1 : fallbacks / swept;
  report.check(
    fallbacks <= fallbackLimit,
    `${fallbacks} of ${swept} worlds fell back (${(share * PERCENT).toFixed(1)}%, max ${FALLBACK_SHARE_MAX * PERCENT}%)`,
  );
  report.check(
    failedFull === 0,
    `every generated board passes every contract row (${failedFull} fail)`,
  );
  report.check(onAnswer === 0, `no turnable network tile starts on its answer (${onAnswer} do)`);
  report.check(
    oneShotDisagreements === 0,
    `stepped generation deals the one-shot attempt loop's board byte for byte (${oneShotDisagreements} of ${Math.min(swept, ONE_SHOT_WORLDS)} worlds differ)`,
  );
  report.note(
    `generation: mean ${(totalMs / Math.max(1, swept)).toFixed(MS_DIGITS)} ms, worst ${worstMs.toFixed(MS_DIGITS)} ms, mean attempts ${(totalAttempts / Math.max(1, swept)).toFixed(MS_DIGITS)} (budget ${GENERATION_ATTEMPTS_MAX}), longest single step ${worstStepMs.toFixed(MS_DIGITS)} ms`,
  );
  return { layouts, worstMs, worstStepMs, fallbacks, worlds: swept };
}

/**
 * The attempt loop run in one go, each attempt assessed in full: what the
 * stepped generation must reproduce exactly, so spreading it across frames
 * never changes the board a world is dealt.
 */
function oneShotGeneration(
  world: number,
  difficulty: Difficulty,
  options: PipeBoardOptions,
): GeneratedPipeBoard {
  const boardSeed = pipeBoardSeed(world, difficulty);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS_MAX; attempt++) {
    const outcome = runPipeAttempt(boardSeed, attempt, PIPE_BOARD_TIERS[difficulty], options);
    if (outcome.accepted && outcome.layout !== null) {
      return { layout: outcome.layout, source: 'generated', attempts: attempt + 1 };
    }
  }
  return {
    layout: PIPE_BOARD_FALLBACKS[difficulty],
    source: 'fallback',
    attempts: GENERATION_ATTEMPTS_MAX,
  };
}

/** The committed fallbacks pass their tiers, regenerate byte for byte, and are no sweep board. */
export function checkFallbacks(
  report: PipeBoardReport,
  sweeps: Readonly<Record<Difficulty, TierSweep>>,
  options: PipeBoardOptions,
): void {
  report.section('Fallbacks');
  for (const difficulty of PIPE_BOARD_DIFFICULTIES) {
    const fallback = PIPE_BOARD_FALLBACKS[difficulty];
    const full = assessPipeBoard(fallback, PIPE_BOARD_TIERS[difficulty], options);
    report.check(
      full.passed,
      `${difficulty} fallback passes its tier: ${full.passed ? 'every row' : describeRows(full)}`,
    );
    const encoded = serializePipeBoardLayout(fallback);
    const regenerated = generatePipeBoardNow(
      PIPE_BOARD_FALLBACK_WORLD_SEED,
      difficulty,
      PIPE_BOARD_TIERS[difficulty],
      options,
    );
    report.check(
      regenerated.source === 'generated' &&
        serializePipeBoardLayout(regenerated.layout) === encoded,
      `${difficulty} fallback regenerates byte for byte from its named world seed`,
    );
    const matches = sweeps[difficulty].layouts.filter(
      (layout) => serializePipeBoardLayout(layout) === encoded,
    ).length;
    report.check(matches === 0, `${difficulty} fallback matches none of the sweep's boards`);
  }
}

/**
 * The same world and difficulty give the same board, difficulties differ, and
 * generation neither touches `Math.random` nor draws from the world's stream.
 */
export function checkDeterminism(report: PipeBoardReport, options: PipeBoardOptions): void {
  report.section('Determinism');
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls++;
    return realRandom();
  };
  try {
    for (const world of DETERMINISM_WORLD_SEEDS) {
      const encoded = PIPE_BOARD_DIFFICULTIES.map((difficulty) => {
        const tier = PIPE_BOARD_TIERS[difficulty];
        const first = serializePipeBoardLayout(
          generatePipeBoardNow(world, difficulty, tier, options).layout,
        );
        const second = serializePipeBoardLayout(
          generatePipeBoardNow(world, difficulty, tier, options).layout,
        );
        report.check(first === second, `world ${world}, ${difficulty}: the same board twice`);
        return first;
      });
      report.check(
        new Set(encoded).size === encoded.length,
        `world ${world}: each difficulty gets its own board`,
      );
    }
  } finally {
    Math.random = realRandom;
  }
  report.check(randomCalls === 0, `generation drew from Math.random ${randomCalls} times`);

  const [world] = DETERMINISM_WORLD_SEEDS;
  const untouched = withWorldSeed(world, () => worldRandom());
  const afterGeneration = withWorldSeed(world, () => {
    generatePipeBoardNow(world, 'easy', PIPE_BOARD_TIERS.easy, options);
    return worldRandom();
  });
  report.check(
    untouched === afterGeneration,
    "generating a board leaves the world's stream where it was",
  );
}

// ── Fallback authoring ───────────────────────────────────────────────────────

function layoutSource(layout: PipeBoardLayout): string {
  const fixtures = layout.fixtures
    .map(
      (fixture) =>
        `    { edge: '${fixture.edge}', index: ${fixture.index}, kind: '${fixture.kind}' },`,
    )
    .join('\n');
  const tiles = layout.tiles
    .map(
      (tile) =>
        `    { kind: '${tile.kind}', answer: ${tile.answer}, scramble: ${tile.scramble}, bolted: ${tile.bolted}, decoy: ${tile.decoy} },`,
    )
    .join('\n');
  return `{\n  size: ${layout.size},\n  inletRow: ${layout.inletRow},\n  fixtures: [\n${fixtures}\n  ],\n  tiles: [\n${tiles}\n  ],\n}`;
}

const FALLBACK_HEADER = `/**
 * One committed board per difficulty, for the rare world whose generator runs
 * out of attempts without accepting a board.
 *
 * Each was found by the generator itself and then frozen here as data, so it
 * is a real board of its tier rather than a hand-drawn approximation. They
 * come from a world seed no gate sweeps, so the sweep never meets them as
 * ordinary generated boards. The pipe-board gate assesses every one against
 * its tier's contract and regenerates it byte for byte, so a retuned tier or
 * generator that no longer produces one of these turns the gate red; rewrite
 * this file with \`npm run verify:pipe-board -- --write-fallbacks\`.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type { PipeBoardLayout } from './pipeBoard';

/**
 * The world seed these boards were generated from: \`generatePipeBoardNow\`
 * with this seed and each difficulty reproduces them.
 */
export const PIPE_BOARD_FALLBACK_WORLD_SEED = 0x${PIPE_BOARD_FALLBACK_WORLD_SEED.toString(HEX_RADIX)};
`;

/** Regenerates the fallback module from the fallback world seed. */
export function writeFallbacks(path: string): void {
  const names: Readonly<Record<Difficulty, string>> = {
    easy: 'EASY_FALLBACK',
    normal: 'NORMAL_FALLBACK',
    hard: 'HARD_FALLBACK',
  };
  const blocks = PIPE_BOARD_DIFFICULTIES.map((difficulty) => {
    const generated = generatePipeBoardNow(PIPE_BOARD_FALLBACK_WORLD_SEED, difficulty);
    if (generated.source !== 'generated') {
      throw new Error(`the fallback world seed found no ${difficulty} board`);
    }
    return `const ${names[difficulty]}: PipeBoardLayout = ${layoutSource(generated.layout)};\n`;
  });
  const table = `export const PIPE_BOARD_FALLBACKS: Readonly<Record<Difficulty, PipeBoardLayout>> = {\n${PIPE_BOARD_DIFFICULTIES.map((difficulty) => `  ${difficulty}: ${names[difficulty]},`).join('\n')}\n};\n`;
  writeFileSync(path, [FALLBACK_HEADER, ...blocks, table].join('\n'));
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface PipeBoardRunOptions {
  readonly fault: PipeBoardFault | null;
  readonly worldsPerTier: number;
}

export interface PipeBoardRunResult {
  readonly failures: string[];
  readonly worstHardMs: number;
}

/** Every board-level check, with at most one fault swapped in. */
export function runPipeBoardChecks(run: PipeBoardRunOptions): PipeBoardRunResult {
  const report = new PipeBoardReport();
  const options: PipeBoardOptions = { fault: run.fault };

  const several =
    checkWinAndSolverExhaustively(report, options) +
    checkSolverAgainstPrunedBruteForce(
      report,
      options,
      `${TINY_PRUNED_SIZE}×${TINY_PRUNED_SIZE}`,
      tinyLayouts(TINY_PRUNED_SIZE, TINY_PRUNED_BOARDS),
    ) +
    checkSolverAgainstPrunedBruteForce(
      report,
      options,
      `generator-shaped ${TINY_PRUNED_SIZE}×${TINY_PRUNED_SIZE} with decoys`,
      generatorShapedLayouts(TINY_PRUNED_SIZE, GENERATOR_SHAPED_BOARDS),
    ) +
    checkSolverAgainstPrunedBruteForce(
      report,
      options,
      `generator-shaped ${PIPE_BOARD_TIERS.easy.size}×${PIPE_BOARD_TIERS.easy.size} with decoys`,
      generatorShapedLayouts(PIPE_BOARD_TIERS.easy.size, GENERATOR_SHAPED_BOARDS),
    );
  checkTinyBoardsIncludeAmbiguity(report, several);
  checkFollowTheWaterCanWin(report, options);
  checkTurnApi(report, PIPE_BOARD_FALLBACKS.easy);

  const sweeps: Record<Difficulty, TierSweep> = {
    easy: checkTierSweep(report, 'easy', run.worldsPerTier, options),
    normal: checkTierSweep(report, 'normal', run.worldsPerTier, options),
    hard: checkTierSweep(report, 'hard', run.worldsPerTier, options),
  };
  checkFallbacks(report, sweeps, options);
  checkDeterminism(report, options);

  report.section('When to generate');
  const worstHardMs = sweeps.hard.worstMs;
  report.note(
    `longest single generation step at hard ${sweeps.hard.worstStepMs.toFixed(MS_DIGITS)} ms`,
  );
  report.note(
    `worst hard generation ${worstHardMs.toFixed(MS_DIGITS)} ms: ${
      worstHardMs <= FLOOR_BUILD_MS_MAX
        ? 'cheap enough to build with the floor'
        : `over ${FLOOR_BUILD_MS_MAX} ms, so build it on the first board open, behind the explainer`
    }`,
  );
  return { failures: report.failures, worstHardMs };
}
