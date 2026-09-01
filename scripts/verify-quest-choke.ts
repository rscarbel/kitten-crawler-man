/**
 * The defense quest's room, checked against the live `GameMap` rather than
 * against the generator's grid.
 *
 * `scripts/verify-progression.ts` proves the *layout* — that the nursery is a
 * room every crawler has to walk through. What it cannot prove is what the
 * built map does about it, because the two disagree by design: the grid is
 * walkable by tile type either way, and passage is denied by a block flag the
 * quest raises at runtime. A wiring mistake there leaves every progression
 * invariant green and the room either boarded shut from the start or never
 * boarded at all.
 *
 * The headline check is that a crawler who never speaks to the goblin mother
 * still gets through. Walking the room is what the floor asks; the wave inside
 * it is hers to offer and theirs to refuse. The rest walks the states her
 * encounter does put the doorway through — barred for the length of a wave,
 * smashed once it ends — and the checkpoint that must not shut a doorway an
 * encounter has already smashed open.
 *
 *   npx tsx scripts/verify-quest-choke.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import { QUEST_EXIT_DOOR_CLOSED, QUEST_EXIT_DOOR_OPEN } from '../src/map/tileTypes.js';
import { tileIndex } from '../src/map/tileIndex.js';

/** Bugaboo grates every nursery carries — two walls, two apiece. */
const EXPECTED_GRATE_COUNT = 4;

/**
 * Maps built per floor.
 *
 * High for a script that builds a whole `GameMap` per run, and deliberately:
 * the doorway shapes this exists to catch are worth well under one map in a
 * hundred — a corridor network that loops back on the nursery, a doorway a
 * crawler can only reach from inside — and at a couple of dozen runs the gate
 * would sit green through a regression for days.
 */
const RUNS_PER_FLOOR = 60;

type Point = { x: number; y: number };

const STEPS: ReadonlyArray<Point> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

/**
 * Everything the player can walk to, using the map's own walkability.
 *
 * `closed` stands in for a room the player refuses to enter, which is how the
 * "is this room really the only way through" question is asked of a live map.
 */
function reachableTiles(gameMap: GameMap, start: Point, closed?: Rect): Set<number> {
  const size = gameMap.gridSize;
  const key = (point: Point): number => tileIndex(point.x, point.y, size);
  const isOpen = (point: Point): boolean =>
    gameMap.isWalkable(point.x, point.y) && !(closed !== undefined && rectContains(closed, point));
  const seen = new Set<number>();
  if (!isOpen(start)) return seen;
  seen.add(key(start));
  const queue: Point[] = [start];
  let head = 0;
  while (head < queue.length) {
    const tile = queue[head];
    head++;
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (seen.has(key(next))) continue;
      if (!isOpen(next)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

function anyTileReachable(reached: ReadonlySet<number>, size: number, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (reached.has(tileIndex(x, y, size))) return true;
    }
  }
  return false;
}

type Rect = { x: number; y: number; w: number; h: number };

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

/**
 * The landmark the nursery stands between the player and.
 *
 * Read from the layout rather than assumed, because the choke sits in a
 * different place on each floor — inside a gauntlet on floor 1, on the spine on
 * floor 2 — and a check that guessed wrong would prove nothing while passing.
 */
function blockedLandmark(gameMap: GameMap, levelDef: LevelDef): Rect | null {
  const choke = gameMap.progressionLayout?.questChoke ?? null;
  if (choke === null) return null;
  const gatewayCount = levelDef.progression?.gauntlets.length ?? 0;
  if (choke.blocks === 'gatewayBossRoom') {
    return gameMap.bossRooms[choke.gauntletIndex]?.bounds ?? null;
  }
  if (choke.blocks === 'gatewaySafeRoom') {
    return gameMap.safeRooms.slice(0, gatewayCount)[choke.gauntletIndex]?.bounds ?? null;
  }
  // Past the gateways, the one safe room that guards a boss is the arena's
  // antechamber. Sliced first, because every gateway safe room guards one too
  // and searching the whole list finds the first gauntlet's instead.
  return (
    gameMap.safeRooms.slice(gatewayCount).find((room) => room.guardsBossType !== undefined)
      ?.bounds ?? null
  );
}

function verifyFloor(levelDef: LevelDef): void {
  console.log(`\n── ${levelDef.id} (${levelDef.name}) ──`);
  for (let run = 0; run < RUNS_PER_FLOOR; run++) {
    const gameMap = new GameMap({
      mapSize: levelDef.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(levelDef),
    });
    const size = gameMap.gridSize;
    const room = gameMap.questRooms[0];
    if (room === undefined) {
      check(false, 'the floor generated no quest room');
      continue;
    }

    check(room.exitDoorTiles.length > 0, 'the quest room has no onward doorway');

    // The way through, for a crawler who never speaks to her: open ground,
    // wearing the floor it generated as rather than either of the encounter's
    // two door states.
    for (const tile of room.exitDoorTiles) {
      check(
        gameMap.isWalkable(tile.x, tile.y),
        `the onward doorway at (${tile.x},${tile.y}) is blocked before any encounter started`,
      );
      const doorType = gameMap.structure[tile.y][tile.x].type;
      check(
        doorType !== QUEST_EXIT_DOOR_CLOSED && doorType !== QUEST_EXIT_DOOR_OPEN,
        `the onward doorway at (${tile.x},${tile.y}) starts wearing the encounter's door art`,
      );
    }

    check(
      gameMap.isWalkable(room.entranceTile.x, room.entranceTile.y),
      'the quest room’s entrance is blocked',
    );
    const openReach = reachableTiles(gameMap, gameMap.startTile);
    check(
      openReach.has(tileIndex(room.npcTile.x, room.npcTile.y, size)),
      'the goblin mother cannot be reached',
    );
    // The count is a generator constant, so a build that quietly stopped cutting
    // grates would otherwise sail past the reachability loop below with nothing
    // to check.
    check(
      room.grateTiles.length === EXPECTED_GRATE_COUNT,
      `the quest room has ${room.grateTiles.length} grates, expected ${EXPECTED_GRATE_COUNT}`,
    );
    for (const grate of room.grateTiles) {
      check(
        openReach.has(tileIndex(grate.x, grate.y, size)),
        `grate (${grate.x},${grate.y}) is not reachable from inside the room`,
      );
    }
    check(
      openReach.has(tileIndex(room.woodPileTile.x, room.woodPileTile.y, size)),
      'the wood pile is not reachable',
    );

    const landmark = blockedLandmark(gameMap, levelDef);
    if (landmark === null || landmark === undefined) {
      check(false, 'the floor recorded no quest choke for the nursery to sit on');
      continue;
    }
    // The whole point of the room, both ways round: the floor past it opens to a
    // party that walked through and did nothing, and to nobody who went around.
    check(
      anyTileReachable(openReach, size, landmark),
      'the landmark past the nursery is unreachable to a party that never took the wave',
    );
    const avoidingRoom = reachableTiles(gameMap, gameMap.startTile, room.bounds);
    check(
      !anyTileReachable(avoidingRoom, size, landmark),
      'the landmark past the nursery is reachable without entering the room at all',
    );

    // Barred: what the goblin mother does for the length of a wave the player
    // accepted. The way she came in by stays open — a segment the party can
    // never walk out of is one the audience watch could never call off.
    gameMap.setQuestExitDoorState('barred');
    for (const tile of room.exitDoorTiles) {
      check(
        !gameMap.isWalkable(tile.x, tile.y),
        `barred doorway tile (${tile.x},${tile.y}) is still walkable`,
      );
      check(
        gameMap.structure[tile.y][tile.x].type === QUEST_EXIT_DOOR_CLOSED,
        `barred doorway tile (${tile.x},${tile.y}) is not wearing the boarded art`,
      );
    }
    const barredReach = reachableTiles(gameMap, gameMap.startTile);
    check(
      barredReach.has(tileIndex(room.npcTile.x, room.npcTile.y, size)),
      'the goblin mother cannot be reached while her wave is running',
    );
    check(
      !anyTileReachable(barredReach, size, landmark),
      'the boards do not actually hold the way onward shut during a wave',
    );

    // Walking out on the segment: the boards come straight back down, or an
    // abandoned encounter would seal the floor behind a phase nothing resumes.
    gameMap.setQuestExitDoorState('clear');
    for (const tile of room.exitDoorTiles) {
      check(
        gameMap.isWalkable(tile.x, tile.y),
        `doorway tile (${tile.x},${tile.y}) stayed blocked after the encounter was abandoned`,
      );
    }

    gameMap.setQuestExitDoorState('smashed');
    for (const tile of room.exitDoorTiles) {
      check(
        gameMap.isWalkable(tile.x, tile.y),
        `doorway tile (${tile.x},${tile.y}) is still blocked after the encounter resolved`,
      );
      check(
        gameMap.structure[tile.y][tile.x].type === QUEST_EXIT_DOOR_OPEN,
        `doorway tile (${tile.x},${tile.y}) kept its boarded art after the wave ended`,
      );
    }

    // A resolved encounter is banked. A checkpoint taken *after* it ended has to
    // put the doorway back the way it left it, or a respawn walks into a room
    // boarded by a wave that is already over.
    const resolvedSnapshot = gameMap.captureCheckpoint();
    gameMap.setQuestExitDoorState('barred');
    gameMap.restoreCheckpoint(resolvedSnapshot);
    for (const tile of room.exitDoorTiles) {
      check(
        gameMap.isWalkable(tile.x, tile.y),
        `restoring a post-encounter checkpoint re-sealed (${tile.x},${tile.y})`,
      );
    }
  }
}

verifyFloor(level1);
verifyFloor(level2);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
