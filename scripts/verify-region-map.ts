/**
 * The dungeon region map, checked against the live `GameMap` over a sweep of
 * floor 1 and floor 2 seeds.
 *
 * Room characters, lighting, hallway dressing and the wear field all ask "which
 * room or hallway is this tile", so the map has to answer for every tile a
 * crawler can stand on, and `roomIndexAt` — which the room-clear and Mongo
 * logic read — has to give exactly the answer the first-match search over
 * `roomBounds` gives. That search is restated here rather than imported so the
 * gate compares the grid against an independent definition.
 *
 *   npx tsx scripts/verify-region-map.ts
 *   npx tsx scripts/verify-region-map.ts --seeds=20
 */
import { TILE_SIZE } from '../src/core/constants.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import { GameMap } from '../src/map/GameMap.js';
import { TutorialMap } from '../src/map/TutorialMap.js';
import { DRESSING_TILE_TYPES } from '../src/map/dungeon/roomDressing.js';
import { HALLWAY_REGION_BASE, NO_REGION } from '../src/map/regionMap.js';
import type { Rect } from '../src/map/roomDoorways.js';
import { FloorTypeValue, VOID_TYPE } from '../src/map/tileTypes.js';
import { isWalkableTileType } from '../src/map/walkability.js';

const DEFAULT_SEEDS_PER_FLOOR = 8;
/** Keeps the two floors' seeds apart so a failure line names one map. */
const SEED_STRIDE_PER_FLOOR = 100_000;
/** Offsets past each grid edge that must read as "no region". */
const OFF_GRID_PROBES: ReadonlyArray<number> = [-1, 0, 1];
/** Seeds for the non-progression maps, which must carry an empty region map. */
const FREE_ROAM_SEEDS: ReadonlyArray<number> = [3, 5];
const FREE_ROAM_MAP_SIZE = 100;

function seedsPerFloor(): number {
  const arg = process.argv.find((value) => value.startsWith('--seeds='));
  const parsed = arg === undefined ? Number.NaN : Number(arg.slice('--seeds='.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SEEDS_PER_FLOOR;
}

let failures = 0;
let checks = 0;
let currentLabel = '';

const MAX_PRINTED_FAILURES = 40;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  if (failures <= MAX_PRINTED_FAILURES) console.log(`  FAIL [${currentLabel}]: ${message}`);
}

function linearRoomIndexAt(rooms: ReadonlyArray<Rect>, x: number, y: number): number {
  return rooms.findIndex(
    (room) => x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h,
  );
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface SweepTotals {
  maps: number;
  rooms: number;
  hallways: number;
  nookHallways: number;
  arenaHallways: number;
  unkindedHallways: number;
  doorways: number;
  /** Non-walkable tiles outside every room that carry no region, by tile type. */
  unregionedBlockers: Map<number, number>;
}

function checkFloorMap(map: GameMap, totals: SweepTotals): void {
  const regions = map.regionMap;
  const layout = map.progressionLayout;
  check(layout !== undefined, 'a progression floor generated no progression layout');
  if (layout === undefined) return;

  const bounds = map.roomBounds;
  check(
    bounds.length === layout.roomBounds.length &&
      bounds.every((rect, index) => sameRect(rect, layout.roomBounds[index])),
    'roomBounds does not match the generator’s own room list',
  );
  check(bounds.length < HALLWAY_REGION_BASE, 'room ids reach into the hallway id range');

  for (let a = 0; a < bounds.length; a++) {
    for (let b = a + 1; b < bounds.length; b++) {
      check(!rectsOverlap(bounds[a], bounds[b]), `rooms ${a} and ${b} overlap`);
    }
  }

  const height = map.structure.length;
  const width = map.structure[0]?.length ?? 0;
  check(regions.width === width && regions.height === height, 'region grid is not map-sized');

  const hallwayTileCounts = new Map<number, number>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = map.structure[y][x];
      const expectedRoom = linearRoomIndexAt(bounds, x, y);
      const roomIndex = map.roomIndexAt(x, y);
      if (roomIndex !== expectedRoom) {
        check(false, `roomIndexAt(${x}, ${y}) = ${roomIndex}, linear search says ${expectedRoom}`);
        continue;
      }
      const id = map.regionAt(x, y);
      if (expectedRoom !== NO_REGION) {
        check(
          id === expectedRoom,
          `room tile (${x}, ${y}) has region ${id}, not room ${expectedRoom}`,
        );
        check(map.regionKind(id) === 'room', `room tile (${x}, ${y}) region is not a room`);
        continue;
      }
      // A prop the generator stood in a hallway after the regions were drawn
      // keeps its segment's id, just as a prop in a room keeps the room's.
      const hallwayProp = DRESSING_TILE_TYPES.has(tile.type) && tile.groundType !== undefined;
      if (isWalkableTileType(tile) || hallwayProp) {
        check(id !== NO_REGION, `walkable tile (${x}, ${y}) belongs to no region`);
        check(
          id >= HALLWAY_REGION_BASE && map.regionKind(id) === 'hallway',
          `walkable non-room tile (${x}, ${y}) has region ${id}, not a hallway`,
        );
        hallwayTileCounts.set(id, (hallwayTileCounts.get(id) ?? 0) + 1);
        continue;
      }
      check(id === NO_REGION, `blocking tile (${x}, ${y}) outside every room has region ${id}`);
      const isRock = tile.type === FloorTypeValue.wall || tile.type === VOID_TYPE;
      if (id === NO_REGION && !isRock) {
        totals.unregionedBlockers.set(
          tile.type,
          (totals.unregionedBlockers.get(tile.type) ?? 0) + 1,
        );
      }
    }
  }

  for (const probe of OFF_GRID_PROBES) {
    for (const [x, y] of [
      [-1 - probe, 0],
      [0, -1 - probe],
      [width + probe, 0],
      [0, height + probe],
    ]) {
      check(map.regionAt(x, y) === NO_REGION, `off-grid (${x}, ${y}) has a region`);
      check(map.roomIndexAt(x, y) === NO_REGION, `off-grid (${x}, ${y}) has a room`);
    }
  }
  check(map.regionKind(NO_REGION) === null, 'NO_REGION has a kind');

  check(regions.rooms.length === bounds.length, 'region room count differs from roomBounds');
  regions.rooms.forEach((room, index) => {
    check(room.id === index, `room ${index} carries id ${room.id}`);
    check(sameRect(room.bounds, bounds[index]), `room ${index} bounds differ from roomBounds`);
    for (const doorway of room.doorways) {
      for (const tile of doorway.tiles) {
        check(
          map.regionAt(tile.x, tile.y) === index,
          `room ${index} doorway tile (${tile.x}, ${tile.y}) is not in the room`,
        );
      }
    }
    totals.doorways += room.doorways.length;
  });

  const roomIds = new Set(regions.rooms.map((room) => room.id));
  regions.hallways.forEach((hallway, index) => {
    check(hallway.id === HALLWAY_REGION_BASE + index, `hallway ${index} carries id ${hallway.id}`);
    check(!roomIds.has(hallway.id), `hallway id ${hallway.id} collides with a room id`);
    check(
      hallwayTileCounts.get(hallway.id) === hallway.tiles.length,
      `hallway ${hallway.id} lists ${hallway.tiles.length} tiles, the grid holds ${hallwayTileCounts.get(hallway.id) ?? 0}`,
    );
    check(
      hallway.rooms.every((room) => roomIds.has(room)),
      `hallway ${hallway.id} opens onto an unknown room`,
    );
    check(
      hallway.hallwayKind === (hallway.hallwayKinds[hallway.hallwayKinds.length - 1] ?? null),
      `hallway ${hallway.id} dominant kind disagrees with its kinds`,
    );
    if (hallway.hallwayKind === 'nook') totals.nookHallways++;
    if (hallway.hallwayKind === null) totals.unkindedHallways++;
    if (hallway.arena) totals.arenaHallways++;
  });

  // Roles survive generation, cross-checked against the encounter lists the
  // generator publishes separately.
  const roleOf = (rect: Rect): string | undefined =>
    regions.rooms.find((room) => sameRect(room.bounds, rect))?.role;
  check(regions.rooms[0]?.role === 'start', 'room 0 is not the start room');
  check(
    regions.rooms.filter((room) => room.role === 'start').length === 1,
    'floor has other than one start room',
  );
  check(
    map.roomIndexAt(map.startTile.x, map.startTile.y) === 0,
    'start tile is not in the start room',
  );
  for (const safe of map.safeRooms) {
    check(roleOf(safe.bounds) === 'safe', 'a safe room does not carry the safe role');
  }
  for (const boss of map.bossRooms) {
    check(roleOf(boss.bounds) === 'boss', 'a boss room does not carry the boss role');
  }
  for (const quest of map.questRooms) {
    check(roleOf(quest.bounds) === 'quest', 'a quest room does not carry the quest role');
  }
  if (map.spiderLabRoom !== null) {
    check(roleOf(map.spiderLabRoom.bounds) === 'spider_lab', 'the spider lab lost its role');
  }
  const treasureRooms = regions.rooms.filter((room) => room.treasure);
  check(
    treasureRooms.length === map.treasureRooms.length &&
      map.treasureRooms.every((treasure) =>
        treasureRooms.some((room) => sameRect(room.bounds, treasure.bounds)),
      ),
    'treasure flags do not match the treasure room list',
  );

  totals.maps++;
  totals.rooms += regions.rooms.length;
  totals.hallways += regions.hallways.length;
}

function checkEmptyRegionMap(map: GameMap): void {
  check(map.roomBounds.length === 0, 'a non-progression map lists rooms');
  check(map.regionMap.rooms.length === 0, 'a non-progression map has room regions');
  check(map.regionMap.hallways.length === 0, 'a non-progression map has hallway regions');
  const height = map.structure.length;
  const width = map.structure[0]?.length ?? 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (map.regionAt(x, y) !== NO_REGION || map.roomIndexAt(x, y) !== NO_REGION) {
        check(false, `non-progression tile (${x}, ${y}) has a region`);
        return;
      }
    }
  }
}

function sweepFloor(name: string, levelDef: LevelDef, floorIndex: number, seeds: number): void {
  const totals: SweepTotals = {
    maps: 0,
    rooms: 0,
    hallways: 0,
    nookHallways: 0,
    arenaHallways: 0,
    unkindedHallways: 0,
    doorways: 0,
    unregionedBlockers: new Map(),
  };
  for (let run = 0; run < seeds; run++) {
    const worldSeed = floorIndex * SEED_STRIDE_PER_FLOOR + run + 1;
    currentLabel = `${name} seed ${worldSeed}`;
    const map = new GameMap({
      mapSize: levelDef.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      dungeon: dungeonOptionsForLevel(levelDef),
      worldSeed,
    });
    checkFloorMap(map, totals);
  }
  const blockers = [...totals.unregionedBlockers]
    .map(([type, count]) => `type ${type}×${count}`)
    .join(', ');
  console.log(
    `${name}: ${totals.maps} maps, ${totals.rooms} rooms, ${totals.doorways} doorways, ` +
      `${totals.hallways} hallway segments (${totals.nookHallways} nook, ` +
      `${totals.arenaHallways} arena, ${totals.unkindedHallways} with no carved kind)`,
  );
  console.log(`  blocking non-wall tiles outside rooms with no region: ${blockers || 'none'}`);
  // A floor where no segment ever reads as a nook means the carvers' kinds are
  // not reaching the map, which no per-tile check above would notice.
  currentLabel = name;
  check(totals.nookHallways > 0, 'no hallway segment on any seed was recorded as a nook');
}

const seeds = seedsPerFloor();
sweepFloor('floor 1', level1, 1, seeds);
sweepFloor('floor 2', level2, 2, seeds);

for (const worldSeed of FREE_ROAM_SEEDS) {
  currentLabel = `free-roam seed ${worldSeed}`;
  checkEmptyRegionMap(
    new GameMap({
      mapSize: FREE_ROAM_MAP_SIZE,
      tileHeight: TILE_SIZE,
      mapType: 'dungeon',
      worldSeed,
    }),
  );
}
currentLabel = 'tutorial';
checkEmptyRegionMap(new TutorialMap());

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
