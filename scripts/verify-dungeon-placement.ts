/**
 * Room and hallway dressing, checked over a sweep of floor 1 and floor 2
 * seeds: every populated room has a character, and the props that character
 * placed leave the floor as playable as it was bare.
 *
 * Per map:
 * - progression validation passes on the dressed floor, and the same seed
 *   built without props is accepted on the same attempt with the same floor
 *   under the props, so no prop ever forced the generator to re-roll
 * - no blocking prop stands within a tile of a doorway
 * - no room and no hallway segment is cut into more walkable pieces than it
 *   had bare
 * - no prop covers, and no blocking prop stands beside, a spawn point, a
 *   chest, a stairwell footprint, a building door, the arena's stairwell or a
 *   crawler sign
 * - blocking props cover at most `MAX_BLOCKING_PROP_COVERAGE` of each room,
 *   and none stands in a room's open middle
 * - outside rooms, a blocking prop stands only in a nook segment, on the
 *   tile that is not open on two opposite sides, so never in a walking lane
 * - every populated room and every non-arena hallway segment has a character,
 *   and every special room its lighting tag
 * - a room holds at most one gas bottle, and none stands within
 *   `GAS_CYLINDER_CLEARANCE` tiles of any doorway or spawn point
 * - a room holds at most `MAX_REMAINS_PER_ROOM` remains (skeletons, bone
 *   piles, loose bones), none beside another, so they never line up in a row
 * - every start room stands at least one light of its own, and nothing covers
 *   or crowds the tile the crawler arrives on
 * - no solid piece is walled in: each has open floor on at least one side,
 *   so it can be struck and broken, and a lamp it carries put out
 *
 * Doorways and components are measured on the floor with its props lifted
 * back off, so the gate judges the props against the layout they were placed
 * in rather than against one they have already changed.
 *
 * Before the sweep it runs each check against a floor with that one rule
 * deliberately broken and fails unless the check notices.
 *
 *   npx tsx scripts/verify-dungeon-placement.ts
 *   npx tsx scripts/verify-dungeon-placement.ts --seeds=40
 */
import { withWorldSeed } from '../src/core/WorldRandom.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level2 } from '../src/levels/level2.js';
import type { LevelDef } from '../src/levels/types.js';
import {
  generateDungeon,
  progressionExpectations,
  type DungeonData,
} from '../src/map/DungeonGenerator.js';
import {
  DRESSING_TILE_TYPES,
  MAX_BLOCKING_PROP_COVERAGE,
} from '../src/map/dungeon/roomDressing.js';
import { RegionCharacters } from '../src/map/dungeon/regionCharacters.js';
import { validateProgression } from '../src/map/progressionValidation.js';
import { HALLWAY_REGION_BASE } from '../src/map/regionMap.js';
import { roomDoorways, type Point, type Rect } from '../src/map/roomDoorways.js';
import {
  BARREL,
  BONE_PILE,
  BONES,
  CRAWLER_SIGN,
  GAS_CYLINDER,
  placeProp,
  SLUMPED_SKELETON,
  TORCH,
  type TileContent,
} from '../src/map/tileTypes.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import { PROP_PART_TILE_TYPES } from '../src/map/serviceLevelProps.js';

const DEFAULT_SEEDS_PER_FLOOR = 12;
/** Keeps the two floors' seeds apart so a failure line names one map. */
const SEED_STRIDE_PER_FLOOR = 100_000;
const MAX_PRINTED_FAILURES = 40;
/** Tiles every stairwell covers, from its recorded tile across and down. */
const STAIRWELL_FOOTPRINT_SPAN = 2;
/**
 * Tiles on each side of a doorway, spawn point, chest, stairwell, building
 * door or sign that must stay free of blocking props.
 */
const CLEARANCE_TILES = 1;
/**
 * The deepest row, counted in from a room's edge (0 on the edge), a blocking
 * prop may stand on. Stated here rather than read from the placer, so a
 * placer that wandered into the middle could not also move the line it is
 * judged against.
 */
const MAX_PROP_DEPTH = 2;
const PERCENT = 100;
/**
 * Tiles every way from a gas bottle that must hold no doorway and no spawn
 * point. Stated here rather than read from the placer, for the same reason as
 * `MAX_PROP_DEPTH`.
 */
const GAS_CYLINDER_CLEARANCE = 3;
const MAX_GAS_CYLINDERS_PER_ROOM = 1;
/**
 * Remains one room may hold, and the tiles kept between two of them. Stated
 * here rather than read from the placer, for the same reason as
 * `MAX_PROP_DEPTH`.
 */
const MAX_REMAINS_PER_ROOM = 3;
const REMAINS_SPACING_TILES = 1;
const REMAINS_TILE_TYPES: ReadonlySet<number> = new Set<number>([
  BONES,
  BONE_PILE,
  SLUMPED_SKELETON,
]);
/** Characters of a generation error printed; its full list of failed invariants runs long. */
const MAX_ERROR_CHARS = 300;
/** Rows a room needs for a wall across its middle to leave floor on both sides. */
const MIN_SPLITTABLE_ROOM_HEIGHT = 3;
/** The floor each negative test breaks a rule on. */
const NEGATIVE_TEST_SEED = 1;

const ORTHOGONAL: ReadonlyArray<Point> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function seedsPerFloor(): number {
  const arg = process.argv.find((value) => value.startsWith('--seeds='));
  const parsed = arg === undefined ? Number.NaN : Number(arg.slice('--seeds='.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SEEDS_PER_FLOOR;
}

/** One broken rule on one map. */
interface Violation {
  readonly rule: string;
  readonly message: string;
}

/** The tile at a position, or null off the grid. */
function tileAt(grid: TileContent[][], x: number, y: number): TileContent | null {
  if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) return null;
  return grid[y][x];
}

function isDressingTile(tile: TileContent | null): boolean {
  if (tile?.groundType === undefined) return false;
  return DRESSING_TILE_TYPES.has(tile.type);
}

function isBlockingDressing(tile: TileContent | null): boolean {
  return tile !== null && isDressingTile(tile) && !isWalkableTileType(tile);
}

/** The grid with every dressing prop lifted back off to the floor under it. */
function bareGrid(grid: TileContent[][]): TileContent[][] {
  return grid.map((row) =>
    row.map((tile) =>
      isDressingTile(tile)
        ? { ...tile, type: tile.groundType ?? tile.type, groundType: undefined }
        : tile,
    ),
  );
}

/** Four-connected pieces the walkable tiles among `tiles` fall into. */
function componentCount(grid: TileContent[][], tiles: ReadonlyArray<Point>): number {
  const inSet = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
  const walkable = (x: number, y: number): boolean => {
    const tile = tileAt(grid, x, y);
    return inSet.has(`${x},${y}`) && tile !== null && isWalkableTileType(tile);
  };
  const seen = new Set<string>();
  let components = 0;
  for (const start of tiles) {
    const startKey = `${start.x},${start.y}`;
    if (seen.has(startKey) || !walkable(start.x, start.y)) continue;
    components++;
    seen.add(startKey);
    const stack: Point[] = [start];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      for (const step of ORTHOGONAL) {
        const x = next.x + step.x;
        const y = next.y + step.y;
        const key = `${x},${y}`;
        if (seen.has(key) || !walkable(x, y)) continue;
        seen.add(key);
        stack.push({ x, y });
      }
    }
  }
  return components;
}

function rectTiles(rect: Rect): Point[] {
  const tiles: Point[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** Tiles between a tile and the nearest edge of a rect; 0 on the edge row. */
function depthIn(rect: Rect, tile: Point): number {
  return Math.min(
    tile.x - rect.x,
    rect.x + rect.w - 1 - tile.x,
    tile.y - rect.y,
    rect.y + rect.h - 1 - tile.y,
  );
}

/**
 * Whether a tile, on the bare floor, is open on two opposite sides: any
 * crawler walking along that row or column passes over it, so a prop there
 * stands in a lane.
 */
function standsInThroughLine(grid: TileContent[][], tile: Point): boolean {
  const open = (dx: number, dy: number): boolean => {
    const cell = tileAt(grid, tile.x + dx, tile.y + dy);
    return cell !== null && isWalkableTileType(cell);
  };
  return (open(0, -1) && open(0, 1)) || (open(-1, 0) && open(1, 0));
}

/** Totals over a sweep, printed so a green run shows it measured something. */
interface SweepTotals {
  maps: number;
  populatedRooms: number;
  /** Dressed rooms that ended up with no blocking prop at all. */
  roomsWithoutBlockingProps: number;
  unlitRooms: number;
  blockingTiles: number;
  walkableTiles: number;
  hallwayBlockingTiles: number;
  worstCoverage: number;
  /** Whole-map attempts the accepted layouts took, summed. */
  attempts: number;
  characters: Map<string, number>;
  gasCylinders: number;
}

function checkMap(data: DungeonData, levelDef: LevelDef, totals: SweepTotals | null): Violation[] {
  const violations: Violation[] = [];
  const fail = (rule: string, message: string): void => {
    violations.push({ rule, message });
  };
  const { grid, regionMap, regionCharacters } = data;
  const bare = bareGrid(grid);

  const expectations = progressionExpectations({
    ...dungeonOptionsForLevel(levelDef),
    size: levelDef.mapSize,
  });
  for (const failure of validateProgression(data, expectations)) {
    fail('progression', `${failure.id}: ${failure.message}`);
  }

  const protectedTiles: Point[] = [
    data.startTile,
    ...data.mobSpawnPoints,
    ...data.hallwaySpawnPoints,
    ...data.treasureRooms.map((room) => room.centre),
    ...data.stairwellTiles.flatMap((stairwell) =>
      rectTiles({
        x: stairwell.x,
        y: stairwell.y,
        w: STAIRWELL_FOOTPRINT_SPAN,
        h: STAIRWELL_FOOTPRINT_SPAN,
      }),
    ),
  ];
  protectedTiles.push(
    ...data.buildingEntries.map((entry) => entry.doorTile),
    ...data.arenaExteriors.map((arena) => arena.stairwellTile),
  );
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x].type === CRAWLER_SIGN) protectedTiles.push({ x, y });
    }
  }
  for (const tile of protectedTiles) {
    if (isDressingTile(tileAt(grid, tile.x, tile.y))) {
      fail('spawn-covered', `a prop covers protected tile (${tile.x}, ${tile.y})`);
    }
    for (let dy = -CLEARANCE_TILES; dy <= CLEARANCE_TILES; dy++) {
      for (let dx = -CLEARANCE_TILES; dx <= CLEARANCE_TILES; dx++) {
        if (isBlockingDressing(tileAt(grid, tile.x + dx, tile.y + dy))) {
          fail(
            'spawn-covered',
            `blocking prop at (${tile.x + dx}, ${tile.y + dy}) beside protected tile (${tile.x}, ${tile.y})`,
          );
        }
      }
    }
  }

  const roomAssignments = regionCharacters.roomAssignments();
  for (const room of regionMap.rooms) {
    const assignment = roomAssignments[room.id] ?? null;
    const populated = room.role === 'regular' || room.role === 'chain';
    if (populated && assignment?.type !== 'room') {
      fail('character', `populated room ${room.id} (${room.role}) has no character`);
    }
    if (!populated && assignment?.type !== 'special') {
      fail('character', `special room ${room.id} (${room.role}) has no lighting tag`);
    }
    if (assignment?.type === 'room') {
      if (totals !== null) {
        totals.populatedRooms++;
        if (assignment.unlit) totals.unlitRooms++;
        const id = assignment.character.id;
        totals.characters.set(id, (totals.characters.get(id) ?? 0) + 1);
      }
      if (assignment.unlit && room.zone === 'entrance') {
        fail('unlit-zone', `entrance room ${room.id} was rolled unlit`);
      }
    }

    const tiles = rectTiles(room.bounds);
    let blocking = 0;
    for (const tile of tiles) {
      const cell = tileAt(grid, tile.x, tile.y);
      if (isDressingTile(cell) && totals !== null && !isBlockingDressing(cell)) {
        totals.walkableTiles++;
      }
      if (!isBlockingDressing(cell)) continue;
      blocking++;
      if (depthIn(room.bounds, tile) > MAX_PROP_DEPTH) {
        fail(
          'open-middle',
          `room ${room.id}: blocking prop at (${tile.x}, ${tile.y}) in the middle`,
        );
      }
    }
    if (totals !== null) {
      totals.blockingTiles += blocking;
      if (assignment?.type === 'room' && blocking === 0) totals.roomsWithoutBlockingProps++;
    }
    const coverage = blocking / (room.bounds.w * room.bounds.h);
    if (totals !== null) totals.worstCoverage = Math.max(totals.worstCoverage, coverage);
    if (coverage > MAX_BLOCKING_PROP_COVERAGE) {
      fail(
        'coverage',
        `room ${room.id}: blocking props cover ${(coverage * PERCENT).toFixed(1)}% of its floor`,
      );
    }

    for (const doorway of roomDoorways(bare, room.bounds)) {
      for (const tile of doorway.tiles) {
        for (let dy = -CLEARANCE_TILES; dy <= CLEARANCE_TILES; dy++) {
          for (let dx = -CLEARANCE_TILES; dx <= CLEARANCE_TILES; dx++) {
            if (isBlockingDressing(tileAt(grid, tile.x + dx, tile.y + dy))) {
              fail(
                'doorway',
                `room ${room.id}: blocking prop at (${tile.x + dx}, ${tile.y + dy}) beside doorway (${tile.x}, ${tile.y})`,
              );
            }
          }
        }
      }
    }

    if (componentCount(grid, tiles) > componentCount(bare, tiles)) {
      fail('room-split', `room ${room.id} is cut into more walkable pieces than it had bare`);
    }

    const gasCylinders = tiles.filter(
      (tile) => tileAt(grid, tile.x, tile.y)?.type === GAS_CYLINDER,
    );
    if (totals !== null) totals.gasCylinders += gasCylinders.length;
    if (gasCylinders.length > MAX_GAS_CYLINDERS_PER_ROOM) {
      fail('gas-cylinder-count', `room ${room.id} holds ${gasCylinders.length} gas bottles`);
    }
    const remains = tiles.filter((tile) => {
      const cell = tileAt(grid, tile.x, tile.y);
      return cell !== null && isDressingTile(cell) && REMAINS_TILE_TYPES.has(cell.type);
    });
    if (remains.length > MAX_REMAINS_PER_ROOM) {
      fail('remains-count', `room ${room.id} holds ${remains.length} remains`);
    }
    for (const [index, body] of remains.entries()) {
      const beside = remains
        .slice(index + 1)
        .find(
          (other) =>
            Math.abs(other.x - body.x) <= REMAINS_SPACING_TILES &&
            Math.abs(other.y - body.y) <= REMAINS_SPACING_TILES,
        );
      if (beside !== undefined) {
        fail(
          'remains-spacing',
          `room ${room.id}: remains at (${body.x}, ${body.y}) and (${beside.x}, ${beside.y}) lie side by side`,
        );
      }
    }

    if (room.role === 'start') {
      const lights = tiles.filter((tile) => {
        const cell = tileAt(grid, tile.x, tile.y);
        return cell !== null && isDressingTile(cell) && cell.type === TORCH;
      });
      if (lights.length === 0) fail('start-dark', `start room ${room.id} stands no light`);
    }

    const hazardsNearby: Point[] = [
      ...roomDoorways(bare, room.bounds).flatMap((doorway) => doorway.tiles),
      ...data.mobSpawnPoints,
      ...data.hallwaySpawnPoints,
    ];
    for (const bottle of gasCylinders) {
      const near = hazardsNearby.find(
        (point) =>
          Math.abs(point.x - bottle.x) <= GAS_CYLINDER_CLEARANCE &&
          Math.abs(point.y - bottle.y) <= GAS_CYLINDER_CLEARANCE,
      );
      if (near !== undefined) {
        fail(
          'gas-cylinder-clearance',
          `room ${room.id}: gas bottle at (${bottle.x}, ${bottle.y}) within ` +
            `${GAS_CYLINDER_CLEARANCE} tiles of a doorway or spawn at (${near.x}, ${near.y})`,
        );
      }
    }
  }

  const hallwayAssignments = regionCharacters.hallwayAssignments();
  for (const hallway of regionMap.hallways) {
    const assignment = hallwayAssignments[hallway.id - HALLWAY_REGION_BASE] ?? null;
    const expected = hallway.arena ? 'special' : 'hallway';
    if (assignment?.type !== expected) {
      fail('character', `hallway ${hallway.id} has no ${expected} assignment`);
    }
    for (const tile of hallway.tiles) {
      if (!isBlockingDressing(tileAt(grid, tile.x, tile.y))) continue;
      if (totals !== null) totals.hallwayBlockingTiles++;
      if (!hallway.hallwayKinds.includes('nook')) {
        fail(
          'lane',
          `hallway ${hallway.id} is no nook but has a blocking prop at (${tile.x}, ${tile.y})`,
        );
      } else if (standsInThroughLine(bare, tile)) {
        fail(
          'lane',
          `hallway ${hallway.id}: blocking prop at (${tile.x}, ${tile.y}) stands in a lane`,
        );
      }
    }
    if (componentCount(grid, hallway.tiles) > componentCount(bare, hallway.tiles)) {
      fail(
        'hallway-split',
        `hallway ${hallway.id} is cut into more walkable pieces than it had bare`,
      );
    }
  }

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      const cell = grid[y][x];
      // A part tile of a larger piece is struck through its anchor.
      if (!isBlockingDressing(cell) || PROP_PART_TILE_TYPES.has(cell.type)) continue;
      const open = ORTHOGONAL.some((step) => {
        const neighbour = tileAt(grid, x + step.x, y + step.y);
        return neighbour !== null && isWalkableTileType(neighbour);
      });
      if (!open) fail('walled-in', `prop at (${x}, ${y}) has no open floor on any side`);
    }
  }

  // A blocking prop outside every room and hallway would be one no check
  // above has looked at.
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      if (!isBlockingDressing(grid[y][x])) continue;
      if (regionMap.regionAt(x, y) < 0) fail('stray', `blocking prop at (${x}, ${y}) in no region`);
    }
  }

  if (totals !== null) totals.maps++;
  return violations;
}

function generate(levelDef: LevelDef, worldSeed: number, placeProps = true): DungeonData {
  return withWorldSeed(worldSeed, () =>
    generateDungeon({ ...dungeonOptionsForLevel(levelDef), size: levelDef.mapSize, placeProps }),
  );
}

function sameTileTypes(a: TileContent[][], b: TileContent[][]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, y) => row.length === b[y].length && row.every((tile, x) => tile.type === b[y][x].type),
    )
  );
}

// ── Negative tests ──────────────────────────────────────────────────────────

/** Makes a tile a blocking dressing prop, as the generator would. */
function plant(data: DungeonData, tile: Point): void {
  const cell = tileAt(data.grid, tile.x, tile.y);
  if (cell !== null) placeProp(cell, BARREL);
}

/**
 * Each check, run against a floor with its one rule broken. A check that
 * stays quiet here would stay quiet on a real regression too.
 */
function runNegativeTests(): number {
  let missed = 0;
  /** `breakRule` returns the broken floor, or null when it found nowhere to break the rule. */
  const expectRed = (
    rule: string,
    breakRule: (data: DungeonData) => DungeonData | null,
    label = rule,
  ): void => {
    let floor: DungeonData;
    try {
      floor = generate(level1, NEGATIVE_TEST_SEED);
    } catch {
      console.log(`  negative test "${label}": the floor failed to generate — MISSED`);
      missed++;
      return;
    }
    const broken = breakRule(floor);
    if (broken === null) {
      console.log(`  negative test "${label}": found nowhere to break the rule — MISSED`);
      missed++;
      return;
    }
    const fired = checkMap(broken, level1, null).some((violation) => violation.rule === rule);
    console.log(`  negative test "${label}": ${fired ? 'caught' : 'MISSED'}`);
    if (!fired) missed++;
  };
  const firstPopulated = (data: DungeonData) =>
    data.regionMap.rooms.find((room) => room.role === 'regular' || room.role === 'chain');

  expectRed('doorway', (data) => {
    const room = data.regionMap.rooms.find(
      (candidate) => candidate.role === 'regular' && candidate.doorways.length > 0,
    );
    const doorway = room?.doorways[0]?.tile;
    if (doorway === undefined) return null;
    plant(data, doorway);
    return data;
  });
  expectRed('spawn-covered', (data) => {
    if (data.mobSpawnPoints.length === 0) return null;
    plant(data, data.mobSpawnPoints[0]);
    return data;
  });
  expectRed(
    'spawn-covered',
    (data) => {
      // Beside the spawn rather than on it: the clearance ring is the rule.
      if (data.mobSpawnPoints.length === 0) return null;
      const spawn = data.mobSpawnPoints[0];
      plant(data, { x: spawn.x + CLEARANCE_TILES, y: spawn.y });
      return data;
    },
    'spawn-clearance ring',
  );
  expectRed('open-middle', (data) => {
    const room = data.regionMap.rooms.find(
      (candidate) =>
        candidate.role === 'regular' &&
        Math.min(candidate.bounds.w, candidate.bounds.h) >= (MAX_PROP_DEPTH + 1) * 2 + 1,
    );
    if (room === undefined) return null;
    const depth = MAX_PROP_DEPTH + 1;
    plant(data, { x: room.bounds.x + depth, y: room.bounds.y + depth });
    return data;
  });
  expectRed('coverage', (data) => {
    const room = firstPopulated(data);
    if (room === undefined) return null;
    // A whole edge row and the row inside it: far past the cap, and in the band.
    for (const tile of rectTiles({ ...room.bounds, h: 2 })) plant(data, tile);
    return data;
  });
  expectRed('room-split', (data) => {
    const room = data.regionMap.rooms.find(
      (candidate) =>
        candidate.role === 'regular' && candidate.bounds.h >= MIN_SPLITTABLE_ROOM_HEIGHT,
    );
    if (room === undefined) return null;
    const wallRow = room.bounds.y + Math.floor(room.bounds.h / 2);
    for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++)
      plant(data, { x, y: wallRow });
    return data;
  });
  expectRed('lane', (data) => {
    const hallway = data.regionMap.hallways.find(
      (candidate) => !candidate.arena && !candidate.hallwayKinds.includes('nook'),
    );
    const tile = hallway?.tiles[0];
    if (tile === undefined) return null;
    plant(data, tile);
    return data;
  });
  expectRed('hallway-split', (data) => {
    // A tile open only to its two opposite sides is the middle of a one-tile
    // lane; standing a prop on it cuts the lane in two.
    for (const hallway of data.regionMap.hallways) {
      if (hallway.arena) continue;
      const segment = new Set(hallway.tiles.map((tile) => `${tile.x},${tile.y}`));
      for (const tile of hallway.tiles) {
        const open = ORTHOGONAL.map((step) => {
          const x = tile.x + step.x;
          const y = tile.y + step.y;
          const cell = tileAt(data.grid, x, y);
          return cell !== null && isWalkableTileType(cell) && segment.has(`${x},${y}`);
        });
        const [north, east, south, west] = open;
        const straightLane =
          (north && south && !east && !west) || (east && west && !north && !south);
        if (!straightLane) continue;
        plant(data, tile);
        return data;
      }
    }
    return null;
  });
  expectRed('gas-cylinder-clearance', (data) => {
    const room = data.regionMap.rooms.find(
      (candidate) => candidate.role === 'regular' && candidate.doorways.length > 0,
    );
    const doorway = room?.doorways[0]?.tile;
    if (room === undefined || doorway === undefined) return null;
    // Two tiles in from the doorway, inside the room: past the one-tile
    // doorway ring, well inside the bottle's.
    const inside = rectTiles(room.bounds).find(
      (tile) => Math.max(Math.abs(tile.x - doorway.x), Math.abs(tile.y - doorway.y)) === 2,
    );
    if (inside === undefined) return null;
    const cell = tileAt(data.grid, inside.x, inside.y);
    if (cell === null) return null;
    placeProp(cell, GAS_CYLINDER);
    return data;
  });
  expectRed('gas-cylinder-count', (data) => {
    const room = firstPopulated(data);
    if (room === undefined) return null;
    for (const tile of rectTiles({ ...room.bounds, h: 1 }).slice(0, 2)) {
      const cell = tileAt(data.grid, tile.x, tile.y);
      if (cell !== null) placeProp(cell, GAS_CYLINDER);
    }
    return data;
  });
  expectRed('remains-count', (data) => {
    const room = firstPopulated(data);
    if (room === undefined) return null;
    // Spaced apart, so only the count is broken.
    const spacedTiles = rectTiles({ ...room.bounds, h: 1 }).filter(
      (_, index) => index % (REMAINS_SPACING_TILES + 1) === 0,
    );
    for (const tile of spacedTiles.slice(0, MAX_REMAINS_PER_ROOM + 1)) {
      const cell = tileAt(data.grid, tile.x, tile.y);
      if (cell !== null) placeProp(cell, BONES);
    }
    return data;
  });
  expectRed('remains-spacing', (data) => {
    const room = firstPopulated(data);
    if (room === undefined) return null;
    for (const tile of rectTiles({ ...room.bounds, h: 1 }).slice(0, 2)) {
      const cell = tileAt(data.grid, tile.x, tile.y);
      if (cell !== null) placeProp(cell, BONES);
    }
    return data;
  });
  expectRed('start-dark', (data) => {
    const room = data.regionMap.rooms.find((candidate) => candidate.role === 'start');
    if (room === undefined) return null;
    // Lifts the start room's lights back off, as a generator that forgot them would leave it.
    for (const tile of rectTiles(room.bounds)) {
      const cell = tileAt(data.grid, tile.x, tile.y);
      if (cell?.type === TORCH && cell.groundType !== undefined) {
        cell.type = cell.groundType;
        cell.groundType = undefined;
      }
    }
    return data;
  });
  expectRed(
    'spawn-covered',
    (data) => {
      plant(data, { x: data.startTile.x + CLEARANCE_TILES, y: data.startTile.y });
      return data;
    },
    'arrival-tile clearance',
  );
  expectRed('walled-in', (data) => {
    for (let y = 0; y < data.grid.length; y++) {
      for (let x = 0; x < data.grid[y].length; x++) {
        const cell = data.grid[y][x];
        if (!isBlockingDressing(cell) || PROP_PART_TILE_TYPES.has(cell.type)) continue;
        for (const step of ORTHOGONAL) {
          const neighbour = tileAt(data.grid, x + step.x, y + step.y);
          if (neighbour !== null && isWalkableTileType(neighbour)) {
            plant(data, { x: x + step.x, y: y + step.y });
          }
        }
        return data;
      }
    }
    return null;
  });
  expectRed('character', (data) => {
    const room = firstPopulated(data);
    if (room === undefined) return null;
    // Stands in for a generator that forgot to dress a room.
    const rooms = data.regionCharacters
      .roomAssignments()
      .map((assignment, index) => (index === room.id ? null : assignment));
    return {
      ...data,
      regionCharacters: new RegionCharacters(
        data.regionMap,
        rooms,
        data.regionCharacters.hallwayAssignments(),
      ),
    };
  });
  return missed;
}

// ── Sweep ───────────────────────────────────────────────────────────────────

let failures = 0;

function sweepFloor(name: string, levelDef: LevelDef, floorIndex: number, seeds: number): void {
  const totals: SweepTotals = {
    maps: 0,
    populatedRooms: 0,
    roomsWithoutBlockingProps: 0,
    unlitRooms: 0,
    blockingTiles: 0,
    walkableTiles: 0,
    hallwayBlockingTiles: 0,
    worstCoverage: 0,
    attempts: 0,
    characters: new Map(),
    gasCylinders: 0,
  };
  for (let run = 0; run < seeds; run++) {
    const worldSeed = floorIndex * SEED_STRIDE_PER_FLOOR + run + 1;
    let dressed: DungeonData;
    try {
      dressed = generate(levelDef, worldSeed);
    } catch (error) {
      // Every attempt rejected: the bare build of the same seed is accepted
      // (checked below on seeds that do build), so the props are what failed.
      failures++;
      console.log(
        `  FAIL [${name} seed ${worldSeed}] rejection: ${String(error)}`.slice(0, MAX_ERROR_CHARS),
      );
      continue;
    }
    const violations = checkMap(dressed, levelDef, totals);
    // The generator retries a layout that fails validation, so a prop that
    // broke progression would show up only as a quiet re-roll. The same seed
    // built without props must be accepted on the same attempt with the same
    // floor under the props.
    const undressed = generate(levelDef, worldSeed, false);
    const dressedAttempts = dressed.progressionLayout?.attempts;
    const undressedAttempts = undressed.progressionLayout?.attempts;
    if (dressedAttempts !== undressedAttempts) {
      violations.push({
        rule: 'rejection',
        message: `accepted on attempt ${dressedAttempts} with props, ${undressedAttempts} without`,
      });
    } else if (!sameTileTypes(bareGrid(dressed.grid), undressed.grid)) {
      violations.push({
        rule: 'rejection',
        message: 'the floor under the props differs from the bare build',
      });
    }
    if (dressedAttempts !== undefined) totals.attempts += dressedAttempts;
    for (const violation of violations) {
      failures++;
      if (failures <= MAX_PRINTED_FAILURES) {
        console.log(`  FAIL [${name} seed ${worldSeed}] ${violation.rule}: ${violation.message}`);
      }
    }
  }
  const characters = [...totals.characters]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `${id} ${count}`)
    .join(', ');
  console.log(
    `${name}: ${totals.maps} maps, ${totals.populatedRooms} dressed rooms ` +
      `(${totals.roomsWithoutBlockingProps} with no blocking prop) ` +
      `(${totals.unlitRooms} unlit), ${totals.blockingTiles} blocking + ` +
      `${totals.walkableTiles} walkable prop tiles in rooms, ${totals.hallwayBlockingTiles} ` +
      `blocking in nooks, worst room coverage ${(totals.worstCoverage * PERCENT).toFixed(1)}%, ` +
      `${totals.attempts} generation attempts (same with and without props)`,
  );
  console.log(`  characters: ${characters}`);
  console.log(`  gas bottles placed: ${totals.gasCylinders}`);
  // A sweep that dressed nothing would pass every check above vacuously.
  if (totals.blockingTiles === 0 || totals.populatedRooms === 0) {
    failures++;
    console.log(`  FAIL [${name}] the sweep placed no props at all`);
  }
}

console.log('negative tests (each rule broken on purpose; every one must be caught):');
const missed = runNegativeTests();
failures += missed;

const seeds = seedsPerFloor();
sweepFloor('floor 1', level1, 1, seeds);
sweepFloor('floor 2', level2, 2, seeds);

console.log(failures === 0 ? '\nall placement checks passed' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
