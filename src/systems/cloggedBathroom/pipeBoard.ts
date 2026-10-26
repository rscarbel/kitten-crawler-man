/**
 * The clogged bathroom's pipe board: tiles, the flow of water through them,
 * the win check, the exact solver, the simulated players and the acceptance
 * contract a generated board must meet.
 *
 * Water enters from the main on the left edge and runs through every pipe
 * whose ends meet. A board is won when every fixture is full and nothing
 * leaks, both at once. A leak is an open end of a wet pipe that meets neither
 * a matching end nor a fixture. Dry pipes never leak and may stay dry, so the
 * board carries decoy tiles that the winning network leaves out. "Nothing
 * leaks" only holds globally, so following the water forward and fixing
 * whatever it touches first does not win: every turn that extends the flow
 * also swings the tile's other ends, and wetting a decoy opens new leaks.
 *
 * Pure and DOM-free. Progress is never saved: a board is regenerated from the
 * world seed and the difficulty, and its opening scramble is kept on the board
 * so a reload restores it.
 */

import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import { mixSeed, seededStream } from '../../map/bigTop/mirrorBoard';

// ── Tiles ────────────────────────────────────────────────────────────────────

export type PipeTileKind = 'cap' | 'straight' | 'elbow' | 'tee' | 'cross';
/** Clockwise quarter turns from the kind's base mask. */
export type PipeRotation = 0 | 1 | 2 | 3;
export type PipeDirection = 'north' | 'east' | 'south' | 'west';
export type TurnDirection = 'clockwise' | 'anticlockwise';
/** The panel edge a fixture hangs on; the water main always enters on the left. */
export type FixtureEdge = 'top' | 'right' | 'bottom';
export type FixtureKind = 'toilet' | 'sink';

const EAST = 1;
const SOUTH = 2;
const SIDE_COUNT = 4;
const NORTH_BIT = 1;
const EAST_BIT = 2;
const SOUTH_BIT = 4;
const WEST_BIT = 8;
const ALL_SIDES = 15;
/** Distinct 4-bit connection masks; a candidate set is a bitset over them. */
const MASK_VALUES = 16;
const HALF_TURN = 2;
const ENDS_PER_EDGE = 2;
const QUARTER_TURN_MASK = 3;

export const PIPE_DIRECTIONS: ReadonlyArray<PipeDirection> = ['north', 'east', 'south', 'west'];
const THREE_QUARTER_TURN: PipeRotation = 3;
export const PIPE_ROTATIONS: ReadonlyArray<PipeRotation> = [0, 1, 2, THREE_QUARTER_TURN];
/** Connection bits: N=1, E=2, S=4, W=8. */
export const SIDE_BIT: Readonly<Record<PipeDirection, number>> = {
  north: NORTH_BIT,
  east: EAST_BIT,
  south: SOUTH_BIT,
  west: WEST_BIT,
};
const STEP_X: ReadonlyArray<number> = [0, 1, 0, -1];
const STEP_Y: ReadonlyArray<number> = [-1, 0, 1, 0];

/** Each kind's connection mask at rotation 0. */
export const KIND_BASE_MASK: Readonly<Record<PipeTileKind, number>> = {
  cap: NORTH_BIT,
  straight: NORTH_BIT | SOUTH_BIT,
  elbow: NORTH_BIT | EAST_BIT,
  tee: EAST_BIT | SOUTH_BIT | WEST_BIT,
  cross: ALL_SIDES,
};

/** How many rotations of each kind look different; a straight turned twice is itself. */
export const KIND_DISTINCT_ROTATIONS: Readonly<Record<PipeTileKind, number>> = {
  cap: 4,
  straight: 2,
  elbow: 4,
  tee: 4,
  cross: 1,
};

export const PIPE_TILE_KINDS: ReadonlyArray<PipeTileKind> = [
  'cap',
  'straight',
  'elbow',
  'tee',
  'cross',
];

/** A mask turned `quarterTurns` clockwise: north becomes east. */
export function rotateMask(mask: number, quarterTurns: number): number {
  const turns = quarterTurns & QUARTER_TURN_MASK;
  return ((mask << turns) | (mask >> (SIDE_COUNT - turns))) & ALL_SIDES;
}

export function tileMask(kind: PipeTileKind, rotation: number): number {
  return rotateMask(KIND_BASE_MASK[kind], rotation);
}

function rotationOf(quarterTurns: number): PipeRotation {
  return PIPE_ROTATIONS[quarterTurns & QUARTER_TURN_MASK];
}

function popcount4(mask: number): number {
  let count = 0;
  for (let side = 0; side < SIDE_COUNT; side++) count += (mask >> side) & 1;
  return count;
}

function popcount16(bits: number): number {
  let count = 0;
  let rest = bits;
  while (rest !== 0) {
    rest &= rest - 1;
    count++;
  }
  return count;
}

function isStraightMask(mask: number): boolean {
  return mask === (NORTH_BIT | SOUTH_BIT) || mask === (EAST_BIT | WEST_BIT);
}

const CAP_ENDS = 1;
const PAIR_ENDS = 2;
const TEE_ENDS = 3;

/** The tile kind whose rotations include `mask`, or null for an empty mask. */
export function kindOfMask(mask: number): PipeTileKind | null {
  switch (popcount4(mask)) {
    case CAP_ENDS:
      return 'cap';
    case PAIR_ENDS:
      return isStraightMask(mask) ? 'straight' : 'elbow';
    case TEE_ENDS:
      return 'tee';
    case SIDE_COUNT:
      return 'cross';
    default:
      return null;
  }
}

/** The smallest rotation of `kind` that gives `mask`. */
export function rotationOfMask(kind: PipeTileKind, mask: number): PipeRotation {
  for (const rotation of PIPE_ROTATIONS) {
    if (tileMask(kind, rotation) === mask) return rotation;
  }
  return 0;
}

/** Bitset over masks of every rotation `kind` can show. */
function kindMaskSet(kind: PipeTileKind): number {
  let set = 0;
  for (const rotation of PIPE_ROTATIONS) set |= 1 << tileMask(kind, rotation);
  return set;
}

const KIND_MASK_SETS: Readonly<Record<PipeTileKind, number>> = {
  cap: kindMaskSet('cap'),
  straight: kindMaskSet('straight'),
  elbow: kindMaskSet('elbow'),
  tee: kindMaskSet('tee'),
  cross: kindMaskSet('cross'),
};

/** Clockwise-only quarter turns from `from` to `to`, or -1 when no turn gets there. */
export function clockwiseTurnsBetween(from: number, to: number): number {
  for (let turns = 0; turns < SIDE_COUNT; turns++) {
    if (rotateMask(from, turns) === to) return turns;
  }
  return -1;
}

// ── Boards ───────────────────────────────────────────────────────────────────

export interface PipeFixture {
  readonly edge: FixtureEdge;
  /** Column on the top or bottom edge, row on the right edge. */
  readonly index: number;
  readonly kind: FixtureKind;
}

export interface PipeTile {
  readonly kind: PipeTileKind;
  /**
   * The rotation that is part of the board's one solution. A decoy has no
   * place in the solution, so its answer is its scramble: the solved board
   * leaves it where it started.
   */
  readonly answer: PipeRotation;
  /** The rotation the board opens on. */
  readonly scramble: PipeRotation;
  /** Bolted tiles never turn: the brass cross, and easy's pre-solved hint tiles. */
  readonly bolted: boolean;
  /**
   * Not part of the winning network: it stays dry in the solution, whichever
   * way it is turned. Decoys are what make "fill every fixture, leak nothing"
   * a puzzle rather than a matter of wetting everything.
   */
  readonly decoy: boolean;
}

/** Everything about a board except where the player has turned it: plain, frozen-friendly data. */
export interface PipeBoardLayout {
  /** The grid is `size` × `size`. */
  readonly size: number;
  /** The row of the left-edge cell the water main feeds. */
  readonly inletRow: number;
  readonly fixtures: ReadonlyArray<PipeFixture>;
  /** Row-major: the tile at column x, row y is `tiles[y * size + x]`. */
  readonly tiles: ReadonlyArray<PipeTile>;
}

/** A layout in play: `rotations` is the only thing that changes. */
export interface PipeBoard extends PipeBoardLayout {
  readonly rotations: PipeRotation[];
}

export interface PipeCellCoord {
  readonly x: number;
  readonly y: number;
}

export function cellIndex(size: number, x: number, y: number): number {
  return y * size + x;
}

export function cellCoord(size: number, cell: number): PipeCellCoord {
  return { x: cell % size, y: Math.floor(cell / size) };
}

/** The edge cell a fixture faces. */
export function fixtureCell(size: number, fixture: PipeFixture): PipeCellCoord {
  switch (fixture.edge) {
    case 'top':
      return { x: fixture.index, y: 0 };
    case 'bottom':
      return { x: fixture.index, y: size - 1 };
    case 'right':
      return { x: size - 1, y: fixture.index };
  }
}

/** The side of its cell a fixture's pipe leaves by. */
export function fixtureDirection(fixture: PipeFixture): PipeDirection {
  switch (fixture.edge) {
    case 'top':
      return 'north';
    case 'bottom':
      return 'south';
    case 'right':
      return 'east';
  }
}

/** A board on its opening scramble. */
export function createPipeBoard(layout: PipeBoardLayout): PipeBoard {
  return { ...layout, rotations: layout.tiles.map((tile) => tile.scramble) };
}

/** Whether any tile stands off its opening scramble: the player has work on the board. */
export function isOffScramble(board: PipeBoard): boolean {
  return board.tiles.some((tile, cell) => board.rotations[cell] !== tile.scramble);
}

/** Puts every tile back on the opening scramble. */
export function resetToScramble(board: PipeBoard): void {
  board.tiles.forEach((tile, cell) => (board.rotations[cell] = tile.scramble));
}

/**
 * Turns one tile a quarter turn. Returns false, and changes nothing, for a
 * bolted tile or a cell off the board: the caller plays the "won't budge" cue.
 */
export function turnTile(
  board: PipeBoard,
  cell: number,
  direction: TurnDirection = 'clockwise',
): boolean {
  const tile = board.tiles[cell];
  const onBoard = Number.isInteger(cell) && cell >= 0 && cell < board.tiles.length;
  if (!onBoard || tile.bolted) return false;
  const step = direction === 'clockwise' ? 1 : SIDE_COUNT - 1;
  board.rotations[cell] = rotationOf(board.rotations[cell] + step);
  return true;
}

export function currentMask(board: PipeBoard, cell: number): number {
  return tileMask(board.tiles[cell].kind, board.rotations[cell]);
}

export function answerMasks(layout: PipeBoardLayout): Uint8Array {
  return Uint8Array.from(layout.tiles, (tile) => tileMask(tile.kind, tile.answer));
}

/** The solution as the solver states it: each tile's answer mask, and 0 for a decoy, which stays dry. */
export function answerNetworkMasks(layout: PipeBoardLayout): Uint8Array {
  return Uint8Array.from(layout.tiles, (tile) =>
    tile.decoy ? 0 : tileMask(tile.kind, tile.answer),
  );
}

export function scrambleMasks(layout: PipeBoardLayout): Uint8Array {
  return Uint8Array.from(layout.tiles, (tile) => tileMask(tile.kind, tile.scramble));
}

export function boardMasks(board: PipeBoard): Uint8Array {
  return Uint8Array.from(board.tiles, (tile, cell) => tileMask(tile.kind, board.rotations[cell]));
}

/** A byte-stable encoding of a layout, for determinism checks and for committing fallbacks. */
export function serializePipeBoardLayout(layout: PipeBoardLayout): string {
  return JSON.stringify({
    size: layout.size,
    inletRow: layout.inletRow,
    fixtures: layout.fixtures,
    tiles: layout.tiles,
  });
}

// ── Gate faults ──────────────────────────────────────────────────────────────

/**
 * Deliberate breakages the pipe-board gate injects to prove each of its checks
 * can go red. Play never passes one; every function defaults to none.
 */
export type PipeBoardFault =
  | 'win-ignores-leaks'
  | 'win-counts-dry-ends'
  | 'solver-skips-global-rules'
  | 'scramble-keeps-answers'
  | 'generator-shares-world-stream'
  | 'uniqueness-stops-at-one'
  | 'follow-the-water-disabled';

export const PIPE_BOARD_FAULTS: ReadonlyArray<PipeBoardFault> = [
  'win-ignores-leaks',
  'win-counts-dry-ends',
  'solver-skips-global-rules',
  'scramble-keeps-answers',
  'generator-shares-world-stream',
  'uniqueness-stops-at-one',
  'follow-the-water-disabled',
];

export interface PipeBoardOptions {
  readonly fault?: PipeBoardFault | null;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** A layout compiled to typed arrays for the hot loops. */
interface PipeGeometry {
  readonly size: number;
  readonly cellCount: number;
  /** `neighbour[cell * 4 + side]`, or -1 off the board. */
  readonly neighbour: Int16Array;
  /** Sides of each cell that face off the board. */
  readonly boundarySides: Uint8Array;
  /** Boundary sides that meet the water main or a fixture. */
  readonly portSides: Uint8Array;
  readonly inletCell: number;
  readonly fixtureCells: Int16Array;
  readonly fixtureSideBits: Uint8Array;
  readonly kindSets: Uint16Array;
  /** Open ends each tile has in every rotation. */
  readonly degree: Uint8Array;
  readonly bolted: Uint8Array;
  readonly scramble: Uint8Array;
  readonly answers: Uint8Array;
  /** The answer's wet network: each tile's answer mask, 0 for a decoy. */
  readonly network: Uint8Array;
}

const geometryCache = new WeakMap<PipeBoardLayout, PipeGeometry>();

function compile(layout: PipeBoardLayout): PipeGeometry {
  const cached = geometryCache.get(layout);
  if (cached !== undefined) return cached;
  const { size } = layout;
  const cellCount = size * size;
  const neighbour = new Int16Array(cellCount * SIDE_COUNT);
  const boundarySides = new Uint8Array(cellCount);
  const portSides = new Uint8Array(cellCount);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = cellIndex(size, x, y);
      for (let side = 0; side < SIDE_COUNT; side++) {
        const nx = x + STEP_X[side];
        const ny = y + STEP_Y[side];
        const onBoard = nx >= 0 && ny >= 0 && nx < size && ny < size;
        neighbour[cell * SIDE_COUNT + side] = onBoard ? cellIndex(size, nx, ny) : -1;
        if (!onBoard) boundarySides[cell] |= 1 << side;
      }
    }
  }
  const inletCell = cellIndex(size, 0, layout.inletRow);
  portSides[inletCell] |= WEST_BIT;
  const fixtureCells = new Int16Array(layout.fixtures.length);
  const fixtureSideBits = new Uint8Array(layout.fixtures.length);
  layout.fixtures.forEach((fixture, index) => {
    const { x, y } = fixtureCell(size, fixture);
    const cell = cellIndex(size, x, y);
    const bit = SIDE_BIT[fixtureDirection(fixture)];
    fixtureCells[index] = cell;
    fixtureSideBits[index] = bit;
    portSides[cell] |= bit;
  });
  const geometry: PipeGeometry = {
    size,
    cellCount,
    neighbour,
    boundarySides,
    portSides,
    inletCell,
    fixtureCells,
    fixtureSideBits,
    kindSets: Uint16Array.from(layout.tiles, (tile) => KIND_MASK_SETS[tile.kind]),
    degree: Uint8Array.from(layout.tiles, (tile) => popcount4(KIND_BASE_MASK[tile.kind])),
    bolted: Uint8Array.from(layout.tiles, (tile) => (tile.bolted ? 1 : 0)),
    scramble: scrambleMasks(layout),
    answers: answerMasks(layout),
    network: answerNetworkMasks(layout),
  };
  geometryCache.set(layout, geometry);
  return geometry;
}

// ── Flow ─────────────────────────────────────────────────────────────────────

/** Reusable buffers and the last run's counts, so the players' inner loops never allocate. */
class FlowRun {
  readonly distance: Int16Array;
  readonly queue: Int16Array;
  wetTiles = 0;
  leaks = 0;
  fixturesFull = 0;
  private lastMasks: Uint8Array | null = null;

  constructor(readonly geometry: PipeGeometry) {
    this.distance = new Int16Array(geometry.cellCount);
    this.queue = new Int16Array(geometry.cellCount);
  }

  /** Floods from the main through `masks`; fills `distance` (-1 dry) and the counts. */
  run(masks: Uint8Array): void {
    const { geometry, distance, queue } = this;
    const { neighbour, portSides } = geometry;
    distance.fill(-1);
    this.lastMasks = masks;
    this.wetTiles = 0;
    this.leaks = 0;
    this.fixturesFull = 0;
    const inlet = geometry.inletCell;
    if ((masks[inlet] & WEST_BIT) === 0) return;
    distance[inlet] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = inlet;
    while (head < tail) {
      const cell = queue[head++];
      const mask = masks[cell];
      for (let side = 0; side < SIDE_COUNT; side++) {
        const bit = 1 << side;
        if ((mask & bit) === 0) continue;
        const next = neighbour[cell * SIDE_COUNT + side];
        if (next < 0) {
          if ((portSides[cell] & bit) === 0) this.leaks++;
          continue;
        }
        const facing = 1 << ((side + HALF_TURN) & QUARTER_TURN_MASK);
        if ((masks[next] & facing) === 0) {
          this.leaks++;
          continue;
        }
        if (distance[next] < 0) {
          distance[next] = distance[cell] + 1;
          queue[tail++] = next;
        }
      }
    }
    this.wetTiles = tail;
    for (let index = 0; index < geometry.fixtureCells.length; index++) {
      const cell = geometry.fixtureCells[index];
      if (distance[cell] >= 0 && (masks[cell] & geometry.fixtureSideBits[index]) !== 0) {
        this.fixturesFull++;
      }
    }
  }

  /** Every fixture full and no wet pipe leaking. Dry pipes never leak, and may stay dry. */
  won(fault: PipeBoardFault | null): boolean {
    const allFull = this.fixturesFull === this.geometry.fixtureCells.length;
    const leaks = fault === 'win-counts-dry-ends' ? this.leaks + this.dryOpenEnds() : this.leaks;
    const noLeaks = fault === 'win-ignores-leaks' || leaks === 0;
    return allFull && noLeaks;
  }

  /** Unmatched open ends on dry pipes: what a win check that forgot dry pipes never leak would count. */
  private dryOpenEnds(): number {
    const masks = this.lastMasks;
    if (masks === null) return 0;
    const { neighbour, portSides, cellCount } = this.geometry;
    let ends = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      if (this.distance[cell] >= 0) continue;
      for (let side = 0; side < SIDE_COUNT; side++) {
        const bit = 1 << side;
        if ((masks[cell] & bit) === 0) continue;
        const next = neighbour[cell * SIDE_COUNT + side];
        const facing = 1 << ((side + HALF_TURN) & QUARTER_TURN_MASK);
        const matched = next < 0 ? (portSides[cell] & bit) !== 0 : (masks[next] & facing) !== 0;
        if (!matched) ends++;
      }
    }
    return ends;
  }
}

export interface PipeLeak {
  readonly cell: number;
  readonly x: number;
  readonly y: number;
  /** The side of the wet tile the water escapes from. */
  readonly direction: PipeDirection;
  /** True when the open end points at the panel edge rather than at another tile. */
  readonly offBoard: boolean;
}

export interface PipeFlowCounts {
  readonly fixturesFull: number;
  readonly fixturesTotal: number;
  readonly leaks: number;
  readonly wetTiles: number;
}

export interface PipeFlowTrace {
  /** Per cell, row-major. */
  readonly wet: ReadonlyArray<boolean>;
  /** Steps from the main along the flow, per cell; -1 when dry. The flood animation's clock. */
  readonly distance: ReadonlyArray<number>;
  readonly maxDistance: number;
  readonly leaks: ReadonlyArray<PipeLeak>;
  /** Per fixture, in `board.fixtures` order. */
  readonly fixturesFull: ReadonlyArray<boolean>;
  readonly counts: PipeFlowCounts;
  readonly won: boolean;
}

/** Where the water is on the board as it stands, and whether that is a win. */
export function traceFlow(board: PipeBoard, options: PipeBoardOptions = {}): PipeFlowTrace {
  const geometry = compile(board);
  const masks = boardMasks(board);
  const flow = new FlowRun(geometry);
  flow.run(masks);
  const distance = Array.from(flow.distance);
  const leaks: PipeLeak[] = [];
  distance.forEach((steps, cell) => {
    if (steps < 0) return;
    for (let side = 0; side < SIDE_COUNT; side++) {
      const bit = 1 << side;
      if ((masks[cell] & bit) === 0) continue;
      const next = geometry.neighbour[cell * SIDE_COUNT + side];
      const offBoard = next < 0;
      const facing = 1 << ((side + HALF_TURN) & QUARTER_TURN_MASK);
      const leaking = offBoard
        ? (geometry.portSides[cell] & bit) === 0
        : (masks[next] & facing) === 0;
      if (!leaking) continue;
      const { x, y } = cellCoord(board.size, cell);
      leaks.push({ cell, x, y, direction: PIPE_DIRECTIONS[side], offBoard });
    }
  });
  const fixturesFull = Array.from(geometry.fixtureCells, (cell, index) => {
    return distance[cell] >= 0 && (masks[cell] & geometry.fixtureSideBits[index]) !== 0;
  });
  return {
    wet: distance.map((steps) => steps >= 0),
    distance,
    maxDistance: Math.max(-1, ...distance),
    leaks,
    fixturesFull,
    counts: {
      fixturesFull: flow.fixturesFull,
      fixturesTotal: geometry.fixtureCells.length,
      leaks: flow.leaks,
      wetTiles: flow.wetTiles,
    },
    won: flow.won(options.fault ?? null),
  };
}

// ── Tiers ────────────────────────────────────────────────────────────────────

export interface PipeBoardTier {
  readonly size: number;
  readonly fixtures: number;
  /** Tiles shown pre-solved and bolted in place. */
  readonly hintTiles: number;
  /** Whether a board the local rules alone finish is acceptable. */
  readonly localOnlySolvesAllowed: boolean;
  readonly minGlobalDeductions: number;
  /** Nested hypotheses the graded solve must need, at least. */
  readonly minHypothesisDepth: number;
  /** Of {@link FOLLOW_THE_WATER_RUNS} seeded runs, how many may win. */
  readonly followTheWaterWinsAllowed: number;
  /** Fewest clockwise quarter turns from the scramble to the answer. */
  readonly minQuarterTurns: number;
  /** Longest run of collinear straights in the answer. */
  readonly maxStraightRun: number;
  /** Tees in the answer network, at least. */
  readonly minTees: number;
  /** Share of the tiles the answer network keeps; the rest are decoys. */
  readonly networkShare: number;
}

/** Tuned by playtest; `normal` is the Nancy Drew circuit-board target. */
export const PIPE_BOARD_TIERS: Readonly<Record<Difficulty, PipeBoardTier>> = {
  easy: {
    size: 5,
    fixtures: 3,
    hintTiles: 2,
    localOnlySolvesAllowed: true,
    minGlobalDeductions: 0,
    minHypothesisDepth: 0,
    followTheWaterWinsAllowed: 3,
    minQuarterTurns: 12,
    maxStraightRun: 3,
    minTees: 3,
    networkShare: 0.8,
  },
  normal: {
    size: 6,
    fixtures: 4,
    hintTiles: 0,
    localOnlySolvesAllowed: false,
    minGlobalDeductions: 2,
    minHypothesisDepth: 0,
    followTheWaterWinsAllowed: 0,
    minQuarterTurns: 24,
    maxStraightRun: 3,
    minTees: 5,
    networkShare: 0.75,
  },
  hard: {
    size: 7,
    fixtures: 5,
    hintTiles: 0,
    localOnlySolvesAllowed: false,
    minGlobalDeductions: 4,
    minHypothesisDepth: 1,
    followTheWaterWinsAllowed: 0,
    minQuarterTurns: 36,
    maxStraightRun: 3,
    minTees: 7,
    networkShare: 0.7,
  },
};

export const PIPE_BOARD_DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];

/** Most of the board that may already be wet on the opening scramble. */
export const START_WET_SHARE_MAX = 0.35;
/** Fixtures must hang on at least this many different edges. */
export const FIXTURE_EDGES_MIN = 2;
/** Cells between two ports, at least (Manhattan): two fixtures never sit on adjacent edge cells. */
export const PORT_SPACING_MIN = 2;
export const CROSSES_MAX = 1;
/** The inlet sits in the middle third of the left edge. */
const INLET_BAND_DIVISOR = 3;

/** The rows the inlet may sit on: the middle third of the left edge. */
export function inletRowRange(size: number): { readonly min: number; readonly max: number } {
  const margin = Math.floor(size / INLET_BAND_DIVISOR);
  return { min: margin, max: size - 1 - margin };
}

// ── Solver ───────────────────────────────────────────────────────────────────

/** Search nodes one solution count may spend before it is given up as unproven. */
export const SOLVER_NODE_BUDGET = 20000;
/** Rule fixpoints one graded solve may spend before it is given up as unproven. */
export const GRADE_WORK_BUDGET = 60000;
/** The deepest nesting of hypotheses the grader tries; a board needing more reports one more. */
export const GRADE_DEPTH_MAX = 2;
const SOLUTION_LIMIT = 2;

/**
 * `FILTER[open << 4 | closed]`: the masks that keep every known-open side open
 * and every known-closed side closed.
 */
const FILTER = (() => {
  const table = new Uint16Array(MASK_VALUES * MASK_VALUES);
  for (let open = 0; open < MASK_VALUES; open++) {
    for (let closed = 0; closed < MASK_VALUES; closed++) {
      let set = 0;
      for (let mask = 0; mask < MASK_VALUES; mask++) {
        if ((mask & open) === open && (mask & closed) === 0) set |= 1 << mask;
      }
      table[(open << SIDE_COUNT) | closed] = set;
    }
  }
  return table;
})();

function andOfMasks(set: number): number {
  let all = ALL_SIDES;
  for (let mask = 0; mask < MASK_VALUES; mask++) if ((set >> mask) & 1) all &= mask;
  return all;
}

function orOfMasks(set: number): number {
  let any = 0;
  for (let mask = 0; mask < MASK_VALUES; mask++) if ((set >> mask) & 1) any |= mask;
  return any;
}

const HIGHEST_BIT_OF_32 = 31;

/** The one mask in a single-mask candidate set. */
function onlyMask(set: number): number {
  return HIGHEST_BIT_OF_32 - Math.clz32(set);
}

/** Each cell's still-possible masks and the sides already known open or closed. */
class SolverState {
  constructor(
    readonly candidates: Uint16Array,
    readonly open: Uint8Array,
    readonly closed: Uint8Array,
  ) {}

  clone(): SolverState {
    return new SolverState(this.candidates.slice(), this.open.slice(), this.closed.slice());
  }
}

/** The two sides that visit every interior edge once. */
const FORWARD_SIDES: ReadonlyArray<number> = [EAST, SOUTH];

const CONTRADICTION = -1;
/**
 * The candidate bit for "this tile stays dry": mask 0, no open end. A dry
 * tile's real rotation never matters, since water only crosses a join where
 * both ends are open and the network's ends toward a dry tile are closed.
 */
const DRY_CANDIDATE = 1;

type ReduceOutcome = 'contradiction' | 'solved' | 'stalled';

interface GradeStats {
  globalDeductions: number;
  hypothesisDepth: number;
}

/** The solver's machinery for one layout: propagation queue, union-find and bridge buffers. */
class SolverEngine {
  private readonly queue: Int16Array;
  private readonly queued: Uint8Array;
  private queueHead = 0;
  private queueLength = 0;
  private readonly parent: Int16Array;
  /** Per union-find root: the main and fixtures its group already reaches. */
  private readonly componentPorts: Int16Array;
  /** Ports on each cell: the main and the fixtures it faces. */
  private readonly portCount: Uint8Array;
  private readonly portsTotal: number;
  /** Per union-find root: open ends its tiles must still show beyond the ones already decided. */
  private readonly componentEndsNeeded: Int16Array;
  private readonly order: Int16Array;
  private readonly low: Int16Array;
  private readonly dryFixture: Uint8Array;
  private readonly pendingCells: Int16Array;
  private readonly pendingSides: Uint8Array;
  private readonly pendingOpen: Uint8Array;
  work = 0;

  constructor(
    readonly geometry: PipeGeometry,
    private readonly fault: PipeBoardFault | null,
  ) {
    const count = geometry.cellCount;
    this.queue = new Int16Array(count);
    this.queued = new Uint8Array(count);
    this.parent = new Int16Array(count);
    this.componentPorts = new Int16Array(count);
    this.portCount = new Uint8Array(count);
    this.portCount[geometry.inletCell]++;
    for (const cell of geometry.fixtureCells) this.portCount[cell]++;
    this.portsTotal = geometry.fixtureCells.length + 1;
    this.componentEndsNeeded = new Int16Array(count);
    this.order = new Int16Array(count);
    this.low = new Int16Array(count);
    this.dryFixture = new Uint8Array(count);
    const islandRulingsMax = count * FORWARD_SIDES.length;
    const bridgeRulingsMax = count;
    const pendingCapacity = islandRulingsMax + bridgeRulingsMax;
    this.pendingCells = new Int16Array(pendingCapacity);
    this.pendingSides = new Uint8Array(pendingCapacity);
    this.pendingOpen = new Uint8Array(pendingCapacity);
  }

  initialState(): SolverState {
    const { geometry } = this;
    const count = geometry.cellCount;
    const candidates = new Uint16Array(count);
    const open = new Uint8Array(count);
    const closed = new Uint8Array(count);
    for (let cell = 0; cell < count; cell++) {
      const turned =
        geometry.bolted[cell] === 1 ? 1 << geometry.scramble[cell] : geometry.kindSets[cell];
      candidates[cell] = turned | DRY_CANDIDATE;
      open[cell] = geometry.portSides[cell];
      closed[cell] = geometry.boundarySides[cell] & ~geometry.portSides[cell];
    }
    this.clearQueue();
    for (let cell = 0; cell < count; cell++) this.enqueue(cell);
    return new SolverState(candidates, open, closed);
  }

  enqueue(cell: number): void {
    if (this.queued[cell] === 1) return;
    this.queued[cell] = 1;
    this.queue[(this.queueHead + this.queueLength) % this.queue.length] = cell;
    this.queueLength++;
  }

  private dequeue(): number {
    const cell = this.queue[this.queueHead];
    this.queueHead = (this.queueHead + 1) % this.queue.length;
    this.queueLength--;
    this.queued[cell] = 0;
    return cell;
  }

  private clearQueue(): void {
    while (this.queueLength > 0) this.dequeue();
  }

  /** Decides one side of `cell` and the matching side of its neighbour. */
  private setSide(state: SolverState, cell: number, side: number, open: boolean): boolean {
    const bit = 1 << side;
    if (!this.markSide(state, cell, bit, open)) return false;
    const next = this.geometry.neighbour[cell * SIDE_COUNT + side];
    if (next < 0) return true;
    const facing = 1 << ((side + HALF_TURN) & QUARTER_TURN_MASK);
    return this.markSide(state, next, facing, open);
  }

  private markSide(state: SolverState, cell: number, bit: number, open: boolean): boolean {
    const known = open ? state.open : state.closed;
    const opposite = open ? state.closed : state.open;
    if ((opposite[cell] & bit) !== 0) return false;
    if ((known[cell] & bit) !== 0) return true;
    known[cell] |= bit;
    this.enqueue(cell);
    return true;
  }

  /** The local rules to a fixpoint: filter each cell's masks, then decide the sides they agree on. */
  propagate(state: SolverState): boolean {
    this.work++;
    const { candidates, open, closed } = state;
    while (this.queueLength > 0) {
      const cell = this.dequeue();
      const filtered = candidates[cell] & FILTER[(open[cell] << SIDE_COUNT) | closed[cell]];
      if (filtered === 0) {
        this.clearQueue();
        return false;
      }
      candidates[cell] = filtered;
      const decidedOpen = andOfMasks(filtered) & ~open[cell];
      const decidedClosed = ~orOfMasks(filtered) & ALL_SIDES & ~closed[cell];
      for (let side = 0; side < SIDE_COUNT; side++) {
        const bit = 1 << side;
        const decided =
          (decidedOpen & bit) !== 0
            ? this.setSide(state, cell, side, true)
            : (decidedClosed & bit) !== 0
              ? this.setSide(state, cell, side, false)
              : true;
        if (!decided) {
          this.clearQueue();
          return false;
        }
      }
    }
    return true;
  }

  private find(cell: number): number {
    let root = cell;
    while (this.parent[root] !== root) root = this.parent[root];
    let walk = cell;
    while (this.parent[walk] !== root) {
      const up = this.parent[walk];
      this.parent[walk] = root;
      walk = up;
    }
    return root;
  }

  private buildOpenComponents(state: SolverState): void {
    const count = this.geometry.cellCount;
    for (let cell = 0; cell < count; cell++) {
      this.parent[cell] = cell;
      this.componentEndsNeeded[cell] = 0;
      this.componentPorts[cell] = 0;
    }
    for (let cell = 0; cell < count; cell++) {
      for (const side of FORWARD_SIDES) {
        if ((state.open[cell] & (1 << side)) === 0) continue;
        const next = this.geometry.neighbour[cell * SIDE_COUNT + side];
        if (next < 0) continue;
        const a = this.find(cell);
        const b = this.find(next);
        if (a !== b) this.parent[a] = b;
      }
    }
    for (let cell = 0; cell < count; cell++) {
      const root = this.find(cell);
      this.componentEndsNeeded[root] += this.geometry.degree[cell] - popcount4(state.open[cell]);
      this.componentPorts[root] += this.portCount[cell];
    }
  }

  /** Every tile with an open end joined to the main by decided-open edges. */
  networkConnected(state: SolverState): boolean {
    this.buildOpenComponents(state);
    const inletRoot = this.find(this.geometry.inletCell);
    for (let cell = 0; cell < this.geometry.cellCount; cell++) {
      if (state.open[cell] !== 0 && this.find(cell) !== inletRoot) return false;
    }
    return true;
  }

  /**
   * The global rules, applied once from one snapshot. Returns the number of
   * sides they decided, or {@link CONTRADICTION}.
   *
   * - No closed island: a group of joined pipes with no open end left is the
   *   whole wet network, so it must hold the main and every fixture. Opening
   *   an edge that would seal a group short of that is ruled out, so the edge
   *   is closed; a group already sealed short of it is a contradiction.
   * - Fixture reachability: an undecided edge whose closing would cut every
   *   route between the main and a still-dry fixture must be open.
   * - Cut off means dry: a tile no still-possible route joins to the main can
   *   never be wet, so it is dry and its neighbours' ends toward it close.
   *
   * There is no "no loop" rule: the win check allows loops, so ruling them
   * out would let a looped board the player could win go uncounted.
   */
  applyGlobalRules(state: SolverState): number {
    if (this.fault === 'solver-skips-global-rules') return 0;
    const { geometry } = this;
    const count = geometry.cellCount;
    this.buildOpenComponents(state);
    let pending = 0;
    for (let cell = 0; cell < count; cell++) {
      const root = this.find(cell);
      const sealed = root === cell && this.componentEndsNeeded[root] === 0;
      if (sealed && this.componentPorts[root] < this.portsTotal) return CONTRADICTION;
    }
    for (let cell = 0; cell < count; cell++) {
      const unknown = ALL_SIDES & ~(state.open[cell] | state.closed[cell]);
      for (const side of FORWARD_SIDES) {
        if ((unknown & (1 << side)) === 0) continue;
        const next = geometry.neighbour[cell * SIDE_COUNT + side];
        if (next < 0) continue;
        const a = this.find(cell);
        const b = this.find(next);
        const sameGroup = a === b;
        const endsNeededAfterJoin = sameGroup
          ? this.componentEndsNeeded[a] - ENDS_PER_EDGE
          : this.componentEndsNeeded[a] + this.componentEndsNeeded[b] - ENDS_PER_EDGE;
        const portsAfterJoin = sameGroup
          ? this.componentPorts[a]
          : this.componentPorts[a] + this.componentPorts[b];
        if (endsNeededAfterJoin === 0 && portsAfterJoin < this.portsTotal) {
          this.pendingCells[pending] = cell;
          this.pendingSides[pending] = side;
          this.pendingOpen[pending] = 0;
          pending++;
        }
      }
    }
    const bridges = this.findFixtureBridges(state, pending);
    if (bridges < 0) return CONTRADICTION;
    pending = bridges;
    let decided = 0;
    for (let cell = 0; cell < count; cell++) {
      if (this.order[cell] >= 0 || state.candidates[cell] === DRY_CANDIDATE) continue;
      if ((state.candidates[cell] & DRY_CANDIDATE) === 0) return CONTRADICTION;
      state.candidates[cell] = DRY_CANDIDATE;
      this.enqueue(cell);
      decided++;
    }
    for (let index = 0; index < pending; index++) {
      const cell = this.pendingCells[index];
      const side = this.pendingSides[index];
      const bit = 1 << side;
      const open = this.pendingOpen[index] === 1;
      const alreadyDecided = ((state.open[cell] | state.closed[cell]) & bit) !== 0;
      if (!this.setSide(state, cell, side, open)) return CONTRADICTION;
      if (!alreadyDecided) decided++;
    }
    return decided;
  }

  /**
   * Appends to the pending list (as "open") every undecided edge whose closing
   * would cut every route between the main and a still-dry fixture: a bridge
   * of the open-or-undecided graph with such a fixture beyond it. Returns the
   * new length, or {@link CONTRADICTION} when a dry fixture is already cut off.
   */
  private findFixtureBridges(state: SolverState, pending: number): number {
    const { geometry, order, low, dryFixture } = this;
    const inletRoot = this.find(geometry.inletCell);
    dryFixture.fill(0);
    for (const cell of geometry.fixtureCells) {
      if (this.find(cell) !== inletRoot) dryFixture[cell] = 1;
    }
    order.fill(-1);
    let clock = 0;
    let length = pending;
    const passable = (cell: number, side: number): boolean =>
      (state.closed[cell] & (1 << side)) === 0 && geometry.neighbour[cell * SIDE_COUNT + side] >= 0;
    const visit = (cell: number, cameFrom: number): boolean => {
      order[cell] = clock;
      low[cell] = clock;
      clock++;
      let holdsDryFixture = dryFixture[cell] === 1;
      for (let side = 0; side < SIDE_COUNT; side++) {
        if (side === cameFrom || !passable(cell, side)) continue;
        const next = geometry.neighbour[cell * SIDE_COUNT + side];
        if (order[next] < 0) {
          const beyondHoldsDryFixture = visit(next, (side + HALF_TURN) & QUARTER_TURN_MASK);
          holdsDryFixture ||= beyondHoldsDryFixture;
          low[cell] = Math.min(low[cell], low[next]);
          const isBridge = low[next] > order[cell];
          const undecided = (state.open[cell] & (1 << side)) === 0;
          if (isBridge && undecided && beyondHoldsDryFixture) {
            this.pendingCells[length] = cell;
            this.pendingSides[length] = side;
            this.pendingOpen[length] = 1;
            length++;
          }
        } else {
          low[cell] = Math.min(low[cell], order[next]);
        }
      }
      return holdsDryFixture;
    };
    visit(geometry.inletCell, -1);
    for (const cell of geometry.fixtureCells) {
      if (order[cell] < 0) return CONTRADICTION;
    }
    return length;
  }

  solved(state: SolverState): boolean {
    const count = this.geometry.cellCount;
    for (let cell = 0; cell < count; cell++) {
      if ((state.open[cell] | state.closed[cell]) !== ALL_SIDES) return false;
    }
    return true;
  }

  /** The undecided cell with the fewest masks left, or -1 when every cell is decided. */
  branchCell(state: SolverState): number {
    let best = -1;
    let bestCount = MASK_VALUES + 1;
    for (let cell = 0; cell < this.geometry.cellCount; cell++) {
      const options = popcount16(state.candidates[cell]);
      if (options > 1 && options < bestCount) {
        best = cell;
        bestCount = options;
      }
    }
    return best;
  }

  /** Local and global rules to a fixpoint, then hypotheses nested up to `maxDepth`. */
  reduce(state: SolverState, maxDepth: number, stats: GradeStats | null): ReduceOutcome {
    for (;;) {
      if (this.work > GRADE_WORK_BUDGET) return 'stalled';
      if (!this.propagate(state)) return 'contradiction';
      const deduced = this.applyGlobalRules(state);
      if (deduced === CONTRADICTION) return 'contradiction';
      if (deduced > 0) {
        if (stats !== null) stats.globalDeductions += deduced;
        continue;
      }
      if (this.solved(state)) return this.networkConnected(state) ? 'solved' : 'contradiction';
      let eliminated = false;
      for (let depth = 1; depth <= maxDepth && !eliminated; depth++) {
        eliminated = this.eliminateByHypothesis(state, depth);
        if (eliminated && stats !== null) {
          stats.hypothesisDepth = Math.max(stats.hypothesisDepth, depth);
        }
      }
      if (!eliminated) return 'stalled';
    }
  }

  /** Assumes one mask for one cell; when that reduces to a contradiction, removes it. */
  private eliminateByHypothesis(state: SolverState, depth: number): boolean {
    for (let cell = 0; cell < this.geometry.cellCount; cell++) {
      const set = state.candidates[cell];
      if (popcount16(set) <= 1) continue;
      for (let mask = 0; mask < MASK_VALUES; mask++) {
        if (((set >> mask) & 1) === 0) continue;
        if (this.work > GRADE_WORK_BUDGET) return false;
        const trial = state.clone();
        trial.candidates[cell] = 1 << mask;
        this.clearQueue();
        this.enqueue(cell);
        if (this.reduce(trial, depth - 1, null) === 'contradiction') {
          state.candidates[cell] = set & ~(1 << mask);
          this.clearQueue();
          this.enqueue(cell);
          return true;
        }
      }
    }
    this.clearQueue();
    return false;
  }
}

export interface PipeSolveResult {
  /** Winning wet networks, counted up to two. */
  readonly solutionCount: number;
  /** True when the node budget ran out before the count was proven. */
  readonly exhausted: boolean;
  /** The first solution's network: each tile's mask, 0 for a dry tile, row-major. */
  readonly solution: Uint8Array | null;
  readonly nodes: number;
}

/**
 * Counts the wet networks that win: each tile is either in the network with
 * one of its rotations or dry, every rotation unknown except bolted tiles,
 * loops included. Two arrangements that differ only in how dry tiles are
 * turned are one network, and a straight's two symmetric rotations are one
 * rotation.
 */
export function countPipeSolutions(
  layout: PipeBoardLayout,
  options: PipeBoardOptions = {},
): PipeSolveResult {
  const fault = options.fault ?? null;
  const limit = fault === 'uniqueness-stops-at-one' ? 1 : SOLUTION_LIMIT;
  const engine = new SolverEngine(compile(layout), fault);
  let nodes = 0;
  let found = 0;
  let exhausted = false;
  let solution: Uint8Array | null = null;

  const search = (state: SolverState): void => {
    if (nodes >= SOLVER_NODE_BUDGET) {
      exhausted = true;
      return;
    }
    nodes++;
    for (;;) {
      if (!engine.propagate(state)) return;
      const deduced = engine.applyGlobalRules(state);
      if (deduced === CONTRADICTION) return;
      if (deduced === 0) break;
    }
    const cell = engine.branchCell(state);
    if (cell < 0) {
      if (!engine.networkConnected(state)) return;
      found++;
      solution ??= Uint8Array.from(state.candidates, onlyMask);
      return;
    }
    const set = state.candidates[cell];
    for (let mask = 0; mask < MASK_VALUES; mask++) {
      if (((set >> mask) & 1) === 0) continue;
      const child = state.clone();
      child.candidates[cell] = 1 << mask;
      engine.enqueue(cell);
      search(child);
      if (found >= limit || exhausted) return;
    }
  };

  search(engine.initialState());
  return { solutionCount: found, exhausted, solution, nodes };
}

export interface PipeGradeResult {
  /** The local rules alone, from the opening state, decided every tile. */
  readonly localOnlySolves: boolean;
  /** Sides decided by the global rules on the main line of the solve. */
  readonly globalDeductions: number;
  /**
   * The deepest nesting of hypotheses the solve needed once the rules stalled.
   * {@link GRADE_DEPTH_MAX} + 1 when even that depth stalled.
   */
  readonly hypothesisDepth: number;
  /** The graded solve reached the solution. */
  readonly resolved: boolean;
  /** True when the work budget ran out before the grade was proven. */
  readonly exhausted: boolean;
  readonly work: number;
}

/**
 * Solves the way a person does: the local rules first, the global rules when
 * those stall, and a hypothesis (assume a tile's rotation, look for a
 * contradiction) only when both stall.
 */
export function gradePipeBoard(
  layout: PipeBoardLayout,
  options: PipeBoardOptions = {},
): PipeGradeResult {
  const engine = new SolverEngine(compile(layout), options.fault ?? null);
  const state = engine.initialState();
  if (!engine.propagate(state)) {
    return {
      localOnlySolves: false,
      globalDeductions: 0,
      hypothesisDepth: 0,
      resolved: false,
      exhausted: false,
      work: engine.work,
    };
  }
  const localOnlySolves = engine.solved(state) && engine.networkConnected(state);
  const stats: GradeStats = { globalDeductions: 0, hypothesisDepth: 0 };
  const outcome = engine.reduce(state, GRADE_DEPTH_MAX, stats);
  const exhausted = engine.work > GRADE_WORK_BUDGET;
  return {
    localOnlySolves,
    globalDeductions: stats.globalDeductions,
    hypothesisDepth: outcome === 'stalled' ? GRADE_DEPTH_MAX + 1 : stats.hypothesisDepth,
    resolved: outcome === 'solved',
    exhausted,
    work: engine.work,
  };
}

// ── Simulated players ────────────────────────────────────────────────────────

export const FOLLOW_THE_WATER_RUNS = 20;
/**
 * Score weights for the follow-the-water player: a full fixture outweighs
 * everything, a leak costs, and each step the water still has to go to reach
 * a dry fixture costs a little.
 */
export const FIXTURE_WEIGHT = 10;
export const LEAK_WEIGHT = 3;
export const REACH_WEIGHT = 1;
/** Turns the follow-the-water player takes before it is judged stuck, per tile on the board. */
const PLAYER_STEPS_PER_TILE = 3;
export const RANDOM_TURN_PLAYER_TURNS = 5000;
const PLAYER_SEED_BASE = 0x9195;
const RANDOM_PLAYER_SEED = 0x7a9;

export interface PipePlayerResult {
  readonly won: boolean;
  readonly turns: number;
}

/** The seed of the `run`th follow-the-water run. */
export function followTheWaterSeed(run: number): number {
  return mixSeed(PLAYER_SEED_BASE, run);
}

function stateKey(masks: Uint8Array): string {
  return String.fromCharCode(...masks);
}

/**
 * The strategy that beats a board with no global rules, played well. It sees
 * what the player sees: wet tiles, leaks and dry fixtures, and it steers the
 * water toward the fixtures still dry. Each step it tries
 * every rotation of every turnable tile that is wet or next to a wet tile
 * (the inlet tile counts as next to the water) and keeps the move that scores
 * best, ties broken by the seed. It stops on a win, on a board state it has
 * seen before, or at its step cap.
 */
export function followTheWaterPlayer(
  layout: PipeBoardLayout,
  seed: number,
  options: PipeBoardOptions = {},
): PipePlayerResult {
  const fault = options.fault ?? null;
  if (fault === 'follow-the-water-disabled') return { won: false, turns: 0 };
  const geometry = compile(layout);
  const random = seededStream(seed);
  const masks = scrambleMasks(layout);
  const flow = new FlowRun(geometry);
  const seen = new Set<string>();
  const stepCap = geometry.cellCount * PLAYER_STEPS_PER_TILE;
  const count = geometry.cellCount;
  const considered = new Uint8Array(count);
  const fixtureCoords = layout.fixtures.map((fixture) => fixtureCell(layout.size, fixture));
  const inletCoord = { x: 0, y: layout.inletRow };
  const distanceStillToGo = (): number => {
    let total = 0;
    fixtureCoords.forEach((target, index) => {
      if (flow.distance[geometry.fixtureCells[index]] >= 0) return;
      let nearest = manhattan(inletCoord, target) + 1;
      for (let cell = 0; cell < count; cell++) {
        if (flow.distance[cell] < 0) continue;
        nearest = Math.min(nearest, manhattan(cellCoord(layout.size, cell), target));
      }
      total += nearest;
    });
    return total;
  };
  const scoreNow = (): number =>
    FIXTURE_WEIGHT * flow.fixturesFull -
    LEAK_WEIGHT * flow.leaks -
    REACH_WEIGHT * distanceStillToGo();

  for (let turns = 0; turns <= stepCap; turns++) {
    flow.run(masks);
    if (flow.won(fault)) return { won: true, turns };
    const key = stateKey(masks);
    if (seen.has(key)) return { won: false, turns };
    seen.add(key);

    considered.fill(0);
    considered[geometry.inletCell] = 1;
    for (let cell = 0; cell < count; cell++) {
      if (flow.distance[cell] < 0) continue;
      considered[cell] = 1;
      for (let side = 0; side < SIDE_COUNT; side++) {
        const next = geometry.neighbour[cell * SIDE_COUNT + side];
        if (next >= 0) considered[next] = 1;
      }
    }

    let bestScore = Number.NEGATIVE_INFINITY;
    let bestCell = -1;
    let bestMask = 0;
    let ties = 0;
    for (let cell = 0; cell < count; cell++) {
      if (considered[cell] === 0 || geometry.bolted[cell] === 1) continue;
      const original = masks[cell];
      let tried = 1 << original;
      for (let turn = 1; turn < SIDE_COUNT; turn++) {
        const turned = rotateMask(original, turn);
        if ((tried & (1 << turned)) !== 0) continue;
        tried |= 1 << turned;
        masks[cell] = turned;
        flow.run(masks);
        const score = flow.won(fault) ? Number.POSITIVE_INFINITY : scoreNow();
        if (score > bestScore) {
          bestScore = score;
          bestCell = cell;
          bestMask = turned;
          ties = 1;
        } else if (score === bestScore) {
          ties++;
          if (random() * ties < 1) {
            bestCell = cell;
            bestMask = turned;
          }
        }
      }
      masks[cell] = original;
    }
    if (bestCell < 0) return { won: false, turns };
    masks[bestCell] = bestMask;
  }
  return { won: false, turns: stepCap };
}

/** How many of {@link FOLLOW_THE_WATER_RUNS} seeded runs win, stopping once `stopAbove` is passed. */
export function followTheWaterWins(
  layout: PipeBoardLayout,
  options: PipeBoardOptions & { readonly stopAbove?: number } = {},
): number {
  let wins = 0;
  for (let run = 0; run < FOLLOW_THE_WATER_RUNS; run++) {
    if (followTheWaterPlayer(layout, followTheWaterSeed(run), options).won) wins++;
    if (options.stopAbove !== undefined && wins > options.stopAbove) break;
  }
  return wins;
}

/** Random clockwise turns on random turnable tiles; a sanity check that the win is not loose. */
export function randomTurnPlayer(
  layout: PipeBoardLayout,
  seed: number = RANDOM_PLAYER_SEED,
  options: PipeBoardOptions & { readonly turns?: number } = {},
): PipePlayerResult {
  const fault = options.fault ?? null;
  const geometry = compile(layout);
  const random = seededStream(seed);
  const masks = scrambleMasks(layout);
  const flow = new FlowRun(geometry);
  const turnable: number[] = [];
  for (let cell = 0; cell < geometry.cellCount; cell++) {
    if (geometry.bolted[cell] === 0) turnable.push(cell);
  }
  const cap = options.turns ?? RANDOM_TURN_PLAYER_TURNS;
  if (turnable.length === 0) {
    flow.run(masks);
    return { won: flow.won(fault), turns: 0 };
  }
  for (let turns = 0; turns < cap; turns++) {
    flow.run(masks);
    if (flow.won(fault)) return { won: true, turns };
    const cell = turnable[Math.floor(random() * turnable.length)];
    masks[cell] = rotateMask(masks[cell], 1);
  }
  flow.run(masks);
  return { won: flow.won(fault), turns: cap };
}

/**
 * Replays the answer from the opening scramble through {@link turnTile},
 * clockwise only, the way a touch player turns. Proves the board is beatable
 * through the real input.
 */
export function solverPlayer(
  layout: PipeBoardLayout,
  options: PipeBoardOptions = {},
): PipePlayerResult {
  const board = createPipeBoard(layout);
  const answers = compile(layout).answers;
  let turns = 0;
  board.tiles.forEach((tile, cell) => {
    for (let quarter = 0; quarter < SIDE_COUNT; quarter++) {
      if (currentMask(board, cell) === answers[cell]) return;
      if (!turnTile(board, cell, 'clockwise')) return;
      turns++;
    }
  });
  return { won: traceFlow(board, options).won, turns };
}

// ── Shape measures ───────────────────────────────────────────────────────────

/** Sum over the turnable network tiles of the clockwise-only turns from the scramble to the answer. */
export function quarterTurnsToSolve(layout: PipeBoardLayout): number {
  const answers = compile(layout).answers;
  const scramble = compile(layout).scramble;
  let total = 0;
  layout.tiles.forEach((tile, cell) => {
    if (tile.bolted || tile.decoy) return;
    total += Math.max(0, clockwiseTurnsBetween(scramble[cell], answers[cell]));
  });
  return total;
}

/** The longest run of straights lying along one row or column. */
export function longestStraightRunOfMasks(size: number, masks: Uint8Array): number {
  const horizontal = EAST_BIT | WEST_BIT;
  const vertical = NORTH_BIT | SOUTH_BIT;
  let longest = 0;
  for (let line = 0; line < size; line++) {
    let rowRun = 0;
    let columnRun = 0;
    for (let along = 0; along < size; along++) {
      rowRun = masks[cellIndex(size, along, line)] === horizontal ? rowRun + 1 : 0;
      columnRun = masks[cellIndex(size, line, along)] === vertical ? columnRun + 1 : 0;
      longest = Math.max(longest, rowRun, columnRun);
    }
  }
  return longest;
}

/** The longest run of straights lying along one row or column in the answer network. */
export function longestStraightRun(layout: PipeBoardLayout): number {
  return longestStraightRunOfMasks(layout.size, compile(layout).network);
}

export function countKind(layout: PipeBoardLayout, kind: PipeTileKind): number {
  return layout.tiles.filter((tile) => tile.kind === kind).length;
}

/** Tiles of `kind` in the answer network, decoys left out. */
export function countNetworkKind(layout: PipeBoardLayout, kind: PipeTileKind): number {
  return layout.tiles.filter((tile) => !tile.decoy && tile.kind === kind).length;
}

export function isEdgeCell(size: number, cell: number): boolean {
  const { x, y } = cellCoord(size, cell);
  return x === 0 || y === 0 || x === size - 1 || y === size - 1;
}

function manhattan(a: PipeCellCoord, b: PipeCellCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Why the ports, crosses and bolts are not legible, or an empty list. */
export function legibilityProblems(layout: PipeBoardLayout, tier: PipeBoardTier): string[] {
  const problems: string[] = [];
  const { size } = layout;
  if (size !== tier.size) problems.push(`size ${size} (tier ${tier.size})`);
  if (layout.tiles.length !== size * size) problems.push(`${layout.tiles.length} tiles`);
  const band = inletRowRange(size);
  if (layout.inletRow < band.min || layout.inletRow > band.max) {
    problems.push(`inlet row ${layout.inletRow} outside ${band.min}–${band.max}`);
  }
  if (layout.fixtures.length !== tier.fixtures) {
    problems.push(`${layout.fixtures.length} fixtures (tier ${tier.fixtures})`);
  }
  const edges = new Set(layout.fixtures.map((fixture) => fixture.edge));
  if (edges.size < FIXTURE_EDGES_MIN) problems.push(`fixtures on ${edges.size} edge`);
  const ports: PipeCellCoord[] = [{ x: 0, y: layout.inletRow }];
  for (const fixture of layout.fixtures) {
    if (fixture.index < 0 || fixture.index >= size) {
      problems.push(`fixture index ${fixture.index} off the ${fixture.edge} edge`);
      continue;
    }
    const at = fixtureCell(size, fixture);
    if (ports.some((port) => manhattan(port, at) < PORT_SPACING_MIN)) {
      problems.push(`fixture at ${fixture.edge} ${fixture.index} crowds another port`);
    }
    ports.push(at);
  }
  const crosses: number[] = [];
  let hints = 0;
  layout.tiles.forEach((tile, cell) => {
    if (tile.decoy && tile.bolted) problems.push(`decoy at ${cell} is bolted`);
    if (tile.decoy && tile.kind === 'cross') problems.push(`decoy at ${cell} is a cross`);
    if (tile.kind === 'cross') {
      crosses.push(cell);
      if (!tile.bolted) problems.push(`cross at ${cell} is not bolted`);
      return;
    }
    if (!tile.bolted) return;
    hints++;
    if (tileMask(tile.kind, tile.scramble) !== tileMask(tile.kind, tile.answer)) {
      problems.push(`hint tile ${cell} is bolted off its answer`);
    }
  });
  if (crosses.length > CROSSES_MAX) problems.push(`${crosses.length} crosses`);
  for (const cell of crosses) {
    if (isEdgeCell(size, cell)) problems.push(`cross on edge cell ${cell}`);
  }
  if (hints !== tier.hintTiles) problems.push(`${hints} hint tiles (tier ${tier.hintTiles})`);
  return problems;
}

/**
 * Whether the answer network is a tree joining the main to every fixture: its
 * ends all meet, it leaves no port unmet and opens no other boundary side,
 * every network tile is wet in it, and it has one join fewer than tiles.
 */
export function answerIsTree(layout: PipeBoardLayout): boolean {
  const geometry = compile(layout);
  const { network } = geometry;
  let interiorEnds = 0;
  let tiles = 0;
  for (let cell = 0; cell < geometry.cellCount; cell++) {
    const mask = network[cell];
    if (mask === 0) {
      if (geometry.portSides[cell] !== 0) return false;
      continue;
    }
    tiles++;
    if ((mask & geometry.boundarySides[cell]) !== geometry.portSides[cell]) return false;
    for (let side = 0; side < SIDE_COUNT; side++) {
      const bit = 1 << side;
      if ((mask & bit) === 0) continue;
      const next = geometry.neighbour[cell * SIDE_COUNT + side];
      if (next < 0) continue;
      const facing = 1 << ((side + HALF_TURN) & QUARTER_TURN_MASK);
      if ((network[next] & facing) === 0) return false;
      interiorEnds++;
    }
  }
  const joins = interiorEnds / ENDS_PER_EDGE;
  const flow = new FlowRun(geometry);
  flow.run(network);
  return joins === tiles - 1 && flow.wetTiles === tiles && flow.won(null);
}

// ── The contract ─────────────────────────────────────────────────────────────

export type PipeContractRow =
  | 'legible'
  | 'treeShape'
  | 'unique'
  | 'notLocallyTrivial'
  | 'needsGlobalThought'
  | 'needsHypothesis'
  | 'scrambleFar'
  | 'followTheWaterFails'
  | 'randomTurnFails'
  | 'solverWins';

/** Checked in this order; the generator stops at the first failure, the gate checks every row. */
export const PIPE_CONTRACT_ROWS: ReadonlyArray<PipeContractRow> = [
  'legible',
  'treeShape',
  'unique',
  'notLocallyTrivial',
  'needsGlobalThought',
  'needsHypothesis',
  'scrambleFar',
  'followTheWaterFails',
  'randomTurnFails',
  'solverWins',
];

export interface PipeContractRowResult {
  readonly pass: boolean;
  readonly detail: string;
}

export interface PipeBoardAssessment {
  readonly passed: boolean;
  /** Every row when assessed in full; up to the first failure otherwise. */
  readonly rows: Partial<Record<PipeContractRow, PipeContractRowResult>>;
  readonly firstFailure: PipeContractRow | null;
  readonly solve: PipeSolveResult | null;
  readonly grade: PipeGradeResult | null;
  readonly followTheWaterWins: number | null;
}

export interface PipeAssessOptions extends PipeBoardOptions {
  /** Stop at the first failing row: the generator's mode. The gate assesses in full. */
  readonly stopAtFirstFailure?: boolean;
  /**
   * Stop after this row. The generator judges an answer's structure before it
   * draws a scramble, since the solver never reads a turnable tile's scramble.
   */
  readonly lastRow?: PipeContractRow;
}

/** What is wrong with the opening scramble, or an empty list. */
export function scrambleProblems(layout: PipeBoardLayout, tier: PipeBoardTier): string[] {
  const problems: string[] = [];
  const answers = compile(layout).answers;
  const scramble = compile(layout).scramble;
  const onAnswer = layout.tiles.filter(
    (tile, cell) => !tile.bolted && !tile.decoy && scramble[cell] === answers[cell],
  ).length;
  if (onAnswer > 0) problems.push(`${onAnswer} turnable network tiles start on their answer`);
  const turns = quarterTurnsToSolve(layout);
  if (turns < tier.minQuarterTurns) problems.push(`${turns} turns (min ${tier.minQuarterTurns})`);
  const flow = new FlowRun(compile(layout));
  flow.run(scramble);
  const wetShare = flow.wetTiles / layout.tiles.length;
  if (wetShare > START_WET_SHARE_MAX) {
    problems.push(`${Math.round(wetShare * PERCENT)}% wet at the start`);
  }
  if (flow.fixturesFull > 0) problems.push(`${flow.fixturesFull} fixtures full at the start`);
  return problems;
}

const PERCENT = 100;

/**
 * Checks a layout against its tier's contract. The generator runs this before
 * offering a board, and the gate runs it again in full.
 */
export function assessPipeBoard(
  layout: PipeBoardLayout,
  tier: PipeBoardTier,
  options: PipeAssessOptions = {},
): PipeBoardAssessment {
  const rows: Partial<Record<PipeContractRow, PipeContractRowResult>> = {};
  let firstFailure: PipeContractRow | null = null;
  let solve: PipeSolveResult | null = null;
  let grade: PipeGradeResult | null = null;
  let wins: number | null = null;
  const stopEarly = options.stopAtFirstFailure === true;
  const engineOptions: PipeBoardOptions = { fault: options.fault ?? null };

  const record = (row: PipeContractRow, pass: boolean, detail: string): boolean => {
    rows[row] = { pass, detail };
    if (!pass && firstFailure === null) firstFailure = row;
    return (!pass && stopEarly) || row === options.lastRow;
  };
  const result = (): PipeBoardAssessment => ({
    passed: firstFailure === null,
    rows,
    firstFailure,
    solve,
    grade,
    followTheWaterWins: wins,
  });

  const legibility = legibilityProblems(layout, tier);
  if (record('legible', legibility.length === 0, legibility.join('; ') || 'clean')) {
    return result();
  }

  const run = longestStraightRun(layout);
  const tees = countNetworkKind(layout, 'tee');
  const isTree = answerIsTree(layout);
  if (
    record(
      'treeShape',
      isTree && run <= tier.maxStraightRun && tees >= tier.minTees,
      `${isTree ? 'tree network' : 'NOT a tree network'}, straight run ${run} (max ${tier.maxStraightRun}), ${tees} tees (min ${tier.minTees})`,
    )
  ) {
    return result();
  }

  solve = countPipeSolutions(layout, engineOptions);
  const answers = compile(layout).network;
  const solution = solve.solution;
  const answerIsTheSolution = solution?.every((mask, cell) => mask === answers[cell]) === true;
  const unique = !solve.exhausted && solve.solutionCount === 1 && answerIsTheSolution;
  const solveDetail = solve.exhausted
    ? `search exhausted after ${solve.nodes} nodes`
    : `${solve.solutionCount}${solve.solutionCount >= SOLUTION_LIMIT ? '+' : ''} solutions${answerIsTheSolution ? '' : ', not the answer'}`;
  if (record('unique', unique, solveDetail)) return result();

  grade = gradePipeBoard(layout, engineOptions);
  const graded = unique && !grade.exhausted;
  if (
    record(
      'notLocallyTrivial',
      graded && (tier.localOnlySolvesAllowed || !grade.localOnlySolves),
      grade.exhausted ? 'grade exhausted' : `local rules alone solve: ${grade.localOnlySolves}`,
    )
  ) {
    return result();
  }
  if (
    record(
      'needsGlobalThought',
      graded && grade.globalDeductions >= tier.minGlobalDeductions,
      `${grade.globalDeductions} global deductions (min ${tier.minGlobalDeductions})`,
    )
  ) {
    return result();
  }
  if (
    record(
      'needsHypothesis',
      graded && grade.hypothesisDepth >= tier.minHypothesisDepth,
      `hypothesis depth ${grade.hypothesisDepth} (min ${tier.minHypothesisDepth})`,
    )
  ) {
    return result();
  }

  const scramble = scrambleProblems(layout, tier);
  if (
    record(
      'scrambleFar',
      scramble.length === 0,
      scramble.join('; ') || `${quarterTurnsToSolve(layout)} turns`,
    )
  ) {
    return result();
  }

  wins = followTheWaterWins(
    layout,
    stopEarly ? { ...engineOptions, stopAbove: tier.followTheWaterWinsAllowed } : engineOptions,
  );
  if (
    record(
      'followTheWaterFails',
      wins <= tier.followTheWaterWinsAllowed,
      `won ${wins} of ${FOLLOW_THE_WATER_RUNS} (max ${tier.followTheWaterWinsAllowed})`,
    )
  ) {
    return result();
  }

  const random = randomTurnPlayer(layout, RANDOM_PLAYER_SEED, engineOptions);
  if (
    record(
      'randomTurnFails',
      !random.won,
      random.won ? `won after ${random.turns} turns` : `${random.turns} turns, no win`,
    )
  ) {
    return result();
  }

  const replay = solverPlayer(layout, engineOptions);
  record(
    'solverWins',
    replay.won,
    `${replay.won ? 'won' : 'did not win'} in ${replay.turns} turns`,
  );
  return result();
}
