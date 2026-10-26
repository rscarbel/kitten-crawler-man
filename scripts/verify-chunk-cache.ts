#!/usr/bin/env tsx
/**
 * Headless gate for the ground chunk cache's pacing, on the real floor-3 town.
 *
 *  - A walk across the town at the crawlers' normal pace never meets a cold
 *    chunk: every chunk that scrolls into view was baked ahead of the camera,
 *    across as many frames as its cost needed. A town chunk costs several
 *    times a frame's bake budget, so a prefetch that waits for a whole bake to
 *    fit the budget never bakes at all, and every chunk then bakes on the frame
 *    it appears.
 *  - The chunks baked a slice at a time draw exactly what one-shot bakes do.
 *  - A tile changed on a chunk corner is patched into all four chunks it
 *    reaches before they are drawn, with no chunk re-baked, and the view then
 *    matches a fresh bake of the changed map.
 *  - A map let go with `releaseTileArt` gives every chunk's pixels back at
 *    once, without waiting for a collection.
 *
 * Every check is a count or a pixel comparison, never a timing. The cache
 * paces itself by the clock, so the gate swaps `performance.now` for a virtual
 * clock that moves a fixed step per reading — the bake reads it once per tile —
 * and every count comes out the same on a machine busy with other work.
 *
 *   npm run verify:chunk-cache
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';

await loadGameSpritesInNode();
const { TILE_SIZE, PLAYER_SPEED } = await import('../src/core/constants.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { TileChunkCache, renderCanvas } = await import('../src/map/TileRenderer.js');
const { perfMonitor } = await import('../src/core/perf/PerfMonitor.js');
const { CHUNK_TILES } = await import('../src/map/tiles/chunkTiles.js');
const { FloorTypeValue } = await import('../src/map/tileTypes.js');
const { surfaceTallies } = await import('../src/core/rendering/canvasSurface.js');

const WORLD_SEED = 7919;
const VIEW_W = 1280;
const VIEW_H = 720;
/** Out from the plaza and back round, long enough to cross several chunk columns and rows. */
const WALK_LEGS: ReadonlyArray<{
  readonly dx: number;
  readonly dy: number;
  readonly tiles: number;
}> = [
  { dx: 1, dy: 0, tiles: 60 },
  { dx: 0, dy: 1, tiles: 40 },
  { dx: -1, dy: 0, tiles: 60 },
  { dx: 0, dy: -1, tiles: 40 },
];
/**
 * Virtual milliseconds each clock reading advances. Puts a town chunk, read
 * once per tile, at about 13 ms: the order of what one costs headless, and
 * several times a frame's bake budget, as in the browser.
 */
const VIRTUAL_MS_PER_CLOCK_READ = 0.05;
/** Chunks a tile on a chunk corner reaches, once its patch is widened past it. */
const CHUNKS_AT_A_CORNER = 4;

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

const map = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
let virtualNowMs = performance.now();
Object.defineProperty(performance, 'now', {
  configurable: true,
  value: () => {
    virtualNowMs += VIRTUAL_MS_PER_CLOCK_READ;
    return virtualNowMs;
  },
});

const start = map.townSquareCentre ?? map.startTile;
const mapPx = level3.mapSize * TILE_SIZE;
const canvas = createCanvas(VIEW_W, VIEW_H);
const ctx = asGameContext(canvas.getContext('2d'));
const freshCanvas = createCanvas(VIEW_W, VIEW_H);
const freshCtx = asGameContext(freshCanvas.getContext('2d'));

let coldBakes = 0;
let directDraws = 0;
let bakes = 0;
let repaints = 0;
perfMonitor.enable();
perfMonitor.setFrameListener((_startedAt, _timers, gauges) => {
  coldBakes += gauges.chunkColdBakes;
  directDraws += gauges.chunkDirectDraws;
  bakes += gauges.chunkBakes;
  repaints += gauges.chunkRepaints;
});

function resetCounts(): void {
  coldBakes = 0;
  directDraws = 0;
  bakes = 0;
  repaints = 0;
}

let cameraX = start.x * TILE_SIZE - VIEW_W / 2;
let cameraY = start.y * TILE_SIZE - VIEW_H / 2;

function moveCamera(dx: number, dy: number): void {
  cameraX = Math.max(0, Math.min(mapPx - VIEW_W, cameraX + dx));
  cameraY = Math.max(0, Math.min(mapPx - VIEW_H, cameraY + dy));
}

function frame(): void {
  map.renderCanvas(ctx, cameraX, cameraY, VIEW_W, VIEW_H);
  perfMonitor.endFrame(performance.now());
}

function viewPixels(): Uint8ClampedArray {
  return ctx.getImageData(0, 0, VIEW_W, VIEW_H).data;
}

/** The view as a cache that has never drawn anything bakes it, every chunk in one go. */
function freshBakePixels(): Uint8ClampedArray {
  freshCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  const freshCache = new TileChunkCache(map.structure, TILE_SIZE);
  renderCanvas(
    freshCtx,
    map.structure,
    TILE_SIZE,
    cameraX,
    cameraY,
    VIEW_W,
    VIEW_H,
    freshCache,
    true,
  );
  freshCache.dispose();
  return freshCtx.getImageData(0, 0, VIEW_W, VIEW_H).data;
}

function differingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) differing++;
  return differing;
}

function clearView(): void {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
}

console.log('\n── A walk across the town');
moveCamera(0, 0);
frame();
resetCounts();
let walkFrames = 0;
// Compared where each leg ends, on ground the walk itself baked: the walk
// ends back on the plaza, whose chunks the first frame baked in one go.
let walkedDiff = 0;
for (const leg of WALK_LEGS) {
  const legFrames = Math.round((leg.tiles * TILE_SIZE) / PLAYER_SPEED);
  for (let step = 0; step < legFrames; step++) {
    moveCamera(leg.dx * PLAYER_SPEED, leg.dy * PLAYER_SPEED);
    frame();
    walkFrames++;
  }
  clearView();
  frame();
  walkedDiff += differingPixels(viewPixels(), freshBakePixels());
}
console.log(`  ..  ${walkFrames} frames, ${bakes} chunks baked on the way`);
check(bakes > 0, 'the walk reaches ground no earlier frame had baked');
check(coldBakes === 0, `no chunk is baked on the frame it scrolls into view (${coldBakes} were)`);
check(directDraws === 0, `no chunk is painted tile by tile (${directDraws} chunk-frames were)`);
check(
  walkedDiff === 0,
  `chunks baked across frames match one-shot bakes (${walkedDiff} bytes differ)`,
);

console.log('\n── A tile changed on a chunk corner');
const chunkPx = CHUNK_TILES * TILE_SIZE;
const cornerX = Math.round((cameraX + VIEW_W / 2) / chunkPx) * CHUNK_TILES;
const cornerY = Math.round((cameraY + VIEW_H / 2) / chunkPx) * CHUNK_TILES;
const cornerTile = map.structure[cornerY]?.[cornerX];
if (cornerTile === undefined) {
  check(false, `the view's centre corner (${cornerX}, ${cornerY}) is on the map`);
} else {
  clearView();
  frame();
  const beforeChange = viewPixels();
  cornerTile.type =
    cornerTile.type === FloorTypeValue.water ? FloorTypeValue.road : FloorTypeValue.water;
  map.markTileDirty(cornerX, cornerY);
  resetCounts();
  clearView();
  frame();
  const afterChange = viewPixels();
  check(differingPixels(beforeChange, afterChange) > 0, 'the change shows on the very next frame');
  check(
    repaints === CHUNKS_AT_A_CORNER,
    `it is patched into all ${CHUNKS_AT_A_CORNER} chunks it reaches (${repaints} patched)`,
  );
  check(bakes === 0, `no chunk is re-baked for it (${bakes} were)`);
  const patchedDiff = differingPixels(afterChange, freshBakePixels());
  check(patchedDiff === 0, `the patched view matches a fresh bake (${patchedDiff} bytes differ)`);
}

console.log('\n── The map is let go');
const chunkSurfacesHeld = (): number => surfaceTallies().get('tileChunks')?.surfaces ?? 0;
const heldBeforeRelease = chunkSurfacesHeld();
check(heldBeforeRelease > 0, `the walk left chunks resident (${heldBeforeRelease})`);
map.releaseTileArt();
const heldAfterRelease = chunkSurfacesHeld();
check(
  heldAfterRelease === 0,
  `releasing the map's art gives every chunk back (${heldAfterRelease} left)`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-chunk-cache: all checks passed');
