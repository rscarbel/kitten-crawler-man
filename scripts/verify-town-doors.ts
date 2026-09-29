#!/usr/bin/env tsx
/**
 * Headless gate: every town building's door can be walked into from the town's
 * start tile, stepping onto it from the tile in front of it, with every prop the
 * town places at runtime standing where it stands in the game.
 *
 * The generator's own reachability assertions run before the market, the plaza
 * props and the street decor exist, and those systems block their tiles
 * afterwards. Their connectivity check cannot see a door being sealed either: a
 * door tile is a dead end, so blocking it strands no *other* tile, and a planter
 * that drifts onto a doorstep passes that check while leaving the building
 * unenterable. So this builds the systems in `DungeonScene`'s order and walks
 * the finished map.
 *
 * Run: npm run verify:town-doors
 */

import { createCanvas } from 'canvas';

/**
 * The game modules are written against browser globals; `SpriteLoader` builds
 * its footprint tables at module load, so these are installed before any game
 * module is imported. Same shim `render-town.ts` uses.
 */
interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
/** Retina, so the low-end downscale check has a `devicePixelRatio` to read. */
const SHIM_DEVICE_PIXEL_RATIO = 2;
const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: SHIM_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless gate cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { TILE_SIZE } = await import('../src/core/constants');
const { GameMap } = await import('../src/map/GameMap');
const { level3 } = await import('../src/levels/level3');
const { MarketSystem } = await import('../src/systems/market/MarketSystem');
const { createMarketStock } = await import('../src/systems/market/MarketStock');
const { TownPropSystem } = await import('../src/systems/TownPropSystem');
const { TownDecorSystem } = await import('../src/systems/TownDecorSystem');

/**
 * World seeds the town is built with. The town itself is fixed data; the seed
 * moves the wilderness around it, which is what could reach a door outside the
 * walls.
 */
const WORLD_SEEDS: ReadonlyArray<number> = [1, 2, 3, 7, 42, 1234];
/** The approach every town door is entered from: the street row below the facade. */
const APPROACH_DY = 1;

let failures = 0;
function check(ok: boolean, message: string): void {
  if (!ok) {
    console.log(` FAIL  ${message}`);
    failures++;
    return;
  }
  console.log(`  ok   ${message}`);
}

const CARDINALS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

for (const worldSeed of WORLD_SEEDS) {
  const gameMap = new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed,
  });
  const market = new MarketSystem(
    gameMap,
    createMarketStock(),
    () => undefined,
    () => false,
    () => null,
    () => true,
  );
  const townProps = new TownPropSystem(
    gameMap,
    () => undefined,
    () => undefined,
    () => null,
    market.reservedTiles,
  );
  townProps.claimBountyGiverTile();
  // Constructed for its side effect: it blocks every tile its props stand on.
  new TownDecorSystem(gameMap, new Set([...market.reservedTiles, ...townProps.reservedTiles]));

  const size = gameMap.gridSize;
  const reached = new Uint8Array(size * size);
  const start = gameMap.startTile;
  const queue: Array<{ x: number; y: number }> = [start];
  reached[start.y * size + start.x] = 1;
  while (queue.length > 0) {
    const tile = queue.pop();
    if (tile === undefined) break;
    for (const [dx, dy] of CARDINALS) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (reached[ny * size + nx] === 1) continue;
      if (!gameMap.isWalkable(nx, ny)) continue;
      reached[ny * size + nx] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  const isReached = (x: number, y: number): boolean => reached[y * size + x] === 1;

  const sealed: string[] = [];
  for (const entry of gameMap.buildingEntries) {
    const door = entry.doorTile;
    const approach = { x: door.x, y: door.y + APPROACH_DY };
    const doorOpen = gameMap.isWalkable(door.x, door.y);
    const approachReached = isReached(approach.x, approach.y);
    if (doorOpen && approachReached) continue;
    const why = [
      doorOpen ? null : `door (${door.x},${door.y}) blocked`,
      approachReached ? null : `approach (${approach.x},${approach.y}) unreachable`,
    ].filter((reason) => reason !== null);
    sealed.push(`${entry.name}: ${why.join(', ')}`);
  }
  check(
    sealed.length === 0,
    `seed ${worldSeed}: all ${gameMap.buildingEntries.length} doors enterable from the start tile` +
      (sealed.length === 0 ? '' : ` — ${sealed.join('; ')}`),
  );
}

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall town doors enterable');
