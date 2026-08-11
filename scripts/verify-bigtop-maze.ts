#!/usr/bin/env tsx
/**
 * Headless checks for the Big Top's trap maze.
 *
 * Everything here reads the game's own exported layout and vent tables — never a
 * copy — so a corridor retuned in the game is a corridor retuned in this gate.
 *
 * The feasibility check is a simulation rather than a formula: a crawler walking
 * 25% slower than the human is stepped through every corridor tile by tile, and
 * the corridor passes only if some entry moment lets that slow crawler cross
 * without ever standing on a lit vent. Twenty-five percent is
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
import { BigTopMazeSystem, HAZARD_ESCAPE_RADIUS_TILES } from '../src/systems/BigTopMazeSystem';
import { MazeBlockTarget } from '../src/creatures/MazeBlockTarget';
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
  BIG_TOP_MAZE_ROWS,
  FRAMES_PER_TILE,
  isInFinalChamber,
  MAZE_ALCOVE_TILES,
  MAZE_BLOCKS,
  MAZE_CAT_SPAWN_TILE,
  MAZE_CORRIDORS,
  MAZE_EXIT_TILES,
  MAZE_GRIMALDI_TILE,
  MAZE_HEIGHT,
  MAZE_HUMAN_SPAWN_TILE,
  MAZE_TIMING_MARGIN,
  MAZE_VENTS,
  MAZE_WIDTH,
  SPRINT_WAVE_STEP,
  ventPhaseAt,
  type MazeCorridor,
  type MazeTile,
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
/** Longer than the slowest vent's whole cycle, so the burnout probe always sees one light. */
const BURNOUT_SEARCH_FRAMES = 400;

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

/** The order the maze forces its four blocks into. */
const BLOCK_ORDER = ['H1', 'C1', 'H2', 'C2'] as const;

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

// ── Layout shape ──────────────────────────────────────────────────────────────

console.log('Checking the authored layout…');
{
  check(
    BIG_TOP_MAZE_ROWS.length === MAZE_HEIGHT,
    `${BIG_TOP_MAZE_ROWS.length} rows (expected ${MAZE_HEIGHT})`,
  );
  const wrongWidth = BIG_TOP_MAZE_ROWS.filter((row) => row.length !== MAZE_WIDTH);
  check(wrongWidth.length === 0, `every row is ${MAZE_WIDTH} tiles wide`);
}

const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
map.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');

console.log('\nChecking the generated map…');
{
  for (const spawn of [MAZE_HUMAN_SPAWN_TILE, MAZE_CAT_SPAWN_TILE]) {
    check(map.isWalkable(spawn.x, spawn.y), `spawn ${tileKey(spawn)} is walkable`);
    // A one-tile pocket passes `isWalkable` and traps whoever is put in it.
    check(hasRoomToMove(map, spawn.x, spawn.y), `spawn ${tileKey(spawn)} has room to move`);
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
    `Grimaldi's tile ${tileKey(MAZE_GRIMALDI_TILE)} is open ground in the final chamber`,
  );
}

// ── Telegraphs ────────────────────────────────────────────────────────────────

console.log('\nChecking every vent’s telegraph…');
{
  const short = MAZE_VENTS.filter((vent) => vent.telegraphFrames < FAIRNESS_TELEGRAPH_FLOOR_FRAMES);
  check(MAZE_VENTS.length > 0, `the maze actually has vents (${MAZE_VENTS.length})`);
  check(
    short.length === 0,
    `every telegraph is at least ${FAIRNESS_TELEGRAPH_FLOOR_FRAMES} frames (${short.length} too short)`,
  );
  const overrun = MAZE_VENTS.filter(
    (vent) => vent.telegraphFrames + vent.flameFrames >= vent.periodFrames,
  );
  check(overrun.length === 0, 'every vent has idle time left in its cycle');
}

// ── Hazard placement ──────────────────────────────────────────────────────────

console.log('\nChecking where vents are allowed to be…');
{
  const forbidden = new Map<string, string>();
  const forbid = (tile: MazeTile, reason: string): void => {
    forbidden.set(tileKey(tile), reason);
  };
  forbid(MAZE_HUMAN_SPAWN_TILE, 'the human flap');
  forbid(MAZE_CAT_SPAWN_TILE, 'the cat flap');
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

  const trespassing = MAZE_VENTS.filter((vent) => forbidden.has(`${vent.tileX},${vent.tileY}`));
  for (const vent of trespassing) {
    console.log(
      `  (vent at ${vent.tileX},${vent.tileY} sits on ${forbidden.get(`${vent.tileX},${vent.tileY}`) ?? '?'})`,
    );
  }
  check(trespassing.length === 0, 'no vent sits on ground the player must be able to stand on');

  const inChamber = MAZE_VENTS.filter((vent) => isInFinalChamber(vent.tileX, vent.tileY));
  check(inChamber.length === 0, 'no vent is in the final chamber');

  const offFloor = MAZE_VENTS.filter((vent) => !map.isWalkable(vent.tileX, vent.tileY));
  check(offFloor.length === 0, 'every vent is on walkable floor');

  // The four tiles the maze *forces* a crawler to be parked on need more than
  // vent-free ground: the companion drive flees a hazard before it walks back to
  // its anchor, and that reach carries a little past a vent's own tile. A rest
  // zone hard against a vent is a crawler pacing in and out of it all fight.
  const ventTiles = new Set(MAZE_VENTS.map((vent) => `${vent.tileX},${vent.tileY}`));
  const crowded = MAZE_BLOCKS.filter((block) =>
    ADJACENT_OFFSETS.some(([dx, dy]) =>
      ventTiles.has(`${block.blockedRestTile.x + dx},${block.blockedRestTile.y + dy}`),
    ),
  );
  for (const block of crowded) {
    console.log(`  (${block.id}'s rest zone ${tileKey(block.blockedRestTile)} touches a vent)`);
  }
  check(crowded.length === 0, 'every block’s rest zone stands clear of the vents around it');

  const seen = new Set<string>();
  const doubled = MAZE_VENTS.filter((vent) => {
    const key = `${vent.tileX},${vent.tileY}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  check(doubled.length === 0, 'no tile carries two vents');
}

// ── Corridor feasibility ──────────────────────────────────────────────────────

/**
 * The simulated crawler's speed: the human's, slowed by the timing margin. A
 * corridor this one clears is a corridor the human clears with room to spare.
 */
const MARGIN_SPEED_PX_PER_FRAME = PLAYER_SPEED / MAZE_TIMING_MARGIN;

function ventIndex(corridor: MazeCorridor): Map<string, VentSchedule> {
  const index = new Map<string, VentSchedule>();
  for (const vent of corridor.vents) index.set(`${vent.tileX},${vent.tileY}`, vent);
  return index;
}

/** Frames the crawler needs to walk from one route tile to the next. */
function stepFrames(from: MazeTile, to: MazeTile): number {
  const distancePx = Math.hypot(to.x - from.x, to.y - from.y) * TILE_SIZE;
  return distancePx / MARGIN_SPEED_PX_PER_FRAME;
}

/**
 * Whether the crawler can walk `route[from..to]` starting on `startFrame`
 * without ever standing on a lit vent.
 *
 * The crawler owns a tile from the moment they step onto it until they step
 * off, so every whole frame in that window is checked — a vent that lights for
 * one frame while they are crossing is a vent that burns them.
 */
function legIsClean(
  corridor: MazeCorridor,
  vents: Map<string, VentSchedule>,
  from: number,
  to: number,
  startFrame: number,
): boolean {
  let enter = startFrame;
  for (let i = from + 1; i <= to; i++) {
    const tile = corridor.route[i];
    const exit = enter + stepFrames(corridor.route[i - 1], tile);
    const vent = vents.get(`${tile.x},${tile.y}`);
    if (vent !== undefined) {
      for (let frame = Math.floor(enter); frame <= Math.ceil(exit); frame++) {
        if (ventPhaseAt(vent, frame) === 'flame') return false;
      }
    }
    enter = exit;
  }
  return true;
}

/** The crawler waits on each waypoint until the next leg is clean, then runs it. */
function corridorIsWalkable(corridor: MazeCorridor): { ok: boolean; frames: number } {
  const vents = ventIndex(corridor);
  const longestPeriod = Math.max(...corridor.vents.map((vent) => vent.periodFrames));
  const waypoints = [...corridor.waypointIndices].sort((a, b) => a - b);

  for (let entryFrame = 0; entryFrame < longestPeriod; entryFrame++) {
    let clock = entryFrame;
    let blocked = false;
    for (let leg = 0; leg + 1 < waypoints.length; leg++) {
      let departed = false;
      for (let wait = 0; wait <= longestPeriod; wait++) {
        if (!legIsClean(corridor, vents, waypoints[leg], waypoints[leg + 1], clock + wait))
          continue;
        clock += wait;
        for (let i = waypoints[leg] + 1; i <= waypoints[leg + 1]; i++) {
          clock += stepFrames(corridor.route[i - 1], corridor.route[i]);
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

console.log('\nWalking a margin-slowed crawler through every corridor…');
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
      `the ${half} half has one of every archetype (${[...archetypes].sort().join(', ')})`,
    );
  }
  for (const corridor of MAZE_CORRIDORS) {
    const waypoints = [...corridor.waypointIndices].sort((a, b) => a - b);
    check(
      waypoints[0] === 0 && waypoints[waypoints.length - 1] === corridor.route.length - 1,
      `${corridor.id}: opens onto rest ground at both ends`,
    );
    const contiguous = corridor.route.every((tile, i) => {
      if (i === 0) return true;
      const previous = corridor.route[i - 1];
      return Math.max(Math.abs(tile.x - previous.x), Math.abs(tile.y - previous.y)) === 1;
    });
    check(contiguous, `${corridor.id}: its route is a connected walk`);
    const onFloor = corridor.route.every((tile) => map.isWalkable(tile.x, tile.y));
    check(onFloor, `${corridor.id}: every route tile is open floor`);

    // No barrier may stand inside a trapped corridor. A gate half way along one
    // would strand whichever crawler is parked there in the middle of the fire,
    // waiting on the other half of the tent.
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

// ── Reachability and the block order ──────────────────────────────────────────

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

const barrierByTile = new Map<string, string>();
for (const block of MAZE_BLOCKS) barrierByTile.set(tileKey(block.barrierTile), block.id);

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
 *
 * Reaching the far end is the obvious version of that failure; dropping in
 * half-way is the one that actually happened, when side pockets authored as
 * alcoves turned out to be doorways into the corridor on the next row.
 */
function waypointsReachableWithoutVents(corridor: MazeCorridor): MazeTile[] {
  const removed = new Set(corridor.vents.map((vent) => `${vent.tileX},${vent.tileY}`));
  const everyBarrierOpen = new Set(BLOCK_ORDER);
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
 * A target that refuses one of these is a finale sealed shut: the halves are
 * walled apart, so nobody else can come and break it.
 */
const ATTACK_KEY_DAMAGE_TYPES: Readonly<Record<'human' | 'cat', ReadonlyArray<PlayerDamageType>>> =
  {
    human: ['melee', 'slingshot'],
    cat: ['melee', 'missile'],
  };

console.log('\nChecking every block answers to everything its crawler can swing…');
{
  for (const block of MAZE_BLOCKS) {
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
        `${block.id}: the ${block.kind} answers to the ${damageType} the ${block.clearedBy}'s ` +
          `attack key can produce`,
      );
    }
  }

  // And a broken one stops answering, so a second swing cannot re-open a door
  // that is already open or spend a stone on wreckage. Bounded rather than run
  // to `broken`, because a target that has stopped accepting the blow this loop
  // is swinging would otherwise hang the gate instead of failing it.
  const spent = new MazeBlockTarget(0, 0, TILE_SIZE, 'brace', 'east');
  for (let swing = 0; swing < BLOCK_TARGET_MAX_SWINGS && !spent.broken; swing++) {
    spent.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, 'melee');
  }
  check(spent.broken, 'a brace gives way to a swing that lands');
  check(!spent.takesPlayerDamage('melee'), 'a broken target takes no further punishment');
}

// The mirror of the section above, and the one that is easy to leave out: the
// blows a target must *refuse* matter as much as the ones it must take. A puzzle
// step killed out from under the player is the same softlock as one they cannot
// break — and it is the more insidious of the two, because it arrives as a rider
// on a hit that was landing correctly.
console.log('\nChecking a target cannot be killed out from under the puzzle…');
{
  const target = new MazeBlockTarget(0, 0, TILE_SIZE, 'brace', 'east');
  const crownWearer = new HumanPlayer(0, 0, TILE_SIZE);

  // The other half of the same invariant, and the easier one to break by
  // accident: a target that spawns dead is skipped by every combat loop and
  // never leaves the mob grid's dead list, so nothing can hit it at all.
  check(target.isAlive, 'a fresh target starts alive, or no weapon can reach it');

  target.applyStatus(makeSepsis(crownWearer));
  check(!target.hasStatus('sepsis'), 'the sepsis crown’s proc never lands on a puzzle target');

  // The door every damage-over-time tick and every pool of acid comes through,
  // which is *not* the door `takesPlayerDamage` guards.
  target.takeDamage(BLOCK_TARGET_PROBE_DAMAGE);
  check(target.isAlive, 'damage from outside a swing leaves it standing');
  check(!target.broken, 'and never counts as having broken it');
  check(target.integrityFraction === 1, 'and costs it no integrity');
}

console.log('\nSolving the maze in order…');
{
  const spawnFor = (half: 'human' | 'cat'): MazeTile =>
    half === 'human' ? MAZE_HUMAN_SPAWN_TILE : MAZE_CAT_SPAWN_TILE;
  const opened = new Set<string>();
  const chamber = tileKey(MAZE_GRIMALDI_TILE);

  check(
    MAZE_BLOCKS.map((block) => block.id).join(',') === BLOCK_ORDER.join(','),
    `the blocks are authored in the order they must be solved (${BLOCK_ORDER.join(' → ')})`,
  );

  for (const id of BLOCK_ORDER) {
    const block = MAZE_BLOCKS.find((candidate) => candidate.id === id);
    if (block === undefined) {
      check(false, `block ${id} exists`);
      continue;
    }
    check(
      block.blocks !== block.clearedBy,
      `${id}: the crawler it stops is not the one that clears it`,
    );

    const actorReach = reachableFrom(spawnFor(block.clearedBy), opened);
    check(
      actorReach.has(tileKey(block.vantageTile)),
      `${id}: the ${block.clearedBy} can already reach the vantage at ${tileKey(block.vantageTile)}`,
    );

    const blockedReach = reachableFrom(spawnFor(block.blocks), opened);
    check(
      blockedReach.has(tileKey(block.blockedRestTile)),
      `${id}: the ${block.blocks} can reach the rest zone they wait in`,
    );
    check(!blockedReach.has(chamber), `${id}: the ${block.blocks} cannot yet walk to the chamber`);

    // Sealed halves: neither crawler may wander into the other's corridors, or
    // the whole two-character premise is a suggestion rather than a rule.
    const otherSpawn = spawnFor(block.blocks === 'human' ? 'cat' : 'human');
    check(
      !blockedReach.has(tileKey(otherSpawn)),
      `${id}: the halves are still sealed from each other`,
    );

    opened.add(id);
  }

  for (const half of ['human', 'cat'] as const) {
    check(
      reachableFrom(spawnFor(half), opened).has(chamber),
      `with all four cleared, the ${half} reaches Grimaldi`,
    );
  }

  // Every block must be needed. A barrier that opens on its own would let a
  // player finish the maze without ever switching crawlers.
  for (const id of BLOCK_ORDER) {
    const withoutOne = new Set(BLOCK_ORDER.filter((other) => other !== id));
    const block = MAZE_BLOCKS.find((candidate) => candidate.id === id);
    if (block === undefined) continue;
    check(
      !reachableFrom(spawnFor(block.blocks), withoutOne).has(chamber),
      `${id} is load-bearing — without it the ${block.blocks} is still shut out`,
    );
  }
}

// ── What a burn costs ─────────────────────────────────────────────────────────

// Touching a lit vent costs the walk, not health: both crawlers wake up at their
// own flap and do the corridors again. That makes two properties load-bearing —
// the flaps are ground that never burns, and the doors already opened stay open,
// because a reset that re-locked them would demand a partner who is also back at
// the start and would never converge.
console.log('\nBurning a crawler and watching where the party wakes up…');
{
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

  // One barrier opened first, so the check that a burn does not re-lock it is
  // asking about a door the run had actually earned.
  const firstBlock = MAZE_BLOCKS[0];
  const firstTarget = spawnedMobs.find(
    (mob): mob is MazeBlockTarget =>
      mob instanceof MazeBlockTarget &&
      Math.round(mob.x / TILE_SIZE) === firstBlock.propTile.x &&
      Math.round(mob.y / TILE_SIZE) === firstBlock.propTile.y,
  );
  check(firstTarget !== undefined, `${firstBlock.id}'s target is in the roster`);
  if (firstTarget !== undefined) {
    firstTarget.takeDamageFrom(BLOCK_TARGET_PROBE_DAMAGE, null, 'missile');
  }
  maze.update(ctx);
  check(
    mazeMap.isWalkable(firstBlock.barrierTile.x, firstBlock.barrierTile.y),
    `${firstBlock.id}: the barrier is open before anyone burns`,
  );

  // Park the human on a vent and run frames until its own clock lights it.
  const vent = MAZE_VENTS[0];
  const startingHp = human.hp;
  let burnedAtFrame = -1;
  for (let frame = 0; frame < BURNOUT_SEARCH_FRAMES && burnedAtFrame < 0; frame++) {
    human.x = vent.tileX * TILE_SIZE;
    human.y = vent.tileY * TILE_SIZE;
    cat.x = MAZE_CAT_SPAWN_TILE.x * TILE_SIZE;
    cat.y = (MAZE_CAT_SPAWN_TILE.y - 1) * TILE_SIZE;
    maze.update(ctx);
    if (maze.partyResetPending) burnedAtFrame = frame;
  }
  check(
    burnedAtFrame >= 0,
    `standing on a vent gets the party burned out (frame ${burnedAtFrame})`,
  );
  check(
    Math.round(human.x / TILE_SIZE) === MAZE_HUMAN_SPAWN_TILE.x &&
      Math.round(human.y / TILE_SIZE) === MAZE_HUMAN_SPAWN_TILE.y,
    'the burned crawler wakes up on their own flap',
  );
  check(
    Math.round(cat.x / TILE_SIZE) === MAZE_CAT_SPAWN_TILE.x &&
      Math.round(cat.y / TILE_SIZE) === MAZE_CAT_SPAWN_TILE.y,
    'and so does the one who was nowhere near it',
  );
  check(human.hp === startingHp, 'a burnout costs no health at all');
  check(!human.hasStatus('burned'), 'and leaves nothing burning on them');
  check(maze.isDialogOpen, 'the box explaining it is up');
  check(maze.dismissDialog(), 'and Escape closes it');
  check(!maze.isDialogOpen, 'leaving the player back in the maze');
  check(
    mazeMap.isWalkable(firstBlock.barrierTile.x, firstBlock.barrierTile.y),
    `${firstBlock.id}: a burnout does not re-lock a door already opened`,
  );

  // The flaps themselves must be ground the reset can safely put someone on,
  // or a burnout drops the party straight into another one.
  const ventTiles = new Set(MAZE_VENTS.map((v) => `${v.tileX},${v.tileY}`));
  for (const spawn of [MAZE_HUMAN_SPAWN_TILE, MAZE_CAT_SPAWN_TILE]) {
    check(!ventTiles.has(tileKey(spawn)), `the flap at ${tileKey(spawn)} never burns`);
  }
}

// ── The props are scenery, not walls ──────────────────────────────────────────

// Separation pushes a crawler a full tile clear of any mob that displaces them,
// and a rooted prop cannot be pushed back — so a solid one standing in a one-tile
// doorway is a wall. At least one of these stands in exactly that doorway, which
// is what makes the flag load-bearing rather than tidy.
console.log('\nChecking a spent prop never becomes a wall…');
{
  const everyBarrierOpen = new Set(BLOCK_ORDER);
  const propTiles = new Set(MAZE_BLOCKS.map((block) => tileKey(block.propTile)));
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
// cell sits one tile off a vent by construction, and "somewhere roomier" would
// march the crawler out of the very spot the corridor was designed around.
console.log('\nParking a crawler on every authored rest cell…');
{
  const mazeMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  mazeMap.generateInterior('house', 0, 'Big Top', false, 'bigtop_maze');
  const progress = createCircusQuestProgress();
  progress.stage = 'bigtop_ready';
  const maze = new BigTopMazeSystem(mazeMap, new EventBus(), () => undefined, progress, null);
  const probe = new HumanPlayer(0, 0, TILE_SIZE);
  const ventTiles = new Set(MAZE_VENTS.map((vent) => `${vent.tileX},${vent.tileY}`));

  const restingSpotFrom = (tile: MazeTile): MazeTile => {
    probe.x = tile.x * TILE_SIZE;
    probe.y = tile.y * TILE_SIZE;
    const spot = maze.restingSpotFor(probe);
    return { x: Math.round(spot.x / TILE_SIZE), y: Math.round(spot.y / TILE_SIZE) };
  };

  // The reach has to cover a whole vent tile and stop at its edge. Wider and the
  // steering shoves a crawler off the safe cell beside a bank; narrower and a
  // crawler standing in a corner of the vent is never pushed out of it at all.
  const TILE_HALF_DIAGONAL_TILES = Math.SQRT2 / 2;
  check(
    HAZARD_ESCAPE_RADIUS_TILES > TILE_HALF_DIAGONAL_TILES && HAZARD_ESCAPE_RADIUS_TILES < 1,
    `the hazard steering reaches all of a vent's tile and none of its neighbours ` +
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
  check(moved === 0, 'every corridor rest cell leaves a parked crawler exactly where they stand');

  for (const block of MAZE_BLOCKS) {
    const spot = restingSpotFrom(block.blockedRestTile);
    check(
      spot.x === block.blockedRestTile.x && spot.y === block.blockedRestTile.y,
      `${block.id}: waiting out the block leaves the crawler put`,
    );
  }

  // And a crawler who *is* on burning ground has to be given somewhere that is not.
  let stranded = 0;
  for (const vent of MAZE_VENTS) {
    const spot = restingSpotFrom({ x: vent.tileX, y: vent.tileY });
    if (!ventTiles.has(tileKey(spot))) continue;
    console.log(`  (a crawler on the vent at ${vent.tileX},${vent.tileY} is left on one)`);
    stranded++;
  }
  check(stranded === 0, 'a crawler parked on a vent is always given ground that never lights');
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
