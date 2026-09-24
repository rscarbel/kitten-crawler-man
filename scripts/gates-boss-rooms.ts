#!/usr/bin/env tsx
/**
 * Gates for the five boss rooms, run on real generated floors.
 *
 *   npm run gates:boss-rooms                      # 20 seeds per floor from seed 1
 *   npm run gates:boss-rooms -- --seeds=40 --seed=100
 *   npm run gates:boss-rooms -- --room=spider
 *   npm run gates:boss-rooms -- --fault=block-approach   # must fail
 *
 * Checked, in order:
 *
 * 1. **Tile contract.** Every boss-room tile type walks, blocks sight and sits in
 *    the decoration registries the way its row below says. A prop missing from
 *    either registry renders as bare floor and passes a typecheck and a lint, so
 *    this renders each one: a prop must be absent from the chunk bake and drawn
 *    by the overlay pass, a flat decal the other way round. A prop's art must
 *    also stay over the tile it blocks — ink hanging past its sides reads as
 *    ground a crawler could stand on.
 * 2. **Sheets.** Each room's painted sheets agree with the manifest, paint
 *    inside their cells, and fit the room's memory budget.
 * 3. **Removed images.** No source file names an image key the rooms dropped.
 * 4. **Floors.** For every seed, each room on the floor keeps a clear approach
 *    from every doorway, a clear disc around the boss's spawn, every open tile
 *    reachable from the doorway, and its minimum share of open floor. Every
 *    doorway side the room can have is covered, by a seed search if the sweep
 *    did not meet it. Each state is rendered: no placeholder magenta may show,
 *    and the heaviest state must fit the per-frame draw budget. Then the room's
 *    own gates run.
 *
 * Fault flags break one guarded thing on purpose, so each gate can be seen to
 * fail: `--fault=block-approach`, `--fault=placeholder`, `--fault=removed-key`, `--fault=draw-budget`,
 * `--fault=sheet-budget`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import {
  ARENA_MUD,
  BOSS_ROOM_FLAT_TILE_TYPES,
  BOSS_ROOM_PROP_TILE_TYPES,
  FloorTypeValue,
  GYM_CABLE_STACK,
  GYM_RACK,
  GYM_SQUAT_RACK,
  GYM_TREADMILL_BELT,
  HOARD_BAG,
  HOARD_PILE,
  HOARD_RUBBLE,
  HOARD_TOWER,
  KRAKAREN_CONSOLE,
  KRAKAREN_TANK,
  KRAKAREN_WADE,
  LAB_BENCH,
  LAB_SHELF,
  LAB_WEB,
  placeProp,
  type TileContent,
} from '../src/map/tileTypes.js';
import { isWalkableTileType } from '../src/map/walkability.js';
import { bossRoomSheetPlans } from '../src/sprites/sheets/bossRoomSheets.js';
import { propSheetPlanMismatches, propSheetSize } from '../src/sprites/sheets/propSheetPlan.js';
import type { TilePoint } from '../src/systems/bossRooms/bossRoomLayout.js';
import {
  buildEnvironment,
  defaultInvariantTiles,
  findFloorWithRoom,
  firstOf,
  generateFloor,
  isBossRoomId,
  magentaPixelCount,
  renderRoom,
  withPlaceholderGround,
  type BossFloor,
  type BossRoomHarness,
  type FoundRoom,
  type GateReport,
} from './bossRooms/harness.js';
import { BOSS_ROOM_HARNESSES } from './bossRooms/rooms.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { bakePropSheet, clippedFrames } from './propSheetBake.js';

// ── Flags ────────────────────────────────────────────────────────────────────

const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name, '');
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

/** Floors swept per level unless `--seeds` says otherwise. */
const DEFAULT_SEEDS_PER_FLOOR = 20;
const DEFAULT_FIRST_SEED = 1;

const FAULTS = [
  'block-approach',
  'placeholder',
  'removed-key',
  'draw-budget',
  'sheet-budget',
] as const;
type Fault = (typeof FAULTS)[number];
const faultArg = stringArg('fault', '');
const fault: Fault | undefined = FAULTS.find((name) => name === faultArg);
if (faultArg !== '' && fault === undefined) {
  throw new Error(`--fault must be one of ${FAULTS.join(', ')}`);
}

const roomArg = stringArg('room', 'all');
if (roomArg !== 'all' && !isBossRoomId(roomArg)) throw new Error(`unknown --room ${roomArg}`);
const seedsPerFloor = intArg('seeds', DEFAULT_SEEDS_PER_FLOOR);
const firstSeed = intArg('seed', DEFAULT_FIRST_SEED);

// ── Budgets ──────────────────────────────────────────────────────────────────

/**
 * `drawImage` calls a room's dressing may make in one frame of its heaviest
 * state — its own layers plus its Y-sorted props, bodies not counted. The game
 * renders on the CPU, and a room that paints itself per frame rather than
 * blitting baked art spends the frame budget the fight needs.
 */
const MAX_DRESSING_DRAW_IMAGES = 120;

/** Bytes of painted sheet a room's dressing may hold resident. */
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MAX_ROOM_SHEET_MEGABYTES = 6;
const BYTES_PER_PIXEL = 4;

/**
 * Pixels of prop ink allowed past either side of the tile it blocks: enough for
 * an antialiased outline, not enough to read as a surface.
 */
const PROP_SIDE_OVERHANG_TOLERANCE_PX = 2;
/** Alpha above which an overhanging pixel counts as ink rather than a soft shadow. */
const PROP_INK_ALPHA_MIN = 128;

/**
 * Image keys deleted from the boss rooms. A source file still naming one is a
 * draw site that will fall back to nothing, or a manifest entry nothing loads.
 */
const REMOVED_IMAGE_KEYS: readonly string[] = [
  'hoarders_room',
  'spider_room_floor',
  'lab_tables',
  'scientist',
  'spider-egg',
];

/** A key the rooms still load, so the `removed-key` fault has a live name to find. */
const LIVE_IMAGE_KEY = 'hoarder_floor';

// ── Reporting ────────────────────────────────────────────────────────────────

const failures: string[] = [];
const notes: string[] = [];
let checksRun = 0;

function reportFor(scope: string): GateReport {
  return {
    fail: (message) => failures.push(`${scope}: ${message}`),
    note: (message) => notes.push(`${scope}: ${message}`),
  };
}

function check(condition: boolean, scope: string, message: string): void {
  checksRun++;
  if (!condition) failures.push(`${scope}: ${message}`);
}

await loadGameSpritesInNode(FLOOR_ART_SEEDS[0]);

// ── 1. Tile contract ─────────────────────────────────────────────────────────

/** How each boss-room tile type must behave, per the room it dresses. */
interface TileContract {
  readonly name: string;
  readonly walkable: boolean;
  readonly blocksSight: boolean;
  /** Drawn in the Y-sorted overlay pass rather than baked flat into the chunk. */
  readonly ySorted: boolean;
}

const TILE_CONTRACTS: ReadonlyMap<number, TileContract> = new Map([
  [HOARD_PILE, { name: 'HOARD_PILE', walkable: false, blocksSight: true, ySorted: true }],
  [HOARD_TOWER, { name: 'HOARD_TOWER', walkable: false, blocksSight: true, ySorted: true }],
  [HOARD_BAG, { name: 'HOARD_BAG', walkable: false, blocksSight: false, ySorted: true }],
  [HOARD_RUBBLE, { name: 'HOARD_RUBBLE', walkable: true, blocksSight: false, ySorted: false }],
  [GYM_RACK, { name: 'GYM_RACK', walkable: false, blocksSight: false, ySorted: true }],
  [GYM_SQUAT_RACK, { name: 'GYM_SQUAT_RACK', walkable: false, blocksSight: true, ySorted: true }],
  [GYM_CABLE_STACK, { name: 'GYM_CABLE_STACK', walkable: false, blocksSight: true, ySorted: true }],
  [
    GYM_TREADMILL_BELT,
    { name: 'GYM_TREADMILL_BELT', walkable: true, blocksSight: false, ySorted: false },
  ],
  [KRAKAREN_WADE, { name: 'KRAKAREN_WADE', walkable: true, blocksSight: false, ySorted: false }],
  [KRAKAREN_TANK, { name: 'KRAKAREN_TANK', walkable: false, blocksSight: true, ySorted: true }],
  [
    KRAKAREN_CONSOLE,
    { name: 'KRAKAREN_CONSOLE', walkable: false, blocksSight: false, ySorted: true },
  ],
  [LAB_BENCH, { name: 'LAB_BENCH', walkable: false, blocksSight: false, ySorted: true }],
  [LAB_SHELF, { name: 'LAB_SHELF', walkable: false, blocksSight: true, ySorted: true }],
  [LAB_WEB, { name: 'LAB_WEB', walkable: true, blocksSight: false, ySorted: false }],
  [ARENA_MUD, { name: 'ARENA_MUD', walkable: true, blocksSight: false, ySorted: false }],
]);

/** Side of the square test map a single tile is judged on. */
const TEST_MAP_TILES = 5;
const TEST_TILE = Math.floor(TEST_MAP_TILES / 2);
const TEST_MAP_PX = TEST_MAP_TILES * TILE_SIZE;

function testMap(centreType: number | undefined): GameMap {
  const grid: TileContent[][] = [];
  for (let y = 0; y < TEST_MAP_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < TEST_MAP_TILES; x++) {
      row.push({ tileId: `${x},${y}`, type: FloorTypeValue.concrete });
    }
    grid.push(row);
  }
  if (centreType !== undefined) placeProp(grid[TEST_TILE][TEST_TILE], centreType);
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

const ALPHA_OFFSET = 3;
const CHANNELS = 4;

/** RGBA of the centre tile, and whether any ink overhangs its sides, for one pass. */
function renderTestTile(
  gameMap: GameMap,
  passes: { base: boolean; overlay: boolean },
): { tilePixels: Uint8ClampedArray; sideOverhangPx: number } {
  const canvas = createCanvas(TEST_MAP_PX, TEST_MAP_PX);
  const nodeCtx = canvas.getContext('2d');
  const ctx = asGameContext(nodeCtx);
  if (passes.base) gameMap.renderCanvas(ctx, 0, 0, TEST_MAP_PX, TEST_MAP_PX);
  if (passes.overlay) gameMap.renderDecorationsOverlay(ctx, 0, 0, TEST_MAP_PX, TEST_MAP_PX);
  const tileOrigin = TEST_TILE * TILE_SIZE;
  const tilePixels = nodeCtx.getImageData(tileOrigin, tileOrigin, TILE_SIZE, TILE_SIZE).data;

  const whole = nodeCtx.getImageData(0, 0, TEST_MAP_PX, TEST_MAP_PX).data;
  const leftLimit = tileOrigin - PROP_SIDE_OVERHANG_TOLERANCE_PX;
  const rightLimit = tileOrigin + TILE_SIZE + PROP_SIDE_OVERHANG_TOLERANCE_PX;
  let sideOverhangPx = 0;
  for (let y = 0; y < TEST_MAP_PX; y++) {
    for (let x = 0; x < TEST_MAP_PX; x++) {
      if (x >= leftLimit && x < rightLimit) continue;
      if (whole[(y * TEST_MAP_PX + x) * CHANNELS + ALPHA_OFFSET] >= PROP_INK_ALPHA_MIN) {
        sideOverhangPx++;
      }
    }
  }
  return { tilePixels, sideOverhangPx };
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const plainFloorBase = renderTestTile(testMap(undefined), { base: true, overlay: false });
const everyBossRoomTileType = [...BOSS_ROOM_PROP_TILE_TYPES, ...BOSS_ROOM_FLAT_TILE_TYPES];
check(
  everyBossRoomTileType.length === TILE_CONTRACTS.size &&
    everyBossRoomTileType.every((type) => TILE_CONTRACTS.has(type)),
  'tile contract',
  'the tile types in BOSS_ROOM_PROP_TILE_TYPES / BOSS_ROOM_FLAT_TILE_TYPES and the contract ' +
    'table here disagree — every boss-room tile needs a row',
);

for (const [type, contract] of TILE_CONTRACTS) {
  const scope = `tile ${contract.name}`;
  check(
    BOSS_ROOM_PROP_TILE_TYPES.has(type) === contract.ySorted &&
      BOSS_ROOM_FLAT_TILE_TYPES.has(type) === !contract.ySorted,
    scope,
    `listed in the wrong boss-room tile set for a ${contract.ySorted ? 'prop' : 'decal'}`,
  );
  const gameMap = testMap(type);
  const tile = gameMap.structure[TEST_TILE][TEST_TILE];
  check(
    isWalkableTileType(tile) === contract.walkable,
    scope,
    `walkable is ${!contract.walkable}, should be ${contract.walkable}`,
  );
  // Sight is judged across the tile, from the floor on one side to the other.
  const sightY = (TEST_TILE + 1 / 2) * TILE_SIZE;
  const sightClear = gameMap.hasLineOfSight(
    TILE_SIZE / 2,
    sightY,
    TEST_MAP_PX - TILE_SIZE / 2,
    sightY,
  );
  check(
    sightClear === !contract.blocksSight,
    scope,
    contract.blocksSight
      ? 'does not block sight, but it is tall enough to hide behind'
      : 'blocks sight, but it is low enough to see over — it would be free cover',
  );

  const base = renderTestTile(gameMap, { base: true, overlay: false });
  const full = renderTestTile(gameMap, { base: true, overlay: true });
  const overlayOnly = renderTestTile(gameMap, { base: false, overlay: true });
  const inDecorationIndex = gameMap
    .getVisibleDecorationTiles(0, 0, TEST_MAP_PX, TEST_MAP_PX)
    .some((entry) => entry.tx === TEST_TILE && entry.ty === TEST_TILE);
  if (contract.ySorted) {
    check(
      samePixels(base.tilePixels, plainFloorBase.tilePixels),
      scope,
      'the chunk bake draws something other than the plain floor under it — missing from ' +
        'DECORATION_TYPES (TileRenderer) or from the baseOnly cases (decorationTiles)',
    );
    check(
      !samePixels(full.tilePixels, base.tilePixels),
      scope,
      'the overlay pass draws nothing — it would render as bare floor',
    );
    check(
      inDecorationIndex,
      scope,
      'missing from DECORATION_OVERLAY_TYPES (GameMap), so the Y-sorted pass never draws it',
    );
    check(
      overlayOnly.sideOverhangPx === 0,
      scope,
      `${overlayOnly.sideOverhangPx} px of its art hang past the sides of the tile it blocks`,
    );
  } else {
    check(
      !samePixels(base.tilePixels, plainFloorBase.tilePixels),
      scope,
      'the chunk bake draws it as bare floor — it has no painter',
    );
    check(
      samePixels(full.tilePixels, base.tilePixels) && !inDecorationIndex,
      scope,
      'a flat decal is also drawn by the Y-sorted overlay pass',
    );
  }
}

// ── 2. Sheets ────────────────────────────────────────────────────────────────

const harnesses = BOSS_ROOM_HARNESSES.filter((h) => roomArg === 'all' || h.id === roomArg);
const maxSheetBytes = fault === 'sheet-budget' ? -1 : MAX_ROOM_SHEET_MEGABYTES * BYTES_PER_MEGABYTE;

for (const harness of harnesses) {
  const scope = `${harness.id} sheets`;
  const plans = bossRoomSheetPlans(harness.assetGroup, 0);
  let bytes = 0;
  for (const plan of plans) {
    for (const mismatch of propSheetPlanMismatches(plan)) check(false, scope, mismatch);
    for (const clipped of clippedFrames(
      plan,
      bakePropSheet(plan).pixels,
      harness.sheetGroundedEdges,
    )) {
      check(false, scope, clipped);
    }
    const { widthPx, heightPx } = propSheetSize(plan);
    bytes += widthPx * heightPx * BYTES_PER_PIXEL;
  }
  check(
    bytes <= maxSheetBytes,
    scope,
    `${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB of sheets, over the ` +
      `${MAX_ROOM_SHEET_MEGABYTES} MB a room may hold`,
  );
  notes.push(`${scope}: ${plans.length} sheet(s), ${(bytes / BYTES_PER_MEGABYTE).toFixed(2)} MB`);
}

// ── 3. Removed images ────────────────────────────────────────────────────────

const removedKeys =
  fault === 'removed-key' ? [...REMOVED_IMAGE_KEYS, LIVE_IMAGE_KEY] : REMOVED_IMAGE_KEYS;
const SOURCE_EXTENSIONS = ['.ts', '.json'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : [];
  });
}

if (removedKeys.length > 0) {
  const files = sourceFiles('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  for (const key of removedKeys) {
    const quoted = [`'${key}'`, `"${key}"`];
    const namedIn = files.filter((file) => quoted.some((q) => file.text.includes(q)));
    check(
      namedIn.length === 0,
      `removed image ${key}`,
      `still named in ${namedIn.map((file) => file.path).join(', ')}`,
    );
  }
}

// ── 4. Floors ────────────────────────────────────────────────────────────────

const maxDrawImages = fault === 'draw-budget' ? 0 : MAX_DRESSING_DRAW_IMAGES;
/** Layout violations a room's pending exemption excused, per room. */
const pendingViolations = new Map<string, number>();

/** The most `drawImage` calls each room's heaviest state made on any floor. */
const worstDrawImages = new Map<string, number>();

const PERCENT = 100;

const tileKey = (tile: TilePoint): string => `${tile.x},${tile.y}`;

/** Runs every per-floor gate for one room on one generated floor. */
function gateRoomOnFloor(harness: BossRoomHarness, found: FoundRoom): void {
  const scope = `${harness.id} seed ${found.seed} (door ${found.room.doorSide})`;
  const report = reportFor(scope);
  const env = buildEnvironment(found);
  const { gameMap, room } = env;
  const builtRoom = harness.build(env);
  const roomUnderTest =
    fault === 'placeholder' ? withPlaceholderGround(builtRoom, room.spawn) : builtRoom;

  const layoutCheck = (condition: boolean, where: string, message: string): void => {
    const pending = harness.layoutInvariantsPending;
    if (pending === undefined || condition) {
      check(condition, where, message);
      return;
    }
    pendingViolations.set(harness.id, (pendingViolations.get(harness.id) ?? 0) + 1);
  };

  const invariants = harness.invariantTiles?.(room) ?? defaultInvariantTiles(room);
  if (fault === 'block-approach') {
    const first = firstOf(invariants.approach);
    if (first !== undefined) gameMap.blockTilePermanently(first.x, first.y);
  }

  const blockedApproach = invariants.approach.filter((t) => !gameMap.isWalkable(t.x, t.y));
  layoutCheck(
    blockedApproach.length === 0,
    scope,
    `doorway approach blocked at ${blockedApproach.map(tileKey).join(' ')}`,
  );
  const blockedSpawn = invariants.spawnDisc.filter((t) => !gameMap.isWalkable(t.x, t.y));
  layoutCheck(
    blockedSpawn.length === 0,
    scope,
    `boss spawn disc blocked at ${blockedSpawn.map(tileKey).join(' ')}`,
  );

  const interiorKeys = new Set(room.interior.map(tileKey));
  const open = room.interior.filter((t) => gameMap.isWalkable(t.x, t.y));
  const openShare = open.length / room.interior.length;
  layoutCheck(
    openShare >= harness.minOpenFloorShare,
    scope,
    `only ${(openShare * PERCENT).toFixed(1)}% of the room is open floor ` +
      `(minimum ${(harness.minOpenFloorShare * PERCENT).toFixed(0)}%)`,
  );

  const reached = new Set<string>();
  const frontier: TilePoint[] = [];
  for (const doorway of room.doorways) {
    for (const tile of doorway.tiles) {
      if (!gameMap.isWalkable(tile.x, tile.y) || reached.has(tileKey(tile))) continue;
      reached.add(tileKey(tile));
      frontier.push(tile);
    }
  }
  const CARDINALS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ] as const;
  for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
    for (const { dx, dy } of CARDINALS) {
      const neighbour = { x: next.x + dx, y: next.y + dy };
      const key = tileKey(neighbour);
      if (reached.has(key) || !interiorKeys.has(key)) continue;
      if (!gameMap.isWalkable(neighbour.x, neighbour.y)) continue;
      reached.add(key);
      frontier.push(neighbour);
    }
  }
  const unreachable = open.filter((t) => !reached.has(tileKey(t)));
  layoutCheck(
    unreachable.length === 0,
    scope,
    `${unreachable.length} open tile(s) cannot be reached from the doorway, ` +
      `first ${unreachable.slice(0, 1).map(tileKey).join('')}`,
  );

  // States are driven in fight order on the one room, as a fight would.
  for (const state of harness.states) {
    if (!roomUnderTest.driveToState(state)) {
      report.fail(`lists a '${state}' state it cannot be driven into`);
      continue;
    }
    roomUnderTest.update();
    const rendered = renderRoom(env, roomUnderTest, 1);
    const magenta = magentaPixelCount(rendered.canvas);
    check(magenta === 0, `${scope} ${state}`, `${magenta} px of placeholder magenta on screen`);
    if (state === harness.heaviestState) {
      const drawImages = rendered.dressingDrawCalls.drawImage;
      worstDrawImages.set(harness.id, Math.max(worstDrawImages.get(harness.id) ?? 0, drawImages));
      check(
        drawImages <= maxDrawImages,
        `${scope} ${state}`,
        `dressing makes ${drawImages} drawImage calls a frame (budget ${maxDrawImages})`,
      );
    }
  }

  harness.gates?.({ env, roomUnderTest, seed: found.seed, report });
}

const FLOORS: readonly BossFloor[] = [1, 2];
for (const floor of FLOORS) {
  const onFloor = harnesses.filter((h) => h.floor === floor);
  if (onFloor.length === 0) continue;
  const sidesSeen = new Map(onFloor.map((h) => [h.id, new Set<string>()]));
  for (let seed = firstSeed; seed < firstSeed + seedsPerFloor; seed++) {
    for (const harness of onFloor) {
      // Each room gets its own copy of the floor, so one room's stamped props
      // cannot change what another room's gates see.
      const { gameMap, levelDef } = generateFloor(floor, seed);
      const room = harness.locate(gameMap, levelDef);
      check(room !== null, `${harness.id} seed ${seed}`, 'the room is missing from the floor');
      if (room === null) continue;
      sidesSeen.get(harness.id)?.add(room.doorSide);
      gateRoomOnFloor(harness, { seed, gameMap, levelDef, room });
    }
  }
  for (const harness of onFloor) {
    const seen = sidesSeen.get(harness.id) ?? new Set<string>();
    for (const side of harness.doorSides) {
      if (seen.has(side)) continue;
      const found = findFloorWithRoom(harness, firstSeed + seedsPerFloor, side);
      check(
        found !== null,
        `${harness.id} door ${side}`,
        'no generated floor gives the room this doorway side, but the room lists it',
      );
      if (found !== null) gateRoomOnFloor(harness, found);
      seen.add(side);
    }
    notes.push(`${harness.id}: doorway sides covered ${[...seen].sort().join(', ')}`);
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────

for (const harness of harnesses) {
  const pending = harness.layoutInvariantsPending;
  if (pending === undefined) continue;
  const excused = pendingViolations.get(harness.id) ?? 0;
  check(
    excused > 0,
    `${harness.id} layout`,
    'breaks no layout invariant any more — remove its layoutInvariantsPending exemption',
  );
  notes.push(`${harness.id}: PENDING layout — ${excused} violation(s) excused: ${pending}`);
}
for (const [id, drawImages] of worstDrawImages) {
  notes.push(
    `${id}: heaviest-state dressing drawImage calls ${drawImages} (budget ${maxDrawImages})`,
  );
}

for (const note of notes) console.log(`  ${note}`);
check(checksRun > 0, 'gates', 'no checks ran — the gate cannot find what it guards');
if (failures.length > 0) {
  console.log(`\nFAIL: ${failures.length} problem(s) in ${checksRun} checks`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}
if (fault !== undefined) {
  console.log(`\nFAIL: --fault=${fault} broke what it guards and the gates still passed`);
  process.exit(1);
}
console.log(`\nPASS: ${checksRun} checks`);
