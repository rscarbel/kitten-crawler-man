/**
 * Builds a hall of mirrors for one world and one difficulty.
 *
 * Placing mirrors at random never yields a solvable board, so each attempt is
 * built backwards from its answer: pick the geometry, route each light to its
 * stars one straight run at a time, protect those routes, then hide them with
 * decoys and a scrambled start. The acceptance contract in `mirrorBoard.ts`
 * decides whether the attempt is kept.
 *
 * Every draw comes from this module's own stream, seeded from the world seed
 * and the difficulty, and never from `Math.random` or the world's stream: one
 * draw from the world's stream would reshuffle everything generated after it,
 * and one from `Math.random` would give a world a different hall each visit.
 * The fallback is chosen by attempt count alone, never by elapsed time, so a
 * slow device lands on the same board as a fast one.
 */

import {
  assessBoard,
  CORNER_WALL_SIDES,
  EAST,
  HEADING_COUNT,
  laneOfColumn,
  NORTH,
  oppositeHeading,
  SOUTH,
  STEP_X,
  STEP_Y,
  WEST,
  WALL_TILES_ABOVE_TEACHING_GLASS,
  CELL_FLOOR,
  CELL_LIMELIGHT,
  CELL_MIRROR,
  CELL_PILLAR,
  CELL_SPLITTER,
  CELL_STAR,
  CELL_WALL,
  CELL_WINDOW,
  facingAt,
  facingTurning,
  FIRST_MIRROR_MAX_TILES,
  headingAt,
  mixSeed,
  MIRROR_BOARD_DIVIDER_X,
  MIRROR_BOARD_ENTRIES,
  MIRROR_BOARD_EXITS,
  MIRROR_BOARD_HEIGHT,
  MIRROR_BOARD_TIERS,
  MIRROR_BOARD_WIDTH,
  PIVOT_CYCLE,
  seededStream,
  splitterReflection,
  traceBoard,
  type BoardAssessment,
  type BoardLane,
  type BoardMirror,
  type BoardStar,
  type BoardTile,
  type MirrorBoard,
  type MirrorBoardDifficulty,
  type MirrorBoardTier,
  type OpticFacing,
  type SplitterDiagonal,
} from './mirrorBoard';
import { MIRROR_BOARD_FALLBACKS } from './mirrorBoardFallback';

/** Attempts before the hall settles for the tier's committed fallback board. */
export const GENERATION_ATTEMPTS_MAX = 60;

/**
 * Route-search nodes one attempt may spend. A hard cap on the work itself:
 * the search counts every placement it tries and gives the attempt up the
 * moment the count is spent, however promising the branch it is in.
 */
const ROUTE_NODE_BUDGET = 1500;

/** Draws a geometry may take to space its windows before the attempt is given up. */
const WINDOW_ROW_DRAWS = 24;
/** Rows between any two windows, and from a window to the twin, at least. */
const WINDOW_SPACING_MIN = 3;
const WINDOW_TWIN_GAP_MIN = 2;
/** Lens, twin and window rows stay off the first and last floor rows, which hold the exits and entries. */
const FEATURE_ROW_INSET = 2;

const DIFFICULTY_SALT: Readonly<Record<MirrorBoardDifficulty, number>> = {
  easy: 0x6b697474,
  normal: 0x63726177,
  hard: 0x6e696768,
};

const QUARTER_LEFT = 3;
const QUARTER_RIGHT = 1;
const SPLITTER_DIAGONALS: ReadonlyArray<SplitterDiagonal> = ['slash', 'backslash'];

/** The one seed a world's board for `difficulty` grows from. */
export function mirrorBoardSeed(worldSeed: number, difficulty: MirrorBoardDifficulty): number {
  return mixSeed(worldSeed, DIFFICULTY_SALT[difficulty]);
}

/** Each attempt's own sub-seed, so an attempt's board never depends on the ones before it. */
export function attemptSeed(boardSeed: number, attempt: number): number {
  return mixSeed(boardSeed, attempt + 1);
}

class Draws {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = seededStream(seed);
  }

  /** An integer in `[low, high]`. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }

  pick<T>(items: ReadonlyArray<T>): T {
    return items[Math.floor(this.next() * items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let index = items.length - 1; index > 0; index--) {
      const swap = Math.floor(this.next() * (index + 1));
      const held = items[index];
      items[index] = items[swap];
      items[swap] = held;
    }
    return items;
  }
}

interface Goal {
  readonly x: number;
  readonly y: number;
  /** The heading the light must be travelling as it arrives. */
  readonly heading: number;
  readonly kind: 'window' | 'star';
}

interface PlacedMirror {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

interface PlacedSplitter {
  readonly x: number;
  readonly y: number;
  readonly diagonal: SplitterDiagonal;
}

/** One committed tile of a light's route, and whether the light is past its first mirror there. */
interface TrailStep {
  readonly index: number;
  readonly heading: number;
  readonly cold: boolean;
}

const GOAL_OPTION = -1;
/** One window per light that has a star in the other crawler's lane. */
const BOTH_LIGHTS_CROSS = 2;
const ONLY_BLUE_CROSSES = 1;
/** A lower bound on the mirrors a light needs to come back round onto a line it is not on. */
const TURNS_TO_DOUBLE_BACK = 2;
/** Columns between two stars on the same wall, at least, so their art does not touch. */
const STAR_SEPARATION_MIN = 2;

/**
 * The fewest mirrors that could take light at (`x`, `y`) travelling `heading`
 * onto `goal`, ignoring everything in the way. A lower bound, used only to
 * prune routes that cannot close within the turns left.
 */
function turnsNeededAtLeast(x: number, y: number, heading: number, goal: Goal): number {
  const ahead = (from: number, to: number, step: number): boolean =>
    step !== 0 && Math.sign(to - from) === step;
  if (heading === goal.heading) {
    const onLine = STEP_X[heading] === 0 ? x === goal.x : y === goal.y;
    const inFront = ahead(x, goal.x, STEP_X[heading]) || ahead(y, goal.y, STEP_Y[heading]);
    return onLine && inFront ? 0 : TURNS_TO_DOUBLE_BACK;
  }
  if (oppositeHeading(heading) === goal.heading) return TURNS_TO_DOUBLE_BACK;
  const cornerX = STEP_X[heading] === 0 ? x : goal.x;
  const cornerY = STEP_X[heading] === 0 ? goal.y : y;
  const cornerAhead = ahead(x, cornerX, STEP_X[heading]) || ahead(y, cornerY, STEP_Y[heading]);
  const goalPastCorner =
    ahead(cornerX, goal.x, STEP_X[goal.heading]) || ahead(cornerY, goal.y, STEP_Y[goal.heading]);
  return cornerAhead && goalPastCorner ? 1 : TURNS_TO_DOUBLE_BACK;
}

/**
 * The fewest mirrors between here and the last of `goals`: the current goal,
 * plus one for every later goal the light has to arrive at on a new axis.
 */
function turnsToFinishAtLeast(
  x: number,
  y: number,
  heading: number,
  goals: ReadonlyArray<Goal>,
  goalIndex: number,
): number {
  let turns = turnsNeededAtLeast(x, y, heading, goals[goalIndex]);
  for (let later = goalIndex + 1; later < goals.length; later++) {
    if (goals[later].heading !== goals[later - 1].heading) turns++;
  }
  return turns;
}

/**
 * One attempt's working state: the grid as the router sees it, how many
 * committed routes cross each tile, and the pieces placed so far.
 */
class BoardBuilder {
  readonly width = MIRROR_BOARD_WIDTH;
  readonly height = MIRROR_BOARD_HEIGHT;
  readonly divider = MIRROR_BOARD_DIVIDER_X;
  readonly cell: Uint8Array;
  readonly path: Uint16Array;
  readonly mirrors: PlacedMirror[] = [];
  readonly splitters: PlacedSplitter[] = [];
  nodes = 0;

  constructor(
    readonly draws: Draws,
    readonly tier: MirrorBoardTier,
  ) {
    this.cell = new Uint8Array(this.width * this.height);
    this.path = new Uint16Array(this.width * this.height);
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (x !== this.divider) this.cell[this.at(x, y)] = CELL_FLOOR;
      }
    }
  }

  at(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  cellAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cell[this.at(x, y)] : CELL_WALL;
  }

  isEntryOrExit(x: number, y: number): boolean {
    return [MIRROR_BOARD_ENTRIES, MIRROR_BOARD_EXITS].some(
      (tiles) =>
        (tiles.human.x === x && tiles.human.y === y) || (tiles.cat.x === x && tiles.cat.y === y),
    );
  }

  /**
   * Whether glass may stand here as far as legibility goes: bare floor, not a
   * doorway's or gate's own tile, not touching other glass, a star or a lens,
   * and not boxed into a corner.
   */
  glassFits(x: number, y: number): boolean {
    if (this.cellAt(x, y) !== CELL_FLOOR || this.isEntryOrExit(x, y)) return false;
    let wallSides = 0;
    for (let heading = 0; heading < HEADING_COUNT; heading++) {
      const kind = this.cellAt(x + STEP_X[heading], y + STEP_Y[heading]);
      if (
        kind === CELL_MIRROR ||
        kind === CELL_SPLITTER ||
        kind === CELL_WINDOW ||
        kind === CELL_STAR ||
        kind === CELL_LIMELIGHT
      ) {
        return false;
      }
      if (kind === CELL_WALL) wallSides++;
    }
    return wallSides < CORNER_WALL_SIDES;
  }

  /** A mirror may not sit where any committed light already passes: it would bend that light. */
  mirrorFits(x: number, y: number): boolean {
    return this.glassFits(x, y) && this.path[this.at(x, y)] === 0;
  }

  commit(trail: TrailStep[], index: number, heading: number, cold: boolean): void {
    this.path[index]++;
    trail.push({ index, heading, cold });
  }

  uncommitTo(trail: TrailStep[], length: number): void {
    while (trail.length > length) {
      const step = trail.pop();
      if (step !== undefined) this.path[step.index]--;
    }
  }

  budgetSpent(): boolean {
    if (this.nodes >= ROUTE_NODE_BUDGET) return true;
    this.nodes++;
    return false;
  }

  /**
   * Routes light leaving (`x`, `y`) on `heading` through `goals` in order, one
   * straight run at a time: at each run it either lets the light reach the
   * goal, or stands a mirror on some tile of the run and turns. A route never
   * passes through a placed optic, because every run stops at the first tile
   * that is not bare floor.
   */
  route(
    x: number,
    y: number,
    heading: number,
    goals: ReadonlyArray<Goal>,
    goalIndex: number,
    turnsLeft: number,
    fromLens: boolean,
    trail: TrailStep[],
  ): boolean {
    const goal = goals[goalIndex];
    const run: number[] = [];
    let reachesGoal = false;
    let runX = x;
    let runY = y;
    for (;;) {
      runX += STEP_X[heading];
      runY += STEP_Y[heading];
      if (runX === goal.x && runY === goal.y) {
        reachesGoal = heading === goal.heading;
        break;
      }
      if (this.cellAt(runX, runY) !== CELL_FLOOR) break;
      run.push(this.at(runX, runY));
    }

    const options: number[] = [];
    if (reachesGoal && !fromLens) options.push(GOAL_OPTION);
    if (turnsLeft > 0) {
      for (let step = 0; step < run.length; step++) {
        if (fromLens && step + 1 > FIRST_MIRROR_MAX_TILES) break;
        const index = run[step];
        const tileX = index % this.width;
        const tileY = Math.floor(index / this.width);
        if (!this.mirrorFits(tileX, tileY)) continue;
        for (const turn of [QUARTER_RIGHT, QUARTER_LEFT]) {
          const turned = (heading + turn) % HEADING_COUNT;
          if (turnsToFinishAtLeast(tileX, tileY, turned, goals, goalIndex) > turnsLeft - 1)
            continue;
          options.push(step * HEADING_COUNT + turn);
        }
      }
    }
    this.draws.shuffle(options);

    const cold = !fromLens;
    for (const option of options) {
      if (this.budgetSpent()) return false;
      const mark = trail.length;
      if (option === GOAL_OPTION) {
        for (const index of run) this.commit(trail, index, heading, cold);
        if (goal.kind === 'star') return true;
        this.commit(trail, this.at(goal.x, goal.y), heading, cold);
        if (this.route(goal.x, goal.y, heading, goals, goalIndex + 1, turnsLeft, false, trail)) {
          return true;
        }
        this.uncommitTo(trail, mark);
        continue;
      }
      const step = Math.floor(option / HEADING_COUNT);
      const turned = (heading + (option % HEADING_COUNT)) % HEADING_COUNT;
      for (let before = 0; before < step; before++) this.commit(trail, run[before], heading, cold);
      const index = run[step];
      const mirrorX = index % this.width;
      const mirrorY = Math.floor(index / this.width);
      this.cell[index] = CELL_MIRROR;
      this.mirrors.push({ x: mirrorX, y: mirrorY, facing: facingTurning(heading, turned) });
      if (this.route(mirrorX, mirrorY, turned, goals, goalIndex, turnsLeft - 1, false, trail)) {
        return true;
      }
      this.mirrors.pop();
      this.cell[index] = CELL_FLOOR;
      this.uncommitTo(trail, mark);
    }
    return false;
  }

  /**
   * Stands a splitter on a cold tile of a light's committed route and routes
   * its reflected branch through `goals`. The straight branch carries on along
   * the route unchanged, so the goal it was already reaching stays reached.
   */
  splitAndRoute(trail: ReadonlyArray<TrailStep>, goals: ReadonlyArray<Goal>): boolean {
    const candidates = this.draws.shuffle(
      trail.filter((step) => {
        const x = step.index % this.width;
        const y = Math.floor(step.index / this.width);
        return step.cold && this.path[step.index] === 1 && this.glassFits(x, y);
      }),
    );
    for (const candidate of candidates) {
      const x = candidate.index % this.width;
      const y = Math.floor(candidate.index / this.width);
      for (const diagonal of this.draws.shuffle([...SPLITTER_DIAGONALS])) {
        const reflected = splitterReflection(diagonal, candidate.heading);
        if (turnsToFinishAtLeast(x, y, reflected, goals, 0) > this.tier.maxTurnsPerLeg) continue;
        if (this.budgetSpent()) return false;
        this.cell[candidate.index] = CELL_SPLITTER;
        const branch: TrailStep[] = [];
        if (this.route(x, y, reflected, goals, 0, this.tier.maxTurnsPerLeg, false, branch)) {
          this.splitters.push({ x, y, diagonal });
          return true;
        }
        this.cell[candidate.index] = CELL_FLOOR;
      }
    }
    return false;
  }

  /** Floor tiles in `lane` where a decoy could stand without touching the solution's light. */
  decoySites(lane: BoardLane): number[] {
    const sites: number[] = [];
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (laneOf(x) !== lane || x === this.divider) continue;
        if (this.mirrorFits(x, y)) sites.push(this.at(x, y));
      }
    }
    return sites;
  }

  /** Whether a tile shares a row or a column with a piece of the solution: somewhere a wrong turn could send the light. */
  alignedWithSolution(index: number): boolean {
    const x = index % this.width;
    const y = Math.floor(index / this.width);
    return (
      this.mirrors.some((mirror) => mirror.x === x || mirror.y === y) ||
      this.splitters.some((splitter) => splitter.x === x || splitter.y === y)
    );
  }

  pillarFits(x: number, y: number): boolean {
    if (this.cellAt(x, y) !== CELL_FLOOR || this.path[this.at(x, y)] !== 0) return false;
    for (let heading = 0; heading < HEADING_COUNT; heading++) {
      const nx = x + STEP_X[heading];
      const ny = y + STEP_Y[heading];
      if (this.isEntryOrExit(nx, ny) || this.isEntryOrExit(x, y)) return false;
      const kind = this.cellAt(nx, ny);
      if (kind === CELL_MIRROR || kind === CELL_SPLITTER || kind === CELL_WINDOW) return false;
    }
    return true;
  }
}

const HALL_FRAME = { dividerX: MIRROR_BOARD_DIVIDER_X } as const;

function isReservedHallTile(tile: BoardTile): boolean {
  return WALL_TILES_ABOVE_TEACHING_GLASS.some(
    (reserved) => reserved.x === tile.x && reserved.y === tile.y,
  );
}

function laneOf(x: number): BoardLane {
  return laneOfColumn(HALL_FRAME, x);
}

function starGoal(tile: BoardTile, arriving: number): Goal {
  return { x: tile.x, y: tile.y, heading: arriving, kind: 'star' };
}

/** Columns of a lane a wall star may sit over: never a gate's or a doorway's own tile. */
function starColumns(lane: BoardLane, wallRow: number): number[] {
  const columns: number[] = [];
  const first = lane === 'human' ? 1 : MIRROR_BOARD_DIVIDER_X + 1;
  const eastWall = MIRROR_BOARD_WIDTH - 1;
  const last = lane === 'human' ? MIRROR_BOARD_DIVIDER_X - 1 : eastWall - 1;
  for (let x = first; x <= last; x++) {
    if (x === MIRROR_BOARD_EXITS[lane].x || x === MIRROR_BOARD_ENTRIES[lane].x) continue;
    if (isReservedHallTile({ x, y: wallRow })) continue;
    columns.push(x);
  }
  return columns;
}

/** A top- or bottom-wall star over `lane`, and the heading light must arrive with. */
function drawWallStar(draws: Draws, lane: BoardLane): { tile: BoardTile; arriving: number } {
  const onTop = draws.int(0, 1) === 0;
  const wallRow = onTop ? 0 : MIRROR_BOARD_HEIGHT - 1;
  const x = draws.pick(starColumns(lane, wallRow));
  return { tile: { x, y: wallRow }, arriving: onTop ? NORTH : SOUTH };
}

function drawFeatureRow(draws: Draws): number {
  return draws.int(FEATURE_ROW_INSET, MIRROR_BOARD_HEIGHT - 1 - FEATURE_ROW_INSET);
}

/** Window rows, spaced from each other and from the twin; null when the draws run out. */
function drawWindowRows(draws: Draws, count: number, twinRow: number | null): number[] | null {
  for (let draw = 0; draw < WINDOW_ROW_DRAWS; draw++) {
    const rows: number[] = [];
    for (let window = 0; window < count; window++) rows.push(drawFeatureRow(draws));
    const spaced = rows.every((row, index) =>
      rows.every(
        (other, otherIndex) => otherIndex === index || Math.abs(row - other) >= WINDOW_SPACING_MIN,
      ),
    );
    const clearOfTwin =
      twinRow === null || rows.every((row) => Math.abs(row - twinRow) >= WINDOW_TWIN_GAP_MIN);
    if (spaced && clearOfTwin) return rows;
  }
  return null;
}

/** The pieces of an attempt that has routed its lights, before decoys and the scramble. */
interface RoutedLight {
  readonly colour: 'blue' | 'red';
  readonly lane: BoardLane;
  readonly lens: BoardTile;
  readonly heading: number;
}

function isEncoreSite(builder: BoardBuilder, tile: BoardTile): boolean {
  const { x, y } = tile;
  const onRing = x === 0 || y === 0 || x === builder.width - 1 || y === builder.height - 1;
  const inCorner = (x === 0 || x === builder.width - 1) && (y === 0 || y === builder.height - 1);
  if (!onRing || inCorner || builder.cellAt(x, y) !== CELL_WALL) return false;
  if (isReservedHallTile(tile)) return false;
  if (y === 0 && (x === MIRROR_BOARD_EXITS.human.x || x === MIRROR_BOARD_EXITS.cat.x)) return false;
  if (
    y === builder.height - 1 &&
    (x === MIRROR_BOARD_ENTRIES.human.x || x === MIRROR_BOARD_ENTRIES.cat.x)
  ) {
    return false;
  }
  for (let heading = 0; heading < HEADING_COUNT; heading++) {
    const kind = builder.cellAt(x + STEP_X[heading], y + STEP_Y[heading]);
    if (
      kind === CELL_STAR ||
      kind === CELL_LIMELIGHT ||
      kind === CELL_MIRROR ||
      kind === CELL_SPLITTER ||
      kind === CELL_PILLAR
    ) {
      return false;
    }
  }
  return true;
}

export interface BoardAttemptBuild {
  readonly board: MirrorBoard | null;
  /** Why construction gave up, when it did. */
  readonly failure: string | null;
  readonly routeNodes: number;
}

/**
 * Constructs one candidate board from `seed`: geometry, routes, protection,
 * cycles, decoys, the encore, and the scramble. Assessment is separate so the
 * two halves of an attempt can run in different frames.
 */
export function buildBoardAttempt(seed: number, tier: MirrorBoardTier): BoardAttemptBuild {
  const draws = new Draws(seed);
  const builder = new BoardBuilder(draws, tier);
  const fail = (failure: string): BoardAttemptBuild => ({
    board: null,
    failure,
    routeNodes: builder.nodes,
  });
  const { width, height, divider } = builder;

  const blueLens: BoardTile = { x: 0, y: drawFeatureRow(draws) };
  const redLens: BoardTile = { x: width - 1, y: drawFeatureRow(draws) };
  const twinRow = tier.twin ? drawFeatureRow(draws) : null;
  const blueNeedsSplit = tier.twin;
  const redNeedsSplit = tier.twin && tier.redStar;
  const redCrosses = tier.redStar;
  const crossingLights = redCrosses ? BOTH_LIGHTS_CROSS : ONLY_BLUE_CROSSES;
  const windowRows = drawWindowRows(draws, crossingLights, twinRow);
  if (windowRows === null) return fail('geometry');
  const [blueWindowRow, redWindowRow = blueWindowRow] = windowRows;

  const blueStar = drawWallStar(draws, 'cat');
  const redStar = tier.redStar ? drawWallStar(draws, 'human') : null;
  if (
    redStar !== null &&
    redStar.tile.y === blueStar.tile.y &&
    Math.abs(redStar.tile.x - blueStar.tile.x) < STAR_SEPARATION_MIN
  ) {
    return fail('geometry');
  }

  builder.cell[builder.at(blueLens.x, blueLens.y)] = CELL_LIMELIGHT;
  builder.cell[builder.at(redLens.x, redLens.y)] = CELL_LIMELIGHT;
  for (const row of windowRows) builder.cell[builder.at(divider, row)] = CELL_WINDOW;
  builder.cell[builder.at(blueStar.tile.x, blueStar.tile.y)] = CELL_STAR;
  if (redStar !== null) builder.cell[builder.at(redStar.tile.x, redStar.tile.y)] = CELL_STAR;
  if (twinRow !== null) builder.cell[builder.at(divider, twinRow)] = CELL_STAR;

  const twinFrom = (heading: number): Goal => ({
    x: divider,
    y: twinRow ?? 0,
    heading,
    kind: 'star',
  });
  const blueToStar: Goal[] = [
    { x: divider, y: blueWindowRow, heading: EAST, kind: 'window' },
    starGoal(blueStar.tile, blueStar.arriving),
  ];
  const redToStar: Goal[] =
    redStar === null
      ? []
      : [
          { x: divider, y: redWindowRow, heading: WEST, kind: 'window' },
          starGoal(redStar.tile, redStar.arriving),
        ];

  // Routes, blue first: its splitter is placed before red is routed, so red
  // is kept off it by the same rule that keeps it off blue's mirrors.
  const lights: RoutedLight[] = [
    { colour: 'blue', lane: 'human', lens: blueLens, heading: EAST },
    { colour: 'red', lane: 'cat', lens: redLens, heading: WEST },
  ];
  for (const light of lights) {
    const isBlue = light.colour === 'blue';
    const splits = isBlue ? blueNeedsSplit : redNeedsSplit;
    const firstLeg: Goal[] = tier.twin
      ? [twinFrom(light.heading)]
      : isBlue
        ? blueToStar
        : redToStar;
    const trail: TrailStep[] = [];
    const routed = builder.route(
      light.lens.x,
      light.lens.y,
      light.heading,
      firstLeg,
      0,
      tier.maxTurnsPerLeg,
      true,
      trail,
    );
    if (!routed) return fail(builder.nodes >= ROUTE_NODE_BUDGET ? 'route budget' : 'route');
    if (splits && !builder.splitAndRoute(trail, isBlue ? blueToStar : redToStar)) {
      return fail(builder.nodes >= ROUTE_NODE_BUDGET ? 'route budget' : 'splitter');
    }
  }

  // Cycles for the solution's glass. A pivot always has all four facings; a
  // swivel has its answer and one other, in either order.
  interface DraftMirror {
    readonly x: number;
    readonly y: number;
    readonly cycle: ReadonlyArray<OpticFacing>;
    readonly solutionIndex: number;
    readonly isDecoy: boolean;
  }
  const drafts: DraftMirror[] = [];
  const swivelCycle = (keep: OpticFacing): OpticFacing[] => {
    const other = draws.pick(PIVOT_CYCLE.filter((facing) => facing !== keep));
    return draws.shuffle([keep, other]);
  };
  for (const mirror of builder.mirrors) {
    const facing = facingAt(mirror.facing);
    const cycle = laneOf(mirror.x) === 'human' ? PIVOT_CYCLE : swivelCycle(facing);
    drafts.push({
      x: mirror.x,
      y: mirror.y,
      cycle,
      solutionIndex: cycle.indexOf(facing),
      isDecoy: false,
    });
  }

  // Decoys, preferring tiles in line with the solution's glass so a wrong
  // turn has somewhere plausible to send the light.
  for (const lane of ['human', 'cat'] as const) {
    for (let decoy = 0; decoy < tier.decoyMirrorsPerLane; decoy++) {
      const sites = builder.decoySites(lane);
      const aligned = sites.filter((site) => builder.alignedWithSolution(site));
      const pool = aligned.length > 0 ? aligned : sites;
      if (pool.length === 0) return fail('decoys');
      const site = draws.pick(pool);
      builder.cell[site] = CELL_MIRROR;
      const x = site % width;
      const y = Math.floor(site / width);
      const cycle = lane === 'human' ? PIVOT_CYCLE : swivelCycle(draws.pick(PIVOT_CYCLE));
      drafts.push({ x, y, cycle, solutionIndex: draws.int(0, cycle.length - 1), isDecoy: true });
    }
  }

  const pillars: BoardTile[] = [];
  for (let pillar = 0; pillar < tier.pillars; pillar++) {
    const sites: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (builder.pillarFits(x, y)) sites.push(builder.at(x, y));
      }
    }
    if (sites.length === 0) return fail('pillars');
    const site = draws.pick(sites);
    builder.cell[site] = CELL_PILLAR;
    pillars.push({ x: site % width, y: Math.floor(site / width) });
  }

  drafts.sort((a, b) => a.y - b.y || a.x - b.x);
  const solution = drafts.map((draft) => draft.solutionIndex);
  const stars: BoardStar[] = [{ id: 'star_blue', kind: 'blue', tile: blueStar.tile }];
  if (redStar !== null) stars.push({ id: 'star_red', kind: 'red', tile: redStar.tile });
  if (twinRow !== null)
    stars.push({ id: 'star_twin', kind: 'twin', tile: { x: divider, y: twinRow } });

  const assemble = (
    starList: ReadonlyArray<BoardStar>,
    startIndices: ReadonlyArray<number>,
  ): MirrorBoard => ({
    width,
    height,
    dividerX: divider,
    entries: MIRROR_BOARD_ENTRIES,
    exits: MIRROR_BOARD_EXITS,
    limelights: [
      { colour: 'blue', lane: 'human', tile: blueLens, heading: headingAt(EAST) },
      { colour: 'red', lane: 'cat', tile: redLens, heading: headingAt(WEST) },
    ],
    mirrors: drafts.map((draft, index): BoardMirror => ({
      id: `mirror_${index}`,
      kind: laneOf(draft.x) === 'human' ? 'pivot_mirror' : 'swivel_mirror',
      owner: laneOf(draft.x),
      tile: { x: draft.x, y: draft.y },
      cycle: draft.cycle,
      initialIndex: startIndices[index],
      solutionIndex: draft.solutionIndex,
    })),
    splitters: builder.splitters.map((splitter) => ({
      tile: { x: splitter.x, y: splitter.y },
      diagonal: splitter.diagonal,
    })),
    windows: windowRows.map((row) => ({ x: divider, y: row })),
    stars: starList,
    pillars,
  });

  // The encore goes where one mirror turned off its answer sends some light,
  // so an arrangement lights it and the constructed answer does not.
  const draft = assemble(stars, solution);
  const answered = traceBoard(draft, solution);
  if (!answered.solved) return fail('construction');
  const answeredEnds = answered.ends.map((end) => builder.at(end.tile.x, end.tile.y));
  let encoreTile: BoardTile | null = null;
  const solutionMirrors = draws.shuffle(
    drafts.flatMap((mirror, index) => (mirror.isDecoy ? [] : [index])),
  );
  search: for (const mirrorIndex of solutionMirrors) {
    const cycle = drafts[mirrorIndex].cycle;
    const alternatives = draws.shuffle(
      cycle.map((_, index) => index).filter((index) => index !== solution[mirrorIndex]),
    );
    for (const cycleIndex of alternatives) {
      const turned = traceBoard(draft, solution, { mirrorIndex, cycleIndex });
      for (const end of draws.shuffle([...turned.ends])) {
        if (answeredEnds.includes(builder.at(end.tile.x, end.tile.y))) continue;
        if (!isEncoreSite(builder, end.tile)) continue;
        encoreTile = end.tile;
        break search;
      }
    }
  }
  if (encoreTile === null) return fail('encore');
  builder.cell[builder.at(encoreTile.x, encoreTile.y)] = CELL_STAR;
  const withEncore = [...stars, { id: 'star_encore', kind: 'encore' as const, tile: encoreTile }];

  // The scramble: no solution mirror starts on its answer.
  const start = drafts.map((mirror, index) => {
    if (mirror.isDecoy) return solution[index];
    const offset = draws.int(1, mirror.cycle.length - 1);
    return (solution[index] + offset) % mirror.cycle.length;
  });

  return { board: assemble(withEncore, start), failure: null, routeNodes: builder.nodes };
}

export interface BoardAttemptResult {
  readonly board: MirrorBoard | null;
  readonly accepted: boolean;
  /** The construction failure, or the first contract row the board failed. */
  readonly rejection: string | null;
  readonly assessment: BoardAssessment | null;
}

/** One whole attempt: build, then assess in the generator's stop-at-first-failure mode. */
export function runBoardAttempt(
  boardSeed: number,
  attempt: number,
  tier: MirrorBoardTier,
): BoardAttemptResult {
  const built = buildBoardAttempt(attemptSeed(boardSeed, attempt), tier);
  if (built.board === null) {
    return { board: null, accepted: false, rejection: built.failure, assessment: null };
  }
  const assessment = assessBoard(built.board, tier, { stopAtFirstFailure: true });
  return {
    board: built.board,
    accepted: assessment.passed,
    rejection: assessment.firstFailure,
    assessment,
  };
}

export interface GeneratedMirrorBoard {
  readonly board: MirrorBoard;
  readonly source: 'generated' | 'fallback';
  /** Attempts spent, including the accepted one. */
  readonly attempts: number;
}

/**
 * Generation that can be spread across frames. Each {@link step} does half an
 * attempt — the build, or the assessment — and returns true once a board is
 * settled; after that it does nothing.
 */
export interface MirrorBoardGeneration {
  step(): boolean;
  readonly result: GeneratedMirrorBoard | null;
  readonly attempts: number;
}

class SlicedBoardGeneration implements MirrorBoardGeneration {
  private attempt = 0;
  private pending: MirrorBoard | null = null;
  private settled: GeneratedMirrorBoard | null = null;
  private readonly boardSeed: number;

  constructor(
    worldSeed: number,
    private readonly difficulty: MirrorBoardDifficulty,
    private readonly tier: MirrorBoardTier,
  ) {
    this.boardSeed = mirrorBoardSeed(worldSeed, difficulty);
  }

  get result(): GeneratedMirrorBoard | null {
    return this.settled;
  }

  get attempts(): number {
    return this.attempt;
  }

  step(): boolean {
    if (this.settled !== null) return true;
    if (this.pending === null) {
      const built = buildBoardAttempt(attemptSeed(this.boardSeed, this.attempt), this.tier);
      if (built.board === null) return this.attemptFailed();
      this.pending = built.board;
      return false;
    }
    const board = this.pending;
    this.pending = null;
    if (!assessBoard(board, this.tier, { stopAtFirstFailure: true }).passed) {
      return this.attemptFailed();
    }
    this.attempt++;
    this.settled = { board, source: 'generated', attempts: this.attempt };
    return true;
  }

  private attemptFailed(): boolean {
    this.attempt++;
    if (this.attempt < GENERATION_ATTEMPTS_MAX) return false;
    this.settled = {
      board: MIRROR_BOARD_FALLBACKS[this.difficulty],
      source: 'fallback',
      attempts: this.attempt,
    };
    return true;
  }
}

/**
 * Starts generating the board for one world and difficulty. `tier` defaults to
 * the difficulty's own; the gate passes another to prove a mistuned tier is
 * caught.
 */
export function createBoardGeneration(
  worldSeed: number,
  difficulty: MirrorBoardDifficulty,
  tier: MirrorBoardTier = MIRROR_BOARD_TIERS[difficulty],
): MirrorBoardGeneration {
  return new SlicedBoardGeneration(worldSeed, difficulty, tier);
}

/** Runs a generation to completion in one go. */
export function generateBoardNow(
  worldSeed: number,
  difficulty: MirrorBoardDifficulty,
  tier: MirrorBoardTier = MIRROR_BOARD_TIERS[difficulty],
): GeneratedMirrorBoard {
  const generation = createBoardGeneration(worldSeed, difficulty, tier);
  let settled = generation.step();
  while (!settled) settled = generation.step();
  const { result } = generation;
  if (result === null) throw new Error('mirror board generation stopped without a board');
  return result;
}
