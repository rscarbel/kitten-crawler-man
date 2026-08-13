/**
 * The Big Top's maze — the authored floor plan, its hazard schedules, and every
 * cross-character block, in one place.
 *
 * The tent turns into this only while "The Show Must Go On" is at its final
 * act. Two crawlers come in through two flaps and walk two sealed lanes through
 * three acts — the fire walk, the menagerie, the hall of mirrors — meeting only
 * in the paired curtain rooms between acts and again in the centre ring, where
 * Grimaldi is waiting.
 *
 * Everything here is data rather than generation, because the trap choreography
 * depends on exact corridor lengths: a procedural maze would have to re-derive
 * the timing every run, and the timing is the part that has to be provably
 * survivable. `scripts/verify-bigtop-maze.ts` imports these same exports and
 * walks a slowed-down player through every crossing, so the numbers the game
 * runs on are the numbers the gate proves.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';

/**
 * The maze floor, one string per row, south end last.
 *
 * ```
 *  #  wall            .  sawdust floor      ^  tent pole
 *  H  human entrance  C  cat entrance
 *
 *  Act I, the fire walk:
 *  1  gate barring the human's first leg    a  its sandbag counterweight
 *  2  barricade barring the cat's           b  its supporting brace
 *  3  gate barring the human's second leg   c  its sandbag counterweight
 *  4  barricade barring the cat's second    d  its supporting brace
 *
 *  Between acts:
 *  K  the human's curtain   L  the cat's curtain   W  the barred window
 *
 *  Act II, the menagerie:
 *  5  cage gate barring the human's first leg   e  its release ring
 *  6  cage gate barring the cat's first         f  its capstan
 *  7  cage gate barring the human's second      g  its release ring
 *  8  cage gate barring the cat's second        h  its capstan
 *
 *  The single floor tiles set into the wall rows above each crossing are the
 *  alcove pockets a crawler ducks into to let a lantern sweep past.
 *
 *  Act III, the hall of mirrors:
 *  P  the human's limelight projector   Q  the cat's
 *  *  a star target set in the dividing wall
 *  <  the gate barring the human       >  the gate barring the cat
 *  [  the human's exit door            ]  the cat's
 * ```
 *
 * Gates, barricades, curtains and doors stand as wall until cleared. The
 * lettered tiles stay wall forever — a broken counterweight is a hole in a
 * grate, not a doorway — and only carry the prop the other lane shoots or
 * smashes.
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
  '#############..................#############',
  '#############..................#############',
  '#############..................#############',
  '##################K#####L###################',
  '#################....#....##################',
  '#################....W....##################',
  '#################....#....##################',
  '###############....#####.....###############',
  '###############[############]###############',
  '###############.############.###############',
  '###############<############>###############',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................*.................#####',
  '#####................#.................#####',
  '####P................#.................Q####',
  '#####................#.................#####',
  '#####................*.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................*.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '#####................#.................#####',
  '##################K#####L###################',
  '#################....#....##################',
  '#################....W....##################',
  '#################....#....##################',
  '###############....#####.....###############',
  '###############.############.###############',
  '###############.############.###############',
  '######...............#...............#######',
  '######...............#...............#######',
  '######...............#...............#######',
  '######...............#...............#######',
  '######...............#...............#######',
  '######...............h...............#######',
  '###################.##.#####################',
  '##########.####.###7##8####.####.###########',
  '######...............g...............#######',
  '######.#############################.#######',
  '######.###.####.###########.####.###.#######',
  '######...............f...............#######',
  '###################.##.#####################',
  '##########.####.###5##6####.####.###########',
  '######...............e...............#######',
  '######.#############################.#######',
  '######.#############################.#######',
  '######.............#####.............#######',
  '##################K#####L###################',
  '#################....#....##################',
  '#################....W....##################',
  '#################....#....##################',
  '###############....#####.....###############',
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
export const MAZE_HEIGHT = 88;

/** Legend characters, so nothing has to spell a literal twice. */
export const MAZE_WALL_CHAR = '#';
export const MAZE_FLOOR_CHAR = '.';
export const MAZE_POLE_CHAR = '^';
export const MAZE_HUMAN_SPAWN_CHAR = 'H';
export const MAZE_CAT_SPAWN_CHAR = 'C';

/**
 * Every character the layout is allowed to contain.
 *
 * Read by the gate rather than by the game: an unlisted glyph is silently a
 * wall, so a typo in the table would seal a lane with no other symptom.
 */
export const MAZE_LEGEND_CHARS = '#.^HC1234abcdKLW5678efgh<>[]*PQ';

export interface MazeTile {
  readonly x: number;
  readonly y: number;
}

/** The two flaps the party comes in through, and leaves by. */
export const MAZE_EXIT_TILES: ReadonlyArray<MazeTile> = [
  { x: 17, y: 87 },
  { x: 26, y: 87 },
];

export const MAZE_HUMAN_SPAWN_TILE: MazeTile = { x: 17, y: 85 };
export const MAZE_CAT_SPAWN_TILE: MazeTile = { x: 26, y: 85 };

/**
 * The centre ring at the tent pole, where the lanes meet and nothing burns.
 * Inclusive bounds.
 */
export const MAZE_FINAL_CHAMBER = { x0: 13, y0: 1, x1: 30, y1: 11 } as const;

/** Grimaldi's own tile — the south face of the pole cluster his mass wraps. */
export const MAZE_GRIMALDI_TILE: MazeTile = { x: 21, y: 6 };

export type MazeHalf = 'human' | 'cat';

// ── Sections ──────────────────────────────────────────────────────────────────

export type MazeSectionId = 'firewalk' | 'menagerie' | 'mirrors' | 'finale';

/**
 * One act of the tent's show.
 *
 * `humanSpawn` / `catSpawn` are the marks the house hauls a failed crawler back
 * to. Failing anywhere in an act costs that act, never the whole run: every
 * curtain, cage gate and lit star already earned stays earned, because a reset
 * that re-locked them would demand a partner who is also back at the start and
 * would never converge.
 */
export interface MazeSection {
  readonly id: MazeSectionId;
  /** The band this act owns, inclusive, including the curtain rooms at its top. */
  readonly rowRange: { readonly y0: number; readonly y1: number };
  readonly humanSpawn: MazeTile;
  readonly catSpawn: MazeTile;
  readonly banner: string;
}

/** Shown once on entry, before the first act's own card. */
export const BIGTOP_ENTRY_BANNER = 'UNDER THE BIG TOP';
export const BIGTOP_ENTRY_SUBTITLE = 'Two rings. Two performers. Neither walks alone.';

export const ACT_ONE_BANNER = 'ACT I: THE FIRE WALK';
export const ACT_TWO_BANNER = 'ACT II: THE MENAGERIE';
export const ACT_THREE_BANNER = 'ACT III: THE HALL OF MIRRORS';
export const LAST_ACT_BANNER = 'THE LAST ACT';

/** South to north, in the order the tent runs them. */
export const MAZE_SECTIONS: ReadonlyArray<MazeSection> = [
  {
    id: 'firewalk',
    rowRange: { y0: 62, y1: 87 },
    humanSpawn: MAZE_HUMAN_SPAWN_TILE,
    catSpawn: MAZE_CAT_SPAWN_TILE,
    banner: ACT_ONE_BANNER,
  },
  {
    id: 'menagerie',
    rowRange: { y0: 37, y1: 61 },
    humanSpawn: { x: 18, y: 61 },
    catSpawn: { x: 24, y: 61 },
    banner: ACT_TWO_BANNER,
  },
  {
    id: 'mirrors',
    rowRange: { y0: 12, y1: 36 },
    humanSpawn: { x: 18, y: 36 },
    catSpawn: { x: 24, y: 36 },
    banner: ACT_THREE_BANNER,
  },
  {
    id: 'finale',
    rowRange: { y0: 0, y1: 11 },
    humanSpawn: { x: 18, y: 11 },
    catSpawn: { x: 24, y: 11 },
    banner: LAST_ACT_BANNER,
  },
];

/** Inclusive tile rectangle. */
export interface MazeRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function rectContains(rect: MazeRect, tileX: number, tileY: number): boolean {
  return tileX >= rect.x0 && tileX <= rect.x1 && tileY >= rect.y0 && tileY <= rect.y1;
}

/**
 * The paired rooms between two acts, and the curtains they open.
 *
 * Hazard-free on purpose: the pair is the one place in the tent where the party
 * is guaranteed to be standing still in the same room, so it is where the show
 * puts its interval. Both crawlers have to be in their own room before either
 * curtain lifts, which is what keeps the two of them in the same act — a party
 * split across two acts would have one crawler resetting to a mark the other
 * cannot reach.
 */
export interface MazeCurtain {
  readonly id: string;
  /** The act the pair opens onto. */
  readonly opens: MazeSectionId;
  readonly humanRoom: MazeRect;
  readonly catRoom: MazeRect;
  readonly humanBarrier: MazeTile;
  readonly catBarrier: MazeTile;
  /** The barred window between the rooms, so each crawler can see the other arrive. */
  readonly windowTile: MazeTile;
}

function curtainAt(id: string, opens: MazeSectionId, top: number): MazeCurtain {
  return {
    id,
    opens,
    humanRoom: { x0: 17, y0: top + 1, x1: 20, y1: top + 3 },
    catRoom: { x0: 22, y0: top + 1, x1: 25, y1: top + 3 },
    humanBarrier: { x: 18, y: top },
    catBarrier: { x: 24, y: top },
    windowTile: { x: 21, y: top + 2 },
  };
}

export const MAZE_CURTAINS: ReadonlyArray<MazeCurtain> = [
  curtainAt('curtain_menagerie', 'menagerie', 62),
  curtainAt('curtain_mirrors', 'mirrors', 37),
  curtainAt('curtain_finale', 'finale', 12),
];

// ── Trap timing ───────────────────────────────────────────────────────────────

/**
 * Frames a vent glows before it erupts.
 *
 * The floor the game's fairness rules put under any telegraphed hazard is 21
 * frames; this sits above it because a vent is on the ground the player is
 * *standing* on rather than out in front of them, and a floor tell has to be
 * read while the eye is on somewhere else.
 */
export const FLAME_TELEGRAPH_FRAMES = 30;

/**
 * Frames a spotlight warms before it opens up.
 *
 * Longer than a vent's: the lantern swings in from off the crawler's own tile,
 * so the pool of dim gold that precedes it is read out of the corner of an eye
 * that is watching the crossing rather than the floor.
 */
export const SPOTLIGHT_WARM_FRAMES = 36;

/**
 * Frames the screen holds its white-out when the house hauls a crawler back.
 *
 * Failing in here costs no health at all — it costs the act. Both crawlers wake
 * up at the top of the act they were in and walk it again, which is a price
 * paid in the thing the room is actually made of. Health would be the wrong
 * currency twice over: an act is a timing puzzle rather than a fight, and a
 * party whittled down by failed attempts would eventually be unable to finish
 * an act they had already learned.
 *
 * Doors already opened stay open. The lesson of a burn is the crossing, not the
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

/** One hazard cell's clock. `phaseFrames` shifts its cycle relative to the shared frame counter. */
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
  telegraphFrames = FLAME_TELEGRAPH_FRAMES,
): VentSchedule {
  return {
    tileX,
    tileY,
    periodFrames,
    telegraphFrames,
    flameFrames,
    phaseFrames: ((phaseFrames % periodFrames) + periodFrames) % periodFrames,
  };
}

/**
 * A row of cells lit one after another along `xs`, in the order given.
 *
 * The phase runs *backwards* against the sequence because a cell's flame sits
 * at the end of its own cycle: the tile meant to erupt later needs the smaller
 * phase offset, not the larger one.
 */
function sweepVents(
  xs: ReadonlyArray<number>,
  tileY: number,
  periodFrames: number,
  flameFrames: number,
  stepFrames: number,
  telegraphFrames = FLAME_TELEGRAPH_FRAMES,
): VentSchedule[] {
  return xs.map((x, index) =>
    ventAt(x, tileY, periodFrames, flameFrames, -index * stepFrames, telegraphFrames),
  );
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

/**
 * A walk along one row that steps up into a side pocket and back down again.
 *
 * The pocket's own column is walked **three** times — onto the boards, up into
 * the pocket, back down onto the boards — rather than cut diagonally, because
 * that is what the game's mover actually does. Movement resolves X and Y
 * separately and the tile beside a pocket is wall, so the vertical step is
 * refused until the crawler's centre has already reached the pocket's column:
 * they are standing on the boards under it, every time, in both directions.
 *
 * Modelled as a diagonal, those two tiles never appear in any route, so nothing
 * ever checks whether the fire on them is survivable — and it was pure luck of
 * the schedule that it was.
 */
function weaveRoute(
  fromX: number,
  toX: number,
  runRow: number,
  pocketRow: number,
  pocketXs: ReadonlyArray<number>,
): MazeTile[] {
  const tiles: MazeTile[] = [];
  for (const tile of rowRun(fromX, toX, runRow)) {
    tiles.push(tile);
    if (!pocketXs.includes(tile.x)) continue;
    tiles.push({ x: tile.x, y: pocketRow });
    tiles.push(tile);
  }
  return tiles;
}

/** Both ends of a weave, plus every pocket in it: the ground it may be waited on. */
function weaveWaypoints(route: ReadonlyArray<MazeTile>, pocketRow: number): number[] {
  return [
    0,
    ...route.flatMap((tile, index) => (tile.y === pocketRow ? [index] : [])),
    route.length - 1,
  ];
}

const HUMAN_ALCOVE_POCKET_XS = [8, 12, 16];
const CAT_ALCOVE_POCKET_XS = [35, 31, 27];

const HUMAN_SPRINT_ROW = 81;
const HUMAN_PULSE_ROW = 79;
const HUMAN_ALCOVE_ROW = 77;
const HUMAN_ALCOVE_POCKET_ROW = 76;
const CAT_ALCOVE_ROW = 81;
const CAT_ALCOVE_POCKET_ROW = 82;
const CAT_SPRINT_ROW = 79;
const CAT_PULSE_ROW = 77;

const HUMAN_ALCOVE_ROUTE = weaveRoute(
  6,
  17,
  HUMAN_ALCOVE_ROW,
  HUMAN_ALCOVE_POCKET_ROW,
  HUMAN_ALCOVE_POCKET_XS,
);
const CAT_ALCOVE_ROUTE = weaveRoute(
  39,
  25,
  CAT_ALCOVE_ROW,
  CAT_ALCOVE_POCKET_ROW,
  CAT_ALCOVE_POCKET_XS,
);

/**
 * The human's lane through the fire walk, walked south-to-north: a sprint east
 * along the bottom, a pulse back west, then a weave east to the brace in the
 * dividing wall.
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
    route: HUMAN_ALCOVE_ROUTE,
    waypointIndices: weaveWaypoints(HUMAN_ALCOVE_ROUTE, HUMAN_ALCOVE_POCKET_ROW),
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
 * The cat's lane through the fire walk, walked the other way round: a weave
 * west to the counterweight grate, a sprint back east, then a pulse west toward
 * the second grate.
 */
const CAT_CORRIDORS: ReadonlyArray<MazeCorridor> = [
  {
    id: 'cat_alcove',
    half: 'cat',
    archetype: 'alcove',
    route: CAT_ALCOVE_ROUTE,
    waypointIndices: weaveWaypoints(CAT_ALCOVE_ROUTE, CAT_ALCOVE_POCKET_ROW),
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

/** Every flame vent in the maze, in no particular order. */
export const MAZE_VENTS: ReadonlyArray<VentSchedule> = MAZE_CORRIDORS.flatMap(
  (corridor) => corridor.vents,
);

// ── Act II: the menagerie ─────────────────────────────────────────────────────

// The ushers' lanterns run on the same clocks as the fire walk's vents, staggered
// along their track so the light sweeps rather than blinking. The beam is long
// and the idle stretch is longer, because a crossing is meant to be waited out
// or bought with a bell rather than sprinted through on a guess.
const SPOTLIGHT_PERIOD_FRAMES = 240;
const SPOTLIGHT_BEAM_FRAMES = 66;
const SPOTLIGHT_SWEEP_STEP_FRAMES = 15;

/**
 * Frames a rung bell keeps its ushers off the floor.
 *
 * Sized against the *walked* crossing rather than the straight-line one. A
 * crawler steps onto the boards under each pocket on the way in and again on
 * the way out — the mover resolves the two axes separately, so the diagonal a
 * route can draw is not one it can take — and costing that honestly added
 * nearly forty frames a crossing. What the bell promises is one clean walk from
 * end to end; this is that walk with about three seconds still unspent.
 */
export const BELL_HOLD_FRAMES = 480;
/**
 * Frames from one ring before the bell will answer again.
 *
 * Deliberately longer than the hold, but only by a couple of seconds. Both
 * crossings on a row together are more than one hold buys, so the second
 * crawler waits their turn rather than both of them walking through on one
 * pull — the bell is a resource the party spends on one of them at a time,
 * which is what makes taking turns the play. The gap is kept short because the
 * waiting is meant to be a beat, not a stall.
 */
export const BELL_COOLDOWN_FRAMES = 600;

/**
 * One usher's lantern, sweeping a crossing.
 *
 * The cells are ordinary {@link VentSchedule}s so that every fairness rule the
 * fire walk already obeys — the telegraph floor, the idle-time check, the
 * margin-slowed traversal simulation — applies to a spotlight without a second
 * implementation to keep honest.
 */
export interface SpotlightTrack {
  readonly id: string;
  readonly half: MazeHalf;
  /** The bell that calls this lantern off the floor. */
  readonly bellId: string;
  readonly cells: ReadonlyArray<VentSchedule>;
}

function spotlightTrack(
  id: string,
  half: MazeHalf,
  bellId: string,
  xs: ReadonlyArray<number>,
  tileY: number,
): SpotlightTrack {
  return {
    id,
    half,
    bellId,
    cells: sweepVents(
      xs,
      tileY,
      SPOTLIGHT_PERIOD_FRAMES,
      SPOTLIGHT_BEAM_FRAMES,
      SPOTLIGHT_SWEEP_STEP_FRAMES,
      SPOTLIGHT_WARM_FRAMES,
    ),
  };
}

const HUMAN_TRACK_XS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const CAT_TRACK_XS = [25, 26, 27, 28, 29, 30, 31, 32, 33, 34];

/**
 * Every lantern sweeps *against* the crossing it guards.
 *
 * A sweep running the same way the crawler walks is a light they can simply
 * keep pace behind, and three of these were exactly that — walkable from most
 * of the ring's phases with the bell buying nothing. Coming the other way, the
 * light arrives at them, and the bell is the answer the act is built around.
 */
const againstTravel = (xs: ReadonlyArray<number>, walksEast: boolean): ReadonlyArray<number> =>
  walksEast ? [...xs].reverse() : xs;

export const MAZE_SPOTLIGHTS: ReadonlyArray<SpotlightTrack> = [
  spotlightTrack(
    'spot_human_first',
    'human',
    'bell_first',
    againstTravel(HUMAN_TRACK_XS, true),
    58,
  ),
  spotlightTrack('spot_cat_first', 'cat', 'bell_first', againstTravel(CAT_TRACK_XS, false), 58),
  spotlightTrack(
    'spot_human_second',
    'human',
    'bell_second',
    againstTravel(HUMAN_TRACK_XS, false),
    55,
  ),
  spotlightTrack('spot_cat_second', 'cat', 'bell_second', againstTravel(CAT_TRACK_XS, true), 55),
  spotlightTrack(
    'spot_human_third',
    'human',
    'bell_third',
    againstTravel(HUMAN_TRACK_XS, true),
    52,
  ),
  spotlightTrack('spot_cat_third', 'cat', 'bell_third', againstTravel(CAT_TRACK_XS, false), 52),
];

export const MAZE_SPOTLIGHT_CELLS: ReadonlyArray<VentSchedule> = MAZE_SPOTLIGHTS.flatMap(
  (track) => track.cells,
);

/**
 * A show-bell on its stand, and the lanterns it calls in.
 *
 * Every bell stands in the cat's lane and holds the pair of lanterns on its
 * row — one in each lane. That is the whole cross-character point of the act:
 * Donut buys Carl his crossing and then buys her own, and neither of them ever
 * walks a lit floor because they timed it right on their own.
 */
export interface MazeBell {
  readonly id: string;
  readonly tile: MazeTile;
  readonly holds: ReadonlyArray<string>;
}

/**
 * Every stand sits one tile short of the crossing it buys, on the shaft the cat
 * comes down to reach it.
 *
 * That placement is load-bearing rather than tidy. A bell across the act from
 * its own crossing spends most of its hold on the walk to the threshold, and
 * the hold is the only thing standing between the crawler and the lanterns —
 * so a bell she has to travel to is a crossing she cannot make. The gate walks
 * bell to threshold to far side at margin speed and proves the whole trip fits.
 */
export const MAZE_BELLS: ReadonlyArray<MazeBell> = [
  { id: 'bell_first', tile: { x: 36, y: 59 }, holds: ['spot_human_first', 'spot_cat_first'] },
  { id: 'bell_second', tile: { x: 22, y: 56 }, holds: ['spot_human_second', 'spot_cat_second'] },
  { id: 'bell_third', tile: { x: 36, y: 53 }, holds: ['spot_human_third', 'spot_cat_third'] },
];

/**
 * The crossings a spotlight track guards, walked end to end.
 *
 * Authored rather than derived from the track, because what has to be provably
 * survivable is the walk a crawler actually makes — rest ground on one side of
 * the lanterns to rest ground on the other — and that is longer than the lit
 * cells at both ends.
 */
export interface SpotlightCrossing {
  readonly trackId: string;
  readonly route: ReadonlyArray<MazeTile>;
  /**
   * Indices into {@link SpotlightCrossing.route} the crawler can wait on: both
   * ends, and every alcove pocket in between.
   */
  readonly waypointIndices: ReadonlyArray<number>;
}

/**
 * Alcove pockets cut off the boards, two to a crossing.
 *
 * The menagerie shipped without them and playtesters stopped dead at its first
 * crossing: a run with no refuge cannot be learned by walking into it, because
 * the only lesson a mistimed entry teaches is that the act has restarted. The
 * fire walk already taught the answer one act earlier — duck into the pocket,
 * let the wall of light go by — so the menagerie asks for the same verb, and
 * the bell goes back to being what buys a crossing in one clean walk rather
 * than the only thing that makes one possible at all.
 */
function crossing(
  trackId: string,
  fromX: number,
  toX: number,
  runRow: number,
  pocketRow: number,
  pocketXs: ReadonlyArray<number>,
): SpotlightCrossing {
  const route = weaveRoute(fromX, toX, runRow, pocketRow, pocketXs);
  return { trackId, route, waypointIndices: weaveWaypoints(route, pocketRow) };
}

const HUMAN_POCKET_XS = [10, 15];
const CAT_POCKET_XS = [27, 32];

export const MAZE_SPOTLIGHT_CROSSINGS: ReadonlyArray<SpotlightCrossing> = [
  crossing('spot_human_first', 6, 20, 58, 57, HUMAN_POCKET_XS),
  crossing('spot_cat_first', 36, 22, 58, 57, CAT_POCKET_XS),
  crossing('spot_human_second', 20, 6, 55, 54, HUMAN_POCKET_XS),
  crossing('spot_cat_second', 22, 36, 55, 54, CAT_POCKET_XS),
  crossing('spot_human_third', 6, 20, 52, 51, HUMAN_POCKET_XS),
  crossing('spot_cat_third', 36, 22, 52, 51, CAT_POCKET_XS),
];

/** Every pocket, for the flood-fill, the dressing and the gate. */
export const MAZE_MENAGERIE_POCKETS: ReadonlyArray<MazeTile> = MAZE_SPOTLIGHT_CROSSINGS.flatMap(
  (entry) =>
    entry.waypointIndices
      .map((index) => entry.route[index])
      .filter((tile) => tile.y !== entry.route[0].y),
);

// ── Cross-character blocks ────────────────────────────────────────────────────

/**
 * How the blocked lane's door is opened.
 *
 * The fire walk hangs a sandbag counterweight behind a grate for the cat to
 * shoot out, or drives a load-bearing brace through the wall for the human to
 * break. The menagerie swaps them for machinery that shows its work: a capstan
 * the human turns a notch at a time, and a release ring the cat shoots to drop
 * a striped sack that hauls a cage gate up on its rope.
 */
export type MazeBlockKind = 'sandbag' | 'brace' | 'release_ring' | 'capstan';

/** Everything in the tent a crawler's attack key is meant to land on. */
export type MazeTargetKind = MazeBlockKind | 'show_bell' | 'pivot_mirror' | 'swivel_mirror';

/**
 * Which crawler each kind belongs to, which is also what colours it.
 *
 * Donut's are red-and-white striped canvas with gold trim and a hoop ring drawn
 * round them; Carl's are circus blue and brass on heavy timber. The palette is
 * the answer to "whose job is that" from across a room.
 */
/** Every prop kind, so a check can walk them all without naming them again. */
export const MAZE_TARGET_KINDS: ReadonlyArray<MazeTargetKind> = [
  'sandbag',
  'brace',
  'release_ring',
  'capstan',
  'show_bell',
  'pivot_mirror',
  'swivel_mirror',
];

export const MAZE_TARGET_OWNER: Readonly<Record<MazeTargetKind, MazeHalf>> = {
  sandbag: 'cat',
  brace: 'human',
  release_ring: 'cat',
  capstan: 'human',
  show_bell: 'cat',
  pivot_mirror: 'human',
  swivel_mirror: 'cat',
};

export interface MazeBlock {
  readonly id: string;
  readonly section: MazeSectionId;
  /** Which crawler is stopped by the barrier. */
  readonly blocks: MazeHalf;
  /** Which crawler can reach the target. Always the other one. */
  readonly clearedBy: MazeHalf;
  readonly kind: MazeBlockKind;
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
   * On the *acting* lane rather than inside the wall, because every player
   * attack in this game is gated on line of sight to its victim's centre, and
   * nothing has line of sight into a wall tile.
   */
  readonly propTile: MazeTile;
  /** Where the acting crawler stands to reach it — hazard-free by construction. */
  readonly vantageTile: MazeTile;
  /** Where the blocked crawler waits — hazard-free by construction. */
  readonly blockedRestTile: MazeTile;
}

/**
 * The eight blocks, in the order the maze forces them: within each act the
 * human is stopped first and the cat opens the way, then the cat is stopped and
 * the human opens it, and again, so neither crawler is ever the one doing all
 * the work.
 */
export const MAZE_BLOCKS: ReadonlyArray<MazeBlock> = [
  {
    id: 'H1',
    section: 'firewalk',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'sandbag',
    barrierTile: { x: 20, y: 80 },
    grateTile: { x: 21, y: 81 },
    propTile: { x: 22, y: 81 },
    vantageTile: { x: 23, y: 81 },
    blockedRestTile: { x: 20, y: 81 },
  },
  {
    id: 'C1',
    section: 'firewalk',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'brace',
    barrierTile: { x: 22, y: 80 },
    grateTile: { x: 21, y: 77 },
    propTile: { x: 20, y: 77 },
    vantageTile: { x: 19, y: 77 },
    // One clear of the counterweight the cat shot out to get here, so it waits
    // beside the wreck rather than standing in it.
    blockedRestTile: { x: 23, y: 81 },
  },
  {
    id: 'H2',
    section: 'firewalk',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'sandbag',
    barrierTile: { x: 20, y: 76 },
    grateTile: { x: 21, y: 73 },
    propTile: { x: 22, y: 73 },
    vantageTile: { x: 23, y: 73 },
    // One clear of the brace the human broke to get here, for the same reason.
    blockedRestTile: { x: 19, y: 77 },
  },
  {
    id: 'C2',
    section: 'firewalk',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'brace',
    barrierTile: { x: 28, y: 72 },
    grateTile: { x: 21, y: 71 },
    propTile: { x: 20, y: 71 },
    vantageTile: { x: 19, y: 71 },
    // One clear of the counterweight the cat shot out to get here, for the same
    // reason its predecessors are.
    blockedRestTile: { x: 23, y: 73 },
  },
  {
    id: 'M1',
    section: 'menagerie',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'release_ring',
    barrierTile: { x: 19, y: 57 },
    grateTile: { x: 21, y: 58 },
    propTile: { x: 22, y: 58 },
    vantageTile: { x: 23, y: 58 },
    blockedRestTile: { x: 20, y: 58 },
  },
  {
    id: 'M2',
    section: 'menagerie',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'capstan',
    barrierTile: { x: 22, y: 57 },
    grateTile: { x: 21, y: 55 },
    propTile: { x: 20, y: 55 },
    vantageTile: { x: 19, y: 55 },
    // Beside the ring the cat shot out to get here, rather than on top of it.
    blockedRestTile: { x: 23, y: 58 },
  },
  {
    id: 'M3',
    section: 'menagerie',
    blocks: 'human',
    clearedBy: 'cat',
    kind: 'release_ring',
    barrierTile: { x: 19, y: 51 },
    grateTile: { x: 21, y: 52 },
    propTile: { x: 22, y: 52 },
    vantageTile: { x: 23, y: 52 },
    blockedRestTile: { x: 20, y: 52 },
  },
  {
    id: 'M4',
    section: 'menagerie',
    blocks: 'cat',
    clearedBy: 'human',
    kind: 'capstan',
    barrierTile: { x: 22, y: 51 },
    grateTile: { x: 21, y: 49 },
    propTile: { x: 20, y: 49 },
    vantageTile: { x: 19, y: 49 },
    blockedRestTile: { x: 23, y: 52 },
  },
];

/**
 * Whether a tile is one the maze can open, and therefore never wall for good.
 *
 * Anything hung on one — a cage front, an arch post — would outlive the opening
 * and go on saying "barred" over ground the party is meant to walk through.
 */
export function isMazeBarrierTile(tileX: number, tileY: number): boolean {
  if (MAZE_BLOCKS.some((block) => block.barrierTile.x === tileX && block.barrierTile.y === tileY))
    return true;
  if (
    MAZE_CURTAINS.some(
      (curtain) =>
        (curtain.humanBarrier.x === tileX && curtain.humanBarrier.y === tileY) ||
        (curtain.catBarrier.x === tileX && curtain.catBarrier.y === tileY),
    )
  ) {
    return true;
  }
  return MAZE_STARS.some((star) => star.opens.some((tile) => tile.x === tileX && tile.y === tileY));
}

// ── Act III: the hall of mirrors ──────────────────────────────────────────────

export type BeamDirection = 'north' | 'south' | 'east' | 'west';

/**
 * Which way a mirror's reflective diagonal faces, named for the two edges of
 * its tile the glass connects.
 *
 * A beam that arrives at one of those two edges leaves by the other. A beam
 * that arrives at either of the other two edges hits the mirror's back and
 * stops there — which is what makes a facing a real choice rather than a
 * cosmetic one, and what lets a single mirror both steer the light and hold it.
 */
export type MirrorFacing = 'NE' | 'SE' | 'SW' | 'NW';

const MIRROR_ARMS: Readonly<Record<MirrorFacing, ReadonlyArray<BeamDirection>>> = {
  NE: ['north', 'east'],
  SE: ['south', 'east'],
  SW: ['south', 'west'],
  NW: ['north', 'west'],
};

const OPPOSITE: Readonly<Record<BeamDirection, BeamDirection>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

const BEAM_STEP: Readonly<Record<BeamDirection, MazeTile>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/** Where a beam travelling `heading` leaves this mirror, or null if it is absorbed. */
export function reflectBeam(facing: MirrorFacing, heading: BeamDirection): BeamDirection | null {
  const arms = MIRROR_ARMS[facing];
  const entry = OPPOSITE[heading];
  if (!arms.includes(entry)) return null;
  return arms[0] === entry ? arms[1] : arms[0];
}

export type MirrorKind = 'pivot_mirror' | 'swivel_mirror';

/**
 * One steerable mirror.
 *
 * Carl's pivots are heavy standing glass that turns a quarter at a time through
 * all four facings; Donut's swivels are spring-mounted and snap between two.
 * The cycle is authored rather than computed so a swivel's pair can be the two
 * facings that matter on its own leg of the beam.
 */
export interface MazeMirror {
  readonly id: string;
  readonly kind: MirrorKind;
  readonly tile: MazeTile;
  readonly cycle: ReadonlyArray<MirrorFacing>;
  readonly initialIndex: number;
}

export const MAZE_MIRRORS: ReadonlyArray<MazeMirror> = [
  {
    id: 'pivot_hub',
    kind: 'pivot_mirror',
    tile: { x: 17, y: 26 },
    cycle: ['NE', 'SE', 'SW', 'NW'],
    initialIndex: 0,
  },
  {
    id: 'pivot_north',
    kind: 'pivot_mirror',
    tile: { x: 17, y: 24 },
    cycle: ['NE', 'SE', 'SW', 'NW'],
    initialIndex: 0,
  },
  {
    id: 'pivot_south',
    kind: 'pivot_mirror',
    tile: { x: 17, y: 28 },
    cycle: ['NE', 'SE', 'SW', 'NW'],
    initialIndex: 3,
  },
  {
    id: 'swivel_hub',
    kind: 'swivel_mirror',
    tile: { x: 25, y: 26 },
    cycle: ['NE', 'SE'],
    initialIndex: 0,
  },
  {
    id: 'swivel_north',
    kind: 'swivel_mirror',
    tile: { x: 25, y: 24 },
    cycle: ['SW', 'NW'],
    initialIndex: 1,
  },
  {
    id: 'swivel_south',
    kind: 'swivel_mirror',
    tile: { x: 25, y: 32 },
    cycle: ['NW', 'SW'],
    initialIndex: 1,
  },
];

/**
 * A limelight, bolted into the wall of its lane.
 *
 * The span between the lens and the first mirror on its ray is still fire, and
 * it is the one hazard in the hall. Everything past that first bounce is cold
 * light. That is not a concession — it is what makes the hall fair: the burning
 * geometry never moves, however the players aim the rest of the beam.
 */
export interface MazeProjector {
  readonly id: string;
  readonly half: MazeHalf;
  readonly tile: MazeTile;
  readonly direction: BeamDirection;
}

export const MAZE_PROJECTORS: ReadonlyArray<MazeProjector> = [
  { id: 'limelight_human', half: 'human', tile: { x: 4, y: 26 }, direction: 'east' },
  { id: 'limelight_cat', half: 'cat', tile: { x: 39, y: 26 }, direction: 'west' },
];

/**
 * A star target set in the dividing wall, and the barriers it latches open.
 *
 * `litBy` names every lane whose beam has to be on it at once. One lane for the
 * two cross-character stars; both for the twin, which is the act's crescendo and
 * the only thing in the tent that asks the two beams to agree.
 */
export interface MazeStar {
  readonly id: string;
  readonly tile: MazeTile;
  readonly litBy: ReadonlyArray<MazeHalf>;
  readonly opens: ReadonlyArray<MazeTile>;
}

export const MAZE_STARS: ReadonlyArray<MazeStar> = [
  {
    id: 'star_cat_gate',
    tile: { x: 21, y: 28 },
    litBy: ['human'],
    opens: [{ x: 28, y: 19 }],
  },
  {
    id: 'star_human_gate',
    tile: { x: 21, y: 32 },
    litBy: ['cat'],
    opens: [{ x: 15, y: 19 }],
  },
  {
    id: 'star_twin',
    tile: { x: 21, y: 24 },
    litBy: ['human', 'cat'],
    opens: [
      { x: 15, y: 17 },
      { x: 28, y: 17 },
    ],
  },
];

export interface BeamStep {
  readonly tile: MazeTile;
  readonly heading: BeamDirection;
  /** True while the beam has not yet met a mirror: still fire rather than light. */
  readonly hot: boolean;
}

export interface BeamPath {
  readonly steps: ReadonlyArray<BeamStep>;
  /** The star the beam ends on, if it ends on one. */
  readonly starId: string | null;
}

/**
 * Walks a limelight from its lens until something stops it.
 *
 * `facingOf` and `isOpenTile` are parameters rather than lookups so the same
 * walk answers both the live question — where is the light now — and the gate's
 * question, which is whether *any* arrangement of these mirrors lands it on a
 * given star. A mirror that returns `null` is treated as opaque, which is how
 * the unbent span is measured.
 */
export function traceMazeBeam(
  half: MazeHalf,
  facingOf: (mirrorId: string) => MirrorFacing | null,
  isOpenTile: (tileX: number, tileY: number) => boolean,
): BeamPath {
  const projector = MAZE_PROJECTORS.find((candidate) => candidate.half === half);
  if (projector === undefined) return { steps: [], starId: null };

  const steps: BeamStep[] = [];
  let heading = projector.direction;
  let x = projector.tile.x;
  let y = projector.tile.y;
  let hot = true;

  // The grid bounds the walk on every side; the budget is only a backstop
  // against a mirror arrangement that could loop the light forever.
  const maxSteps = MAZE_WIDTH * MAZE_HEIGHT;
  for (let step = 0; step < maxSteps; step++) {
    const move = BEAM_STEP[heading];
    x += move.x;
    y += move.y;

    const star = MAZE_STARS.find((candidate) => candidate.tile.x === x && candidate.tile.y === y);
    if (star !== undefined) return { steps, starId: star.id };

    const mirror = MAZE_MIRRORS.find(
      (candidate) => candidate.tile.x === x && candidate.tile.y === y,
    );
    if (mirror !== undefined) {
      const facing = facingOf(mirror.id);
      // Deliberately no step for the mirror's own tile. The unbent span is
      // measured with every facing opaque, which returns before this line — so
      // pushing one here would paint fire on a tile the hazard set does not
      // contain, and the glass is drawn there anyway.
      if (facing === null) return { steps, starId: null };
      const next = reflectBeam(facing, heading);
      if (next === null) return { steps, starId: null };
      heading = next;
      hot = false;
      continue;
    }

    if (!isOpenTile(x, y)) return { steps, starId: null };
    steps.push({ tile: { x, y }, heading, hot });
  }
  return { steps, starId: null };
}

// ── Where the dressing hangs ──────────────────────────────────────────────────

/**
 * The two lanes of the menagerie, the wall rows its cage fronts hang on, and
 * the row its bleachers fill.
 *
 * Authored beside the floor plan rather than derived from the crossings,
 * because dressing is about the *walls* that bound a lane and a crossing only
 * knows about its floor.
 */
export const MENAGERIE_LANES: ReadonlyArray<{
  readonly half: MazeHalf;
  readonly x0: number;
  readonly x1: number;
}> = [
  { half: 'human', x0: 6, x1: 20 },
  { half: 'cat', x0: 22, x1: 36 },
];
export const MENAGERIE_CAGE_ROWS: ReadonlyArray<number> = [51, 54, 57];
export const MENAGERIE_BLEACHER_ROW = 43;

/** The hall of mirrors, and the wall columns its panes are set into. */
export const MIRROR_HALL_ROWS: { readonly y0: number; readonly y1: number } = { y0: 20, y1: 36 };
export const MIRROR_HALL_GLASS_COLUMNS: ReadonlyArray<number> = [4, 21, 39];

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Vent-free pockets off the weave corridors, for the flood-fill and the gate. */
export const MAZE_ALCOVE_TILES: ReadonlyArray<MazeTile> = MAZE_CORRIDORS.filter(
  (corridor) => corridor.archetype === 'alcove',
).flatMap((corridor) =>
  corridor.waypointIndices
    .map((index) => corridor.route[index])
    .filter((tile) => tile.y !== corridor.route[0].y),
);

/** Whether a tile lies inside the centre ring. */
export function isInFinalChamber(tileX: number, tileY: number): boolean {
  return rectContains(MAZE_FINAL_CHAMBER, tileX, tileY);
}

/** The act a row belongs to. Every row of the maze belongs to exactly one. */
export function sectionAtRow(tileY: number): MazeSection {
  const found = MAZE_SECTIONS.find(
    (section) => tileY >= section.rowRange.y0 && tileY <= section.rowRange.y1,
  );
  // The bands are authored to tile the whole grid, and the gate asserts it.
  if (found === undefined) throw new Error(`no Big Top maze section covers row ${tileY}`);
  return found;
}
