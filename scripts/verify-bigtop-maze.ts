#!/usr/bin/env tsx
/**
 * Headless checks for the Big Top's three-act trap maze and its finale.
 *
 * Everything here reads the game's own exported layout and hazard tables — never
 * a copy — so a crossing retuned in the game is a crossing retuned in this gate.
 *
 * The feasibility check is a simulation rather than a formula: a crawler walking
 * 25% slower than the human is stepped through every corridor tile by tile, and
 * the corridor passes only if some entry moment lets that slow crawler cross
 * without ever standing on a lit hazard. Twenty-five percent is
 * `MAZE_TIMING_MARGIN`, so a corridor this crawler survives is one the real
 * human walks with a quarter of every window still unspent.
 *
 * Run: npx tsx scripts/verify-bigtop-maze.ts
 */
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { BuildingSystem } from '../src/systems/BuildingSystem';
import {
  bigTopWallAt,
  buildBigTopDressing,
  BigTopMazeSystem,
  HAZARD_ESCAPE_RADIUS_TILES,
} from '../src/systems/BigTopMazeSystem';
import { MazeBlockTarget } from '../src/creatures/MazeBlockTarget';
import { MazeBellTarget } from '../src/creatures/MazeBellTarget';
import { MazeMirrorTarget } from '../src/creatures/MazeMirrorTarget';
import { MAZE_TARGET_DAMAGE_TYPES, type MazePropTarget } from '../src/creatures/MazePropTarget';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { GrimaldiVine } from '../src/creatures/GrimaldiVine';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import type { Mob, PlayerDamageType } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';
import { EventBus } from '../src/core/EventBus';
import { makeSepsis } from '../src/core/StatusEffect';
import { BIG_TOP_SEALED_MESSAGE, createCircusQuestProgress } from '../src/core/CircusQuestProgress';
import {
  BELL_HOLD_FRAMES,
  BIG_TOP_MAZE_ROWS,
  FRAMES_PER_TILE,
  isInFinalChamber,
  MAZE_ALCOVE_TILES,
  MAZE_BELLS,
  MAZE_BLOCKS,
  MAZE_CAT_SPAWN_TILE,
  MAZE_CORRIDORS,
  MAZE_CURTAINS,
  MAZE_EXIT_TILES,
  MAZE_GRIMALDI_TILE,
  MAZE_HEIGHT,
  MAZE_HUMAN_SPAWN_TILE,
  MAZE_LEGEND_CHARS,
  MAZE_MENAGERIE_POCKETS,
  MAZE_MIRRORS,
  MAZE_PROJECTORS,
  MAZE_SECTIONS,
  MAZE_SPOTLIGHT_CELLS,
  MAZE_SPOTLIGHT_CROSSINGS,
  MAZE_SPOTLIGHTS,
  MAZE_STARS,
  MAZE_TARGET_KINDS,
  MAZE_TARGET_OWNER,
  MAZE_TIMING_MARGIN,
  MAZE_VENTS,
  MAZE_WIDTH,
  SPRINT_WAVE_STEP,
  traceMazeBeam,
  ventPhaseAt,
  type MazeCorridor,
  type MazeHalf,
  type MazeSectionId,
  type MazeTile,
  type MirrorFacing,
  type VentSchedule,
} from '../src/map/bigTopMazeLayout';

/**
 * The telegraph floor the game's fairness rules put under any hazard the player
 * is expected to move out of. Restated here rather than imported so the gate is
 * an independent assertion about the number, not a tautology over it.
 */
const FAIRNESS_TELEGRAPH_FLOOR_FRAMES = 21;

/** Enough to flatten a target in one blow, for the checks that only want it broken. */
const BLOCK_TARGET_PROBE_DAMAGE = 1000;
/** A bound on the swing loop, so a target that stops answering fails rather than hangs. */
const BLOCK_TARGET_MAX_SWINGS = 100;

/**
 * Swings a prop the way a player does: one blow, then the frames between blows.
 *
 * The props hold a short lockout after every landed hit, so that one Magic
 * Missile bursting into six sub-missiles at the impact point counts once. A
 * loop that hammers `takeDamageFrom` inside a single frame would measure the
 * lockout rather than the prop.
 */
function swingAt(prop: MazePropTarget, damageType: PlayerDamageType, swings: number): void {
  for (let swing = 0; swing < swings; swing++) {
    prop.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, damageType);
    for (let frame = 0; frame < BLOW_LOCKOUT_SETTLE_FRAMES; frame++) prop.updateAI([]);
  }
}

/** Every crossing keeps at least this many places to duck aside. */
const MINIMUM_POCKETS_PER_CROSSING = 2;

/** Intervals between the flaps and the hall of mirrors. */
const CURTAINS_TO_THE_MIRRORS = 2;

/** Longer than any prop's lockout, so a scripted swing always lands. */
const BLOW_LOCKOUT_SETTLE_FRAMES = 16;
/** The most sub-missiles one Magic Missile splits into at its highest level. */
const SUB_MISSILE_BURST = 6;
/** Longer than the slowest hazard's whole cycle, so a burnout probe always sees one light. */
const BURNOUT_SEARCH_FRAMES = 400;
/** Longer than any hazard cycle in the tent, so a quiet stretch is really quiet. */
const FIGHT_PRESSURE_FRAMES = 900;

/** A tile and everything touching it, including diagonally. */
const ADJACENT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The order the maze forces its eight cross-character blocks into. */
const BLOCK_ORDER = ['H1', 'C1', 'H2', 'C2', 'M1', 'M2', 'M3', 'M4'] as const;

/** Big enough to generate a town with its full set of buildings. */
const TOWN_MAP_SIZE = 220;
/** Frames the door gate is held on one tile, to prove it does not repeat itself. */
const DOOR_DWELL_FRAMES = 30;
/** How far south of a doorway counts as standing clear of it. */
const AWAY_FROM_DOOR_TILES = 3;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

const tileKey = (tile: MazeTile): string => `${tile.x},${tile.y}`;

/**
 * Looks a row up in a table and fails loudly when it is not there.
 *
 * A gate that skips a check it could not find its subject for reports "all
 * passed" while measuring nothing, which is worse than no gate at all.
 */
function required<T>(value: T | undefined, what: string): T | null {
  if (value === undefined) {
    check(false, `${what} exists in the layout`);
    return null;
  }
  return value;
}

// ── Layout shape ──────────────────────────────────────────────────────────────

console.log('Checking the authored layout…');
{
  check(
    BIG_TOP_MAZE_ROWS.length === MAZE_HEIGHT,
    `${BIG_TOP_MAZE_ROWS.length} rows (expected ${MAZE_HEIGHT})`,
  );
  const wrongWidth = BIG_TOP_MAZE_ROWS.filter((row) => row.length !== MAZE_WIDTH);
  check(wrongWidth.length === 0, `every row is ${MAZE_WIDTH} tiles wide`);

  // An unlisted glyph is silently a wall, so a typo would seal a lane with no
  // other symptom anywhere in the game.
  const legend = new Set(MAZE_LEGEND_CHARS.split(''));
  const strays = new Set<string>();
  for (const row of BIG_TOP_MAZE_ROWS) {
    for (const glyph of row) if (!legend.has(glyph)) strays.add(glyph);
  }
  check(
    strays.size === 0,
    `every glyph is in the legend (${[...strays].join('') || 'none stray'})`,
  );
}

console.log('\nChecking the act bands…');
{
  const uncovered: number[] = [];
  const doubled: number[] = [];
  for (let y = 0; y < MAZE_HEIGHT; y++) {
    const covering = MAZE_SECTIONS.filter(
      (section) => y >= section.rowRange.y0 && y <= section.rowRange.y1,
    );
    if (covering.length === 0) uncovered.push(y);
    if (covering.length > 1) doubled.push(y);
  }
  check(uncovered.length === 0, `every row belongs to an act (${uncovered.length} orphaned)`);
  check(doubled.length === 0, `no row belongs to two acts (${doubled.length} overlapping)`);
  check(MAZE_SECTIONS.length === 4, `${MAZE_SECTIONS.length} acts (expected 4)`);
  check(
    MAZE_SECTIONS[0].humanSpawn.x === MAZE_HUMAN_SPAWN_TILE.x &&
      MAZE_SECTIONS[0].humanSpawn.y === MAZE_HUMAN_SPAWN_TILE.y,
    "the fire walk's mark is the human flap",
  );
  check(
    MAZE_SECTIONS[0].catSpawn.x === MAZE_CAT_SPAWN_TILE.x &&
      MAZE_SECTIONS[0].catSpawn.y === MAZE_CAT_SPAWN_TILE.y,
    "and the fire walk's other mark is the cat flap",
  );
  const banners = new Set(MAZE_SECTIONS.map((section) => section.banner));
  check(banners.size === MAZE_SECTIONS.length, 'every act has a banner of its own');
}

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
map.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');

console.log('\nChecking the generated map…');
{
  for (const section of MAZE_SECTIONS) {
    for (const spawn of [section.humanSpawn, section.catSpawn]) {
      check(map.isWalkable(spawn.x, spawn.y), `${section.id}: mark ${tileKey(spawn)} is walkable`);
      // A one-tile pocket passes `isWalkable` and traps whoever is put in it.
      check(
        hasRoomToMove(map, spawn.x, spawn.y),
        `${section.id}: mark ${tileKey(spawn)} has room to move`,
      );
    }
  }
  check(
    map.startTile.x === MAZE_HUMAN_SPAWN_TILE.x && map.startTile.y === MAZE_HUMAN_SPAWN_TILE.y,
    'the map start tile is the human flap',
  );
  check(
    map._interiorExitTiles.length === MAZE_EXIT_TILES.length,
    `${map._interiorExitTiles.length} exit tiles`,
  );
  check(
    map.isWalkable(MAZE_GRIMALDI_TILE.x, MAZE_GRIMALDI_TILE.y) &&
      isInFinalChamber(MAZE_GRIMALDI_TILE.x, MAZE_GRIMALDI_TILE.y),
    `Grimaldi's tile ${tileKey(MAZE_GRIMALDI_TILE)} is open ground in the centre ring`,
  );
  for (const projector of MAZE_PROJECTORS) {
    check(
      !map.isWalkable(projector.tile.x, projector.tile.y),
      `${projector.id} is bolted into the wall at ${tileKey(projector.tile)}`,
    );
  }
  for (const star of MAZE_STARS) {
    check(
      !map.isWalkable(star.tile.x, star.tile.y),
      `${star.id} is set in the dividing wall at ${tileKey(star.tile)}`,
    );
  }
}

// ── Telegraphs ────────────────────────────────────────────────────────────────

const ALL_HAZARD_CELLS: ReadonlyArray<VentSchedule> = [...MAZE_VENTS, ...MAZE_SPOTLIGHT_CELLS];

console.log('\nChecking every telegraph…');
{
  check(MAZE_VENTS.length > 0, `the fire walk actually has vents (${MAZE_VENTS.length})`);
  check(
    MAZE_SPOTLIGHT_CELLS.length > 0,
    `the menagerie actually has lantern cells (${MAZE_SPOTLIGHT_CELLS.length})`,
  );
  const short = ALL_HAZARD_CELLS.filter(
    (cell) => cell.telegraphFrames < FAIRNESS_TELEGRAPH_FLOOR_FRAMES,
  );
  check(
    short.length === 0,
    `every telegraph is at least ${FAIRNESS_TELEGRAPH_FLOOR_FRAMES} frames (${short.length} too short)`,
  );
  const overrun = ALL_HAZARD_CELLS.filter(
    (cell) => cell.telegraphFrames + cell.flameFrames >= cell.periodFrames,
  );
  check(overrun.length === 0, 'every hazard cell has idle time left in its cycle');
}

// ── Hazard placement ──────────────────────────────────────────────────────────

/** The unbent span of both limelights, which is the only part of a beam that burns. */
const HOT_BEAM_TILES = new Set<string>();
for (const half of ['human', 'cat'] as const) {
  const path = traceMazeBeam(
    half,
    () => null,
    (x, y) => map.isWalkable(x, y),
  );
  for (const step of path.steps) if (step.hot) HOT_BEAM_TILES.add(tileKey(step.tile));
}

console.log('\nChecking where hazards are allowed to be…');
{
  const forbidden = new Map<string, string>();
  const forbid = (tile: MazeTile, reason: string): void => {
    forbidden.set(tileKey(tile), reason);
  };
  for (const section of MAZE_SECTIONS) {
    forbid(section.humanSpawn, `${section.id}'s human mark`);
    forbid(section.catSpawn, `${section.id}'s cat mark`);
  }
  for (const exit of MAZE_EXIT_TILES) forbid(exit, 'an exit');
  for (const alcove of MAZE_ALCOVE_TILES) forbid(alcove, 'an alcove');
  for (const block of MAZE_BLOCKS) {
    forbid(block.vantageTile, `${block.id}'s vantage`);
    forbid(block.propTile, `${block.id}'s target`);
    forbid(block.blockedRestTile, `${block.id}'s rest zone`);
  }
  for (const corridor of MAZE_CORRIDORS) {
    for (const index of corridor.waypointIndices) {
      forbid(corridor.route[index], `${corridor.id}'s rest ground`);
    }
  }
  for (const bell of MAZE_BELLS) forbid(bell.tile, `${bell.id}'s stand`);
  for (const pocket of MAZE_MENAGERIE_POCKETS) forbid(pocket, 'a menagerie alcove');
  for (const mirror of MAZE_MIRRORS) forbid(mirror.tile, `${mirror.id}'s mount`);
  for (const curtain of MAZE_CURTAINS) {
    for (const room of [curtain.humanRoom, curtain.catRoom]) {
      for (let y = room.y0; y <= room.y1; y++) {
        for (let x = room.x0; x <= room.x1; x++) forbid({ x, y }, `${curtain.id}'s interval room`);
      }
    }
  }

  const trespassing = ALL_HAZARD_CELLS.filter((cell) =>
    forbidden.has(`${cell.tileX},${cell.tileY}`),
  );
  for (const cell of trespassing) {
    console.log(
      `  (hazard at ${cell.tileX},${cell.tileY} sits on ${forbidden.get(`${cell.tileX},${cell.tileY}`) ?? '?'})`,
    );
  }
  check(trespassing.length === 0, 'no hazard sits on ground the player must be able to stand on');

  const hotOnStanding = [...HOT_BEAM_TILES].filter((key) => forbidden.has(key));
  for (const key of hotOnStanding) {
    console.log(`  (the unbent limelight crosses ${key}, which is ${forbidden.get(key) ?? '?'})`);
  }
  check(hotOnStanding.length === 0, 'neither limelight burns ground the player must stand on');

  const inChamber = ALL_HAZARD_CELLS.filter((cell) => isInFinalChamber(cell.tileX, cell.tileY));
  check(inChamber.length === 0, 'no timed hazard is in the centre ring');

  const offFloor = ALL_HAZARD_CELLS.filter((cell) => !map.isWalkable(cell.tileX, cell.tileY));
  check(offFloor.length === 0, 'every hazard cell is on walkable floor');

  // The tiles the maze *forces* a crawler to be parked on need more than
  // hazard-free ground: the companion drive flees a hazard before it walks back
  // to its anchor, and that reach carries a little past a cell's own tile. A
  // rest zone hard against a lantern is a crawler pacing in and out of it.
  const hazardTiles = new Set(ALL_HAZARD_CELLS.map((cell) => `${cell.tileX},${cell.tileY}`));
  const crowded = MAZE_BLOCKS.filter((block) =>
    ADJACENT_OFFSETS.some(([dx, dy]) =>
      hazardTiles.has(`${block.blockedRestTile.x + dx},${block.blockedRestTile.y + dy}`),
    ),
  );
  for (const block of crowded) {
    console.log(`  (${block.id}'s rest zone ${tileKey(block.blockedRestTile)} touches a hazard)`);
  }
  check(crowded.length === 0, 'every block’s rest zone stands clear of the hazards around it');

  const seen = new Set<string>();
  const doubled = ALL_HAZARD_CELLS.filter((cell) => {
    const key = `${cell.tileX},${cell.tileY}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  check(doubled.length === 0, 'no tile carries two hazard cells');
}

// ── Corridor feasibility ──────────────────────────────────────────────────────

/**
 * The simulated crawler's speed: the human's, slowed by the timing margin. A
 * corridor this one clears is a corridor the human clears with room to spare.
 */
const MARGIN_SPEED_PX_PER_FRAME = PLAYER_SPEED / MAZE_TIMING_MARGIN;

function ventIndex(cells: ReadonlyArray<VentSchedule>): Map<string, VentSchedule> {
  const index = new Map<string, VentSchedule>();
  for (const cell of cells) index.set(`${cell.tileX},${cell.tileY}`, cell);
  return index;
}

/**
 * Whether a route is a walk the game's own mover can actually perform.
 *
 * Orthogonal steps only. `applyMovement` resolves X and Y independently and
 * refuses the vertical step while the tile beside the crawler is wall — so a
 * route that cuts the corner into a one-tile side pocket describes a path
 * nobody walks, and quietly excuses the two tiles under the pocket from every
 * check in this file. A diagonal is legal in open ground; an authored route
 * through a corridor is never in open ground.
 */
function isOrthogonalWalk(route: ReadonlyArray<MazeTile>): boolean {
  return route.every((tile, index) => {
    if (index === 0) return true;
    const previous = route[index - 1];
    return Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y) === 1;
  });
}

/** Frames the crawler needs to walk from one route tile to the next. */
function stepFrames(from: MazeTile, to: MazeTile): number {
  const distancePx = Math.hypot(to.x - from.x, to.y - from.y) * TILE_SIZE;
  return distancePx / MARGIN_SPEED_PX_PER_FRAME;
}

/** Frames the crawler needs to walk a whole route end to end. */
function routeFrames(route: ReadonlyArray<MazeTile>): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += stepFrames(route[i - 1], route[i]);
  return total;
}

/**
 * Whether the crawler can walk `route[from..to]` starting on `startFrame`
 * without ever standing on a lit hazard.
 *
 * The crawler owns a tile from the moment they step onto it until they step
 * off, so every whole frame in that window is checked — a vent that lights for
 * one frame while they are crossing is a vent that burns them.
 */
function legIsClean(
  route: ReadonlyArray<MazeTile>,
  cells: Map<string, VentSchedule>,
  from: number,
  to: number,
  startFrame: number,
): boolean {
  let enter = startFrame;
  for (let i = from + 1; i <= to; i++) {
    const tile = route[i];
    const exit = enter + stepFrames(route[i - 1], tile);
    const cell = cells.get(`${tile.x},${tile.y}`);
    if (cell !== undefined) {
      for (let frame = Math.floor(enter); frame <= Math.ceil(exit); frame++) {
        if (ventPhaseAt(cell, frame) === 'flame') return false;
      }
    }
    enter = exit;
  }
  return true;
}

/**
 * The crawler waits on each waypoint until the next leg is clean, then runs it.
 *
 * Shared by the fire walk's corridors and the menagerie's crossings, because
 * the two ask the same question — can a margin-slowed crawler get from one
 * piece of safe ground to the next before the light arrives — and a second
 * implementation is a second thing to keep honest.
 */
function routeIsWalkable(
  route: ReadonlyArray<MazeTile>,
  waypointIndices: ReadonlyArray<number>,
  hazardCells: ReadonlyArray<VentSchedule>,
): { ok: boolean; frames: number } {
  const cells = ventIndex(hazardCells);
  const longestPeriod = Math.max(...hazardCells.map((cell) => cell.periodFrames));
  const waypoints = [...waypointIndices].sort((a, b) => a - b);

  for (let entryFrame = 0; entryFrame < longestPeriod; entryFrame++) {
    let clock = entryFrame;
    let blocked = false;
    for (let leg = 0; leg + 1 < waypoints.length; leg++) {
      let departed = false;
      for (let wait = 0; wait <= longestPeriod; wait++) {
        if (!legIsClean(route, cells, waypoints[leg], waypoints[leg + 1], clock + wait)) continue;
        clock += wait;
        for (let i = waypoints[leg] + 1; i <= waypoints[leg + 1]; i++) {
          clock += stepFrames(route[i - 1], route[i]);
        }
        departed = true;
        break;
      }
      if (!departed) {
        blocked = true;
        break;
      }
    }
    if (!blocked) return { ok: true, frames: Math.round(clock - entryFrame) };
  }
  return { ok: false, frames: 0 };
}

function corridorIsWalkable(corridor: MazeCorridor): { ok: boolean; frames: number } {
  return routeIsWalkable(corridor.route, corridor.waypointIndices, corridor.vents);
}

console.log('\nWalking a margin-slowed crawler through every fire-walk corridor…');
{
  check(MAZE_CORRIDORS.length >= 6, `${MAZE_CORRIDORS.length} trapped corridors (want at least 6)`);
  for (const half of ['human', 'cat'] as const) {
    const archetypes = new Set(
      MAZE_CORRIDORS.filter((corridor) => corridor.half === half).map(
        (corridor) => corridor.archetype,
      ),
    );
    check(
      archetypes.size === 3,
      `the ${half} lane has one of every archetype (${[...archetypes].sort().join(', ')})`,
    );
  }
  for (const corridor of MAZE_CORRIDORS) {
    const waypoints = [...corridor.waypointIndices].sort((a, b) => a - b);
    check(
      waypoints[0] === 0 && waypoints[waypoints.length - 1] === corridor.route.length - 1,
      `${corridor.id}: opens onto rest ground at both ends`,
    );
    check(
      isOrthogonalWalk(corridor.route),
      `${corridor.id}: its route is a walk the mover can take`,
    );
    const onFloor = corridor.route.every((tile) => map.isWalkable(tile.x, tile.y));
    check(onFloor, `${corridor.id}: every route tile is open floor`);

    // No barrier may stand inside a trapped corridor. A gate half way along one
    // would strand whichever crawler is parked there in the middle of the fire,
    // waiting on the other lane.
    const routeTiles = new Set(corridor.route.map(tileKey));
    const barriersInside = MAZE_BLOCKS.filter((block) =>
      routeTiles.has(tileKey(block.barrierTile)),
    );
    check(
      barriersInside.length === 0,
      `${corridor.id}: no block stands inside it (${barriersInside.map((b) => b.id).join(', ') || 'none'})`,
    );

    const walk = corridorIsWalkable(corridor);
    check(
      walk.ok,
      `${corridor.id}: a crawler ${MAZE_TIMING_MARGIN}× slower than the human crosses it` +
        (walk.ok ? ` in ${walk.frames} frames` : ''),
    );
  }

  // The one property the sprint archetype rests on, which no per-tile window can
  // express: the crawler is faster than the wall of fire chasing them.
  check(
    SPRINT_WAVE_STEP >= FRAMES_PER_TILE * MAZE_TIMING_MARGIN,
    `the sprint wave takes ${SPRINT_WAVE_STEP} frames a tile, against the human's ` +
      `${FRAMES_PER_TILE.toFixed(1)} × ${MAZE_TIMING_MARGIN} = ` +
      `${(FRAMES_PER_TILE * MAZE_TIMING_MARGIN).toFixed(1)}`,
  );
}

/** How many tiles the shortest walk between two tiles takes, or null if there is none. */
function shortestWalk(from: MazeTile, to: MazeTile, opened: ReadonlySet<string>): number | null {
  const seen = new Map<string, number>([[tileKey(from), 0]]);
  const queue: MazeTile[] = [from];
  for (const tile of queue) {
    const steps = seen.get(tileKey(tile)) ?? 0;
    if (tile.x === to.x && tile.y === to.y) return steps;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || !passable(x, y, opened)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!passable(tile.x + dx, tile.y, opened) || !passable(tile.x, tile.y + dy, opened)) {
          continue;
        }
      }
      seen.set(key, steps + 1);
      queue.push({ x, y });
    }
  }
  return null;
}

// ── Reachability ──────────────────────────────────────────────────────────────

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Every barrier the maze can open, keyed by the tile it stands on. */
const barrierByTile = new Map<string, string>();
for (const block of MAZE_BLOCKS) barrierByTile.set(tileKey(block.barrierTile), block.id);
for (const curtain of MAZE_CURTAINS) {
  barrierByTile.set(tileKey(curtain.humanBarrier), curtain.id);
  barrierByTile.set(tileKey(curtain.catBarrier), curtain.id);
}
for (const star of MAZE_STARS) {
  for (const tile of star.opens) barrierByTile.set(tileKey(tile), star.id);
}

const EVERY_BARRIER: ReadonlyArray<string> = [
  ...MAZE_BLOCKS.map((block) => block.id),
  ...MAZE_CURTAINS.map((curtain) => curtain.id),
  ...MAZE_STARS.map((star) => star.id),
];

// The art an opened way wears is authored for a doorway you walk north through:
// the jambs go on the east and west edges and the chevrons point up the lane. It
// holds for all fourteen of them today, and nothing else in the file would
// notice if a later barrier were cut sideways into a wall.
console.log('\nChecking every barrier is a north–south doorway…');
{
  const everyBarrierOpen = new Set(EVERY_BARRIER);
  for (const [key, id] of barrierByTile) {
    const [x, y] = key.split(',').map(Number);
    check(
      passable(x, y - 1, everyBarrierOpen) && passable(x, y + 1, everyBarrierOpen),
      `${id} at ${key}: opens onto floor to the north and the south`,
    );
    check(
      !passable(x - 1, y, everyBarrierOpen) && !passable(x + 1, y, everyBarrierOpen),
      `${id} at ${key}: has a jamb either side of it`,
    );
  }
}

// The strides that hang cage fronts, bleachers, arch posts and panes of glass
// walk a lane counting tiles; they know nothing about the doorways and shafts
// cut through the wall they are walking. Three of them landed a barred cage on
// the alcove pockets the act's own hint tells the player to duck into.
console.log('\nChecking no dressing is hung over ground the party walks…');
{
  const everyBarrierOpen = new Set(EVERY_BARRIER);
  // The game's own predicate, not a copy of it: a gate that restated the rule
  // would keep passing while the system handed the builder a broken one.
  const dressing = buildBigTopDressing(bigTopWallAt(map));
  const wallHung: ReadonlyArray<string> = ['bleacher', 'cage', 'mirrorGlass', 'archPost'];
  const trespassing = dressing.filter(
    (piece) =>
      wallHung.includes(piece.kind) && passable(piece.tile.x, piece.tile.y, everyBarrierOpen),
  );
  check(
    trespassing.length === 0,
    `no wall-hung dressing stands on walkable ground (${trespassing
      .map((piece) => `${piece.kind} at ${tileKey(piece.tile)}`)
      .join(', ')})`,
  );
  check(
    dressing.some((piece) => piece.kind === 'cage'),
    `and the menagerie still has its cage fronts (${dressing.filter((piece) => piece.kind === 'cage').length})`,
  );
  check(
    dressing.some((piece) => piece.kind === 'bleacher'),
    'and the bleachers are still seated',
  );
}

function passable(x: number, y: number, opened: ReadonlySet<string>): boolean {
  const barrier = barrierByTile.get(`${x},${y}`);
  if (barrier !== undefined) return opened.has(barrier);
  return map.isWalkable(x, y);
}

function reachableFrom(start: MazeTile, opened: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>([tileKey(start)]);
  const queue: MazeTile[] = [start];
  for (const tile of queue) {
    for (const [dx, dy] of NEIGHBOURS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || !passable(x, y, opened)) continue;
      // No corner cutting, matching how the game's own pathing treats diagonals.
      if (dx !== 0 && dy !== 0) {
        if (!passable(tile.x + dx, tile.y, opened) || !passable(tile.x, tile.y + dy, opened)) {
          continue;
        }
      }
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

/**
 * The corridor waypoints a player can reach without crossing one of its vents.
 *
 * Run in the most permissive world the maze ever has — every barrier open —
 * minus this one corridor's vent tiles. Only its entry should come back: a
 * second waypoint means there is a way *into the middle* of the corridor from
 * somewhere else, and every vent before that point is decoration.
 */
function waypointsReachableWithoutVents(corridor: MazeCorridor): MazeTile[] {
  const removed = new Set(corridor.vents.map((vent) => `${vent.tileX},${vent.tileY}`));
  const everyBarrierOpen = new Set(EVERY_BARRIER);
  const walkable = (x: number, y: number): boolean =>
    !removed.has(`${x},${y}`) && passable(x, y, everyBarrierOpen);

  const entry = corridor.route[0];
  const seen = new Set<string>([tileKey(entry)]);
  const queue: MazeTile[] = [entry];
  for (const tile of queue) {
    for (const [dx, dy] of NEIGHBOURS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key) || !walkable(x, y)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!walkable(tile.x + dx, tile.y) || !walkable(tile.x, tile.y + dy)) continue;
      }
      seen.add(key);
      queue.push({ x, y });
    }
  }

  return corridor.waypointIndices
    .map((index) => corridor.route[index])
    .filter((tile) => !(tile.x === entry.x && tile.y === entry.y))
    .filter((tile) => seen.has(tileKey(tile)));
}

console.log('\nChecking that every trapped corridor has to be walked…');
{
  for (const corridor of MAZE_CORRIDORS) {
    const reachable = waypointsReachableWithoutVents(corridor);
    for (const tile of reachable) {
      console.log(`  (${corridor.id}: ${tileKey(tile)} can be reached without crossing a vent)`);
    }
    check(reachable.length === 0, `${corridor.id}: there is no way into it but through its vents`);
  }
}

// ── The menagerie's crossings ─────────────────────────────────────────────────

console.log('\nCrossing the menagerie with the bell rung at the threshold…');
{
  check(MAZE_SPOTLIGHTS.length > 0, `${MAZE_SPOTLIGHTS.length} lantern tracks`);
  const everyBarrierOpen = new Set(EVERY_BARRIER);

  for (const crossing of MAZE_SPOTLIGHT_CROSSINGS) {
    const track = required(
      MAZE_SPOTLIGHTS.find((candidate) => candidate.id === crossing.trackId),
      `the track ${crossing.trackId} its crossing names`,
    );
    if (track === null) continue;

    const onFloor = crossing.route.every((tile) => map.isWalkable(tile.x, tile.y));
    check(onFloor, `${track.id}: every tile of its crossing is open floor`);
    check(
      isOrthogonalWalk(crossing.route),
      `${track.id}: its crossing is a walk the mover can take`,
    );

    const cellTiles = new Set(track.cells.map((cell) => `${cell.tileX},${cell.tileY}`));
    const first = crossing.route[0];
    const last = crossing.route[crossing.route.length - 1];
    check(
      !cellTiles.has(tileKey(first)) && !cellTiles.has(tileKey(last)),
      `${track.id}: its crossing opens onto unlit ground at both ends`,
    );

    // Every lit cell has to be on the boards the crossing runs along, between
    // its two ends — a lantern sweeping anywhere else is decoration. Measured
    // against the run rather than against the route, because the route dips off
    // the boards at each pocket and those two cells are exactly the ones the
    // pockets exist to let the crawler stand out of.
    const runRow = first.y;
    const lowX = Math.min(first.x, last.x);
    const highX = Math.max(first.x, last.x);
    const strayCells = track.cells.filter(
      (cell) => cell.tileY !== runRow || cell.tileX < lowX || cell.tileX > highX,
    );
    check(strayCells.length === 0, `${track.id}: every lantern cell is on the boards it guards`);

    const bell = required(
      MAZE_BELLS.find((candidate) => candidate.id === track.bellId),
      `the bell ${track.bellId} the track names`,
    );
    if (bell === null) continue;
    check(bell.holds.includes(track.id), `${bell.id}: the bell the track names holds it back`);

    // The fairness contract, simulated rather than asserted: ring the bell, then
    // walk. The crawler who rings it is the cat, so her trip is the walk from
    // the stand to the threshold *and* the crossing; the human is already
    // standing at his own threshold in the other lane when she rings, so his is
    // the crossing alone. Either way the whole trip has to fit inside one hold,
    // at margin speed, with the lanterns back on the floor the moment it ends.
    const approachTiles =
      track.half === 'cat' ? shortestWalk(bell.tile, first, everyBarrierOpen) : 0;
    check(
      track.half !== 'cat' || approachTiles !== null,
      `${bell.id}: the cat can walk from the stand to ${track.id}'s threshold at all`,
    );
    const approachFrames =
      approachTiles === null
        ? Number.POSITIVE_INFINITY
        : approachTiles * FRAMES_PER_TILE * MAZE_TIMING_MARGIN;
    const crossingFrames = routeFrames(crossing.route);
    const trip = approachFrames + crossingFrames;
    check(
      trip <= BELL_HOLD_FRAMES,
      `${track.id}: ring to far side is ${Math.round(trip)} frames ` +
        `(${Math.round(approachFrames)} walking to the threshold, ${Math.round(crossingFrames)} crossing), ` +
        `inside the bell's ${BELL_HOLD_FRAMES}`,
    );

    // And the crossing has to be walkable with no bell rung at all, ducking
    // pocket to pocket. Playtesters stopped dead at the menagerie's first
    // crossing when this was not true: a run with no refuge cannot be learned
    // by walking into it, because the only thing a mistimed entry teaches is
    // that the act has restarted.
    const unaided = routeIsWalkable(crossing.route, crossing.waypointIndices, track.cells);
    check(
      unaided.ok,
      `${track.id}: a margin-slowed crawler crosses it pocket to pocket with no bell rung` +
        (unaided.ok ? ` in ${unaided.frames} frames` : ''),
    );

    // The pockets are refuges, not a way round: a crawler must still put their
    // feet on the swept boards. A dead end that quietly joined up would make
    // the whole act optional.
    {
      const lit = new Set(track.cells.map((cell) => `${cell.tileX},${cell.tileY}`));
      const seen = new Set<string>([tileKey(first)]);
      const queue: MazeTile[] = [first];
      for (const tile of queue) {
        for (const [dx, dy] of NEIGHBOURS) {
          const x = tile.x + dx;
          const y = tile.y + dy;
          const key = `${x},${y}`;
          if (seen.has(key) || lit.has(key) || !passable(x, y, everyBarrierOpen)) continue;
          if (dx !== 0 && dy !== 0) {
            if (!passable(tile.x + dx, tile.y, everyBarrierOpen)) continue;
            if (!passable(tile.x, tile.y + dy, everyBarrierOpen)) continue;
          }
          seen.add(key);
          queue.push({ x, y });
        }
      }
      check(
        !seen.has(tileKey(last)),
        `${track.id}: the alcoves are refuges, not a way round the lanterns`,
      );
    }

    const pockets = crossing.waypointIndices
      .map((index) => crossing.route[index])
      .filter((tile) => tile.y !== first.y);
    check(
      pockets.length >= MINIMUM_POCKETS_PER_CROSSING,
      `${track.id}: has ${pockets.length} alcove pockets to wait in`,
    );
    for (const pocket of pockets) {
      check(
        map.isWalkable(pocket.x, pocket.y),
        `${track.id}: its pocket ${tileKey(pocket)} is floor`,
      );
      check(
        !cellTiles.has(tileKey(pocket)),
        `${track.id}: nothing sweeps the pocket at ${tileKey(pocket)}`,
      );
    }
  }

  const menagerie = required(
    MAZE_SECTIONS.find((section) => section.id === 'menagerie'),
    'the menagerie band',
  );
  for (const bell of MAZE_BELLS) {
    for (const trackId of bell.holds) {
      check(
        MAZE_SPOTLIGHTS.some((track) => track.id === trackId),
        `${bell.id}: the track ${trackId} it holds exists`,
      );
    }
    // A stand the cat cannot walk up to is a crossing nobody can buy.
    if (menagerie === null) continue;
    const reach = reachableFrom(menagerie.catSpawn, everyBarrierOpen);
    check(reach.has(tileKey(bell.tile)), `${bell.id}: the cat can reach the stand`);
  }
}

// ── What the attack key produces ──────────────────────────────────────────────

/**
 * Every damage type a crawler's attack key can produce, restated here rather
 * than imported so this is an independent claim about the game's controls and
 * not a tautology over the target's own table.
 *
 * Carl's key is two weapons wearing one button: `HumanPlayer.triggerAttack`
 * fires the sling and returns early whenever `isWieldingSlingshot`, so a stone
 * is the *only* thing that button produces while it is out — there is no
 * fallback swing. Donut's is `missile` while Magic Missile is in the action bar
 * (`triggerPlayerAttack` checks the bar, not the tome) and `melee` once it is
 * dragged out.
 *
 * A target that refuses one of these is an act sealed shut: the lanes are
 * walled apart, so nobody else can come and break it.
 */
const ATTACK_KEY_DAMAGE_TYPES: Readonly<Record<MazeHalf, ReadonlyArray<PlayerDamageType>>> = {
  human: ['melee', 'slingshot'],
  cat: ['melee', 'missile'],
};

console.log('\nChecking every prop answers to everything its crawler can swing…');
{
  for (const kind of MAZE_TARGET_KINDS) {
    const owner = MAZE_TARGET_OWNER[kind];
    const accepted = MAZE_TARGET_DAMAGE_TYPES[kind];
    for (const damageType of ATTACK_KEY_DAMAGE_TYPES[owner]) {
      check(
        accepted.includes(damageType),
        `${kind}: answers to the ${damageType} the ${owner}'s attack key can produce`,
      );
    }
  }

  for (const block of MAZE_BLOCKS) {
    check(
      MAZE_TARGET_OWNER[block.kind] === block.clearedBy,
      `${block.id}: its ${block.kind} belongs to the ${block.clearedBy} who has to break it`,
    );
    const target = new MazeBlockTarget(
      block.propTile.x,
      block.propTile.y,
      TILE_SIZE,
      block.kind,
      'east',
    );
    for (const damageType of ATTACK_KEY_DAMAGE_TYPES[block.clearedBy]) {
      check(
        target.takesPlayerDamage(damageType),
        `${block.id}: the live ${block.kind} takes ${damageType}`,
      );
    }
  }

  for (const mirror of MAZE_MIRRORS) {
    const owner = MAZE_TARGET_OWNER[mirror.kind];
    const target = new MazeMirrorTarget(TILE_SIZE, mirror);
    for (const damageType of ATTACK_KEY_DAMAGE_TYPES[owner]) {
      check(
        target.takesPlayerDamage(damageType),
        `${mirror.id}: takes the ${owner}'s ${damageType}`,
      );
    }
    // Glass that could be spent is a hall the player can lock themselves out of.
    swingAt(target, 'melee', BLOCK_TARGET_MAX_SWINGS);
    check(target.takesPlayerDamage('melee'), `${mirror.id}: never stops answering a blow`);
    // And one trigger pull may only turn it once, however many sub-missiles the
    // burst puts inside its hit radius on the same frame.
    const settled = new MazeMirrorTarget(TILE_SIZE, mirror);
    const before = settled.facing;
    for (let burst = 0; burst < mirror.cycle.length; burst++) {
      settled.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, 'melee');
    }
    check(
      settled.facing !== before,
      `${mirror.id}: a burst of sub-missiles turns it exactly once (${before} to ${settled.facing})`,
    );
    check(
      mirror.cycle.length === (mirror.kind === 'pivot_mirror' ? 4 : 2),
      `${mirror.id}: a ${mirror.kind} has the right number of facings (${mirror.cycle.length})`,
    );
    check(
      mirror.initialIndex >= 0 && mirror.initialIndex < mirror.cycle.length,
      `${mirror.id}: its starting facing is inside its own cycle`,
    );
  }

  // A prop only ever answers the crawler it belongs to, and refuses the other
  // one *audibly*: the centre ring is shared ground, and a missile that passes
  // through a floor gall in silence reads as the game having eaten the input.
  for (const kind of MAZE_TARGET_KINDS) {
    const owner = MAZE_TARGET_OWNER[kind];
    const wrongWeapon: PlayerDamageType = owner === 'human' ? 'missile' : 'slingshot';
    check(
      !MAZE_TARGET_DAMAGE_TYPES[kind].includes(wrongWeapon),
      `${kind}: refuses the ${wrongWeapon} only the other crawler can produce`,
    );
  }

  for (const bell of MAZE_BELLS) {
    const target = new MazeBellTarget(bell.tile.x, bell.tile.y, TILE_SIZE, bell.id);
    for (const damageType of ATTACK_KEY_DAMAGE_TYPES.cat) {
      check(target.takesPlayerDamage(damageType), `${bell.id}: takes the cat's ${damageType}`);
    }
    target.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, 'missile');
    check(target.isHolding, `${bell.id}: a ring calls its lanterns off the floor`);
    check(!target.isReady, `${bell.id}: and the stand goes quiet straight afterwards`);
    check(
      !target.takesPlayerDamage('missile'),
      `${bell.id}: a second shot during the cooldown is refused`,
    );
  }

  // A broken destructible stops answering, so a second swing cannot re-open a
  // door that is already open or spend a stone on wreckage. Bounded rather than
  // run to `broken`, because a target that has stopped accepting the blow this
  // loop is swinging would otherwise hang the gate instead of failing it.
  const spent = new MazeBlockTarget(0, 0, TILE_SIZE, 'brace', 'east');
  swingAt(spent, 'melee', BLOCK_TARGET_MAX_SWINGS);
  check(spent.broken, 'a brace gives way to swings that land');
  // And a single burst never flattens a prop that is meant to take several: a
  // three-hit target that dies to one trigger pull never shows the player a
  // damage stage at all. The capstan is the real case, and Donut's missiles are
  // what bursts — so the probe is the blow the maze must refuse to multiply.
  const bursted = new MazeBlockTarget(0, 0, TILE_SIZE, 'capstan', 'east');
  for (let subMissile = 0; subMissile < SUB_MISSILE_BURST; subMissile++) {
    bursted.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, 'melee');
  }
  check(!bursted.broken, 'and one burst of sub-missiles counts as one blow, not three');
  check(!spent.takesPlayerDamage('melee'), 'a broken target takes no further punishment');
}

// The mirror of the section above, and the one that is easy to leave out: the
// blows a target must *refuse* matter as much as the ones it must take. A puzzle
// step killed out from under the player is the same softlock as one they cannot
// break — and it is the more insidious of the two, because it arrives as a rider
// on a hit that was landing correctly.
console.log('\nChecking a prop cannot be killed out from under the puzzle…');
{
  const crownWearer = new HumanPlayer(0, 0, TILE_SIZE);
  const probes = [
    new MazeBlockTarget(0, 0, TILE_SIZE, 'brace', 'east'),
    new MazeBlockTarget(0, 0, TILE_SIZE, 'capstan', 'east'),
    new MazeBellTarget(0, 0, TILE_SIZE, MAZE_BELLS[0].id),
    new MazeMirrorTarget(TILE_SIZE, MAZE_MIRRORS[0]),
  ];
  for (const probe of probes) {
    // The other half of the same invariant, and the easier one to break by
    // accident: a prop that spawns dead is skipped by every combat loop and
    // never leaves the mob grid's dead list, so nothing can hit it at all.
    check(probe.isAlive, `${probe.kind}: a fresh prop starts alive, or no weapon can reach it`);
    probe.applyStatus(makeSepsis(crownWearer));
    check(!probe.hasStatus('sepsis'), `${probe.kind}: the sepsis crown’s proc never lands on it`);
    // The door every damage-over-time tick and every pool of acid comes through,
    // which is *not* the door `takesPlayerDamage` guards.
    probe.takeDamage(BLOCK_TARGET_PROBE_DAMAGE);
    check(probe.isAlive, `${probe.kind}: damage from outside a swing leaves it standing`);
    // A clock a prop owns may not stop when the party walks out of AI range: a
    // bell frozen mid-hold holds its lanterns off the floor forever.
    check(
      probe.exemptFromAiActivationRadius,
      `${probe.kind}: its own clock keeps running at any distance`,
    );
  }
  const untouched = new MazeBlockTarget(0, 0, TILE_SIZE, 'sandbag', 'east');
  untouched.takeDamage(BLOCK_TARGET_PROBE_DAMAGE);
  check(!untouched.broken, 'a status tick never counts as having broken a target');
  check(untouched.integrityFraction === 1, 'and costs it no integrity');
}

// ── The hall of mirrors ───────────────────────────────────────────────────────

console.log('\nSolving the hall of mirrors by search…');
{
  const mirrors = MAZE_MIRRORS;
  const states: MirrorFacing[][] = [[]];
  for (const mirror of mirrors) {
    const grown: MirrorFacing[][] = [];
    for (const state of states) {
      for (const facing of mirror.cycle) grown.push([...state, facing]);
    }
    states.length = 0;
    states.push(...grown);
  }
  check(states.length > 0, `${states.length} reachable mirror arrangements`);

  const facingOfState = (state: ReadonlyArray<MirrorFacing>) => (mirrorId: string) => {
    const index = mirrors.findIndex((mirror) => mirror.id === mirrorId);
    return index < 0 ? null : state[index];
  };

  const hotSpansSeen = new Set<string>();
  const litBy = new Map<string, Set<MazeHalf>>();
  let twinArrangements = 0;
  for (const state of states) {
    const facingOf = facingOfState(state);
    const hot: string[] = [];
    const hits = new Map<MazeHalf, string | null>();
    for (const half of ['human', 'cat'] as const) {
      const path = traceMazeBeam(half, facingOf, (x, y) => map.isWalkable(x, y));
      for (const step of path.steps) if (step.hot) hot.push(tileKey(step.tile));
      hits.set(half, path.starId);
      if (path.starId !== null) {
        const halves = litBy.get(path.starId) ?? new Set<MazeHalf>();
        halves.add(half);
        litBy.set(path.starId, halves);
      }
    }
    hotSpansSeen.add([...hot].sort().join('|'));
    if (hits.get('human') === 'star_twin' && hits.get('cat') === 'star_twin') twinArrangements++;
  }

  // The rule the whole hall rests on: however the players aim the light, the
  // burning ground never moves.
  check(
    hotSpansSeen.size === 1,
    `the unbent spans are the same in all ${states.length} arrangements (${hotSpansSeen.size} distinct)`,
  );

  for (const star of MAZE_STARS) {
    const halves = litBy.get(star.id) ?? new Set<MazeHalf>();
    for (const half of star.litBy) {
      check(halves.has(half), `${star.id}: some arrangement puts the ${half}'s beam on it`);
    }
  }
  check(twinArrangements > 0, `${twinArrangements} arrangements land both beams on the twin star`);

  // Every star has to be worth something, and the twin has to be the last word.
  for (const star of MAZE_STARS) {
    check(star.opens.length > 0, `${star.id}: opens something`);
    for (const tile of star.opens) {
      check(!map.isWalkable(tile.x, tile.y), `${star.id}: ${tileKey(tile)} starts shut`);
    }
  }
}

// ── Solving the show, act by act ──────────────────────────────────────────────

console.log('\nSolving the maze in order…');
{
  const spawnFor = (section: MazeSectionId, half: MazeHalf): MazeTile => {
    const found = MAZE_SECTIONS.find((candidate) => candidate.id === section);
    if (found === undefined) throw new Error(`no section ${section}`);
    return half === 'human' ? found.humanSpawn : found.catSpawn;
  };
  const opened = new Set<string>();
  const chamber = tileKey(MAZE_GRIMALDI_TILE);

  check(
    MAZE_BLOCKS.map((block) => block.id).join(',') === BLOCK_ORDER.join(','),
    `the blocks are authored in the order they must be solved (${BLOCK_ORDER.join(' → ')})`,
  );

  const solveBlocksOf = (section: MazeSectionId): void => {
    for (const block of MAZE_BLOCKS.filter((candidate) => candidate.section === section)) {
      check(
        block.blocks !== block.clearedBy,
        `${block.id}: the crawler it stops is not the one that clears it`,
      );

      const actorReach = reachableFrom(spawnFor(section, block.clearedBy), opened);
      check(
        actorReach.has(tileKey(block.vantageTile)),
        `${block.id}: the ${block.clearedBy} can already reach the vantage at ${tileKey(block.vantageTile)}`,
      );
      check(
        actorReach.has(tileKey(block.propTile)),
        `${block.id}: and can walk right up to the ${block.kind}, not only shoot it`,
      );

      const blockedReach = reachableFrom(spawnFor(section, block.blocks), opened);
      check(
        blockedReach.has(tileKey(block.blockedRestTile)),
        `${block.id}: the ${block.blocks} can reach the rest zone they wait in`,
      );
      check(
        !blockedReach.has(chamber),
        `${block.id}: the ${block.blocks} cannot yet walk to the centre ring`,
      );

      // Sealed lanes: neither crawler may wander into the other's corridors, or
      // the whole two-character premise is a suggestion rather than a rule.
      const otherSpawn = spawnFor(section, block.blocks === 'human' ? 'cat' : 'human');
      check(
        !blockedReach.has(tileKey(otherSpawn)),
        `${block.id}: the lanes are still sealed from each other`,
      );

      opened.add(block.id);
    }
  };

  const openCurtain = (id: string): void => {
    const curtain = required(
      MAZE_CURTAINS.find((candidate) => candidate.id === id),
      `the curtain ${id}`,
    );
    if (curtain === null) return;
    for (const [half, room] of [
      ['human', curtain.humanRoom],
      ['cat', curtain.catRoom],
    ] as const) {
      const reach = reachableFrom(spawnFor(sectionBefore(curtain.opens), half), opened);
      const roomTiles: MazeTile[] = [];
      for (let y = room.y0; y <= room.y1; y++) {
        for (let x = room.x0; x <= room.x1; x++) roomTiles.push({ x, y });
      }
      check(
        roomTiles.some((tile) => reach.has(tileKey(tile))),
        `${id}: the ${half} can walk into their interval room`,
      );
      check(
        !reach.has(tileKey(spawnFor(curtain.opens, half))),
        `${id}: the ${half} cannot reach the next act before the curtain lifts`,
      );
    }
    opened.add(id);
  };

  const sectionBefore = (section: MazeSectionId): MazeSectionId => {
    const index = MAZE_SECTIONS.findIndex((candidate) => candidate.id === section);
    return MAZE_SECTIONS[Math.max(0, index - 1)].id;
  };

  solveBlocksOf('firewalk');
  openCurtain('curtain_menagerie');
  solveBlocksOf('menagerie');
  openCurtain('curtain_mirrors');

  // The hall of mirrors is solved with light rather than with a swing, so its
  // barriers are the stars'. Each crawler has to be able to walk to their own
  // mirrors first.
  for (const mirror of MAZE_MIRRORS) {
    const owner = MAZE_TARGET_OWNER[mirror.kind];
    const reach = reachableFrom(spawnFor('mirrors', owner), opened);
    check(
      reach.has(tileKey(mirror.tile)),
      `${mirror.id}: the ${owner} can walk up to it and swing`,
    );
    const otherReach = reachableFrom(
      spawnFor('mirrors', owner === 'human' ? 'cat' : 'human'),
      opened,
    );
    check(!otherReach.has(tileKey(mirror.tile)), `${mirror.id}: the other lane cannot reach it`);
  }
  for (const star of MAZE_STARS) {
    for (const half of ['human', 'cat'] as const) {
      const reach = reachableFrom(spawnFor('mirrors', half), opened);
      check(
        !reach.has(chamber),
        `before ${star.id}: the ${half} is still short of the centre ring`,
      );
    }
    opened.add(star.id);
  }
  openCurtain('curtain_finale');

  for (const half of ['human', 'cat'] as const) {
    check(
      reachableFrom(spawnFor('finale', half), opened).has(chamber),
      `with every act solved, the ${half} reaches Grimaldi`,
    );
  }

  // Every block must be needed. A barrier that opens on its own would let a
  // player finish an act without ever switching crawlers.
  for (const block of MAZE_BLOCKS) {
    const withoutOne = new Set(EVERY_BARRIER.filter((other) => other !== block.id));
    check(
      !reachableFrom(spawnFor(block.section, block.blocks), withoutOne).has(chamber),
      `${block.id} is load-bearing — without it the ${block.blocks} is still shut out`,
    );
  }
  for (const curtain of MAZE_CURTAINS) {
    const withoutOne = new Set(EVERY_BARRIER.filter((other) => other !== curtain.id));
    for (const half of ['human', 'cat'] as const) {
      check(
        !reachableFrom(spawnFor('firewalk', half), withoutOne).has(chamber),
        `${curtain.id} is load-bearing for the ${half}`,
      );
    }
  }
  for (const star of MAZE_STARS) {
    const withoutOne = new Set(EVERY_BARRIER.filter((other) => other !== star.id));
    const shutOut = (['human', 'cat'] as const).filter(
      (half) => !reachableFrom(spawnFor('mirrors', half), withoutOne).has(chamber),
    );
    check(shutOut.length > 0, `${star.id} is load-bearing (${shutOut.join(', ') || 'nobody'})`);
  }
}

// ── Every one of Donut's targets can be walked up to ──────────────────────────

console.log("\nWalking to every one of Donut's targets…");
{
  const everyBarrierOpen = new Set(EVERY_BARRIER);
  interface CatTarget {
    readonly id: string;
    readonly tile: MazeTile;
    readonly section: MazeSectionId;
  }
  const bellTargets: ReadonlyArray<CatTarget> = MAZE_BELLS.map((bell) => ({
    id: bell.id,
    tile: bell.tile,
    section: 'menagerie',
  }));
  const mirrorTargets: ReadonlyArray<CatTarget> = MAZE_MIRRORS.filter(
    (mirror) => MAZE_TARGET_OWNER[mirror.kind] === 'cat',
  ).map((mirror) => ({ id: mirror.id, tile: mirror.tile, section: 'mirrors' }));
  const catTargets: ReadonlyArray<CatTarget> = [
    ...MAZE_BLOCKS.filter((block) => MAZE_TARGET_OWNER[block.kind] === 'cat').map((block) => ({
      id: block.id,
      tile: block.propTile,
      section: block.section,
    })),
    ...bellTargets,
    ...mirrorTargets,
  ];
  check(catTargets.length > 0, `${catTargets.length} targets belong to Donut`);
  for (const target of catTargets) {
    const section = required(
      MAZE_SECTIONS.find((candidate) => candidate.id === target.section),
      `${target.id}'s act`,
    );
    if (section === null) continue;
    const reach = reachableFrom(section.catSpawn, everyBarrierOpen);
    check(
      reach.has(tileKey(target.tile)),
      `${target.id}: range is the easy way, but a walkable melee path exists`,
    );
  }
}

// ── What a failed act costs ───────────────────────────────────────────────────

/** Everything a scripted run of the maze needs to stand up an instance of it. */
function buildMazeHarness(): {
  maze: BigTopMazeSystem;
  mazeMap: GameMap;
  ctx: SystemContext;
  human: HumanPlayer;
  cat: CatPlayer;
  spawnedMobs: Mob[];
} {
  const mazeMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  mazeMap.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');
  const progress = createCircusQuestProgress();
  progress.stage = 'bigtop_ready';
  const spawnedMobs: Mob[] = [];
  const roster = new MobRoster(mazeMap, new SpellSystem());
  const maze = new BigTopMazeSystem(
    mazeMap,
    new EventBus(),
    (mob: Mob) => {
      spawnedMobs.push(mob);
      roster.add(mob);
    },
    progress,
    null,
  );
  const human = new HumanPlayer(0, 0, TILE_SIZE);
  const cat = new CatPlayer(0, 0, TILE_SIZE);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: mazeMap,
  };
  return { maze, mazeMap, ctx, human, cat, spawnedMobs };
}

function placeAt(entity: { x: number; y: number }, tile: MazeTile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
}

/**
 * Walks the party through the first `intervals` curtains, so a check that needs
 * a later act can get to one the way the game does rather than by reaching into
 * the system.
 */
function openCurtains(
  maze: BigTopMazeSystem,
  ctx: SystemContext,
  human: HumanPlayer,
  cat: CatPlayer,
  intervals = MAZE_CURTAINS.length,
): void {
  for (const curtain of MAZE_CURTAINS.slice(0, intervals)) {
    placeAt(human, { x: curtain.humanRoom.x0, y: curtain.humanRoom.y0 });
    placeAt(cat, { x: curtain.catRoom.x0, y: curtain.catRoom.y0 });
    maze.update(ctx);
    maze.dismissDialog();
  }
}

/**
 * Parks a crawler on one tile until the house comes for them.
 *
 * The frame it happens on, or -1 if it never does. Both answers are wanted:
 * every act has to prove its own hazard *does* catch somebody, and every act
 * the party has left has to prove its hazard does not.
 */
function framesUntilCaught(
  maze: BigTopMazeSystem,
  ctx: SystemContext,
  human: HumanPlayer,
  cat: CatPlayer,
  tile: MazeTile,
  partner: MazeTile,
): number {
  maze.partyResetPending = false;
  for (let frame = 0; frame < BURNOUT_SEARCH_FRAMES; frame++) {
    placeAt(human, tile);
    placeAt(cat, partner);
    maze.update(ctx);
    if (maze.partyResetPending) return frame;
  }
  return -1;
}

// Every act that has a hazard has to prove its hazard *catches somebody*, not
// only that its schedules are survivable. Without this a whole family could be
// switched off — the vents never lighting, or the unbent limelight span coming
// out empty because a mirror moved off its projector's ray — and every other
// check in this file would still pass, with the act visibly unchanged until a
// playtester strolled through white fire unharmed.
console.log('\nCatching a crawler in every act that has a hazard…');
{
  {
    const { maze, ctx, human, cat } = buildMazeHarness();
    const vent = MAZE_VENTS[0];
    const startingHp = human.hp;
    const caught = framesUntilCaught(
      maze,
      ctx,
      human,
      cat,
      { x: vent.tileX, y: vent.tileY },
      MAZE_CAT_SPAWN_TILE,
    );
    check(caught >= 0, `the fire walk's fire burns a crawler standing in it (frame ${caught})`);
    check(
      Math.round(human.x / TILE_SIZE) === MAZE_HUMAN_SPAWN_TILE.x &&
        Math.round(human.y / TILE_SIZE) === MAZE_HUMAN_SPAWN_TILE.y,
      'and puts them back on their own flap',
    );
    check(human.hp === startingHp, 'at no cost in health');
    check(maze.isDialogOpen && maze.dismissDialog(), 'behind a box Escape closes');
  }

  {
    const { maze, ctx, human, cat } = buildMazeHarness();
    const mirrors = required(
      MAZE_SECTIONS.find((section) => section.id === 'mirrors'),
      'the hall of mirrors band',
    );
    const hotTile = required([...HOT_BEAM_TILES][0], 'a tile the unbent limelight crosses');
    if (mirrors !== null && hotTile !== undefined && hotTile !== null) {
      const [x, y] = hotTile.split(',').map(Number);
      openCurtains(maze, ctx, human, cat, CURTAINS_TO_THE_MIRRORS);
      const caught = framesUntilCaught(maze, ctx, human, cat, { x, y }, mirrors.catSpawn);
      check(
        caught >= 0,
        `the unbent limelight scorches a crawler standing in it (frame ${caught})`,
      );
      check(
        Math.round(human.x / TILE_SIZE) === mirrors.humanSpawn.x &&
          Math.round(human.y / TILE_SIZE) === mirrors.humanSpawn.y,
        'and puts them back at the top of the hall, not at the flap',
      );
      check(maze.isDialogOpen && maze.dismissDialog(), 'behind a box Escape closes');
    }
  }
}

console.log('\nDriving the curtains and the section resets…');
{
  const { maze, mazeMap, ctx, human, cat, spawnedMobs } = buildMazeHarness();

  const breakTarget = (tile: MazeTile, damageType: PlayerDamageType): boolean => {
    const target = spawnedMobs.find(
      (mob): mob is MazeBlockTarget =>
        mob instanceof MazeBlockTarget &&
        Math.round(mob.x / TILE_SIZE) === tile.x &&
        Math.round(mob.y / TILE_SIZE) === tile.y,
    );
    if (target === undefined) return false;
    swingAt(target, damageType, BLOCK_TARGET_MAX_SWINGS);
    return target.broken;
  };

  // Clear the fire walk so the party can legally reach the first interval.
  for (const block of MAZE_BLOCKS.filter((candidate) => candidate.section === 'firewalk')) {
    const damageType: PlayerDamageType = block.clearedBy === 'cat' ? 'missile' : 'melee';
    check(
      breakTarget(block.propTile, damageType),
      `${block.id}: its prop is in the roster and breaks`,
    );
  }
  placeAt(human, MAZE_HUMAN_SPAWN_TILE);
  placeAt(cat, MAZE_CAT_SPAWN_TILE);
  maze.update(ctx);
  for (const block of MAZE_BLOCKS.filter((candidate) => candidate.section === 'firewalk')) {
    check(
      mazeMap.isWalkable(block.barrierTile.x, block.barrierTile.y),
      `${block.id}: its barrier opened`,
    );
  }

  const curtain = MAZE_CURTAINS[0];
  // One crawler alone must not lift it, or the party can be split across acts.
  placeAt(human, { x: curtain.humanRoom.x0, y: curtain.humanRoom.y0 });
  placeAt(cat, MAZE_CAT_SPAWN_TILE);
  maze.update(ctx);
  check(
    !mazeMap.isWalkable(curtain.humanBarrier.x, curtain.humanBarrier.y),
    `${curtain.id}: one crawler in the room lifts nothing`,
  );

  placeAt(cat, { x: curtain.catRoom.x0, y: curtain.catRoom.y0 });
  maze.update(ctx);
  check(
    mazeMap.isWalkable(curtain.humanBarrier.x, curtain.humanBarrier.y) &&
      mazeMap.isWalkable(curtain.catBarrier.x, curtain.catBarrier.y),
    `${curtain.id}: both in their rooms lifts both curtains`,
  );
  check(maze.isDialogOpen, `${curtain.id}: the act's card comes up`);
  check(maze.dismissDialog(), 'and Escape closes it');

  // An act the party has walked out of is a struck set. Standing on the fire
  // walk's own vents from the menagerie has to cost nothing at all — without
  // that, a crawler who wanders back gets both of them yanked *forward* onto
  // marks in an act they were not standing in, which is a reset that moves the
  // party the wrong way and teaches nothing.
  {
    const retiredVent = MAZE_VENTS[0];
    // `framesUntilCaught` clears the flag first, which matters here rather than
    // above: the scene clears it every frame it sees one and nothing in this
    // file does, so a probe run after a reset would read that stale `true` and
    // report a hazard that never fired — a false alarm, not a false pass.
    const caught =
      framesUntilCaught(
        maze,
        ctx,
        human,
        cat,
        { x: retiredVent.tileX, y: retiredVent.tileY },
        MAZE_CAT_SPAWN_TILE,
      ) >= 0;
    check(
      !caught,
      `the fire walk goes cold once the menagerie's curtains are up ` +
        `(${retiredVent.tileX},${retiredVent.tileY} burned nobody in ${BURNOUT_SEARCH_FRAMES} frames)`,
    );
    check(!maze.isDialogOpen, 'and a retired act never raises a reset notice');
  }

  // Now the party is in the menagerie: a lantern must reset them to *its* marks,
  // not back out to the flaps.
  const menagerie = required(
    MAZE_SECTIONS.find((section) => section.id === 'menagerie'),
    'the menagerie band',
  );
  const firstCell = MAZE_SPOTLIGHT_CELLS.find((cell) =>
    MAZE_SPOTLIGHTS.some((track) => track.half === 'human' && track.cells.includes(cell)),
  );
  if (menagerie !== null && firstCell !== undefined) {
    const startingHp = human.hp;
    let caughtAtFrame = -1;
    for (let frame = 0; frame < BURNOUT_SEARCH_FRAMES && caughtAtFrame < 0; frame++) {
      placeAt(human, { x: firstCell.tileX, y: firstCell.tileY });
      placeAt(cat, menagerie.catSpawn);
      maze.update(ctx);
      if (maze.partyResetPending) caughtAtFrame = frame;
    }
    check(
      caughtAtFrame >= 0,
      `a lantern catches a crawler standing in it (frame ${caughtAtFrame})`,
    );
    check(
      Math.round(human.x / TILE_SIZE) === menagerie.humanSpawn.x &&
        Math.round(human.y / TILE_SIZE) === menagerie.humanSpawn.y,
      'the caught crawler wakes at the top of the menagerie, not back at the flap',
    );
    check(
      Math.round(cat.x / TILE_SIZE) === menagerie.catSpawn.x &&
        Math.round(cat.y / TILE_SIZE) === menagerie.catSpawn.y,
      'and so does the one who was nowhere near it',
    );
    check(human.hp === startingHp, 'a reset costs no health at all');
    check(!human.hasStatus('burned'), 'and leaves nothing burning on them');
    check(maze.isDialogOpen, 'the box explaining it is up');
    check(maze.dismissDialog(), 'and Escape closes it');
    check(
      mazeMap.isWalkable(curtain.humanBarrier.x, curtain.humanBarrier.y),
      'a reset does not drop a curtain the party already earned',
    );
    for (const block of MAZE_BLOCKS.filter((candidate) => candidate.section === 'firewalk')) {
      check(
        mazeMap.isWalkable(block.barrierTile.x, block.barrierTile.y),
        `${block.id}: a reset does not re-lock a door already opened`,
      );
    }
  }

  // And the converse, two acts later: with every curtain up the party is in the
  // centre ring, and neither the menagerie's lanterns nor the hall's limelight
  // may reach back for them.
  {
    openCurtains(maze, ctx, human, cat);
    const retiredCells: ReadonlyArray<MazeTile> = [
      { x: MAZE_SPOTLIGHT_CELLS[0].tileX, y: MAZE_SPOTLIGHT_CELLS[0].tileY },
      ...[...HOT_BEAM_TILES].slice(0, 1).map((key) => {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
      }),
    ];
    check(
      retiredCells.length === 2,
      'there is a retired lantern and a retired limelight to stand on',
    );
    for (const tile of retiredCells) {
      const caught = framesUntilCaught(maze, ctx, human, cat, tile, tile) >= 0;
      check(!caught, `${tileKey(tile)} is cold once its act is over`);
    }
  }

  // And the fire walk's own marks are still ground that never burns.
  const hazardTiles = new Set(ALL_HAZARD_CELLS.map((cell) => `${cell.tileX},${cell.tileY}`));
  for (const section of MAZE_SECTIONS) {
    for (const spawn of [section.humanSpawn, section.catSpawn]) {
      check(
        !hazardTiles.has(tileKey(spawn)) && !HOT_BEAM_TILES.has(tileKey(spawn)),
        `${section.id}: the mark at ${tileKey(spawn)} never lights`,
      );
    }
  }
}

console.log('\nWalking into the centre ring and reaching the last conversation…');
{
  const { maze, ctx, human, cat, spawnedMobs } = buildMazeHarness();

  // The whole point of the rework: the ring holds nothing to break. A prop
  // spawned in the chamber is a fight nobody asked for, and it would take the
  // last beat of the questline back out of the player's hands.
  const propsInTheRing = spawnedMobs.filter(
    (mob) =>
      mob instanceof MazeBlockTarget &&
      isInFinalChamber(Math.round(mob.x / TILE_SIZE), Math.round(mob.y / TILE_SIZE)),
  );
  check(propsInTheRing.length === 0, 'nothing breakable stands in the centre ring');

  const vine = spawnedMobs.find((mob): mob is GrimaldiVine => mob instanceof GrimaldiVine);
  check(vine !== undefined, 'Grimaldi is in the roster');
  if (vine !== undefined) {
    const before = vine.hp;
    vine.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, human, 'melee');
    check(vine.hp === before && vine.isAlive, 'and refuses every blow aimed at him');
  }

  openCurtains(maze, ctx, human, cat);

  // One crawler at the pole is not the ending. Both of them standing in front of
  // him is what the scene is, and Carl is the one holding the bottle.
  const finaleCurtain = required(
    MAZE_CURTAINS.find((curtain) => curtain.opens === 'finale'),
    "the finale's curtain",
  );
  placeAt(human, MAZE_GRIMALDI_TILE);
  if (finaleCurtain !== null)
    placeAt(cat, { x: finaleCurtain.catRoom.x0, y: finaleCurtain.catRoom.y0 });
  maze.update(ctx);
  check(!maze.tryInteract(ctx), 'the potion cannot be poured with Donut still outside the ring');

  placeAt(cat, { x: MAZE_GRIMALDI_TILE.x + 1, y: MAZE_GRIMALDI_TILE.y });
  ctx.active = cat;
  ctx.inactive = human;
  maze.update(ctx);
  check(!maze.tryInteract(ctx), 'and Donut cannot pour it — she has no hands for a bottle');
  ctx.active = human;
  ctx.inactive = cat;

  // Standing in the ring costs nothing at all. This is the inverse of every
  // other hazard check in this file, and it is the one the playtest asked for:
  // the last act is a conversation, so a party that stands still in front of him
  // must be able to stand there indefinitely.
  const startingHp = human.hp;
  const catStartingHp = cat.hp;
  for (let frame = 0; frame < FIGHT_PRESSURE_FRAMES; frame++) {
    placeAt(human, MAZE_GRIMALDI_TILE);
    placeAt(cat, { x: MAZE_GRIMALDI_TILE.x + 1, y: MAZE_GRIMALDI_TILE.y });
    maze.update(ctx);
  }
  check(
    human.hp === startingHp && cat.hp === catStartingHp,
    `standing in the ring for ${FIGHT_PRESSURE_FRAMES} frames costs no health`,
  );
  check(
    maze.getHazardEscapeVector(human.x, human.y) === null,
    'and nothing in the ring steers a parked crawler off their own mark',
  );

  const poured = maze.tryInteract(ctx);
  check(poured, 'with both of them at the pole, Carl can start the last conversation');
  check(maze.playerLocked, 'and the script takes both crawlers');
  check(maze.isDialogOpen, 'with the cure dialog up');
  check(!maze.dismissDialog(), 'which Escape may not close');

  const settledHp = human.hp;
  for (let frame = 0; frame < FIGHT_PRESSURE_FRAMES; frame++) maze.update(ctx);
  check(human.hp === settledHp, 'and nothing swings at a party standing inside a cutscene');
}

// ── The props are scenery, not walls ──────────────────────────────────────────

// Separation pushes a crawler a full tile clear of any mob that displaces them,
// and a rooted prop cannot be pushed back — so a solid one standing in a one-tile
// doorway is a wall. At least one of these stands in exactly that doorway, which
// is what makes the flag load-bearing rather than tidy.
console.log('\nChecking a spent prop never becomes a wall…');
{
  const everyBarrierOpen = new Set(EVERY_BARRIER);
  const propTiles = new Set([
    ...MAZE_BLOCKS.map((block) => tileKey(block.propTile)),
    ...MAZE_BELLS.map((bell) => tileKey(bell.tile)),
    ...MAZE_MIRRORS.map((mirror) => tileKey(mirror.tile)),
  ]);
  const chamber = tileKey(MAZE_GRIMALDI_TILE);

  const reachesChamberAroundProps = (start: MazeTile): boolean => {
    const seen = new Set<string>([tileKey(start)]);
    const queue: MazeTile[] = [start];
    const open = (x: number, y: number): boolean =>
      !propTiles.has(`${x},${y}`) && passable(x, y, everyBarrierOpen);
    for (const tile of queue) {
      for (const [dx, dy] of NEIGHBOURS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        const key = `${x},${y}`;
        if (seen.has(key) || !open(x, y)) continue;
        if (dx !== 0 && dy !== 0 && (!open(tile.x + dx, tile.y) || !open(tile.x, tile.y + dy))) {
          continue;
        }
        seen.add(key);
        queue.push({ x, y });
      }
    }
    return seen.has(chamber);
  };

  const cutOff = (['human', 'cat'] as const).filter(
    (half) =>
      !reachesChamberAroundProps(half === 'human' ? MAZE_HUMAN_SPAWN_TILE : MAZE_CAT_SPAWN_TILE),
  );
  check(
    cutOff.length > 0,
    `a solid prop would shut somebody out (${cutOff.join(', ') || 'nobody'}), ` +
      `which is why the flag below matters`,
  );
  for (const block of MAZE_BLOCKS) {
    const target = new MazeBlockTarget(
      block.propTile.x,
      block.propTile.y,
      TILE_SIZE,
      block.kind,
      'east',
    );
    check(!target.displacesPlayers, `${block.id}: its ${block.kind} never shoves a crawler`);
  }
  // A prop only ever answers the crawler it belongs to, and refuses the other
  // one *audibly*: the centre ring is shared ground, and a missile that passes
  // through a floor gall in silence reads as the game having eaten the input.
  for (const kind of MAZE_TARGET_KINDS) {
    const owner = MAZE_TARGET_OWNER[kind];
    const wrongWeapon: PlayerDamageType = owner === 'human' ? 'missile' : 'slingshot';
    check(
      !MAZE_TARGET_DAMAGE_TYPES[kind].includes(wrongWeapon),
      `${kind}: refuses the ${wrongWeapon} only the other crawler can produce`,
    );
  }

  for (const bell of MAZE_BELLS) {
    const target = new MazeBellTarget(bell.tile.x, bell.tile.y, TILE_SIZE, bell.id);
    check(!target.displacesPlayers, `${bell.id}: its stand never shoves a crawler`);
  }
  for (const mirror of MAZE_MIRRORS) {
    const target = new MazeMirrorTarget(TILE_SIZE, mirror);
    check(!target.displacesPlayers, `${mirror.id}: the glass never shoves a crawler`);
  }

  // The vine is the same kind of object standing on the same kind of demand: a
  // rooted mass the party has to walk up to and pour a bottle over. The margin
  // that saves a solid one is two unrelated constants happening to exceed a
  // tile, which is not a thing to leave unwatched.
  const vine = new GrimaldiVine(MAZE_GRIMALDI_TILE.x, MAZE_GRIMALDI_TILE.y, TILE_SIZE);
  check(!vine.displacesPlayers, 'Grimaldi never holds the party at arm’s length either');
}

// ── Where a parked crawler is put down ────────────────────────────────────────

// Switching crawlers re-anchors the one being handed over, and the anchored
// follow drive walks them to that anchor. So the rule has to leave every cell the
// maze teaches the player to stand on exactly alone — an alcove pocket or a dwell
// cell sits one tile off a hazard by construction, and "somewhere roomier" would
// march the crawler out of the very spot the corridor was designed around.
console.log('\nParking a crawler on every authored rest cell…');
{
  const { maze } = buildMazeHarness();
  const probe = new HumanPlayer(0, 0, TILE_SIZE);
  const hazardTiles = new Set(ALL_HAZARD_CELLS.map((cell) => `${cell.tileX},${cell.tileY}`));

  const restingSpotFrom = (tile: MazeTile): MazeTile => {
    placeAt(probe, tile);
    const spot = maze.restingSpotFor(probe);
    return { x: Math.round(spot.x / TILE_SIZE), y: Math.round(spot.y / TILE_SIZE) };
  };

  // The reach has to cover a whole hazard tile and stop at its edge. Wider and
  // the steering shoves a crawler off the safe cell beside a bank; narrower and
  // a crawler standing in a corner of the cell is never pushed out of it at all.
  const TILE_HALF_DIAGONAL_TILES = Math.SQRT2 / 2;
  check(
    HAZARD_ESCAPE_RADIUS_TILES > TILE_HALF_DIAGONAL_TILES && HAZARD_ESCAPE_RADIUS_TILES < 1,
    `the hazard steering reaches all of a cell's tile and none of its neighbours ` +
      `(${HAZARD_ESCAPE_RADIUS_TILES} is between ${TILE_HALF_DIAGONAL_TILES.toFixed(3)} and 1)`,
  );

  let moved = 0;
  for (const corridor of MAZE_CORRIDORS) {
    for (const index of corridor.waypointIndices) {
      const tile = corridor.route[index];
      const spot = restingSpotFrom(tile);
      if (spot.x === tile.x && spot.y === tile.y) continue;
      console.log(`  (${corridor.id}: parking at ${tileKey(tile)} moved them to ${tileKey(spot)})`);
      moved++;
    }
  }
  for (const crossing of MAZE_SPOTLIGHT_CROSSINGS) {
    for (const index of crossing.waypointIndices) {
      const tile = crossing.route[index];
      const spot = restingSpotFrom(tile);
      if (spot.x === tile.x && spot.y === tile.y) continue;
      console.log(
        `  (${crossing.trackId}: parking at ${tileKey(tile)} moved them to ${tileKey(spot)})`,
      );
      moved++;
    }
  }
  check(moved === 0, 'every rest cell leaves a parked crawler exactly where they stand');

  // An alcove is only a refuge if the companion steering leaves a crawler in it
  // while the lantern one tile away is lit. That is the upper bound on
  // HAZARD_ESCAPE_RADIUS_TILES doing its job, measured on the tiles it matters on.
  {
    const shoved = MAZE_MENAGERIE_POCKETS.filter((pocket) => {
      const spot = restingSpotFrom(pocket);
      return spot.x !== pocket.x || spot.y !== pocket.y;
    });
    check(
      shoved.length === 0,
      `no alcove pocket shoves the crawler waiting in it (${shoved.length})`,
    );
  }

  for (const block of MAZE_BLOCKS) {
    const spot = restingSpotFrom(block.blockedRestTile);
    check(
      spot.x === block.blockedRestTile.x && spot.y === block.blockedRestTile.y,
      `${block.id}: waiting out the block leaves the crawler put`,
    );
  }

  // And a crawler who *is* on burning ground has to be given somewhere that is not.
  let stranded = 0;
  for (const cell of ALL_HAZARD_CELLS) {
    const spot = restingSpotFrom({ x: cell.tileX, y: cell.tileY });
    if (!hazardTiles.has(tileKey(spot)) && !HOT_BEAM_TILES.has(tileKey(spot))) continue;
    console.log(`  (a crawler on the hazard at ${cell.tileX},${cell.tileY} is left on one)`);
    stranded++;
  }
  check(stranded === 0, 'a crawler parked on a hazard is always given ground that never lights');
}

// ── The sealed door ───────────────────────────────────────────────────────────

// `BuildingSystem` gained the entry gate for this one tent, but the code path is
// every door in town — so the ordinary open-door behaviour is asserted here
// beside the refusal it was added for.

console.log('\nDriving the Big Top’s door gate…');
{
  const town = new GameMap({ mapSize: TOWN_MAP_SIZE, mapType: 'overworld' });
  const bigTop = town.buildingEntries.find((entry) => entry.name === 'Big Top');
  const otherDoor = town.buildingEntries.find((entry) => entry.name !== 'Big Top');
  check(bigTop !== undefined, 'the generated town has a Big Top');
  check(otherDoor !== undefined, 'the generated town has some other building to compare against');

  if (bigTop !== undefined && otherDoor !== undefined) {
    let sealed = true;
    const refusals: string[] = [];
    let entered = 0;
    const system = new BuildingSystem(
      town,
      () => {
        entered++;
      },
      {
        blockedMessage: (entry) =>
          entry.name === 'Big Top' && sealed ? BIG_TOP_SEALED_MESSAGE : null,
        onRefused: (message) => refusals.push(message),
      },
    );

    const standOn = (tile: MazeTile): void => {
      system.detect({ x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE });
    };
    const offDoor = { x: bigTop.doorTile.x, y: bigTop.doorTile.y + AWAY_FROM_DOOR_TILES };

    standOn(bigTop.doorTile);
    check(refusals.length === 1, `stepping onto a sealed door refuses once (${refusals.length})`);
    check(!system.menuOpen, 'a sealed door never opens the entry menu');
    for (let frame = 0; frame < DOOR_DWELL_FRAMES; frame++) standOn(bigTop.doorTile);
    check(refusals.length === 1, `standing on it does not repeat the refusal (${refusals.length})`);

    standOn(offDoor);
    standOn(bigTop.doorTile);
    check(refusals.length === 2, 'stepping off and back on refuses again');

    // The wave that opens the tent can die while the player is standing on its
    // mat, which is the case the gate has to notice without them moving.
    sealed = false;
    standOn(bigTop.doorTile);
    check(system.menuOpen, 'a door that unseals underfoot opens its menu without a step');
    for (let frame = 0; frame < DOOR_DWELL_FRAMES; frame++) standOn(bigTop.doorTile);
    check(system.menuOpen, 'and the menu stays open while they stand there');

    system.closeMenu();
    for (let frame = 0; frame < DOOR_DWELL_FRAMES; frame++) standOn(bigTop.doorTile);
    check(!system.menuOpen, 'Leave keeps it shut for as long as they stand on the mat');

    standOn(offDoor);
    standOn(bigTop.doorTile);
    check(system.menuOpen, 'stepping off and back on offers again');

    standOn(offDoor);
    standOn(otherDoor.doorTile);
    check(system.menuOpen, 'an ordinary door still opens its menu');
    check(refusals.length === 2, 'and never refuses');
    check(entered === 0, 'nothing was entered by merely walking about');

    // Two doorways can share an edge, so a step from one to the next never lifts
    // the player off door ground — and the offer has to follow their feet.
    system.closeMenu();
    standOn(bigTop.doorTile);
    check(system.menuOpen, 'stepping straight from one doorway onto another offers the new one');
  }
}

console.log(
  failures === 0 ? '\nAll Big Top maze checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
