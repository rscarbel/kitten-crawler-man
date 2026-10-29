/**
 * The clogged bathroom's map half, checked against the live `GameMap`.
 *
 * `verify:progression` proves the layout through S6: a bathroom halfway along
 * every branch, and no way to the gateway round them. What it cannot prove is
 * what the built map does about it, because the grid is walkable by tile type
 * either way and the queue only holds the doorways shut through a block flag
 * the map honours while the plumbing is broken. So this builds whole floors and
 * walks them with the map's own walkability: shut while broken, open once
 * fixed, every copy at once, the player never shut out of the stalls, the
 * pipes or the plumber, and a checkpoint that keeps whichever state it caught.
 *
 *   npx tsx scripts/verify-clogged-bathroom.ts [--runs=60] [--fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { bathroomBranchIndex } from '../src/map/gauntletLayout.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import { pastSafeRoomTest } from '../src/map/pastSafeRoom.js';
import { BIG_ROOSTER_BOSS_TYPE } from '../src/core/mobs/bossTypes.js';
import { tileIndex } from '../src/map/tileIndex.js';
import {
  SINK_COUNT,
  STALL_COUNT,
  STALL_WIDTH_TILES,
  plumberTalkTiles,
  type BathroomRoomData,
} from '../src/map/bathroomLayout.js';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

/**
 * Floors built per run. A whole `GameMap` each, and still this many: the
 * layouts the gate exists for (a doorway in a corner, a corridor hugging a
 * wall, branches braiding past one another) turn up a few times in a hundred.
 */
const DEFAULT_RUNS = 60;

const FAULTS = [
  /** The map starts with the plumbing already fixed, so nothing is ever blocked. */
  'never-blocked',
  /** Fixing the plumbing does nothing. */
  'never-opens',
  /** A checkpoint restore forgets the plumbing and puts it back broken. */
  'checkpoint-drops-plumbing',
  /** The bypass check removes only the first copy, the bug braided branches expose. */
  'bypass-checks-one-copy',
  /** The halfway rule is read one room late. */
  'halfway-off-by-one',
  /** The stall doors themselves are counted as part of the line. */
  'line-covers-stalls',
  /** A hallway rat is set down where the queue spills into the corridor. */
  'rats-on-queue',
  /** A safe pocket that falls on the bathroom is left hanging off it, behind the queue. */
  'pocket-on-bathroom',
  /** The room is laid out and dressed as if the anchored plumber stood in no one's way. */
  'plumber-tile-open',
  /** The rest of a wide doorway the line leaves by is flagged but given no goblins. */
  'doorway-tile-unposted',
  /** One goblin too many for the loiter spots, so two share a tile after the fix. */
  'loiter-short',
] as const;
type Fault = (typeof FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

function parseArgs(): { runs: number; fault: Fault | null } {
  let runs = DEFAULT_RUNS;
  let fault: Fault | null = null;
  for (const arg of process.argv.slice(2)) {
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? '' : arg.slice(separator + 1);
    if (name === '--runs') runs = Number(value);
    else if (name === '--fault') {
      if (!isFault(value)) {
        console.error(`unknown fault "${value}"; known: ${FAULTS.join(', ')}`);
        process.exit(2);
      }
      fault = value;
    } else {
      console.error(`unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return { runs, fault };
}

const { runs, fault } = parseArgs();

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

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Everything walkable from `start`, never stepping into a `closed` rect or onto a `solid` tile. */
function reachableTiles(
  gameMap: GameMap,
  start: Point,
  closed: ReadonlyArray<Rect> = [],
  solid: ReadonlyArray<Point> = [],
): Set<number> {
  const size = gameMap.gridSize;
  const key = (point: Point): number => tileIndex(point.x, point.y, size);
  const solidKeys = new Set(solid.map(key));
  const isOpen = (point: Point): boolean =>
    gameMap.isWalkable(point.x, point.y) &&
    !solidKeys.has(key(point)) &&
    !closed.some((rect) => rectContains(rect, point));
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
      if (seen.has(key(next)) || !isOpen(next)) continue;
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

function blockedTilesOf(room: BathroomRoomData): Point[] {
  return [
    ...room.blockedDoorways.flatMap((doorway) => doorway.tiles),
    ...room.queueTiles,
    ...room.doorwayKnots.flat(),
  ];
}

function setPlumbing(gameMap: GameMap, state: 'broken' | 'fixed'): void {
  if (fault === 'never-opens' && state === 'fixed') return;
  if (fault === 'never-blocked' && state === 'broken') return;
  gameMap.setBathroomPlumbing(state);
}

/**
 * The runtime stands one goblin on each queue tile and each knot tile, so every
 * flagged tile has to be one of those, exactly once. A flagged tile without a
 * goblin is an invisible wall in an empty doorway.
 */
function verifyEveryFlagHasAGoblin(room: BathroomRoomData, label: string): void {
  const exitDoorway = room.blockedDoorways.find((doorway) =>
    doorway.tiles.some((door) => room.queueTiles.some((tile) => samePoint(tile, door))),
  );
  const isRestOfExitDoorway = (knot: ReadonlyArray<Point>): boolean =>
    exitDoorway !== undefined &&
    knot.every((tile) => exitDoorway.tiles.some((door) => samePoint(door, tile)));
  const knots =
    fault === 'doorway-tile-unposted'
      ? room.doorwayKnots.filter((knot) => !isRestOfExitDoorway(knot))
      : room.doorwayKnots;
  const posts = new Map<string, number>();
  for (const tile of [...room.queueTiles, ...knots.flat()]) {
    const key = `${tile.x},${tile.y}`;
    posts.set(key, (posts.get(key) ?? 0) + 1);
  }
  for (const tile of blockedTilesOf(room)) {
    const count = posts.get(`${tile.x},${tile.y}`) ?? 0;
    check(
      count === 1,
      `${label}: flagged tile (${tile.x},${tile.y}) holds ${count} goblins, not one`,
    );
  }
}

function verifyRoomShape(gameMap: GameMap, room: BathroomRoomData, label: string): void {
  const { bounds } = room;
  check(
    gameMap.isWalkable(room.entranceTile.x, room.entranceTile.y),
    `${label}: the entrance is blocked while the plumbing is broken`,
  );
  check(
    !gameMap.isWalkable(room.pipeWallTile.x, room.pipeWallTile.y) &&
      room.pipeWallTile.y === bounds.y - 1,
    `${label}: the pipe wall is not a north wall-face tile`,
  );
  check(
    samePoint(room.pipeWallStandTile, { x: room.pipeWallTile.x, y: room.pipeWallTile.y + 1 }),
    `${label}: the pipe wall's stand tile is not the floor below it`,
  );
  check(
    room.stallDoorTiles.length === STALL_COUNT,
    `${label}: ${room.stallDoorTiles.length} stalls`,
  );
  check(room.sinkTiles.length === SINK_COUNT, `${label}: ${room.sinkTiles.length} sinks`);
  for (const stall of room.stallDoorTiles) {
    check(stall.y === bounds.y, `${label}: a stall door is off the north row`);
    check(
      !gameMap.isWalkable(stall.x, stall.y - 1) &&
        !gameMap.isWalkable(stall.x + STALL_WIDTH_TILES - 1, stall.y - 1),
      `${label}: the stall at (${stall.x},${stall.y}) has no wall face behind it`,
    );
  }
  for (const sink of room.sinkTiles) {
    check(
      rectContains(bounds, sink) && (sink.x === bounds.x || sink.x === bounds.x + bounds.w - 1),
      `${label}: the sink at (${sink.x},${sink.y}) is not against a side wall`,
    );
  }

  if (room.queueTiles.length === 0) {
    check(false, `${label}: the bathroom has no line`);
    return;
  }
  const head = room.queueTiles[0];
  check(
    Math.abs(head.x - room.plumberTile.x) + Math.abs(head.y - room.plumberTile.y) === 1,
    `${label}: the line does not start at the plumber`,
  );
  for (let index = 1; index < room.queueTiles.length; index++) {
    const before = room.queueTiles[index - 1];
    const tile = room.queueTiles[index];
    check(
      Math.abs(before.x - tile.x) + Math.abs(before.y - tile.y) === 1,
      `${label}: the line breaks between tiles ${index - 1} and ${index}`,
    );
  }
  const tail = room.queueTiles[room.queueTiles.length - 1];
  check(!rectContains(bounds, tail), `${label}: the line never spills out into the corridor`);
  const primaryExit = room.queueTiles.find((tile) =>
    room.blockedDoorways.some((doorway) => doorway.tiles.some((door) => samePoint(door, tile))),
  );
  check(primaryExit !== undefined, `${label}: the line leaves by no blocked doorway`);
  verifyEveryFlagHasAGoblin(room, label);

  const goblinTiles = blockedTilesOf(room);
  for (const tile of goblinTiles) {
    check(
      !gameMap.isWalkable(tile.x, tile.y),
      `${label}: goblin tile (${tile.x},${tile.y}) is walkable while the plumbing is broken`,
    );
  }
  for (const spot of room.loiterTiles) {
    check(rectContains(bounds, spot), `${label}: loiter spot (${spot.x},${spot.y}) is outside`);
  }
  // Goblins share loiter spots by wrapping round the list once the line clears,
  // so a short list stacks two goblins on one tile.
  const goblinPosts = room.queueTiles.length + room.doorwayKnots.flat().length;
  const loiterTiles =
    fault === 'loiter-short' ? room.loiterTiles.slice(0, goblinPosts - 1) : room.loiterTiles;
  const distinctSpots = new Set(loiterTiles.map((spot) => `${spot.x},${spot.y}`)).size;
  check(
    distinctSpots >= goblinPosts,
    `${label}: ${distinctSpots} loiter spots for ${goblinPosts} goblins`,
  );
  for (const spot of loiterTiles) {
    check(
      gameMap.isWalkableIgnoringBathroomQueue(spot.x, spot.y),
      `${label}: loiter spot (${spot.x},${spot.y}) is not open floor`,
    );
  }

  // With the line in place, the room's working parts are all still reachable
  // from its way in. The plumber is anchored on his tile, so he is as solid as
  // the line. The sinks count as solid in case they are dressed as props.
  const standingSolid = [...room.sinkTiles, room.plumberTile];
  const lineSolid =
    fault === 'line-covers-stalls' ? [...standingSolid, ...room.stallDoorTiles] : standingSolid;
  const fromEntrance = reachableTiles(gameMap, room.entranceTile, [], lineSolid);
  const size = gameMap.gridSize;
  const reaches = (tile: Point): boolean => fromEntrance.has(tileIndex(tile.x, tile.y, size));
  check(reaches(room.pipeWallStandTile), `${label}: the pipe wall cannot be reached past the line`);
  for (const [index, stall] of room.stallDoorTiles.entries()) {
    check(reaches(stall), `${label}: stall ${index} cannot be reached past the line`);
  }
  check(
    plumberTalkTiles(room.plumberTile).some(reaches),
    `${label}: the plumber cannot be reached past the line`,
  );
}

/**
 * Level 2, or for `pocket-on-bathroom` and `plumber-tile-open` the same floor
 * built with the rule that fault breaks switched off.
 */
function floorUnderTest(): LevelDef {
  if (level2.progression === undefined) return level2;
  const gateSwitches =
    fault === 'pocket-on-bathroom'
      ? { strandPocketsForGate: true }
      : fault === 'plumber-tile-open'
        ? { plumberWalkableForGate: true }
        : null;
  if (gateSwitches === null) return level2;
  return {
    ...level2,
    progression: {
      ...level2.progression,
      gauntlets: level2.progression.gauntlets.map((gauntlet) =>
        gauntlet.route.kind !== 'branches' || gauntlet.route.bathroomChoke === undefined
          ? gauntlet
          : {
              ...gauntlet,
              route: {
                ...gauntlet.route,
                bathroomChoke: { ...gauntlet.route.bathroomChoke, ...gateSwitches },
              },
            },
      ),
    },
  };
}

function firstWalkableTile(gameMap: GameMap, rect: Rect): Point | null {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (gameMap.isWalkable(x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Nothing that spawns on its own may be set down on a bathroom's goblin or
 * fixture tiles: a hallway rat on a queue tile starts inside ground it cannot
 * walk, and a room spawn in a bathroom would fight beside the line.
 */
function verifySpawnsClear(gameMap: GameMap, label: string): void {
  const rooms = gameMap.bathroomRooms;
  const taken = new Set(
    rooms
      .flatMap((room) => [
        ...blockedTilesOf(room),
        room.plumberTile,
        room.pipeWallStandTile,
        ...room.stallDoorTiles,
        ...room.sinkTiles,
        ...room.loiterTiles,
      ])
      .map((tile) => tileIndex(tile.x, tile.y, gameMap.gridSize)),
  );
  const hallwaySpawns: Point[] = [...gameMap.hallwaySpawnPoints];
  if (fault === 'rats-on-queue' && rooms.length > 0) {
    const line = rooms[0].queueTiles;
    if (line.length > 0) hallwaySpawns.push(line[line.length - 1]);
  }
  for (const spawn of hallwaySpawns) {
    check(
      !taken.has(tileIndex(spawn.x, spawn.y, gameMap.gridSize)),
      `${label}: a hallway spawn at (${spawn.x},${spawn.y}) stands on a bathroom tile`,
    );
  }
  for (const spawn of gameMap.mobSpawnPoints) {
    check(
      !rooms.some((room) => rectContains(room.bounds, spawn)),
      `${label}: a room spawn at (${spawn.x},${spawn.y}) is inside a bathroom`,
    );
  }
}

/**
 * Which rooms lie past Big Rooster's gateway safe room is a question about the route as
 * built, asked at floor load while the queue still stands. Its answer must not
 * change when the plumbing is fixed.
 */
function verifyPastSafeRoomIgnoresQueue(gameMap: GameMap, label: string): void {
  const roomBounds = gameMap.progressionLayout?.roomBounds ?? [];
  gameMap.setBathroomPlumbing('broken');
  const whileBroken = pastSafeRoomTest(gameMap, BIG_ROOSTER_BOSS_TYPE);
  const brokenAnswers = roomBounds.map((room) => whileBroken?.(room) ?? null);
  gameMap.setBathroomPlumbing('fixed');
  const whileFixed = pastSafeRoomTest(gameMap, BIG_ROOSTER_BOSS_TYPE);
  const changed = roomBounds.filter(
    (room, index) => (whileFixed?.(room) ?? null) !== brokenAnswers[index],
  ).length;
  check(
    changed === 0,
    `${label}: ${changed} rooms change sides of Big Rooster's gateway safe room when the plumbing is fixed`,
  );
  gameMap.setBathroomPlumbing('broken');
}

/**
 * Every safe pocket seated off the bathroom gauntlet's branches opens onto the
 * route either before its bathroom or after it, never onto the bathroom
 * itself, where the queue would strand it until the plumbing is fixed.
 */
function verifyPocketsNotStranded(
  gameMap: GameMap,
  gauntletRooms: ReadonlyArray<Rect>,
  gateway: Rect,
  label: string,
): void {
  const size = gameMap.gridSize;
  const bathroomRects = gameMap.bathroomRooms.map((room) => room.bounds);
  const pockets = gameMap.safeRooms.filter(
    (room) =>
      room.isSafeAccessPocket === true &&
      gauntletRooms.some((rect) => rect.x === room.bounds.x && rect.y === room.bounds.y),
  );
  gameMap.setBathroomPlumbing('fixed');
  for (const pocket of pockets) {
    const inside = firstWalkableTile(gameMap, pocket.bounds);
    if (inside === null) {
      check(
        false,
        `${label}: the safe pocket at (${pocket.bounds.x},${pocket.bounds.y}) has no floor`,
      );
      continue;
    }
    const reach = reachableTiles(gameMap, inside, bathroomRects);
    const opensOntoRoute =
      reach.has(tileIndex(gameMap.startTile.x, gameMap.startTile.y, size)) ||
      anyTileReachable(reach, size, gateway);
    check(
      opensOntoRoute,
      `${label}: the safe pocket at (${pocket.bounds.x},${pocket.bounds.y}) hangs off a bathroom`,
    );
  }
  gameMap.setBathroomPlumbing('broken');
}

function verifyFloor(run: number): void {
  const gameMap = new GameMap({
    mapSize: level2.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(floorUnderTest()),
  });
  if (fault === 'never-blocked') gameMap.setBathroomPlumbing('fixed');
  const size = gameMap.gridSize;
  const label = `run ${run}`;
  const layout = gameMap.progressionLayout;
  const gauntletIndex = layout?.bathroomGauntletIndex ?? null;
  if (layout === undefined || gauntletIndex === null) {
    check(false, `${label}: the floor recorded no bathroom gauntlet`);
    return;
  }
  const gauntlet = level2.progression?.gauntlets[gauntletIndex];
  const gateway = gameMap.safeRooms.find(
    (room) => room.guardsBossType === gauntlet?.bossType && room.followsBossType === undefined,
  );
  if (gateway === undefined) {
    check(false, `${label}: the bathroom gauntlet has no gateway safe room`);
    return;
  }

  verifySpawnsClear(gameMap, label);
  verifyPastSafeRoomIgnoresQueue(gameMap, label);
  verifyPocketsNotStranded(
    gameMap,
    layout.gauntletRoomBounds[gauntletIndex] ?? [],
    gateway.bounds,
    label,
  );

  const branches = layout.gauntletBranchChains[gauntletIndex] ?? [];
  const rooms = gameMap.bathroomRooms;
  check(
    rooms.length === branches.length,
    `${label}: ${rooms.length} bathrooms, ${branches.length} branches`,
  );
  for (const [branchIndex, chain] of branches.entries()) {
    const halfway =
      fault === 'halfway-off-by-one'
        ? bathroomBranchIndex(chain.length) + 1
        : bathroomBranchIndex(chain.length);
    const expected = halfway < chain.length ? chain[halfway] : null;
    const seated = rooms.find((room) => room.branchIndex === branchIndex);
    check(
      seated !== undefined &&
        expected !== null &&
        seated.bounds.x === expected.x &&
        seated.bounds.y === expected.y,
      `${label}: branch ${branchIndex}'s bathroom is not halfway along it`,
    );
  }

  // The layout half, on the live map: with every copy refused, nothing reaches
  // the gateway, and each copy's way in is reachable without another copy.
  setPlumbing(gameMap, 'fixed');
  const bypassRects =
    fault === 'bypass-checks-one-copy'
      ? rooms.slice(0, 1).map((room) => room.bounds)
      : rooms.map((room) => room.bounds);
  const avoidingBathrooms = reachableTiles(gameMap, gameMap.startTile, bypassRects);
  check(
    !anyTileReachable(avoidingBathrooms, size, gateway.bounds),
    `${label}: the gateway is reachable without walking through a bathroom`,
  );
  for (const [index, room] of rooms.entries()) {
    const approached = STEPS.some((step) =>
      avoidingBathrooms.has(
        tileIndex(room.entranceTile.x + step.x, room.entranceTile.y + step.y, size),
      ),
    );
    check(
      approached,
      `${label}: bathroom ${index}'s entrance is only reachable through a bathroom`,
    );
  }

  setPlumbing(gameMap, 'broken');
  const brokenReach = reachableTiles(gameMap, gameMap.startTile);
  check(
    !anyTileReachable(brokenReach, size, gateway.bounds),
    `${label}: the gateway is reachable while the plumbing is broken`,
  );
  for (const [index, room] of rooms.entries()) {
    check(
      brokenReach.has(tileIndex(room.entranceTile.x, room.entranceTile.y, size)),
      `${label}: bathroom ${index}'s entrance is unreachable from the start`,
    );
    verifyRoomShape(gameMap, room, `${label} bathroom ${index}`);
  }
  const brokenSnapshot = gameMap.captureCheckpoint();

  setPlumbing(gameMap, 'fixed');
  for (const [index, room] of rooms.entries()) {
    for (const tile of blockedTilesOf(room)) {
      check(
        gameMap.isWalkable(tile.x, tile.y),
        `${label}: bathroom ${index}'s tile (${tile.x},${tile.y}) stayed blocked after the fix`,
      );
    }
  }
  check(
    anyTileReachable(reachableTiles(gameMap, gameMap.startTile), size, gateway.bounds),
    `${label}: the gateway is still unreachable after the fix`,
  );

  // A fix is banked by a checkpoint taken after it, and undone by one taken before.
  const fixedSnapshot =
    fault === 'checkpoint-drops-plumbing'
      ? { ...gameMap.captureCheckpoint(), bathroomPlumbing: 'broken' as const }
      : gameMap.captureCheckpoint();
  gameMap.setBathroomPlumbing('broken');
  gameMap.restoreCheckpoint(fixedSnapshot);
  check(
    gameMap.bathroomPlumbingState === 'fixed',
    `${label}: restoring a checkpoint taken after the fix put the plumbing back broken`,
  );
  check(
    rooms.every((room) => blockedTilesOf(room).every((tile) => gameMap.isWalkable(tile.x, tile.y))),
    `${label}: restoring a checkpoint taken after the fix re-blocked the line`,
  );
  gameMap.restoreCheckpoint(brokenSnapshot);
  check(
    gameMap.bathroomPlumbingState === 'broken',
    `${label}: restoring a checkpoint taken before the fix left the plumbing fixed`,
  );
}

console.log(`── ${level2.id}: ${runs} floors${fault === null ? '' : `, fault ${fault}`} ──`);
for (let run = 0; run < runs; run++) verifyFloor(run);

console.log(
  `\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`,
);
process.exit(failures === 0 ? 0 : 1);
