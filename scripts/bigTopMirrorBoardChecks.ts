/**
 * Board-level checks for the hall of mirrors: the generator's sweep per tier,
 * the committed fallbacks, the ordering of the tiers, determinism, and the
 * frame the board is laid into.
 *
 * Pure checks over `src/map/bigTop/`: nothing here builds a scene, so they run
 * in a couple of seconds and can be called from any gate. Each negative-test
 * fault swaps a broken board (or tier) into exactly one check and asserts the
 * swap really happened, because a fault that silently fails to apply leaves
 * its check green for the wrong reason.
 */

import type { Difficulty } from '../src/core/difficultyProfiles';
import {
  BIG_TOP_MAZE_ROWS,
  MIRROR_HALL_GLASS_COLUMNS,
  MIRROR_HALL_ROWS,
  TEACHING_STRIP_BOARD,
  teachingTileToTent,
  type MazeTile,
} from '../src/map/bigTopMazeLayout';
import {
  assessBoard,
  boardCellAt,
  boardTileToTent,
  CELL_FLOOR,
  CELL_WALL,
  hotSpanProblems,
  PIVOT_CYCLE,
  CONTRACT_ROWS,
  constructedSolution,
  MIRROR_BOARD_DIFFICULTIES,
  MIRROR_BOARD_DIVIDER_X,
  MIRROR_BOARD_ENTRIES,
  MIRROR_BOARD_EXITS,
  MIRROR_BOARD_HEIGHT,
  MIRROR_BOARD_TENT_ORIGIN,
  MIRROR_BOARD_TIERS,
  MIRROR_BOARD_WIDTH,
  mixSeed,
  RANDOM_SWING_BLOW_CAP,
  randomSwingPlayer,
  serializeMirrorBoard,
  solveBoard,
  startingIndices,
  tentTileToBoard,
  traceBoard,
  WALL_TILES_ABOVE_TEACHING_GLASS,
  type BoardAssessment,
  type BoardLane,
  type BoardTile,
  type ContractRow,
  type MirrorBoard,
  type MirrorBoardDifficulty,
  type MirrorBoardTier,
} from '../src/map/bigTop/mirrorBoard';
import {
  GENERATION_ATTEMPTS_MAX,
  generateBoardNow,
  mirrorBoardSeed,
  runBoardAttempt,
} from '../src/map/bigTop/mirrorBoardGenerator';
import {
  MIRROR_BOARD_FALLBACKS,
  MIRROR_BOARD_FALLBACK_WORLD_SEED,
} from '../src/map/bigTop/mirrorBoardFallback';

export type MirrorBoardFault =
  | 'drop-solution-mirror'
  | 'current-hall'
  | 'decorative-window'
  | 'hot-span-blocks-glass'
  | 'misplaced-limelight'
  | 'star-over-teaching-glass'
  | 'kitten-twin';

export const MIRROR_BOARD_FAULTS: ReadonlyArray<MirrorBoardFault> = [
  'drop-solution-mirror',
  'current-hall',
  'decorative-window',
  'hot-span-blocks-glass',
  'misplaced-limelight',
  'star-over-teaching-glass',
  'kitten-twin',
];

/** Generation attempts each tier's sweep must assess, at least. */
export const SWEEP_ATTEMPTS = 500;
/** Accepted boards each tier's sweep must re-assess, at least: the medians compared across tiers rest on them. */
export const SWEEP_ACCEPTED_MIN = 40;
/** Below this share of accepted attempts, a tier would lean on its fallback in play. */
export const SWEEP_PASS_RATE_MIN = 0.1;
/** Accepted boards per tier the random-swinging player is sent at; it is slow by design. */
const RANDOM_SWING_SAMPLE = 20;
/** World seeds the determinism check regenerates. */
const FIRST_WORLD_SEED = 1;
const SECOND_WORLD_SEED = 0x5eed;
const THIRD_WORLD_SEED = 0xbadc0de;
const DETERMINISM_WORLD_SEEDS: ReadonlyArray<number> = [
  FIRST_WORLD_SEED,
  SECOND_WORLD_SEED,
  THIRD_WORLD_SEED,
];
/** Rows between a window and any other window, and from the twin, for the decorative-window fault. */
const DECORATIVE_WINDOW_CLEARANCE = 2;
const DECORATIVE_WINDOW_ROW_INSET = 2;
const PERCENT = 100;
/** Arrangements a board may have for the brute-force cross-check to enumerate it. */
const BRUTE_FORCE_ARRANGEMENTS_MAX = 5000;

/** Collects pass/fail lines and the failures among them. */
export class MirrorBoardReport {
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

type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Fails to compile if the board module's difficulty union drifts from the game's. */
const DIFFICULTY_UNIONS_MATCH: SameType<Difficulty, MirrorBoardDifficulty> = true;

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function spread(values: ReadonlyArray<number>): string {
  if (values.length === 0) return 'none';
  return `${Math.min(...values)}–${Math.max(...values)}, median ${median(values)}`;
}

function describeRows(assessment: BoardAssessment): string {
  return CONTRACT_ROWS.map((row) => {
    const result = assessment.rows[row];
    if (result === undefined) return `${row}: -`;
    return `${row}: ${result.pass ? 'pass' : `FAIL (${result.detail})`}`;
  }).join('; ');
}

// ── The frame ────────────────────────────────────────────────────────────────

const FLOOR_CHAR = '.';

function tentChar(tile: MazeTile): string {
  return BIG_TOP_MAZE_ROWS[tile.y]?.[tile.x] ?? '';
}

/**
 * The board's frame constants against the tent's own rows: its walls are
 * walls, its lanes are floor, its gates sit over the tent's gates, its
 * doorways line up with the menagerie's curtains, and the hall constants the
 * rest of the tent reads agree with it.
 */
export function checkBoardFrame(report: MirrorBoardReport): void {
  report.section('Board frame in the tent');
  report.check(DIFFICULTY_UNIONS_MATCH, 'the board difficulty union is the game Difficulty union');

  const origin = MIRROR_BOARD_TENT_ORIGIN;
  const [westWall, divider, eastWall] = MIRROR_HALL_GLASS_COLUMNS;
  report.check(
    westWall === origin.x &&
      divider === origin.x + MIRROR_BOARD_DIVIDER_X &&
      eastWall === origin.x + MIRROR_BOARD_WIDTH - 1,
    `wall columns ${westWall}/${divider}/${eastWall} are the board's 0/${MIRROR_BOARD_DIVIDER_X}/${MIRROR_BOARD_WIDTH - 1}`,
  );
  report.check(
    MIRROR_HALL_ROWS.y0 === origin.y + 1,
    `the hall's first floor row ${MIRROR_HALL_ROWS.y0} is the board's row 1`,
  );

  let badTiles = 0;
  for (let y = 1; y < MIRROR_BOARD_HEIGHT - 1; y++) {
    for (let x = 0; x < MIRROR_BOARD_WIDTH; x++) {
      const isWall = x === 0 || x === MIRROR_BOARD_WIDTH - 1 || x === MIRROR_BOARD_DIVIDER_X;
      const char = tentChar(boardTileToTent({ x, y }));
      if (isWall === (char === FLOOR_CHAR)) badTiles++;
    }
  }
  report.check(
    badTiles === 0,
    `every board wall is tent wall and every lane tile is floor (${badTiles} disagree)`,
  );

  const gateChars: Readonly<Record<BoardLane, string>> = { human: '<', cat: '>' };
  const curtainChars: Readonly<Record<BoardLane, string>> = { human: 'K', cat: 'L' };
  const curtainRow = MIRROR_HALL_ROWS.y1 + 1;
  for (const lane of ['human', 'cat'] as const) {
    const exit = MIRROR_BOARD_EXITS[lane];
    const gate = boardTileToTent({ x: exit.x, y: exit.y - 1 });
    report.check(
      tentChar(gate) === gateChars[lane],
      `${lane} exit tile sits under the tent's ${gateChars[lane]} gate at ${gate.x},${gate.y}`,
    );
    const entryColumn = boardTileToTent(MIRROR_BOARD_ENTRIES[lane]).x;
    report.check(
      tentChar({ x: entryColumn, y: curtainRow }) === curtainChars[lane],
      `${lane} doorway column ${entryColumn} lines up with the ${curtainChars[lane]} curtain on row ${curtainRow}`,
    );
  }
  const hallBottomWallRow = boardTileToTent({ x: 0, y: MIRROR_BOARD_HEIGHT - 1 }).y;
  const glassUnderTheWall = [
    ...TEACHING_STRIP_BOARD.mirrors.map((mirror) => mirror.tile),
    ...TEACHING_STRIP_BOARD.splitters.map((splitter) => splitter.tile),
  ]
    .map(teachingTileToTent)
    .filter((tile) => tile.y === hallBottomWallRow + 1)
    .map((tile) => `${tile.x},${hallBottomWallRow}`)
    .sort();
  const reserved = WALL_TILES_ABOVE_TEACHING_GLASS.map(boardTileToTent)
    .map((tile) => `${tile.x},${tile.y}`)
    .sort();
  report.check(
    glassUnderTheWall.length > 0 && glassUnderTheWall.join(' ') === reserved.join(' '),
    `stars are kept off the wall tiles above the teaching glass: reserved ${reserved.join(' ')}, glass under the wall at ${glassUnderTheWall.join(' ') || 'none'}`,
  );

  const roundTrip = tentTileToBoard(boardTileToTent({ x: MIRROR_BOARD_DIVIDER_X, y: 1 }));
  report.check(
    roundTrip.x === MIRROR_BOARD_DIVIDER_X && roundTrip.y === 1,
    'board and tent tiles map back and forth',
  );
}

// ── The sweep ────────────────────────────────────────────────────────────────

export interface TierSweep {
  readonly difficulty: MirrorBoardDifficulty;
  readonly attempts: number;
  readonly accepted: number;
  readonly boards: ReadonlyArray<MirrorBoard>;
  readonly fewestBlows: ReadonlyArray<number>;
  readonly touchedGlass: ReadonlyArray<number>;
  readonly withTwin: number;
  readonly withSplitter: number;
}

/**
 * Generates boards world after world until at least {@link SWEEP_ATTEMPTS}
 * attempts have been assessed, re-assesses every accepted board in full, and
 * checks the real sliced generator lands on the same board the attempt loop
 * accepted.
 */
export function checkTierSweep(
  report: MirrorBoardReport,
  difficulty: MirrorBoardDifficulty,
  tier: MirrorBoardTier,
  attemptsWanted: number,
): TierSweep {
  report.section(`Sweep: ${difficulty}`);
  const rejections = new Map<string, number>();
  const boards: MirrorBoard[] = [];
  const fewestBlows: number[] = [];
  const touchedGlass: number[] = [];
  let attempts = 0;
  let accepted = 0;
  let worstAttempts = 0;
  let fallbacks = 0;
  let failedFull = 0;
  let generatorDisagreements = 0;
  let totalMs = 0;
  let worstMs = 0;

  for (let world = 1; attempts < attemptsWanted; world++) {
    const seed = mirrorBoardSeed(world, difficulty);
    let found: MirrorBoard | null = null;
    let attempt = 0;
    for (; attempt < GENERATION_ATTEMPTS_MAX && found === null; attempt++) {
      const started = performance.now();
      const result = runBoardAttempt(seed, attempt, tier);
      const elapsed = performance.now() - started;
      totalMs += elapsed;
      worstMs = Math.max(worstMs, elapsed);
      attempts++;
      if (result.accepted && result.board !== null) {
        found = result.board;
        accepted++;
      } else {
        const reason = result.rejection ?? 'unknown';
        rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
      }
    }
    worstAttempts = Math.max(worstAttempts, attempt);

    const generated = generateBoardNow(world, difficulty, tier);
    if (found === null) {
      fallbacks++;
      if (generated.source !== 'fallback') generatorDisagreements++;
      continue;
    }
    if (
      generated.source !== 'generated' ||
      generated.attempts !== attempt ||
      serializeMirrorBoard(generated.board) !== serializeMirrorBoard(found)
    ) {
      generatorDisagreements++;
    }

    const full = assessBoard(found, tier);
    if (!full.passed) {
      failedFull++;
      report.note(`world ${world}: ${describeRows(full)}`);
    }
    boards.push(found);
    fewestBlows.push(full.solve?.fewestBlows ?? 0);
    touchedGlass.push(full.solve?.touchedMirrors ?? 0);
  }

  const passRate = attempts === 0 ? 0 : accepted / attempts;
  const reasons = [...rejections.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  const swings = boards
    .slice(0, RANDOM_SWING_SAMPLE)
    .map((board, index) => randomSwingPlayer(board, mixSeed(index, board.mirrors.length)).blows);

  report.check(
    attempts >= attemptsWanted,
    `generation attempts assessed: ${attempts} (min ${attemptsWanted}), over ${boards.length + fallbacks} worlds`,
  );
  report.check(
    boards.length >= SWEEP_ACCEPTED_MIN,
    `accepted boards re-assessed in full: ${boards.length} (min ${SWEEP_ACCEPTED_MIN})`,
  );
  report.check(
    passRate >= SWEEP_PASS_RATE_MIN,
    `attempt pass rate ${(passRate * PERCENT).toFixed(1)}%: ${accepted} accepted of ${attempts} attempts (min ${SWEEP_PASS_RATE_MIN * PERCENT}%)`,
  );
  report.check(
    failedFull === 0,
    `every accepted board passes the full contract (${failedFull} do not)`,
  );
  report.check(
    generatorDisagreements === 0,
    `the sliced generator settles on the attempt loop's board every time (${generatorDisagreements} differ)`,
  );
  report.note(`rejections: ${reasons || 'none'}`);
  report.note(`worst attempts per board: ${worstAttempts}; fallbacks: ${fallbacks}`);
  report.note(`fewest blows, over accepted boards: ${spread(fewestBlows)}`);
  report.note(
    `touched glass (mirrors in the answer), over accepted boards: ${spread(touchedGlass)}`,
  );
  report.note(
    `random swinging, median blows over ${swings.length} boards: ${median(swings)} (cap ${RANDOM_SWING_BLOW_CAP})`,
  );
  report.note(
    `attempt cost: ${(totalMs / Math.max(attempts, 1)).toFixed(2)} ms mean, ${worstMs.toFixed(1)} ms worst`,
  );

  return {
    difficulty,
    attempts,
    accepted,
    boards,
    fewestBlows,
    touchedGlass,
    withTwin: boards.filter((board) => board.stars.some((star) => star.kind === 'twin')).length,
    withSplitter: boards.filter((board) => board.splitters.length > 0).length,
  };
}

/** Kitten stays the gentlest: the twin and the splitter are Crawler's and Nightmare's, and Nightmare asks the most. */
export function checkTierOrdering(
  report: MirrorBoardReport,
  sweeps: Readonly<Record<MirrorBoardDifficulty, TierSweep>>,
): void {
  report.section('Tier ordering');
  const { easy, normal, hard } = sweeps;
  report.check(
    easy.boards.length > 0 && normal.boards.length > 0 && hard.boards.length > 0,
    'every tier produced boards to compare',
  );
  report.check(
    easy.withTwin === 0 && easy.withSplitter === 0,
    `Kitten boards have no twin and no splitter (${easy.withTwin} twins, ${easy.withSplitter} splitters of ${easy.boards.length})`,
  );
  for (const sweep of [normal, hard]) {
    report.check(
      sweep.withTwin === sweep.boards.length && sweep.withSplitter === sweep.boards.length,
      `every ${sweep.difficulty} board has a twin and a splitter (${sweep.withTwin} and ${sweep.withSplitter} of ${sweep.boards.length})`,
    );
  }
  report.check(
    median(hard.fewestBlows) > median(normal.fewestBlows),
    `Nightmare's median fewest blows ${median(hard.fewestBlows)} is above Crawler's ${median(normal.fewestBlows)}`,
  );
  report.check(
    median(hard.touchedGlass) > median(normal.touchedGlass),
    `Nightmare's median mirrors in the answer ${median(hard.touchedGlass)} is above Crawler's ${median(normal.touchedGlass)}`,
  );
}

// ── Single boards ────────────────────────────────────────────────────────────

/** Assesses one board in full and reports each named row. */
export function checkBoardRows(
  report: MirrorBoardReport,
  label: string,
  board: MirrorBoard,
  tier: MirrorBoardTier,
  rows: ReadonlyArray<ContractRow> = CONTRACT_ROWS,
  goalStarIds?: ReadonlyArray<string>,
): BoardAssessment {
  const assessment = assessBoard(board, tier, { goalStarIds });
  for (const row of rows) {
    const result = assessment.rows[row];
    report.check(result?.pass === true, `${label}: ${row} — ${result?.detail ?? 'not assessed'}`);
  }
  return assessment;
}

/** Each committed fallback meets its own tier's contract. */
export function checkFallbacks(
  report: MirrorBoardReport,
  boards: Readonly<Record<MirrorBoardDifficulty, MirrorBoard>> = MIRROR_BOARD_FALLBACKS,
): void {
  report.section('Fallback boards');
  for (const difficulty of MIRROR_BOARD_DIFFICULTIES) {
    const assessment = checkBoardRows(
      report,
      `${difficulty} fallback`,
      boards[difficulty],
      MIRROR_BOARD_TIERS[difficulty],
    );
    report.note(
      `${difficulty} fallback: ${assessment.solve?.fewestBlows ?? '-'} blows, ${assessment.solve?.touchedMirrors ?? '-'} mirrors touched, tune player won ${assessment.tuneWins ?? '-'}`,
    );
  }
}

/**
 * The same world and difficulty give the same board byte for byte, two
 * difficulties on one world differ, and generation never touches
 * `Math.random`. That the sliced generation settles on the attempt loop's
 * board is the sweep's check, run on every world it generates.
 */
export function checkDeterminism(report: MirrorBoardReport): void {
  report.section('Determinism');
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls++;
    return realRandom();
  };
  try {
    for (const world of DETERMINISM_WORLD_SEEDS) {
      const encoded = MIRROR_BOARD_DIFFICULTIES.map((difficulty) => {
        const first = serializeMirrorBoard(generateBoardNow(world, difficulty).board);
        const second = serializeMirrorBoard(generateBoardNow(world, difficulty).board);
        report.check(
          first === second,
          `world ${world}, ${difficulty}: the same board twice (${first.length} bytes)`,
        );
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
}

/** The fallbacks were frozen from worlds no sweep or determinism check generates, so they are not a sweep board in disguise. */
export function checkFallbacksAreTheirOwnBoards(
  report: MirrorBoardReport,
  sweeps: Readonly<Record<MirrorBoardDifficulty, TierSweep>>,
): void {
  report.section('Fallbacks are not sweep boards');
  for (const difficulty of MIRROR_BOARD_DIFFICULTIES) {
    const fallback = serializeMirrorBoard(MIRROR_BOARD_FALLBACKS[difficulty]);
    const generated = [
      ...sweeps[difficulty].boards,
      ...DETERMINISM_WORLD_SEEDS.map((world) => generateBoardNow(world, difficulty).board),
    ];
    const matches = generated.filter((board) => serializeMirrorBoard(board) === fallback).length;
    report.check(
      matches === 0,
      `${difficulty} fallback matches none of ${generated.length} checked boards`,
    );
    const regenerated = serializeMirrorBoard(
      generateBoardNow(MIRROR_BOARD_FALLBACK_WORLD_SEED, difficulty).board,
    );
    report.check(
      regenerated === fallback,
      `${difficulty} fallback regenerates byte for byte from its named world seed`,
    );
  }
}

// ── The walk against brute force ─────────────────────────────────────────────

/**
 * A light that merges into the other light's path: blue runs east along row
 * 5, and red, coming north, is turned east onto the same tiles by a splitter.
 * Every arrangement of its two mirrors lights the red star, and a walk that
 * shares one visited set between the lights cuts red off where it joins blue.
 */
export function mergingLightsBoard(): MirrorBoard {
  return {
    width: MIRROR_BOARD_WIDTH,
    height: MIRROR_BOARD_HEIGHT,
    dividerX: MIRROR_BOARD_DIVIDER_X,
    entries: MIRROR_BOARD_ENTRIES,
    exits: MIRROR_BOARD_EXITS,
    limelights: [
      { colour: 'blue', lane: 'human', tile: { x: 0, y: 2 }, heading: 'east' },
      { colour: 'red', lane: 'human', tile: { x: 5, y: 13 }, heading: 'north' },
    ],
    mirrors: [
      {
        id: 'merge_upper',
        kind: 'pivot_mirror',
        owner: 'human',
        tile: { x: 3, y: 2 },
        cycle: PIVOT_CYCLE,
        initialIndex: 0,
        solutionIndex: 0,
      },
      {
        id: 'merge_lower',
        kind: 'pivot_mirror',
        owner: 'human',
        tile: { x: 3, y: 5 },
        cycle: PIVOT_CYCLE,
        initialIndex: 0,
        solutionIndex: 0,
      },
    ],
    splitters: [{ tile: { x: 5, y: 5 }, diagonal: 'slash' }],
    windows: [],
    stars: [{ id: 'merge_red', kind: 'red', tile: { x: 17, y: 5 } }],
    pillars: [],
  };
}

function arrangementAt(board: MirrorBoard, ordinal: number): number[] {
  let rest = ordinal;
  return board.mirrors.map((mirror) => {
    const index = rest % mirror.cycle.length;
    rest = Math.floor(rest / mirror.cycle.length);
    return index;
  });
}

function stepKeys(board: MirrorBoard, indices: ReadonlyArray<number>): Set<string> {
  return new Set(
    traceBoard(board, indices).steps.map(
      (step) => `${step.colour}:${step.tile.x},${step.tile.y}:${step.heading}`,
    ),
  );
}

/**
 * The solver's counts against enumerating every arrangement through the walk,
 * and the walk of both lights together against each light walked alone. A
 * light's path cannot depend on the other light being switched on, so any
 * difference is one light's walk leaking into the other's.
 */
export function checkWalkAgainstBruteForce(
  report: MirrorBoardReport,
  boards: ReadonlyArray<{ readonly label: string; readonly board: MirrorBoard }>,
): void {
  report.section('Walk and solver against brute force');
  for (const { label, board } of boards) {
    const start = startingIndices(board);
    const total = board.mirrors.reduce((product, mirror) => product * mirror.cycle.length, 1);
    if (total > BRUTE_FORCE_ARRANGEMENTS_MAX) {
      report.check(false, `${label}: ${total} arrangements is too many to enumerate`);
      continue;
    }
    let solving = 0;
    let fewest = Number.POSITIVE_INFINITY;
    let leaks = 0;
    for (let ordinal = 0; ordinal < total; ordinal++) {
      const indices = arrangementAt(board, ordinal);
      if (traceBoard(board, indices).solved) {
        solving++;
        const blows = indices.reduce(
          (sum, index, mirror) =>
            sum +
            ((index - start[mirror] + board.mirrors[mirror].cycle.length) %
              board.mirrors[mirror].cycle.length),
          0,
        );
        fewest = Math.min(fewest, blows);
      }
      const together = stepKeys(board, indices);
      const alone = board.limelights.flatMap((light) => [
        ...stepKeys({ ...board, limelights: [light] }, indices),
      ]);
      if (alone.length !== together.size || alone.some((key) => !together.has(key))) leaks++;
    }
    const solved = solveBoard(board);
    const bruteFewest = solving === 0 ? null : fewest;
    report.check(
      solved.solvingArrangements === solving &&
        solved.fewestBlows === bruteFewest &&
        !solved.exhausted,
      `${label}: solver ${solved.solvingArrangements} solving / ${solved.fewestBlows ?? '-'} blows, brute force ${solving} / ${bruteFewest ?? '-'} over ${total}`,
    );
    report.check(
      leaks === 0,
      `${label}: each light walks the same alone as beside the other (${leaks} arrangements differ)`,
    );
  }
}

// ── Faults ───────────────────────────────────────────────────────────────────

/**
 * A board with one mirror of its constructed answer taken out — one past the
 * hot span, so the fire, and with it every walk, stays exactly as it was and
 * only the solve can notice.
 */
export function dropSolutionMirror(board: MirrorBoard): {
  board: MirrorBoard;
  droppedId: string | null;
} {
  const answered = traceBoard(board, constructedSolution(board));
  for (const index of answered.reachedMirrors) {
    const dropped = board.mirrors[index];
    const variant = {
      ...board,
      mirrors: board.mirrors.filter((mirror) => mirror !== dropped),
    };
    if (hotSpanProblems(variant).length > 0) continue;
    return { board: variant, droppedId: dropped.id };
  }
  return { board, droppedId: null };
}

/** A board with a third window cut where nothing needs one. */
export function withDecorativeWindow(board: MirrorBoard): {
  board: MirrorBoard;
  added: BoardTile | null;
} {
  const taken = [
    ...board.windows,
    ...board.stars.filter((star) => star.tile.x === board.dividerX).map((star) => star.tile),
  ];
  const glassAt = (x: number, y: number): boolean =>
    board.mirrors.some((mirror) => mirror.tile.x === x && mirror.tile.y === y) ||
    board.splitters.some((splitter) => splitter.tile.x === x && splitter.tile.y === y);
  for (let y = DECORATIVE_WINDOW_ROW_INSET; y < board.height - DECORATIVE_WINDOW_ROW_INSET; y++) {
    if (taken.some((tile) => Math.abs(tile.y - y) <= DECORATIVE_WINDOW_CLEARANCE)) continue;
    if (glassAt(board.dividerX - 1, y) || glassAt(board.dividerX + 1, y)) continue;
    const added = { x: board.dividerX, y };
    return { board: { ...board, windows: [...board.windows, added] }, added };
  }
  return { board, added: null };
}

/**
 * A board with one more of Carl's mirrors, stood beside blue's hot span next
 * to the outer wall, whose only other floor neighbours are closed by pillars.
 * Nothing in it touches the light — the mirror and the pillars stand on empty
 * floor the answer never lights — so the hot span, walked as solid, is the
 * only thing between Carl and that glass, and only the reachable row can see
 * it.
 */
export function withHotSpanBlockingGlass(board: MirrorBoard): {
  board: MirrorBoard;
  blockedId: string | null;
  pillarsAdded: number;
} {
  const lens = board.limelights.find((light) => light.colour === 'blue');
  const untouched = { board, blockedId: null, pillarsAdded: 0 };
  if (lens === undefined) return untouched;
  const lit = stepKeys(board, constructedSolution(board));
  const litTiles = new Set([...lit].map((key) => key.split(':')[1]));
  const firstFloor = lens.tile.x + (lens.heading === 'east' ? 1 : -1);
  const inward = lens.heading === 'east' ? 1 : -1;
  const gateways = [board.entries.human, board.entries.cat, board.exits.human, board.exits.cat];
  const emptyFloor = (tile: BoardTile): boolean =>
    boardCellAt(board, tile) === CELL_FLOOR &&
    !litTiles.has(`${tile.x},${tile.y}`) &&
    !gateways.some((gateway) => gateway.x === tile.x && gateway.y === tile.y);
  for (const side of [-1, 1]) {
    const mirrorTile = { x: firstFloor, y: lens.tile.y + side };
    const pillarTiles: BoardTile[] = [
      { x: firstFloor + inward, y: mirrorTile.y },
      { x: firstFloor, y: mirrorTile.y + side },
    ];
    const behind = { x: lens.tile.x, y: mirrorTile.y };
    if (!emptyFloor(mirrorTile) || !pillarTiles.every(emptyFloor)) continue;
    if (boardCellAt(board, behind) !== CELL_WALL) continue;
    const blocked = {
      id: 'fault_mirror',
      kind: 'pivot_mirror' as const,
      owner: lens.lane,
      tile: mirrorTile,
      cycle: PIVOT_CYCLE,
      initialIndex: 0,
      solutionIndex: 0,
    };
    return {
      board: {
        ...board,
        mirrors: [...board.mirrors, blocked],
        pillars: [...board.pillars, ...pillarTiles],
      },
      blockedId: blocked.id,
      pillarsAdded: pillarTiles.length,
    };
  }
  return untouched;
}

/**
 * A board whose blue limelight is moved one row along its wall, so its ray no
 * longer meets its first mirror a few tiles out.
 */
export function withMisplacedLimelight(board: MirrorBoard): {
  board: MirrorBoard;
  moved: boolean;
} {
  for (const side of [-1, 1]) {
    const lens = board.limelights.find((light) => light.colour === 'blue');
    if (lens === undefined) break;
    const tile = { x: lens.tile.x, y: lens.tile.y + side };
    if (tile.y <= 0 || tile.y >= board.height - 1) continue;
    if (boardCellAt(board, tile) !== CELL_WALL) continue;
    const limelights = board.limelights.map((light) =>
      light === lens ? { ...light, tile } : light,
    );
    const moved = { ...board, limelights };
    if (hotSpanProblems(moved).length > 0) return { board: moved, moved: true };
  }
  return { board, moved: false };
}

/**
 * The latched three-star hall as board data: two limelights, three of Carl's
 * pivots and three of Donut's swivels, three stars in the divider that each
 * latched on its own, and the encore in Carl's outer wall. Its frame runs
 * from the gate-row wall down to the menagerie's curtain row, seventeen floor
 * rows deep. Frozen here so the fault that proves the contract rejects it
 * does not depend on the tent still carrying it.
 */
export function latchedThreeStarHallBoard(): MirrorBoard {
  return {
    width: MIRROR_BOARD_WIDTH,
    height: 19,
    dividerX: MIRROR_BOARD_DIVIDER_X,
    entries: { human: { x: 14, y: 17 }, cat: { x: 20, y: 17 } },
    exits: MIRROR_BOARD_EXITS,
    limelights: [
      { colour: 'blue', lane: 'human', tile: { x: 0, y: 7 }, heading: 'east' },
      { colour: 'red', lane: 'cat', tile: { x: 35, y: 7 }, heading: 'west' },
    ],
    mirrors: [
      {
        id: 'pivot_hub',
        kind: 'pivot_mirror',
        owner: 'human',
        tile: { x: 13, y: 7 },
        cycle: ['NE', 'SE', 'SW', 'NW'],
        initialIndex: 0,
        solutionIndex: 0,
      },
      {
        id: 'pivot_north',
        kind: 'pivot_mirror',
        owner: 'human',
        tile: { x: 13, y: 5 },
        cycle: ['NE', 'SE', 'SW', 'NW'],
        initialIndex: 0,
        solutionIndex: 0,
      },
      {
        id: 'pivot_south',
        kind: 'pivot_mirror',
        owner: 'human',
        tile: { x: 13, y: 9 },
        cycle: ['NE', 'SE', 'SW', 'NW'],
        initialIndex: 3,
        solutionIndex: 3,
      },
      {
        id: 'swivel_hub',
        kind: 'swivel_mirror',
        owner: 'cat',
        tile: { x: 21, y: 7 },
        cycle: ['NE', 'SE'],
        initialIndex: 0,
        solutionIndex: 0,
      },
      {
        id: 'swivel_north',
        kind: 'swivel_mirror',
        owner: 'cat',
        tile: { x: 21, y: 5 },
        cycle: ['SW', 'NW'],
        initialIndex: 1,
        solutionIndex: 1,
      },
      {
        id: 'swivel_south',
        kind: 'swivel_mirror',
        owner: 'cat',
        tile: { x: 21, y: 13 },
        cycle: ['NW', 'SW'],
        initialIndex: 1,
        solutionIndex: 1,
      },
    ],
    splitters: [],
    windows: [],
    stars: [
      { id: 'star_cat_gate', kind: 'blue', tile: { x: 17, y: 9 } },
      { id: 'star_human_gate', kind: 'red', tile: { x: 17, y: 13 } },
      { id: 'star_twin', kind: 'twin', tile: { x: 17, y: 5 } },
      { id: 'star_encore', kind: 'encore', tile: { x: 0, y: 5 } },
    ],
    pillars: [],
  };
}

/** Mirrors and stars the latched hall is frozen with, so the fault can tell it was really swapped in. */
const LATCHED_HALL_MIRRORS = 6;
const LATCHED_HALL_STARS = 4;

/** The rows a hall of trivial stars fails. */
const THOUGHT_ROWS: ReadonlyArray<ContractRow> = ['needsThought', 'nearUnique'];

/**
 * Needs-thought and near-unique, with each board judged under the rule it is
 * played by: a board of this module under "every star at once", the latched
 * three-star hall under its own latch, one star at a time. Judged under
 * "every star at once" the latched hall would pass both rows vacuously, because nothing lights its
 * three stars together, so that would prove nothing about its stars.
 */
export function checkBoardNeedsThought(
  report: MirrorBoardReport,
  board: MirrorBoard,
  label: string,
  rule: 'all-at-once' | 'latch-each-star',
): void {
  report.section(`Needs thought (${rule}): ${label}`);
  const tier = MIRROR_BOARD_TIERS.easy;
  const whole = solveBoard(board);
  report.note(
    `every star at once: ${whole.solvingArrangements} of ${whole.totalArrangements} arrangements`,
  );
  if (rule === 'all-at-once') {
    checkBoardRows(report, label, board, tier, THOUGHT_ROWS);
    return;
  }
  for (const star of board.stars.filter((candidate) => candidate.kind !== 'encore')) {
    checkBoardRows(report, `${label} ${star.id}`, board, tier, THOUGHT_ROWS, [star.id]);
  }
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface MirrorBoardRunOptions {
  readonly fault: MirrorBoardFault | null;
  readonly attemptsPerTier: number;
}

/** Every board-level check, with at most one fault swapped in. Returns the failures. */
export function runMirrorBoardChecks(options: MirrorBoardRunOptions): string[] {
  const report = new MirrorBoardReport();
  const { fault } = options;

  checkBoardFrame(report);
  checkWalkAgainstBruteForce(report, [
    { label: 'merging lights', board: mergingLightsBoard() },
    { label: 'latched three-star hall', board: latchedThreeStarHallBoard() },
    { label: 'easy fallback', board: MIRROR_BOARD_FALLBACKS.easy },
    { label: 'normal fallback', board: MIRROR_BOARD_FALLBACKS.normal },
  ]);

  const fallbacks: Record<MirrorBoardDifficulty, MirrorBoard> = { ...MIRROR_BOARD_FALLBACKS };
  if (fault === 'drop-solution-mirror') {
    const { board, droppedId } = dropSolutionMirror(fallbacks.hard);
    report.check(
      droppedId !== null && board.mirrors.length === fallbacks.hard.mirrors.length - 1,
      `fault applied: dropped answer mirror ${droppedId ?? 'nothing'} from the hard fallback`,
    );
    fallbacks.hard = board;
  }
  if (fault === 'decorative-window') {
    const { board, added } = withDecorativeWindow(fallbacks.easy);
    report.check(
      added !== null,
      `fault applied: a third window at ${added?.x ?? '-'},${added?.y ?? '-'} on the easy fallback`,
    );
    report.check(solveBoard(board).solvable, 'the board with the extra window is still solvable');
    fallbacks.easy = board;
  }
  if (fault === 'hot-span-blocks-glass') {
    const { board, blockedId, pillarsAdded } = withHotSpanBlockingGlass(fallbacks.normal);
    report.check(
      blockedId !== null &&
        board.pillars.length === fallbacks.normal.pillars.length + pillarsAdded &&
        pillarsAdded > 0,
      `fault applied: ${blockedId ?? 'nothing'} stands beside the hot span behind ${pillarsAdded} pillars on empty floor`,
    );
    fallbacks.normal = board;
  }
  if (fault === 'star-over-teaching-glass') {
    const [reserved] = WALL_TILES_ABOVE_TEACHING_GLASS;
    const board = {
      ...fallbacks.easy,
      stars: fallbacks.easy.stars.map((star) =>
        star.kind === 'encore' ? { ...star, tile: reserved } : star,
      ),
    };
    report.check(
      board.stars.some((star) => star.tile.x === reserved.x && star.tile.y === reserved.y),
      `fault applied: the easy fallback's encore moved onto ${reserved.x},${reserved.y}`,
    );
    fallbacks.easy = board;
  }
  if (fault === 'misplaced-limelight') {
    const { board, moved } = withMisplacedLimelight(fallbacks.easy);
    report.check(moved, "fault applied: the easy fallback's blue limelight moved one row");
    fallbacks.easy = board;
  }
  checkFallbacks(report, fallbacks);

  if (fault === 'current-hall') {
    const hall = latchedThreeStarHallBoard();
    report.check(
      hall.mirrors.length === LATCHED_HALL_MIRRORS && hall.stars.length === LATCHED_HALL_STARS,
      `fault applied: the latched three-star hall, ${hall.mirrors.length} mirrors and ${hall.stars.length} stars`,
    );
    checkBoardNeedsThought(report, hall, 'latched three-star hall', 'latch-each-star');
  } else {
    checkBoardNeedsThought(report, MIRROR_BOARD_FALLBACKS.easy, 'Kitten fallback', 'all-at-once');
  }

  const tiers: Record<MirrorBoardDifficulty, MirrorBoardTier> = { ...MIRROR_BOARD_TIERS };
  if (fault === 'kitten-twin') {
    tiers.easy = { ...tiers.easy, twin: true };
    report.check(tiers.easy.twin, 'fault applied: the Kitten tier generates a twin');
  }
  const sweeps: Record<MirrorBoardDifficulty, TierSweep> = {
    easy: checkTierSweep(report, 'easy', tiers.easy, options.attemptsPerTier),
    normal: checkTierSweep(report, 'normal', tiers.normal, options.attemptsPerTier),
    hard: checkTierSweep(report, 'hard', tiers.hard, options.attemptsPerTier),
  };
  checkTierOrdering(report, sweeps);
  checkFallbacksAreTheirOwnBoards(report, sweeps);
  checkDeterminism(report);

  return report.failures;
}
