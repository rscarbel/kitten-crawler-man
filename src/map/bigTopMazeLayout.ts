/**
 * The Big Top's maze — the authored floor plan, its flame-vent schedules, and
 * the four cross-character blocks, in one place.
 *
 * The tent turns into this only while "The Show Must Go On" is at its final
 * act. Two crawlers come in through two flaps, walk two sealed halves, and each
 * of them meets doors only the other one can open; the halves meet again in the
 * chamber at the tent pole, where Grimaldi is waiting.
 *
 * Everything here is data rather than generation, because the trap choreography
 * depends on exact corridor lengths: a procedural maze would have to re-derive
 * the timing every run, and the timing is the part that has to be provably
 * survivable. `scripts/verify-bigtop-maze.ts` imports these same exports and
 * walks a slowed-down player through every corridor, so the numbers the game
 * runs on are the numbers the gate proves.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';

/**
 * The maze floor, one string per row.
 *
 * ```
 *  #  wall            .  sawdust floor      ^  tent pole
 *  H  human entrance  C  cat entrance
 *  1  gate barring the human's first leg    a  its sandbag counterweight
 *  2  barricade barring the cat's           b  its supporting brace
 *  3  gate barring the human's second leg   c  its sandbag counterweight
 *  4  barricade barring the cat's second    d  its supporting brace
 * ```
 *
 * Gates and barricades stand as wall until cleared. The lettered tiles stay
 * wall forever — a broken counterweight is a hole in a grate, not a doorway —
 * and only carry the prop the other half shoots or smashes.
 */
export const BIG_TOP_MAZE_ROWS: ReadonlyArray<string> = [
  '############################################',
  '#############..................#############',
  '#############..................#############',
  '#############..................#############',
  '#############........^^........#############',
  '#############........^^........#############',
  '#############..................#############',
  '#############..................#############',
  '#############..................#############',
  '###############.############.###############',
  '###############.############.###############',
  '###############.############.###############',
  '###############.############.###############',
  '###############......d######.###############',
  '#################.##########4###############',
  '#################.###c.......###############',
  '#################.####.#####################',
  '#################....#.#####################',
  '########.###.###.###3#.#####################',
  '####.................b....................##',
  '####.####################################.##',
  '####.................#....................##',
  '####################1#2#####################',
  '##...................a....................##',
  '##.########################.###.###.#####.##',
  '##.............##########################.##',
  '##############.......#....................##',
  '##############...H...#....C...##############',
  '##############.......#........##############',
  '#################.########.#################',
];

export const MAZE_WIDTH = 44;
export const MAZE_HEIGHT = 30;

/** Legend characters, so nothing has to spell a literal twice. */
export const MAZE_WALL_CHAR = '#';
export const MAZE_FLOOR_CHAR = '.';
export const MAZE_POLE_CHAR = '^';
export const MAZE_HUMAN_SPAWN_CHAR = 'H';
export const MAZE_CAT_SPAWN_CHAR = 'C';

export interface MazeTile {
  readonly x: number;
  readonly y: number;
}

/** The two flaps the party comes in through, and leaves by. */
export const MAZE_EXIT_TILES: ReadonlyArray<MazeTile> = [
  { x: 17, y: 29 },
  { x: 26, y: 29 },
];

export const MAZE_HUMAN_SPAWN_TILE: MazeTile = { x: 17, y: 27 };
export const MAZE_CAT_SPAWN_TILE: MazeTile = { x: 26, y: 27 };

/**
 * The room at the tent pole, where the halves meet and nothing burns.
 * Inclusive bounds.
 */
export const MAZE_FINAL_CHAMBER = { x0: 13, y0: 1, x1: 30, y1: 8 } as const;

/** Grimaldi's own tile — the south face of the pole cluster his mass wraps. */
export const MAZE_GRIMALDI_TILE: MazeTile = { x: 21, y: 6 };

// ── Trap timing ───────────────────────────────────────────────────────────────

/**
 * Frames a vent glows before it erupts.
 *
 * The floor the fairness rules put under any telegraphed hazard is 21 frames;
 * this sits above it because a vent is on the ground the player is *standing*
 * on rather than out in front of them, and a floor tell has to be read while
 * the eye is on somewhere else.
 */
export const FLAME_TELEGRAPH_FRAMES = 30;

/**
 * Frames the screen holds its white-out when a crawler is caught by a vent.
 *
 * Touching fire in here costs no health at all — it costs the run of the maze.
 * Both crawlers wake up at their own flap and walk it again, which is a price
 * paid in the thing the room is actually made of. Health would be the wrong
 * currency twice over: a corridor is a timing puzzle rather than a fight, and a
 * party whittled down by failed attempts would eventually be unable to finish a
 * maze they had already learned.
 *
 * Doors already opened stay open. The lesson of a burn is the corridor, not the
 * counterweight somebody already brought down.
 */
export const BURNOUT_FLASH_FRAMES = 24;

/**
 * How much longer than the bare traversal every safe window has to be.
 *
 * Applied by *slowing the simulated player down* rather than by padding the
 * windows: a route that a crawler 25% slower than the human can walk cleanly is
 * a route the human walks with a quarter of the window still unspent.
 */
export const MAZE_TIMING_MARGIN = 1.25;

/** Frames a character at the human's walking speed needs to cross one tile. */
export const FRAMES_PER_TILE = TILE_SIZE / PLAYER_SPEED;

/** One vent's clock. `phaseFrames` shifts its cycle relative to the shared frame counter. */
export interface VentSchedule {
  readonly tileX: number;
  readonly tileY: number;
  readonly periodFrames: number;
  readonly telegraphFrames: number;
  readonly flameFrames: number;
  readonly phaseFrames: number;
}

export type VentPhase = 'idle' | 'telegraph' | 'flame';

/** Where a vent is in its cycle on `frame`. */
export function ventPhaseAt(vent: VentSchedule, frame: number): VentPhase {
  const period = vent.periodFrames;
  const t = (((frame + vent.phaseFrames) % period) + period) % period;
  const flameStart = period - vent.flameFrames;
  if (t >= flameStart) return 'flame';
  if (t >= flameStart - vent.telegraphFrames) return 'telegraph';
  return 'idle';
}

/** How far through its burn a lit vent is, 0..1. Zero when it is not lit. */
export function ventFlameProgress(vent: VentSchedule, frame: number): number {
  if (ventPhaseAt(vent, frame) !== 'flame') return 0;
  const period = vent.periodFrames;
  const t = (((frame + vent.phaseFrames) % period) + period) % period;
  return (t - (period - vent.flameFrames)) / vent.flameFrames;
}

/** How far through its warning a telegraphing vent is, 0..1. Zero otherwise. */
export function ventTelegraphProgress(vent: VentSchedule, frame: number): number {
  if (ventPhaseAt(vent, frame) !== 'telegraph') return 0;
  const period = vent.periodFrames;
  const t = (((frame + vent.phaseFrames) % period) + period) % period;
  const telegraphStart = period - vent.flameFrames - vent.telegraphFrames;
  return (t - telegraphStart) / vent.telegraphFrames;
}

// ── Corridor archetypes ───────────────────────────────────────────────────────

export type CorridorArchetype = 'sprint' | 'pulse' | 'alcove';
export type MazeHalf = 'human' | 'cat';

/**
 * One trapped corridor: the tiles a crawler walks through it, which of those
 * tiles they may stand on indefinitely, and the vents in between.
 *
 * The route runs rest zone to rest zone, so index 0 and the last index are
 * always safe ground outside the trap — which is what makes it impossible to
 * have to leave the idle character parked inside one.
 */
export interface MazeCorridor {
  readonly id: string;
  readonly half: MazeHalf;
  readonly archetype: CorridorArchetype;
  readonly route: ReadonlyArray<MazeTile>;
  /** Indices into {@link route} the character can wait on. Always includes both ends. */
  readonly waypointIndices: ReadonlyArray<number>;
  readonly vents: ReadonlyArray<VentSchedule>;
}

// Sprint: a wall of flame walks the corridor from the entry threshold toward the
// exit, one tile every SPRINT_WAVE_STEP_FRAMES. The step is deliberately longer
// than FRAMES_PER_TILE — the crawler outpaces the wave, so a crawler who keeps
// moving stays ahead of it and one who stops is overrun.
const SPRINT_PERIOD_FRAMES = 300;
const SPRINT_FLAME_FRAMES = 40;
const SPRINT_WAVE_STEP_FRAMES = 18;

// Pulse: two banks in exact anti-phase, with a vent-free dwell cell between
// every pair. Half the corridor burns at all times, so the crawler advances one
// bank per swap rather than walking through.
const PULSE_PERIOD_FRAMES = 240;
const PULSE_FLAME_FRAMES = 120;
const PULSE_BANK_B_PHASE_FRAMES = PULSE_PERIOD_FRAMES / 2;

// Alcove weave: one flame wall sweeps the whole corridor against the direction
// of travel on a long clock, and vent-free pockets open off the side every few
// tiles for the crawler to tuck into as it goes past.
const ALCOVE_PERIOD_FRAMES = 240;
const ALCOVE_FLAME_FRAMES = 45;
const ALCOVE_SWEEP_STEP_FRAMES = 16;

/**
 * The wave step of a sprint corridor, exported so the gate can check the one
 * property that archetype rests on: the crawler is faster than the fire.
 */
export const SPRINT_WAVE_STEP = SPRINT_WAVE_STEP_FRAMES;

function ventAt(
  tileX: number,
  tileY: number,
  periodFrames: number,
  flameFrames: number,
  phaseFrames: number,
): VentSchedule {
  return {
    tileX,
    tileY,
    periodFrames,
    telegraphFrames: FLAME_TELEGRAPH_FRAMES,
    flameFrames,
    phaseFrames: ((phaseFrames % periodFrames) + periodFrames) % periodFrames,
  };
}

/**
 * A row of vents lit one after another along `xs`, in the order given.
 *
 * The phase runs *backwards* against the sequence because a vent's flame sits
 * at the end of its own cycle: the tile meant to erupt later needs the smaller
 * phase offset, not the larger one.
 */
function sweepVents(
  xs: ReadonlyArray<number>,
  tileY: number,
  periodFrames: number,
  flameFrames: number,
  stepFrames: number,
): VentSchedule[] {
  return xs.map((x, index) => ventAt(x, tileY, periodFrames, flameFrames, -index * stepFrames));
}

/** Two anti-phase banks over one corridor row. */
function pulseVents(
  bankA: ReadonlyArray<number>,
  bankB: ReadonlyArray<number>,
  tileY: number,
): VentSchedule[] {
  return [
    ...bankA.map((x) => ventAt(x, tileY, PULSE_PERIOD_FRAMES, PULSE_FLAME_FRAMES, 0)),
    ...bankB.map((x) =>
      ventAt(x, tileY, PULSE_PERIOD_FRAMES, PULSE_FLAME_FRAMES, PULSE_BANK_B_PHASE_FRAMES),
    ),
  ];
}

/** Consecutive tiles along one row, inclusive, in the order walked. */
function rowRun(fromX: number, toX: number, y: number): MazeTile[] {
  const step = toX >= fromX ? 1 : -1;
  const tiles: MazeTile[] = [];
  for (let x = fromX; x !== toX + step; x += step) tiles.push({ x, y });
  return tiles;
}

const HUMAN_SPRINT_ROW = 23;
const HUMAN_PULSE_ROW = 21;
const HUMAN_ALCOVE_ROW = 19;
const HUMAN_ALCOVE_POCKET_ROW = 18;
const CAT_ALCOVE_ROW = 23;
const CAT_ALCOVE_POCKET_ROW = 24;
const CAT_SPRINT_ROW = 21;
const CAT_PULSE_ROW = 19;

/**
 * The human's half, walked south-to-north: a sprint east along the bottom, a
 * pulse back west, then a weave east to the brace in the dividing wall.
 */
const HUMAN_CORRIDORS: ReadonlyArray<MazeCorridor> = [
  {
    id: 'human_sprint',
    half: 'human',
    archetype: 'sprint',
    route: rowRun(4, 17, HUMAN_SPRINT_ROW),
    waypointIndices: [0, 13],
    vents: sweepVents(
      [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      HUMAN_SPRINT_ROW,
      SPRINT_PERIOD_FRAMES,
      SPRINT_FLAME_FRAMES,
      SPRINT_WAVE_STEP_FRAMES,
    ),
  },
  {
    id: 'human_pulse',
    half: 'human',
    archetype: 'pulse',
    route: rowRun(18, 6, HUMAN_PULSE_ROW),
    waypointIndices: [0, 3, 6, 9, 12],
    vents: pulseVents([14, 13, 8, 7], [17, 16, 11, 10], HUMAN_PULSE_ROW),
  },
  {
    id: 'human_alcove',
    half: 'human',
    archetype: 'alcove',
    route: [
      { x: 6, y: HUMAN_ALCOVE_ROW },
      { x: 7, y: HUMAN_ALCOVE_ROW },
      { x: 8, y: HUMAN_ALCOVE_POCKET_ROW },
      { x: 9, y: HUMAN_ALCOVE_ROW },
      { x: 10, y: HUMAN_ALCOVE_ROW },
      { x: 11, y: HUMAN_ALCOVE_ROW },
      { x: 12, y: HUMAN_ALCOVE_POCKET_ROW },
      { x: 13, y: HUMAN_ALCOVE_ROW },
      { x: 14, y: HUMAN_ALCOVE_ROW },
      { x: 15, y: HUMAN_ALCOVE_ROW },
      { x: 16, y: HUMAN_ALCOVE_POCKET_ROW },
      { x: 17, y: HUMAN_ALCOVE_ROW },
    ],
    waypointIndices: [0, 2, 6, 10, 11],
    // Swept against the direction of travel, so the wall comes at the crawler
    // rather than running away from them — an alcove they can wait behind is
    // only worth having if the fire is coming the other way.
    vents: sweepVents(
      [16, 15, 14, 13, 12, 11, 10, 9, 8, 7],
      HUMAN_ALCOVE_ROW,
      ALCOVE_PERIOD_FRAMES,
      ALCOVE_FLAME_FRAMES,
      ALCOVE_SWEEP_STEP_FRAMES,
    ),
  },
];

/**
 * The cat's half, walked the other way round: a weave west to the counterweight
 * grate, a sprint back east, then a pulse west toward the second grate.
 */
const CAT_CORRIDORS: ReadonlyArray<MazeCorridor> = [
  {
    id: 'cat_alcove',
    half: 'cat',
    archetype: 'alcove',
    route: [
      { x: 39, y: CAT_ALCOVE_ROW },
      { x: 38, y: CAT_ALCOVE_ROW },
      { x: 37, y: CAT_ALCOVE_ROW },
      { x: 36, y: CAT_ALCOVE_ROW },
      { x: 35, y: CAT_ALCOVE_POCKET_ROW },
      { x: 34, y: CAT_ALCOVE_ROW },
      { x: 33, y: CAT_ALCOVE_ROW },
      { x: 32, y: CAT_ALCOVE_ROW },
      { x: 31, y: CAT_ALCOVE_POCKET_ROW },
      { x: 30, y: CAT_ALCOVE_ROW },
      { x: 29, y: CAT_ALCOVE_ROW },
      { x: 28, y: CAT_ALCOVE_ROW },
      { x: 27, y: CAT_ALCOVE_POCKET_ROW },
      { x: 26, y: CAT_ALCOVE_ROW },
      { x: 25, y: CAT_ALCOVE_ROW },
    ],
    waypointIndices: [0, 4, 8, 12, 14],
    vents: sweepVents(
      [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
      CAT_ALCOVE_ROW,
      ALCOVE_PERIOD_FRAMES,
      ALCOVE_FLAME_FRAMES,
      ALCOVE_SWEEP_STEP_FRAMES,
    ),
  },
  {
    id: 'cat_sprint',
    half: 'cat',
    archetype: 'sprint',
    route: rowRun(24, 38, CAT_SPRINT_ROW),
    waypointIndices: [0, 14],
    vents: sweepVents(
      [25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37],
      CAT_SPRINT_ROW,
      SPRINT_PERIOD_FRAMES,
      SPRINT_FLAME_FRAMES,
      SPRINT_WAVE_STEP_FRAMES,
    ),
  },
  {
    id: 'cat_pulse',
    half: 'cat',
    archetype: 'pulse',
    route: rowRun(39, 24, CAT_PULSE_ROW),
    waypointIndices: [0, 3, 6, 9, 12, 15],
    vents: pulseVents([38, 37, 32, 31, 26, 25], [35, 34, 29, 28], CAT_PULSE_ROW),
  },
];

export const MAZE_CORRIDORS: ReadonlyArray<MazeCorridor> = [...HUMAN_CORRIDORS, ...CAT_CORRIDORS];

/** Every vent in the maze, in no particular order. */
export const MAZE_VENTS: ReadonlyArray<VentSchedule> = MAZE_CORRIDORS.flatMap(
  (corridor) => corridor.vents,
);

// ── Cross-character blocks ────────────────────────────────────────────────────

/**
 * How the blocked half's door is opened: a sandbag counterweight the cat shoots
 * out from behind its grate, or a load-bearing brace the human breaks with a
 * swing through the wall.
 */
export type BlockTargetKind = 'sandbag' | 'brace';

export interface MazeBlock {
  readonly id: string;
  /** Which crawler is stopped by the barrier. */
  readonly blocks: MazeHalf;
  /** Which crawler can reach the target. Always the other one. */
  readonly clearedBy: MazeHalf;
  readonly kind: BlockTargetKind;
  /** The wall tile that opens when the target is destroyed. */
  readonly barrierTile: MazeTile;
  /**
   * The dividing-wall tile the grate is painted on. Always stays wall — a
   * broken counterweight leaves a hole to see through, not one to walk through.
   */
  readonly grateTile: MazeTile;
  /**
   * The floor tile the destructible itself stands on, hard against the grate.
   *
   * On the *acting* half rather than inside the wall, because every player
   * attack in this game is gated on line of sight to its victim's centre, and
   * nothing has line of sight into a wall tile.
   */
  readonly propTile: MazeTile;
  /** Where the acting crawler stands to reach it — vent-free by construction. */
  readonly vantageTile: MazeTile;
  /** Where the blocked crawler waits — vent-free by construction. */
  readonly blockedRestTile: MazeTile;
}

/**
 * The four blocks, in the order the maze forces them: the human is stopped
 * first and the cat opens the way, then the cat is stopped and the human opens
 * it, and again, so neither crawler is ever the one doing all the work.
 */
export const MAZE_BLOCKS: ReadonlyArray<MazeBlock> = [
  {
    id: 'H1',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'sandbag',
    barrierTile: { x: 20, y: 22 },
    grateTile: { x: 21, y: 23 },
    propTile: { x: 22, y: 23 },
    vantageTile: { x: 23, y: 23 },
    blockedRestTile: { x: 20, y: 23 },
  },
  {
    id: 'C1',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'brace',
    barrierTile: { x: 22, y: 22 },
    grateTile: { x: 21, y: 19 },
    propTile: { x: 20, y: 19 },
    vantageTile: { x: 19, y: 19 },
    // One clear of the counterweight the cat shot out to get here, so it waits
    // beside the wreck rather than standing in it.
    blockedRestTile: { x: 23, y: 23 },
  },
  {
    id: 'H2',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'sandbag',
    barrierTile: { x: 20, y: 18 },
    grateTile: { x: 21, y: 15 },
    propTile: { x: 22, y: 15 },
    vantageTile: { x: 23, y: 15 },
    // One clear of the brace the human broke to get here, for the same reason.
    blockedRestTile: { x: 19, y: 19 },
  },
  {
    id: 'C2',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'brace',
    barrierTile: { x: 28, y: 14 },
    grateTile: { x: 21, y: 13 },
    propTile: { x: 20, y: 13 },
    vantageTile: { x: 19, y: 13 },
    // One clear of the counterweight the cat shot out to get here, for the same
    // reason its predecessors are.
    blockedRestTile: { x: 23, y: 15 },
  },
];

/** Vent-free pockets off the weave corridors, for the flood-fill and the gate. */
export const MAZE_ALCOVE_TILES: ReadonlyArray<MazeTile> = MAZE_CORRIDORS.filter(
  (corridor) => corridor.archetype === 'alcove',
).flatMap((corridor) =>
  corridor.waypointIndices
    .map((index) => corridor.route[index])
    .filter((tile) => tile.y !== corridor.route[0].y),
);

/** Whether a tile lies inside the final chamber. */
export function isInFinalChamber(tileX: number, tileY: number): boolean {
  return (
    tileX >= MAZE_FINAL_CHAMBER.x0 &&
    tileX <= MAZE_FINAL_CHAMBER.x1 &&
    tileY >= MAZE_FINAL_CHAMBER.y0 &&
    tileY <= MAZE_FINAL_CHAMBER.y1
  );
}
