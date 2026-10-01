#!/usr/bin/env tsx
/**
 * Headless gate for the cellars' furniture.
 *
 * On a hand-built flat floor, every breakable cellar piece is struck until it
 * breaks: it must break within its own health in single-damage blows, leave
 * its whole footprint walkable floor, and leave wreckage behind. A two-tile
 * piece struck only on its part tile must break whole. The sarcophagus must
 * survive any number of blows.
 *
 * On generated floor-1 maps, every candle cluster, guardroom table and fungus
 * must carry a light, the table's part tile must carry none, a room rolled as
 * unlit must hold none of them, and smashing one must put its light out.
 *
 * Run: npm run verify:cellar-props
 */

import { TILE_SIZE } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { getLevelDef } from '../src/levels';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { setDungeonFloorTheme } from '../src/map/dungeon/floorTheme';
import { CELLAR_LIGHT_CARRYING_TILE_TYPES, CELLAR_TILE_TYPES } from '../src/map/cellarProps';
import { GameMap } from '../src/map/GameMap';
import { multiTilePieceTypes } from '../src/map/serviceLevelProps';
import {
  CANDLE_CLUSTER,
  CELLAR_TABLE,
  FloorTypeValue,
  GLOW_FUNGUS,
  PROP_PART_LOW,
  SARCOPHAGUS,
  placeProp,
  type TileContent,
} from '../src/map/tileTypes';
import { isWalkableTileType } from '../src/map/walkability';
import {
  CELLAR_PROP_KINDS,
  CELLAR_PROP_KIND_LIST,
} from '../src/systems/destruction/cellarPropKinds';
import { DestructiblePropSystem } from '../src/systems/DestructiblePropSystem';
import { DungeonLightingSystem } from '../src/systems/DungeonLightingSystem';
import { LootSystem } from '../src/systems/LootSystem';
import { installCanvasGlobals } from './nodeCanvasGlobals';

installCanvasGlobals();

const GRID_SIZE = 40;
const FLOOR_NUMBER = 1;
const PROP_TILE = 20;
/** The crawler stands two tiles south of the piece, out of its footprint. */
const CRAWLER_TILES_SOUTH = 2;
/** Reaches the piece's anchor from the crawler's stance. */
const AREA_RADIUS_TILES = 2.2;
/** From one tile east of the crawler's usual stance, reaches the part tile but not the anchor. */
const PART_ONLY_STANCE_EAST = 2;
const PART_ONLY_RADIUS_TILES = 2.5;
/** Blows the sarcophagus has to shrug off. */
const SARCOPHAGUS_BLOWS = 40;
/** The floor-1 layouts the light checks run on: the same seeds the lighting gate uses, and one more. */
const FLOOR_SEED_A = 3;
const FLOOR_SEED_B = 7;
const FLOOR_SEED_C = 11;
const FLOOR_SEED_D = 19;
const FLOOR_SEEDS = [FLOOR_SEED_A, FLOOR_SEED_B, FLOOR_SEED_C, FLOOR_SEED_D] as const;
const TILE_CENTRE = 0.5;
/** The blast lands on the tile below the piece and reaches just past it. */
const BLAST_BELOW_TILES = 1;
const BLAST_RADIUS_TILES = 1.2;

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function flatFloor(): TileContent[][] {
  return Array.from({ length: GRID_SIZE }, (_, y) =>
    Array.from({ length: GRID_SIZE }, (_, x) => ({
      tileId: `${x}#${y}`,
      type: FloorTypeValue.tile_floor,
    })),
  );
}

interface Bench {
  readonly gameMap: GameMap;
  readonly props: DestructiblePropSystem;
  readonly footprint: ReadonlyArray<{ x: number; y: number }>;
}

/** A flat floor with one piece of `tileType` anchored at the test tile. */
function benchWith(tileType: number, tilesWide: number): Bench {
  const gameMap = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: flatFloor() });
  const footprint = Array.from({ length: tilesWide }, (_, dx) => ({
    x: PROP_TILE + dx,
    y: PROP_TILE,
  }));
  const types = multiTilePieceTypes(tileType, footprint);
  footprint.forEach((cell, index) => {
    placeProp(gameMap.structure[cell.y][cell.x], types[index] ?? tileType);
  });
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), FLOOR_NUMBER);
  return { gameMap, props, footprint };
}

function standing(bench: Bench): boolean {
  return bench.footprint.some(
    (cell) => !isWalkableTileType(bench.gameMap.structure[cell.y][cell.x]),
  );
}

function checkBreaks(kind: (typeof CELLAR_PROP_KIND_LIST)[number]): void {
  const def = CELLAR_PROP_KINDS[kind];
  const tilesWide = multiTilePieceTypes(def.tileType, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]).includes(PROP_PART_LOW)
    ? 2
    : 1;
  const bench = benchWith(def.tileType, tilesWide);
  const crawler = new HumanPlayer(PROP_TILE, PROP_TILE + CRAWLER_TILES_SOUTH, TILE_SIZE);
  const wasSolid = standing(bench) || CELLAR_LIGHT_CARRYING_TILE_TYPES.has(def.tileType);
  let blows = 0;
  while (bench.gameMap.structure[PROP_TILE][PROP_TILE].type === def.tileType && blows < def.hp) {
    bench.props.tryAreaHit(crawler, AREA_RADIUS_TILES * TILE_SIZE, 1);
    blows++;
  }
  if (bench.gameMap.structure[PROP_TILE][PROP_TILE].type === def.tileType) {
    fail(`${kind}: still standing after ${blows} blows against ${def.hp} health`);
    return;
  }
  if (!wasSolid && def.hp > 1) fail(`${kind}: was never placed as a solid piece`);
  if (standing(bench)) fail(`${kind}: part of its footprint is still solid after it broke`);
  const wreckage = bench.props.captureCheckpoint().wreckage;
  if (!wreckage.some((decal) => decal.kind === kind)) fail(`${kind}: broke without wreckage`);
  console.log(`PASS: ${kind} broke in ${blows} blow(s) (${tilesWide} tile(s)) and left wreckage`);

  if (tilesWide === 1) return;
  const partBench = benchWith(def.tileType, tilesWide);
  const offside = new HumanPlayer(
    PROP_TILE + PART_ONLY_STANCE_EAST,
    PROP_TILE + CRAWLER_TILES_SOUTH,
    TILE_SIZE,
  );
  for (let blow = 0; blow < def.hp && standing(partBench); blow++) {
    partBench.props.tryAreaHit(offside, PART_ONLY_RADIUS_TILES * TILE_SIZE, 1);
  }
  if (standing(partBench)) fail(`${kind}: striking only its part tile never broke it`);
  else console.log(`PASS: ${kind} broke whole when struck only on its part tile`);
}

function checkSarcophagusStands(): void {
  const bench = benchWith(SARCOPHAGUS, 2);
  const crawler = new HumanPlayer(PROP_TILE, PROP_TILE + CRAWLER_TILES_SOUTH, TILE_SIZE);
  for (let blow = 0; blow < SARCOPHAGUS_BLOWS; blow++) {
    bench.props.tryAreaHit(crawler, AREA_RADIUS_TILES * TILE_SIZE, 1);
  }
  bench.props.destroyInRadius(
    (PROP_TILE + 1) * TILE_SIZE,
    (PROP_TILE + 1) * TILE_SIZE,
    AREA_RADIUS_TILES * TILE_SIZE,
    crawler,
  );
  if (!standing(bench)) fail('sarcophagus: broke, but it is not breakable');
  else console.log(`PASS: the sarcophagus stood through ${SARCOPHAGUS_BLOWS} blows and a blast`);
}

// ── Generated floors ──────────────────────────────────────────────────────────

function buildFloor(seed: number): GameMap {
  const levelDef = getLevelDef('level1');
  setDungeonFloorTheme(levelDef.groundTheme ?? 'cellars');
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: seed,
  });
}

const LIGHT_CHECK_TYPES = [CANDLE_CLUSTER, CELLAR_TABLE, GLOW_FUNGUS] as const;

function checkFloor(seed: number, counts: Map<number, number>): void {
  const gameMap = buildFloor(seed);
  const lighting = new DungeonLightingSystem({
    gameMap,
    now: () => 0,
    additiveGlows: () => true,
  });
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), FLOOR_NUMBER);
  const smashed = new Set<number>();
  gameMap.structure.forEach((row, y) =>
    row.forEach((tile, x) => {
      const type = tile.type;
      if (CELLAR_TILE_TYPES.has(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
      if (type === PROP_PART_LOW && lighting.hasStaticLightAt(x, y)) {
        fail(`seed ${seed}: a two-tile piece's part tile at ${x},${y} carries a light`);
      }
      if (!CELLAR_LIGHT_CARRYING_TILE_TYPES.has(type)) return;
      const region = gameMap.regionAt(x, y);
      if (gameMap.regionCharacters.isUnlit(region)) {
        fail(`seed ${seed}: an unlit room holds a light-carrying piece at ${x},${y}`);
      }
      if (!lighting.isLightOnAt(x, y)) fail(`seed ${seed}: the piece at ${x},${y} is not lit`);
      // One of each kind per floor is smashed to prove its light goes out with it.
      if (smashed.has(type) || !LIGHT_CHECK_TYPES.some((kind) => kind === type)) return;
      smashed.add(type);
      const crawler = new HumanPlayer(x, y + 1, TILE_SIZE);
      // From the tile below, not the piece's own centre: a blast exactly on a
      // tile's centre is no distance from it, and is skipped as no hit at all.
      const blastX = (x + TILE_CENTRE) * TILE_SIZE;
      const blastY = (y + BLAST_BELOW_TILES + TILE_CENTRE) * TILE_SIZE;
      props.destroyInRadius(blastX, blastY, BLAST_RADIUS_TILES * TILE_SIZE, crawler);
      lighting.update();
      if (gameMap.structure[y][x].type === type)
        fail(`seed ${seed}: the piece at ${x},${y} did not break`);
      else if (lighting.isLightOnAt(x, y))
        fail(`seed ${seed}: a smashed piece at ${x},${y} is still lit`);
    }),
  );
  console.log(`seed ${seed}: smashed and darkened ${smashed.size} light-carrying kind(s)`);
}

for (const kind of CELLAR_PROP_KIND_LIST) checkBreaks(kind);
checkSarcophagusStands();

const counts = new Map<number, number>();
for (const seed of FLOOR_SEEDS) checkFloor(seed, counts);
for (const type of CELLAR_TILE_TYPES) {
  if ((counts.get(type) ?? 0) === 0)
    fail(`tile type ${type} was never placed on ${FLOOR_SEEDS.length} floors`);
}
console.log(
  `placed on ${FLOOR_SEEDS.length} floors: ${[...counts].map(([type, count]) => `${type}×${count}`).join(', ')}`,
);

if (failures.length > 0) {
  console.error(`\nverify-cellar-props: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nverify-cellar-props: all checks passed');
