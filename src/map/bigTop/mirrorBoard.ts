/**
 * The hall of mirrors as a light puzzle: the board, the one light walk, the
 * solver, the two simulated players and the acceptance contract.
 *
 * Pure on purpose. The generator, the gate and the live system all import this
 * module, and none of them may disagree about where the light goes — so there
 * is exactly one walk ({@link traceBoard}), and every other question (the turn
 * preview, the hot span, the solver, the players) is answered by calling it.
 *
 * Board coordinates are the tent's own tiles shifted by
 * {@link MIRROR_BOARD_TENT_ORIGIN}: board `(0, 0)` is the tent's top-left wall
 * tile of the hall, so a board tile maps onto the tent with one addition and
 * nothing is flipped or scaled.
 */

// ── Pieces ───────────────────────────────────────────────────────────────────

export interface BoardTile {
  readonly x: number;
  readonly y: number;
}

export type BoardLane = 'human' | 'cat';
export type LightColour = 'blue' | 'red';
export type BeamHeading = 'north' | 'east' | 'south' | 'west';

/**
 * Which two edges of its tile a mirror's glass connects. Light arriving at one
 * of them leaves by the other; light arriving at either of the other two edges
 * hits the timber back and stops. Spelled the same as the tent's `MirrorFacing`
 * so the two are interchangeable.
 */
export type OpticFacing = 'NE' | 'SE' | 'SW' | 'NW';

export type BoardMirrorKind = 'pivot_mirror' | 'swivel_mirror';

/**
 * The line a splitter's half-silvered pane is set on, drawn as the glyph it
 * looks like: `slash` runs from the tile's south-west corner to its north-east
 * one, `backslash` from the north-west to the south-east.
 */
export type SplitterDiagonal = 'slash' | 'backslash';

/**
 * `twin` wants both lights at once; `encore` is the optional gold star, lit by
 * either light, that the act does not need.
 */
export type BoardStarKind = 'blue' | 'red' | 'twin' | 'encore';

/**
 * What a star is showing. `half` is a twin with one of its two lights; `fizzle`
 * is a coloured star with only the wrong light on it — the sputter that tells a
 * player the star noticed the light and refused it.
 */
export type StarStatus = 'dark' | 'lit' | 'half' | 'fizzle';

/**
 * The difficulty a board is generated for. Spelled out here rather than
 * imported, because the module that owns `Difficulty` reads live settings; the
 * gate proves the two unions are the same.
 */
export type MirrorBoardDifficulty = 'easy' | 'normal' | 'hard';

export interface BoardLimelight {
  readonly colour: LightColour;
  readonly lane: BoardLane;
  /** A tile in the lane's outer wall. */
  readonly tile: BoardTile;
  readonly heading: BeamHeading;
}

export interface BoardMirror {
  readonly id: string;
  readonly kind: BoardMirrorKind;
  /** The crawler whose blows turn it: always the lane its tile is in. */
  readonly owner: BoardLane;
  readonly tile: BoardTile;
  /** Facings one blow at a time; a blow advances one step and wraps. */
  readonly cycle: ReadonlyArray<OpticFacing>;
  readonly initialIndex: number;
  /**
   * Its place in the arrangement the generator built the board around — not
   * necessarily the only answer, and never shown to the player. A decoy's is
   * its starting index.
   */
  readonly solutionIndex: number;
}

export interface BoardSplitter {
  readonly tile: BoardTile;
  readonly diagonal: SplitterDiagonal;
}

export interface BoardStar {
  readonly id: string;
  readonly kind: BoardStarKind;
  /** A wall tile: the outer ring, or the divider for the twin. */
  readonly tile: BoardTile;
}

/**
 * One hall of mirrors.
 *
 * The outer ring of tiles and the divider column are wall; every other tile is
 * floor unless a piece stands on it. Windows are the divider tiles light can
 * pass.
 */
export interface MirrorBoard {
  readonly width: number;
  readonly height: number;
  readonly dividerX: number;
  /** The floor tile each crawler steps onto first. */
  readonly entries: Readonly<Record<BoardLane, BoardTile>>;
  /** The floor tile at the foot of each lane's exit gate. */
  readonly exits: Readonly<Record<BoardLane, BoardTile>>;
  readonly limelights: ReadonlyArray<BoardLimelight>;
  readonly mirrors: ReadonlyArray<BoardMirror>;
  readonly splitters: ReadonlyArray<BoardSplitter>;
  readonly windows: ReadonlyArray<BoardTile>;
  readonly stars: ReadonlyArray<BoardStar>;
  readonly pillars: ReadonlyArray<BoardTile>;
}

// ── The hall's frame in the tent ─────────────────────────────────────────────

/** The tent tile that board `(0, 0)` sits on: the hall's west wall, on the row the exit gates are cut into. */
export const MIRROR_BOARD_TENT_ORIGIN: BoardTile = { x: 4, y: 19 };
/** Outer wall to outer wall, both walls included. */
export const MIRROR_BOARD_WIDTH = 36;
/** Gate-row wall, twelve floor rows, and the wall with the doorways in. */
export const MIRROR_BOARD_HEIGHT = 14;
/** The dividing wall between Carl's lane (west) and Donut's (east). */
export const MIRROR_BOARD_DIVIDER_X = 17;
/** The floor tile beneath each lane's exit gate (`<` and `>` in the tent). */
export const MIRROR_BOARD_EXITS: Readonly<Record<BoardLane, BoardTile>> = {
  human: { x: 11, y: 1 },
  cat: { x: 24, y: 1 },
};
/**
 * The floor tile inside each lane's doorway in the bottom wall, lined up with
 * the lane's curtain from the menagerie so the walk up from it runs straight.
 */
export const MIRROR_BOARD_ENTRIES: Readonly<Record<BoardLane, BoardTile>> = {
  human: { x: 14, y: 12 },
  cat: { x: 20, y: 12 },
};

/**
 * Bottom-wall tiles no hall star may sit on: the ones directly above the
 * teaching strip's glass, whose frames rise into the wall row and would hide
 * a star plate there. Board tiles, like everything in this module.
 */
export const WALL_TILES_ABOVE_TEACHING_GLASS: ReadonlyArray<BoardTile> = [
  { x: 5, y: MIRROR_BOARD_HEIGHT - 1 },
  { x: 30, y: MIRROR_BOARD_HEIGHT - 1 },
];

/** Whether a board of the hall's own frame reserves this tile from stars. */
export function isReservedStarTile(board: MirrorBoard, tile: BoardTile): boolean {
  const onHallFrame = board.width === MIRROR_BOARD_WIDTH && board.height === MIRROR_BOARD_HEIGHT;
  return (
    onHallFrame &&
    WALL_TILES_ABOVE_TEACHING_GLASS.some(
      (reserved) => reserved.x === tile.x && reserved.y === tile.y,
    )
  );
}

/** The tent tile a board tile stands on. */
export function boardTileToTent(tile: BoardTile): BoardTile {
  return { x: tile.x + MIRROR_BOARD_TENT_ORIGIN.x, y: tile.y + MIRROR_BOARD_TENT_ORIGIN.y };
}

/** The board tile under a tent tile; outside the board when the tent tile is outside the hall. */
export function tentTileToBoard(tile: BoardTile): BoardTile {
  return { x: tile.x - MIRROR_BOARD_TENT_ORIGIN.x, y: tile.y - MIRROR_BOARD_TENT_ORIGIN.y };
}

/** The lane a board column belongs to; the divider column itself counts as neither and reads as the cat's. */
export function laneOfColumn(board: Pick<MirrorBoard, 'dividerX'>, x: number): BoardLane {
  return x < board.dividerX ? 'human' : 'cat';
}

/** The first optic on each limelight's ray must be a mirror no further than this from the lens. */
export const FIRST_MIRROR_MAX_TILES = 5;

// ── Tiers ────────────────────────────────────────────────────────────────────

/**
 * How much a board asks for one difficulty.
 *
 * The pieces follow from the stars: every light with two stars to reach needs a
 * splitter, and every coloured star sits in the other crawler's lane, so each
 * light that has one needs a window to cross by.
 */
export interface MirrorBoardTier {
  /** A twin star in the divider, lit by both lights at once. */
  readonly twin: boolean;
  /** A red star in Carl's lane. The blue star in Donut's lane is on every tier. */
  readonly redStar: boolean;
  /**
   * Mirrors per leg of a light's route: from the lens, or from a splitter, to
   * the star that leg ends on, windows included.
   */
  readonly maxTurnsPerLeg: number;
  readonly decoyMirrorsPerLane: number;
  readonly pillars: number;
  /** The fewest blows that solve the board from its starting arrangement. */
  readonly minBlows: number;
  /** Solving arrangements over all arrangements, at most. */
  readonly solvingShareMax: number;
  /** Of {@link TUNE_PLAYER_RUNS} seeded "tune each mirror" runs, how many may win. */
  readonly tuneWinsAllowed: number;
}

export const MIRROR_BOARD_TIERS: Readonly<Record<MirrorBoardDifficulty, MirrorBoardTier>> = {
  easy: {
    twin: false,
    redStar: true,
    maxTurnsPerLeg: 3,
    decoyMirrorsPerLane: 0,
    pillars: 0,
    minBlows: 4,
    solvingShareMax: 0.02,
    tuneWinsAllowed: 10,
  },
  normal: {
    twin: true,
    redStar: false,
    maxTurnsPerLeg: 2,
    decoyMirrorsPerLane: 1,
    pillars: 2,
    minBlows: 6,
    solvingShareMax: 0.005,
    tuneWinsAllowed: 0,
  },
  hard: {
    twin: true,
    redStar: true,
    maxTurnsPerLeg: 3,
    decoyMirrorsPerLane: 2,
    pillars: 3,
    minBlows: 10,
    solvingShareMax: 0.002,
    tuneWinsAllowed: 0,
  },
};

export const MIRROR_BOARD_DIFFICULTIES: ReadonlyArray<MirrorBoardDifficulty> = [
  'easy',
  'normal',
  'hard',
];

/** Seeded runs of the "tune each mirror" player per assessment. */
export const TUNE_PLAYER_RUNS = 20;
/** Sweeps over every mirror before the tune player is judged stuck. */
const TUNE_PLAYER_MAX_PASSES = 12;
/** Where the random-swinging player gives up. */
export const RANDOM_SWING_BLOW_CAP = 3000;
/** Search nodes the solver may spend before a board is judged unprovable. */
const SOLVER_NODE_BUDGET = 60000;

// ── Directions and optics as small integers ──────────────────────────────────

const HEADINGS: ReadonlyArray<BeamHeading> = ['north', 'east', 'south', 'west'];
export const HEADING_COUNT = HEADINGS.length;
export const NORTH = 0;
export const EAST = 1;
export const SOUTH = 2;
export const WEST = 3;
export const STEP_X: ReadonlyArray<number> = [0, 1, 0, -1];
export const STEP_Y: ReadonlyArray<number> = [-1, 0, 1, 0];
/** Two quarter turns: the heading straight back. */
const HALF_TURN = 2;
/** Walls on this many sides of a floor tile put it in a lane corner. */
export const CORNER_WALL_SIDES = 2;
/** The index a lookup returns when it finds nothing, and an empty grid reference. */
const NOT_FOUND = -1;

/** Pivot order: each blow is a quarter turn clockwise. */
export const PIVOT_CYCLE: ReadonlyArray<OpticFacing> = ['NE', 'SE', 'SW', 'NW'];
const FACINGS: ReadonlyArray<OpticFacing> = PIVOT_CYCLE;
const FACING_ARMS: ReadonlyArray<readonly [number, number]> = [
  [NORTH, EAST],
  [SOUTH, EAST],
  [SOUTH, WEST],
  [NORTH, WEST],
];
const UNKNOWN_FACING = NOT_FOUND;
const ABSORBED = NOT_FOUND;

export function headingIndex(heading: BeamHeading): number {
  return HEADINGS.indexOf(heading);
}

export function headingAt(index: number): BeamHeading {
  return HEADINGS[((index % HEADING_COUNT) + HEADING_COUNT) % HEADING_COUNT];
}

export function facingIndex(facing: OpticFacing): number {
  return FACINGS.indexOf(facing);
}

export function facingAt(index: number): OpticFacing {
  return FACINGS[index];
}

export function oppositeHeading(heading: number): number {
  return (heading + HALF_TURN) % HEADING_COUNT;
}

/** Where light travelling `heading` leaves a mirror at `facing`, or -1 at its back. */
export function mirrorExit(facing: number, heading: number): number {
  const [armA, armB] = FACING_ARMS[facing];
  const entry = oppositeHeading(heading);
  if (entry === armA) return armB;
  if (entry === armB) return armA;
  return ABSORBED;
}

/** The facing that turns light travelling `inHeading` into `outHeading`, or -1 for a straight line. */
export function facingTurning(inHeading: number, outHeading: number): number {
  const entry = oppositeHeading(inHeading);
  return FACING_ARMS.findIndex(
    ([armA, armB]) =>
      (armA === entry && armB === outHeading) || (armB === entry && armA === outHeading),
  );
}

/** The heading a splitter's reflected branch leaves by; the straight branch keeps `heading`. */
export function splitterReflection(diagonal: SplitterDiagonal, heading: number): number {
  // A slash pane swaps north with east and south with west; a backslash pane
  // swaps north with west and south with east.
  const slashPartner =
    heading === NORTH ? EAST : heading === EAST ? NORTH : heading === SOUTH ? WEST : SOUTH;
  const backslashPartner =
    heading === NORTH ? WEST : heading === WEST ? NORTH : heading === SOUTH ? EAST : SOUTH;
  return diagonal === 'slash' ? slashPartner : backslashPartner;
}

export const BLUE_BIT = 1;
export const RED_BIT = 2;
const BOTH_BITS = BLUE_BIT | RED_BIT;

export function colourBit(colour: LightColour): number {
  return colour === 'blue' ? BLUE_BIT : RED_BIT;
}

function colourOfBit(bit: number): LightColour {
  return bit === BLUE_BIT ? 'blue' : 'red';
}

/** Whether a star of `kind` glows with these colours on it. */
export function starLitBy(kind: BoardStarKind, bits: number): boolean {
  switch (kind) {
    case 'blue':
      return (bits & BLUE_BIT) !== 0;
    case 'red':
      return (bits & RED_BIT) !== 0;
    case 'twin':
      return (bits & BOTH_BITS) === BOTH_BITS;
    case 'encore':
      return bits !== 0;
  }
}

export function starStatus(kind: BoardStarKind, bits: number): StarStatus {
  if (starLitBy(kind, bits)) return 'lit';
  if (bits === 0) return 'dark';
  return kind === 'twin' ? 'half' : 'fizzle';
}

// ── The compiled grid the walk runs on ───────────────────────────────────────

export const CELL_WALL = 0;
export const CELL_FLOOR = 1;
export const CELL_WINDOW = 2;
export const CELL_PILLAR = 3;
export const CELL_MIRROR = 4;
export const CELL_SPLITTER = 5;
export const CELL_STAR = 6;
export const CELL_LIMELIGHT = 7;

/** The visited stamps are 32-bit; clear them before the counter would wrap. */
const STAMP_LIMIT = 0xffffffff;
/** A branch on the walk's stack still carries fire: it has not met an optic since the lens. */
const HOT_BRANCH = 1;
const COLD_BRANCH = 0;

interface CompiledLight {
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  readonly bit: number;
}

/**
 * A board flattened to typed arrays, plus the scratch the walk writes into.
 *
 * The solver and the players walk the light tens of thousands of times per
 * board, so the walk allocates nothing: every result lands in these buffers
 * and is read back before the next walk.
 */
class CompiledBoard {
  readonly cell: Uint8Array;
  readonly ref: Int16Array;
  readonly splitterDiagonal: ReadonlyArray<SplitterDiagonal>;
  readonly cycles: ReadonlyArray<ReadonlyArray<number>>;
  readonly starKinds: ReadonlyArray<BoardStarKind>;
  readonly lights: ReadonlyArray<CompiledLight>;

  private readonly visited: Uint32Array;
  private stamp = 0;
  private readonly stack: number[] = [];

  /** Colour bits on each star after the last walk. */
  readonly starBits: Uint8Array;
  /** 1 for each mirror the last walk reached, whatever its facing. */
  readonly reached: Uint8Array;
  /** Mirrors the last walk stopped at because their facing was unknown, in the order it met them. */
  readonly unknown: number[] = [];
  /** Floor and window tiles the last walk lit, counting a tile once per branch through it. */
  stepCount = 0;

  constructor(readonly board: MirrorBoard) {
    const { width, height } = board;
    const size = width * height;
    this.cell = new Uint8Array(size);
    this.ref = new Int16Array(size).fill(NOT_FOUND);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (x !== board.dividerX) this.cell[y * width + x] = CELL_FLOOR;
      }
    }
    const put = (tile: BoardTile, kind: number, index: number): void => {
      if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) return;
      this.cell[tile.y * width + tile.x] = kind;
      this.ref[tile.y * width + tile.x] = index;
    };
    board.windows.forEach((tile, index) => put(tile, CELL_WINDOW, index));
    board.pillars.forEach((tile, index) => put(tile, CELL_PILLAR, index));
    board.mirrors.forEach((mirror, index) => put(mirror.tile, CELL_MIRROR, index));
    board.splitters.forEach((splitter, index) => put(splitter.tile, CELL_SPLITTER, index));
    board.stars.forEach((star, index) => put(star.tile, CELL_STAR, index));
    board.limelights.forEach((light, index) => put(light.tile, CELL_LIMELIGHT, index));

    this.splitterDiagonal = board.splitters.map((splitter) => splitter.diagonal);
    this.cycles = board.mirrors.map((mirror) => mirror.cycle.map(facingIndex));
    this.starKinds = board.stars.map((star) => star.kind);
    this.lights = board.limelights.map((light) => ({
      x: light.tile.x,
      y: light.tile.y,
      heading: headingIndex(light.heading),
      bit: colourBit(light.colour),
    }));
    this.visited = new Uint32Array(size * HEADING_COUNT);
    this.starBits = new Uint8Array(board.stars.length);
    this.reached = new Uint8Array(board.mirrors.length);
  }

  /** A visited stamp no earlier walk has used, clearing the set before the counter wraps. */
  private freshStamp(): number {
    if (this.stamp >= STAMP_LIMIT) {
      this.visited.fill(0);
      this.stamp = 0;
    }
    this.stamp++;
    return this.stamp;
  }

  /**
   * Walks every limelight until each branch of its light stops.
   *
   * `facings[m]` is mirror `m`'s facing as a facing index, or -1 when it is
   * unknown — the solver's way of asking "where does the light go before it
   * needs this mirror decided". An unknown mirror stops the branch that meets
   * it and is listed in {@link unknown}. A splitter forks the branch; the
   * visited set on (tile, heading) is what keeps a fork from looping forever.
   *
   * Each light gets its own visited set. Shared, a light arriving on a tile
   * and heading the other light already crossed would stop there, and a red
   * beam merging into blue's path through a splitter would silently die.
   */
  walk(facings: ArrayLike<number>, recorder: TraceRecorder | null): void {
    const { width, height } = this.board;
    this.starBits.fill(0);
    this.reached.fill(0);
    this.unknown.length = 0;
    this.stepCount = 0;
    const stack = this.stack;
    stack.length = 0;

    for (const light of this.lights) {
      const stamp = this.freshStamp();
      stack.push(light.x, light.y, light.heading, HOT_BRANCH);
      while (stack.length > 0) {
        const hotFlag = stack.pop() ?? COLD_BRANCH;
        let heading = stack.pop() ?? 0;
        let y = stack.pop() ?? 0;
        let x = stack.pop() ?? 0;
        let hot = hotFlag === HOT_BRANCH;
        for (;;) {
          x += STEP_X[heading];
          y += STEP_Y[heading];
          if (x < 0 || y < 0 || x >= width || y >= height) break;
          const index = y * width + x;
          const visitKey = index * HEADING_COUNT + heading;
          if (this.visited[visitKey] === stamp) break;
          this.visited[visitKey] = stamp;
          const kind = this.cell[index];
          if (kind === CELL_FLOOR || kind === CELL_WINDOW) {
            this.stepCount++;
            recorder?.step(x, y, heading, hot, light.bit);
            continue;
          }
          if (kind === CELL_STAR) {
            this.starBits[this.ref[index]] |= light.bit;
            recorder?.end(x, y, light.bit);
            break;
          }
          if (kind === CELL_MIRROR) {
            const mirror = this.ref[index];
            this.reached[mirror] = 1;
            const facing = facings[mirror];
            if (facing === UNKNOWN_FACING) {
              if (!this.unknown.includes(mirror)) this.unknown.push(mirror);
              break;
            }
            const next = mirrorExit(facing, heading);
            if (next === ABSORBED) break;
            heading = next;
            hot = false;
            continue;
          }
          if (kind === CELL_SPLITTER) {
            const reflected = splitterReflection(this.splitterDiagonal[this.ref[index]], heading);
            stack.push(x, y, reflected, COLD_BRANCH);
            hot = false;
            continue;
          }
          recorder?.end(x, y, light.bit);
          break;
        }
      }
    }
  }
}

interface TraceRecorder {
  step(x: number, y: number, heading: number, hot: boolean, bit: number): void;
  end(x: number, y: number, bit: number): void;
}

const compiledBoards = new WeakMap<MirrorBoard, CompiledBoard>();

function compile(board: MirrorBoard): CompiledBoard {
  const cached = compiledBoards.get(board);
  if (cached !== undefined) return cached;
  const compiled = new CompiledBoard(board);
  compiledBoards.set(board, compiled);
  return compiled;
}

/** The cell kind at a board tile, as the walk sees it. */
export function boardCellAt(board: MirrorBoard, tile: BoardTile): number {
  if (tile.x < 0 || tile.y < 0 || tile.x >= board.width || tile.y >= board.height) return CELL_WALL;
  return compile(board).cell[tile.y * board.width + tile.x];
}

// ── The trace ────────────────────────────────────────────────────────────────

export interface BoardBeamStep {
  readonly tile: BoardTile;
  readonly heading: BeamHeading;
  /** True from the lens to the first optic: fire rather than light. */
  readonly hot: boolean;
  readonly colour: LightColour;
}

/** A wall, pillar or star tile that stopped a branch of the light. */
export interface BoardBeamEnd {
  readonly tile: BoardTile;
  readonly colour: LightColour;
}

export interface BoardStarState {
  readonly starId: string;
  readonly kind: BoardStarKind;
  readonly blue: boolean;
  readonly red: boolean;
  readonly status: StarStatus;
}

export interface BoardTrace {
  readonly steps: ReadonlyArray<BoardBeamStep>;
  readonly ends: ReadonlyArray<BoardBeamEnd>;
  readonly stars: ReadonlyArray<BoardStarState>;
  /** Every non-encore star is lit: the board is solved. */
  readonly solved: boolean;
  /** Mirrors any branch of the light reaches, by index, in board order. */
  readonly reachedMirrors: ReadonlyArray<number>;
}

/** One mirror held at a cycle index other than the arrangement's, for the turn preview. */
export interface MirrorOverride {
  readonly mirrorIndex: number;
  readonly cycleIndex: number;
}

function facingsFor(
  compiled: CompiledBoard,
  cycleIndices: ReadonlyArray<number>,
  override: MirrorOverride | null,
): Int8Array {
  const facings = new Int8Array(compiled.cycles.length);
  compiled.cycles.forEach((cycle, mirror) => {
    const index =
      override !== null && override.mirrorIndex === mirror
        ? override.cycleIndex
        : cycleIndices[mirror];
    facings[mirror] = cycle[((index % cycle.length) + cycle.length) % cycle.length];
  });
  return facings;
}

/**
 * Where every light goes with each mirror at `cycleIndices` (an index into its
 * own cycle), and what every star is showing.
 *
 * This is the one walk. The live beam calls it with the mirrors as they stand;
 * the turn preview calls it with `override` set to the facing the next blow
 * would give one mirror; the gate and the solver reach the same walk through
 * the module's internals. Nothing else in the game may compute where the light
 * goes.
 */
export function traceBoard(
  board: MirrorBoard,
  cycleIndices: ReadonlyArray<number>,
  override: MirrorOverride | null = null,
): BoardTrace {
  const compiled = compile(board);
  const steps: BoardBeamStep[] = [];
  const ends: BoardBeamEnd[] = [];
  compiled.walk(facingsFor(compiled, cycleIndices, override), {
    step: (x, y, heading, hot, bit) =>
      steps.push({ tile: { x, y }, heading: headingAt(heading), hot, colour: colourOfBit(bit) }),
    end: (x, y, bit) => ends.push({ tile: { x, y }, colour: colourOfBit(bit) }),
  });
  const stars = board.stars.map((star, index) => {
    const bits = compiled.starBits[index];
    return {
      starId: star.id,
      kind: star.kind,
      blue: (bits & BLUE_BIT) !== 0,
      red: (bits & RED_BIT) !== 0,
      status: starStatus(star.kind, bits),
    };
  });
  const solved = stars.every((star) => star.kind === 'encore' || star.status === 'lit');
  const reachedMirrors = board.mirrors.flatMap((_, index) =>
    compiled.reached[index] === 1 ? [index] : [],
  );
  return { steps, ends, stars, solved, reachedMirrors };
}

/** The cycle index one more blow turns a mirror to. */
export function nextCycleIndex(mirror: BoardMirror, cycleIndex: number): number {
  return (cycleIndex + 1) % mirror.cycle.length;
}

/** Where the light would go if `mirrorIndex` took one more blow: the turn preview. */
export function traceBoardAfterBlow(
  board: MirrorBoard,
  cycleIndices: ReadonlyArray<number>,
  mirrorIndex: number,
): BoardTrace {
  const mirror = board.mirrors[mirrorIndex];
  return traceBoard(board, cycleIndices, {
    mirrorIndex,
    cycleIndex: nextCycleIndex(mirror, cycleIndices[mirrorIndex]),
  });
}

/**
 * The fire: each limelight's span from the lens to the first optic. Walked with
 * every mirror's facing unknown, so it cannot depend on how anything is turned.
 */
export function boardHotSpan(board: MirrorBoard): ReadonlyArray<BoardBeamStep> {
  const compiled = compile(board);
  const steps: BoardBeamStep[] = [];
  compiled.walk(new Int8Array(board.mirrors.length).fill(UNKNOWN_FACING), {
    step: (x, y, heading, hot, bit) => {
      if (hot)
        steps.push({ tile: { x, y }, heading: headingAt(heading), hot, colour: colourOfBit(bit) });
    },
    end: () => undefined,
  });
  return steps;
}

/** The arrangement the generator built the board around, as a cycle index per mirror. */
export function constructedSolution(board: MirrorBoard): number[] {
  return board.mirrors.map((mirror) => mirror.solutionIndex);
}

export function startingIndices(board: MirrorBoard): number[] {
  return board.mirrors.map((mirror) => mirror.initialIndex);
}

/** Every star but the encore: the ones a solve needs. */
export function requiredStarIds(board: MirrorBoard): string[] {
  return board.stars.filter((star) => star.kind !== 'encore').map((star) => star.id);
}

function goalIndices(board: MirrorBoard, goalStarIds: ReadonlyArray<string> | undefined): number[] {
  const ids = goalStarIds ?? requiredStarIds(board);
  return board.stars.flatMap((star, index) => (ids.includes(star.id) ? [index] : []));
}

function goalsLit(compiled: CompiledBoard, goals: ReadonlyArray<number>): number {
  let lit = 0;
  for (const star of goals) {
    if (starLitBy(compiled.starKinds[star], compiled.starBits[star])) lit++;
  }
  return lit;
}

function cyclicDistance(from: number, to: number, length: number): number {
  return (((to - from) % length) + length) % length;
}

// ── The solver ───────────────────────────────────────────────────────────────

export interface BoardSolveOptions {
  /** The arrangement blows are counted from; the board's starting one when absent. */
  readonly start?: ReadonlyArray<number>;
  /** Stars that must all be lit; every non-encore star when absent. */
  readonly goalStarIds?: ReadonlyArray<string>;
}

export interface BoardSolveResult {
  readonly solvable: boolean;
  /** Arrangements (cycle index per mirror) that light every goal star at once. */
  readonly solvingArrangements: number;
  readonly totalArrangements: number;
  /** Fewest blows from the start to any solving arrangement; null when unsolvable. */
  readonly fewestBlows: number | null;
  /** A solving arrangement reached in the fewest blows. */
  readonly solution: ReadonlyArray<number> | null;
  /** Mirrors that solution's light touches; every other mirror is free. */
  readonly touchedMirrors: number;
  readonly nodes: number;
  /** The search ran out of budget, so a false `solvable` proves nothing. */
  readonly exhausted: boolean;
}

/**
 * Exhaustive, but by following the light rather than enumerating arrangements.
 *
 * Walk with every undecided mirror unknown; branch over the facings of the
 * first unknown mirror the light reaches. Light only ever gains ground as
 * mirrors are decided, so once the goal stars are lit every completion of the
 * remaining mirrors lights them too, and those mirrors are free: they multiply
 * the solving count and cost no blows.
 *
 * Because each mirror cycles on its own, every arrangement is reachable from
 * every other, so "some arrangement lights every goal star" is exactly
 * "solvable from here", and the fewest blows is the least total cyclic
 * distance from the start over the solving arrangements.
 */
export function solveBoard(board: MirrorBoard, options: BoardSolveOptions = {}): BoardSolveResult {
  const compiled = compile(board);
  const goals = goalIndices(board, options.goalStarIds);
  const start = options.start ?? startingIndices(board);
  const mirrorCount = board.mirrors.length;
  const assigned = new Int8Array(mirrorCount).fill(UNKNOWN_FACING);
  const facings = new Int8Array(mirrorCount).fill(UNKNOWN_FACING);
  const totalArrangements = compiled.cycles.reduce((product, cycle) => product * cycle.length, 1);

  const search: {
    solving: number;
    nodes: number;
    exhausted: boolean;
    bestBlows: number;
    bestTouched: number;
    bestSolution: number[] | null;
  } = {
    solving: 0,
    nodes: 0,
    exhausted: false,
    bestBlows: Number.POSITIVE_INFINITY,
    bestTouched: 0,
    bestSolution: null,
  };

  const visit = (): void => {
    if (search.nodes >= SOLVER_NODE_BUDGET) {
      search.exhausted = true;
      return;
    }
    search.nodes++;
    compiled.walk(facings, null);
    if (goals.length > 0 && goalsLit(compiled, goals) === goals.length) {
      let multiplier = 1;
      let blows = 0;
      let touched = 0;
      for (let mirror = 0; mirror < mirrorCount; mirror++) {
        const length = compiled.cycles[mirror].length;
        if (assigned[mirror] === UNKNOWN_FACING) {
          multiplier *= length;
        } else {
          blows += cyclicDistance(start[mirror], assigned[mirror], length);
          touched++;
        }
      }
      search.solving += multiplier;
      if (blows < search.bestBlows) {
        search.bestBlows = blows;
        search.bestTouched = touched;
        search.bestSolution = Array.from(assigned, (index, mirror) =>
          index === UNKNOWN_FACING ? start[mirror] : index,
        );
      }
      return;
    }
    if (compiled.unknown.length === 0) return;
    const mirror = compiled.unknown[0];
    const cycle = compiled.cycles[mirror];
    for (let index = 0; index < cycle.length; index++) {
      assigned[mirror] = index;
      facings[mirror] = cycle[index];
      visit();
    }
    assigned[mirror] = UNKNOWN_FACING;
    facings[mirror] = UNKNOWN_FACING;
  };
  visit();

  const solvable = search.bestSolution !== null;
  return {
    solvable,
    solvingArrangements: search.solving,
    totalArrangements,
    fewestBlows: solvable ? search.bestBlows : null,
    solution: search.bestSolution,
    touchedMirrors: search.bestTouched,
    nodes: search.nodes,
    exhausted: search.exhausted,
  };
}

// ── Simulated players ────────────────────────────────────────────────────────

/** Shift triple of a full-period 32-bit xorshift. */
const XORSHIFT_A = 13;
const XORSHIFT_B = 17;
const XORSHIFT_C = 5;
const UINT32_RANGE = 0x100000000;

/** Constants of a murmur-style 32-bit finaliser. */
const MIX_SALT = 0x9e3779b9;
const MIX_MULTIPLIER_A = 0x85ebca6b;
const MIX_MULTIPLIER_B = 0xc2b2ae35;
const MIX_SHIFT_A = 16;
const MIX_SHIFT_B = 13;

/** A small seeded stream for the players, so a verdict replays exactly. */
export function seededStream(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << XORSHIFT_A;
    state >>>= 0;
    state ^= state >>> XORSHIFT_B;
    state ^= state << XORSHIFT_C;
    state >>>= 0;
    return state / UINT32_RANGE;
  };
}

/** Mixes two integers into a well-spread 32-bit seed. */
export function mixSeed(a: number, b: number): number {
  let hash = Math.imul((a >>> 0) ^ MIX_SALT, MIX_MULTIPLIER_A) >>> 0;
  hash = Math.imul(hash ^ (b >>> 0) ^ (hash >>> MIX_SHIFT_A), MIX_MULTIPLIER_B) >>> 0;
  hash = Math.imul(hash ^ (hash >>> MIX_SHIFT_B), MIX_MULTIPLIER_A) >>> 0;
  return (hash ^ (hash >>> MIX_SHIFT_A)) >>> 0;
}

function shuffleInPlace(items: unknown[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const held = items[index];
    items[index] = items[swap];
    items[swap] = held;
  }
}

export interface PlayerRunResult {
  readonly won: boolean;
  readonly blows: number;
}

export interface PlayerOptions {
  readonly goalStarIds?: ReadonlyArray<string>;
  readonly start?: ReadonlyArray<number>;
}

/**
 * The player who needs no plan: visits the mirrors in a shuffled order and
 * turns each to whichever facing looks best in the preview — more goal stars
 * lit, then more light on the floor — leaving it alone when its current facing
 * is already as good as any. Repeats until a sweep changes nothing.
 *
 * If this player can finish a board, the board is a chore: it proves the turn
 * preview alone answers the puzzle.
 */
export function tuneEachMirrorPlayer(
  board: MirrorBoard,
  seed: number,
  options: PlayerOptions = {},
): PlayerRunResult {
  const compiled = compile(board);
  const goals = goalIndices(board, options.goalStarIds);
  const random = seededStream(seed);
  const indices = Array.from(options.start ?? startingIndices(board));
  const facings = new Int8Array(board.mirrors.length);
  indices.forEach((index, mirror) => (facings[mirror] = compiled.cycles[mirror][index]));
  const order = board.mirrors.map((_, mirror) => mirror);
  let blows = 0;

  const solvedNow = (): boolean => {
    compiled.walk(facings, null);
    return goals.length > 0 && goalsLit(compiled, goals) === goals.length;
  };
  if (solvedNow()) return { won: true, blows };

  for (let pass = 0; pass < TUNE_PLAYER_MAX_PASSES; pass++) {
    shuffleInPlace(order, random);
    let changed = false;
    for (const mirror of order) {
      const cycle = compiled.cycles[mirror];
      const current = indices[mirror];
      let bestLit = NOT_FOUND;
      let bestSteps = NOT_FOUND;
      let tied: number[] = [];
      for (let index = 0; index < cycle.length; index++) {
        facings[mirror] = cycle[index];
        compiled.walk(facings, null);
        const lit = goalsLit(compiled, goals);
        const steps = compiled.stepCount;
        if (lit > bestLit || (lit === bestLit && steps > bestSteps)) {
          bestLit = lit;
          bestSteps = steps;
          tied = [index];
        } else if (lit === bestLit && steps === bestSteps) {
          tied.push(index);
        }
      }
      const choice = tied.includes(current) ? current : tied[Math.floor(random() * tied.length)];
      facings[mirror] = cycle[choice];
      if (choice !== current) {
        blows += cyclicDistance(current, choice, cycle.length);
        indices[mirror] = choice;
        changed = true;
        if (solvedNow()) return { won: true, blows };
      }
    }
    if (!changed) break;
  }
  return { won: false, blows };
}

/** Blows a random mirror at a time until the goal stars light or the cap is reached. */
export function randomSwingPlayer(
  board: MirrorBoard,
  seed: number,
  options: PlayerOptions & { readonly maxBlows?: number } = {},
): PlayerRunResult {
  const compiled = compile(board);
  const goals = goalIndices(board, options.goalStarIds);
  const random = seededStream(seed);
  const indices = Array.from(options.start ?? startingIndices(board));
  const facings = new Int8Array(board.mirrors.length);
  indices.forEach((index, mirror) => (facings[mirror] = compiled.cycles[mirror][index]));
  const cap = options.maxBlows ?? RANDOM_SWING_BLOW_CAP;
  const solvedNow = (): boolean => {
    compiled.walk(facings, null);
    return goals.length > 0 && goalsLit(compiled, goals) === goals.length;
  };
  if (board.mirrors.length === 0) return { won: solvedNow(), blows: 0 };
  for (let blows = 0; blows < cap; blows++) {
    if (solvedNow()) return { won: true, blows };
    const mirror = Math.floor(random() * board.mirrors.length);
    const cycle = compiled.cycles[mirror];
    indices[mirror] = (indices[mirror] + 1) % cycle.length;
    facings[mirror] = cycle[indices[mirror]];
  }
  return { won: solvedNow(), blows: cap };
}

/** The seed of the tune player's `run`-th attempt at a board; fixed so a verdict replays. */
export function tunePlayerSeed(run: number): number {
  return mixSeed(TUNE_PLAYER_SEED_BASE, run);
}
const TUNE_PLAYER_SEED_BASE = 0x7a11e;

/** How many of {@link TUNE_PLAYER_RUNS} seeded tune-player runs win, stopping early once `stopAbove` is passed. */
export function tunePlayerWins(
  board: MirrorBoard,
  options: PlayerOptions & { readonly stopAbove?: number } = {},
): number {
  let wins = 0;
  for (let run = 0; run < TUNE_PLAYER_RUNS; run++) {
    if (tuneEachMirrorPlayer(board, tunePlayerSeed(run), options).won) wins++;
    if (options.stopAbove !== undefined && wins > options.stopAbove) break;
  }
  return wins;
}

// ── The acceptance contract ──────────────────────────────────────────────────

export type ContractRow =
  | 'solvable'
  | 'notPreSolved'
  | 'reachable'
  | 'longEnough'
  | 'nearUnique'
  | 'needsThought'
  | 'windowsLoadBearing'
  | 'splittersLoadBearing'
  | 'encore'
  | 'legible'
  | 'fairHotSpan';

export const CONTRACT_ROWS: ReadonlyArray<ContractRow> = [
  'legible',
  'fairHotSpan',
  'notPreSolved',
  'reachable',
  'solvable',
  'longEnough',
  'nearUnique',
  'windowsLoadBearing',
  'splittersLoadBearing',
  'encore',
  'needsThought',
];

export interface ContractRowResult {
  readonly pass: boolean;
  readonly detail: string;
}

export interface BoardAssessment {
  readonly passed: boolean;
  /** Every row when assessed in full; up to the first failure otherwise. */
  readonly rows: Partial<Record<ContractRow, ContractRowResult>>;
  readonly firstFailure: ContractRow | null;
  readonly solve: BoardSolveResult | null;
  readonly tuneWins: number | null;
}

export interface AssessOptions {
  /** Stop at the first failing row: the generator's mode. The gate assesses in full. */
  readonly stopAtFirstFailure?: boolean;
  /**
   * Stars the solve-dependent rows judge against; every non-encore star when
   * absent. Narrowing it to one star assesses a board under a latch-per-star
   * rule, which is how a hall of independent stars is shown not to be a puzzle.
   */
  readonly goalStarIds?: ReadonlyArray<string>;
}

function orthogonalNeighbours(tile: BoardTile): BoardTile[] {
  return HEADINGS.map((_, heading) => ({
    x: tile.x + STEP_X[heading],
    y: tile.y + STEP_Y[heading],
  }));
}

function isGlassCell(kind: number): boolean {
  return kind === CELL_MIRROR || kind === CELL_SPLITTER || kind === CELL_WINDOW;
}

/**
 * Two glass tiles side by side read as one prop, glass pressed against a star
 * or a lens reads as part of the wall, and glass boxed into a lane corner is
 * hidden behind the two walls it touches.
 */
export function legibilityProblems(board: MirrorBoard): string[] {
  const problems: string[] = [];
  for (const star of board.stars) {
    if (isReservedStarTile(board, star.tile)) {
      problems.push(
        `${star.id} at ${star.tile.x},${star.tile.y} is hidden behind the teaching glass`,
      );
    }
  }
  const optics: BoardTile[] = [
    ...board.mirrors.map((mirror) => mirror.tile),
    ...board.splitters.map((splitter) => splitter.tile),
  ];
  for (const tile of optics) {
    const neighbours = orthogonalNeighbours(tile).map((neighbour) => boardCellAt(board, neighbour));
    if (neighbours.some(isGlassCell))
      problems.push(`glass at ${tile.x},${tile.y} touches other glass`);
    if (neighbours.some((kind) => kind === CELL_STAR || kind === CELL_LIMELIGHT)) {
      problems.push(`glass at ${tile.x},${tile.y} is pressed against a star or a lens`);
    }
    const wallSides = neighbours.filter((kind) => kind === CELL_WALL).length;
    if (wallSides >= CORNER_WALL_SIDES)
      problems.push(`glass at ${tile.x},${tile.y} is boxed into a corner`);
  }
  return problems;
}

/**
 * The hot span is fair only when it is short and cannot move: the first thing
 * each limelight's ray meets is a mirror no further than
 * {@link FIRST_MIRROR_MAX_TILES} from the lens, the fire stays in the lens's
 * own lane, and it never lies on a lane's entry or exit tile. Whether it cuts
 * a crawler off from their glass is the reachable row's question, which walks
 * with the hot span solid.
 */
export function hotSpanProblems(board: MirrorBoard): string[] {
  const problems: string[] = [];
  for (const light of board.limelights) {
    const heading = headingIndex(light.heading);
    let x = light.tile.x;
    let y = light.tile.y;
    let distance = 0;
    let kind = CELL_FLOOR;
    while (kind === CELL_FLOOR) {
      x += STEP_X[heading];
      y += STEP_Y[heading];
      distance++;
      kind = boardCellAt(board, { x, y });
    }
    if (kind !== CELL_MIRROR) {
      problems.push(`${light.colour} light's first optic at ${x},${y} is not a mirror`);
    } else if (distance > FIRST_MIRROR_MAX_TILES) {
      problems.push(
        `${light.colour} light's first mirror is ${distance} tiles out (max ${FIRST_MIRROR_MAX_TILES})`,
      );
    }
  }
  const gateways = [board.entries.human, board.entries.cat, board.exits.human, board.exits.cat];
  for (const step of boardHotSpan(board)) {
    const light = board.limelights.find((candidate) => candidate.colour === step.colour);
    if (light !== undefined && laneOfColumn(board, step.tile.x) !== light.lane) {
      problems.push(`${step.colour} fire at ${step.tile.x},${step.tile.y} is outside its lane`);
    }
    if (gateways.some((tile) => tile.x === step.tile.x && tile.y === step.tile.y)) {
      problems.push(`${step.colour} fire covers a doorway tile at ${step.tile.x},${step.tile.y}`);
    }
  }
  return problems;
}

/**
 * Floor a crawler can stand on in their own lane, walking in from its entry
 * with glass, splitters, pillars and the hot span all solid.
 */
export function walkableFromEntry(board: MirrorBoard, lane: BoardLane): Uint8Array {
  const { width, height } = board;
  const compiled = compile(board);
  const solid = new Uint8Array(width * height);
  for (const step of boardHotSpan(board)) solid[step.tile.y * width + step.tile.x] = 1;
  const reached = new Uint8Array(width * height);
  const entry = board.entries[lane];
  const isOpen = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = y * width + x;
    return (
      compiled.cell[index] === CELL_FLOOR && solid[index] === 0 && laneOfColumn(board, x) === lane
    );
  };
  if (!isOpen(entry.x, entry.y)) return reached;
  const queue: number[] = [entry.y * width + entry.x];
  reached[queue[0]] = 1;
  // A for-of over an array visits what is pushed during the loop, which is
  // what makes this a breadth-first flood.
  for (const index of queue) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (let heading = 0; heading < HEADING_COUNT; heading++) {
      const nx = x + STEP_X[heading];
      const ny = y + STEP_Y[heading];
      if (!isOpen(nx, ny)) continue;
      const next = ny * width + nx;
      if (reached[next] === 1) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
}

export function reachabilityProblems(board: MirrorBoard): string[] {
  const problems: string[] = [];
  for (const lane of ['human', 'cat'] as const) {
    const reached = walkableFromEntry(board, lane);
    const standable = (tile: BoardTile): boolean =>
      tile.x >= 0 &&
      tile.y >= 0 &&
      tile.x < board.width &&
      tile.y < board.height &&
      reached[tile.y * board.width + tile.x] === 1;
    const exit = board.exits[lane];
    if (!standable(exit)) problems.push(`${lane} cannot walk from the entry to the exit`);
    board.mirrors.forEach((mirror) => {
      if (mirror.owner !== lane) return;
      if (!orthogonalNeighbours(mirror.tile).some(standable)) {
        problems.push(`${lane} cannot reach ${mirror.id}`);
      }
    });
  }
  return problems;
}

/** Significant figures a solving share is reported to. */
const SHARE_DIGITS = 3;

function withoutWindow(board: MirrorBoard, index: number): MirrorBoard {
  return { ...board, windows: board.windows.filter((_, candidate) => candidate !== index) };
}

function withoutSplitter(board: MirrorBoard, index: number): MirrorBoard {
  return { ...board, splitters: board.splitters.filter((_, candidate) => candidate !== index) };
}

/**
 * Checks a board against the acceptance contract for its tier. The generator
 * runs this before offering a board, and the gate runs it again in full.
 */
export function assessBoard(
  board: MirrorBoard,
  tier: MirrorBoardTier,
  options: AssessOptions = {},
): BoardAssessment {
  const rows: Partial<Record<ContractRow, ContractRowResult>> = {};
  let firstFailure: ContractRow | null = null;
  let solve: BoardSolveResult | null = null;
  let tuneWins: number | null = null;
  const stopEarly = options.stopAtFirstFailure === true;

  const record = (row: ContractRow, pass: boolean, detail: string): boolean => {
    rows[row] = { pass, detail };
    if (!pass && firstFailure === null) firstFailure = row;
    return !pass && stopEarly;
  };
  const result = (): BoardAssessment => ({
    passed: firstFailure === null,
    rows,
    firstFailure,
    solve,
    tuneWins,
  });

  const legibility = legibilityProblems(board);
  if (record('legible', legibility.length === 0, legibility.join('; ') || 'clean')) return result();

  const hotSpan = hotSpanProblems(board);
  if (record('fairHotSpan', hotSpan.length === 0, hotSpan.join('; ') || 'short and fixed')) {
    return result();
  }

  const startTrace = traceBoard(board, startingIndices(board));
  const litAtStart = startTrace.stars
    .filter((star) => star.status === 'lit')
    .map((star) => star.starId);
  if (record('notPreSolved', litAtStart.length === 0, litAtStart.join(', ') || 'every star dark')) {
    return result();
  }

  const reachability = reachabilityProblems(board);
  if (record('reachable', reachability.length === 0, reachability.join('; ') || 'every mirror')) {
    return result();
  }

  const goalStarIds = options.goalStarIds;
  solve = solveBoard(board, { goalStarIds });
  // An exhausted search proved nothing either way, so every row that leans
  // on a solve fails rather than read the budget running out as an answer.
  const proven = !solve.exhausted;
  const solvedDetail = proven
    ? `${solve.solvingArrangements} of ${solve.totalArrangements} arrangements`
    : `search exhausted after ${solve.nodes} nodes`;
  if (record('solvable', proven && solve.solvable, solvedDetail)) return result();

  const fewest = solve.fewestBlows ?? 0;
  if (
    record(
      'longEnough',
      proven && solve.solvable && fewest >= tier.minBlows,
      `${fewest} blows (min ${tier.minBlows})`,
    )
  ) {
    return result();
  }

  const share = solve.solvingArrangements / solve.totalArrangements;
  if (
    record(
      'nearUnique',
      proven && solve.solvable && share <= tier.solvingShareMax,
      `share ${share.toPrecision(SHARE_DIGITS)} (max ${tier.solvingShareMax})`,
    )
  ) {
    return result();
  }

  /** Why taking a piece out does not provably break the board, or null when it does. */
  const notLoadBearing = (variant: MirrorBoard): string | null => {
    const without = solveBoard(variant, { goalStarIds });
    if (without.exhausted) return 'unproven';
    return without.solvable ? 'decorative' : null;
  };
  const windowProblems = board.windows.flatMap((tile, index) => {
    const problem = notLoadBearing(withoutWindow(board, index));
    return problem === null ? [] : [`${problem}: ${tile.x},${tile.y}`];
  });
  if (
    record(
      'windowsLoadBearing',
      windowProblems.length === 0,
      windowProblems.length === 0 ? `${board.windows.length} windows` : windowProblems.join(' '),
    )
  ) {
    return result();
  }

  const splitterProblems = board.splitters.flatMap((splitter, index) => {
    const problem = notLoadBearing(withoutSplitter(board, index));
    return problem === null ? [] : [`${problem}: ${splitter.tile.x},${splitter.tile.y}`];
  });
  if (
    record(
      'splittersLoadBearing',
      splitterProblems.length === 0,
      splitterProblems.length === 0
        ? `${board.splitters.length} splitters`
        : splitterProblems.join(' '),
    )
  ) {
    return result();
  }

  const encore = board.stars.find((star) => star.kind === 'encore');
  const encoreSolve = encore === undefined ? null : solveBoard(board, { goalStarIds: [encore.id] });
  let encoreProblem = '';
  if (encoreSolve === null) {
    encoreProblem = 'no encore star';
  } else if (encoreSolve.exhausted) {
    encoreProblem = 'the encore search was exhausted';
  } else if (!encoreSolve.solvable) {
    encoreProblem = 'no arrangement lights the encore';
  } else {
    const atSolution = traceBoard(board, constructedSolution(board));
    if (!atSolution.solved) encoreProblem = 'the constructed solution does not solve the board';
    else if (atSolution.stars.some((star) => star.kind === 'encore' && star.status === 'lit')) {
      encoreProblem = 'the constructed solution lights the encore';
    }
  }
  if (record('encore', encoreProblem === '', encoreProblem || 'reachable, off the solution')) {
    return result();
  }

  tuneWins = tunePlayerWins(
    board,
    stopEarly ? { goalStarIds, stopAbove: tier.tuneWinsAllowed } : { goalStarIds },
  );
  record(
    'needsThought',
    tuneWins <= tier.tuneWinsAllowed,
    `tune player won ${tuneWins} of ${TUNE_PLAYER_RUNS} (max ${tier.tuneWinsAllowed})`,
  );
  return result();
}

/** A byte-stable encoding of a board, for determinism checks and for committing fallbacks. */
export function serializeMirrorBoard(board: MirrorBoard): string {
  return JSON.stringify(board);
}
