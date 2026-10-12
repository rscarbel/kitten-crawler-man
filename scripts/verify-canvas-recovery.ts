/**
 * The floor survives the browser discarding every canvas's pixels.
 *
 * Builds a small floor, bakes it, then wipes the pixels of every surface the
 * game allocated — what a mobile browser does to a backgrounded page's canvases
 * — and checks, in order:
 *
 * - the wipe bites: a render straight after it draws no floor at all, which is
 *   the reported bug and proves the simulation reaches the cached path;
 * - the periodic check notices it on its own, through the sentinel, and runs a
 *   recovery;
 * - while the sheets repaint the floor still draws, in fallback colour;
 * - once the repainted sheets land, the floor renders pixel for pixel as it did
 *   before the wipe;
 * - with canvas memory exhausted, a render neither throws nor stops the frame,
 *   and the chunks bake again once memory comes back;
 * - a probe that cannot get a context recovers for memory pressure rather than
 *   repainting everything;
 * - a floor that has been left does not keep setting off recoveries.
 *
 *   npx tsx scripts/verify-canvas-recovery.ts
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import {
  beginCanvasRecoveryFrame,
  canvasRecoveryCount,
  checkCanvasesSoon,
} from '../src/core/canvasRecovery.js';
import { hasEnvironmentSheet, paintEnvironmentArtNow } from '../src/map/environmentArtCache.js';
import { DEFAULT_FLOOR_ART_SEED, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';
import { GROUND_SHEET_KEYS, requestGroundSheets } from '../src/map/ground/runtimeGroundSheets.js';
import { GameMap } from '../src/map/GameMap.js';
import { CHUNK_TILES } from '../src/map/tiles/chunkTiles.js';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';

/** Two chunks a side, so more than one chunk is baked, wiped and rebuilt. */
const MAP_TILES = CHUNK_TILES * 2;
const MAP_PX = MAP_TILES * TILE_SIZE;
const ALPHA_OFFSET = 3;
const CHANNELS = 4;
/** Well past `CHUNK_BAKE_RETRY_FRAMES`, so a held-off bake has had its retry. */
const FRAMES_TO_OUTLAST_BAKE_HOLD = 90;
/** Past the longest the periodic check backs off to, so every advance makes it due. */
const MAX_CHECK_INTERVAL_MS = 64001;
/** Checks run after leaving a floor, each of which a stale probe would turn into a recovery. */
const CHECKS_AFTER_LEAVING = 3;
const PROBED_SHEET = GROUND_SHEET_KEYS[0];

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

/** Every canvas the game asks for, so the wipe can reach all of them. */
const allocated: Canvas[] = [];
let refuseContexts = false;

function installRecordingCanvasGlobals(): void {
  installCanvasGlobals();
  const globals: { document?: unknown } = globalThis;
  globals.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`harness cannot create <${tag}>`);
      const canvas = createCanvas(1, 1);
      if (refuseContexts) {
        // What iOS does once its canvas memory budget is spent.
        Object.defineProperty(canvas, 'getContext', { value: () => null });
      } else {
        allocated.push(canvas);
      }
      return canvas;
    },
  };
}

function wipeEveryCanvas(): void {
  for (const canvas of allocated) {
    if (canvas.width === 0 || canvas.height === 0) continue;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}

function floorMap(): GameMap {
  const grid: TileContent[][] = [];
  for (let y = 0; y < MAP_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < MAP_TILES; x++) {
      row.push({ tileId: `${x},${y}`, type: FloorTypeValue.concrete });
    }
    grid.push(row);
  }
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function render(gameMap: GameMap): Uint8ClampedArray {
  const canvas = createCanvas(MAP_PX, MAP_PX);
  const nodeCtx = canvas.getContext('2d');
  gameMap.renderCanvas(asGameContext(nodeCtx), 0, 0, MAP_PX, MAP_PX);
  return nodeCtx.getImageData(0, 0, MAP_PX, MAP_PX).data;
}

function opaqueShare(pixels: Uint8ClampedArray): number {
  let opaque = 0;
  for (let index = ALPHA_OFFSET; index < pixels.length; index += CHANNELS) {
    if (pixels[index] > 0) opaque++;
  }
  return opaque / (pixels.length / CHANNELS);
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

installRecordingCanvasGlobals();
setFloorArtSeed(DEFAULT_FLOOR_ART_SEED);
const gameMap = floorMap();
requestGroundSheets(GROUND_SHEET_KEYS, () => gameMap.invalidateAllTileArt());
paintEnvironmentArtNow();

let nowMs = 0;

/** Advances the clock far enough that the periodic check is due, whatever its backoff. */
function runDueCheck(): void {
  nowMs += MAX_CHECK_INTERVAL_MS;
  beginCanvasRecoveryFrame(nowMs);
}

// A probe that cannot get a context has found memory exhausted, not pixels
// lost, so the recovery it starts must keep the painted sheets.
render(gameMap);
render(gameMap);
refuseContexts = true;
const recoveriesBeforeExhaustion = canvasRecoveryCount();
runDueCheck();
refuseContexts = false;
check(
  canvasRecoveryCount() === recoveriesBeforeExhaustion + 1,
  'a probe refused a context starts a recovery',
);
check(
  hasEnvironmentSheet(PROBED_SHEET),
  'a probe refused a context recovers for memory pressure, keeping the sheets',
);

checkCanvasesSoon();
beginCanvasRecoveryFrame(nowMs);
const before = render(gameMap);
// A second frame draws every chunk from its cache rather than baking it.
const cached = render(gameMap);
check(opaqueShare(before) === 1, 'the floor covers every pixel before the wipe');
check(samePixels(before, cached), 'a cached frame matches the frame that baked it');

wipeEveryCanvas();
check(opaqueShare(render(gameMap)) === 0, 'after the wipe the cached floor draws nothing');

const recoveriesBefore = canvasRecoveryCount();
checkCanvasesSoon();
beginCanvasRecoveryFrame(nowMs);
check(canvasRecoveryCount() === recoveriesBefore + 1, 'the purge check notices the wipe');

// A frame before the sheets land bakes against each material's fallback
// colour, as play does while they repaint; landing must throw those chunks away.
check(opaqueShare(render(gameMap)) === 1, 'the floor draws in fallback colour while it repaints');
paintEnvironmentArtNow();
const after = render(gameMap);
check(samePixels(before, after), 'the recovered floor matches the floor before the wipe');

checkCanvasesSoon();
beginCanvasRecoveryFrame(nowMs);
check(canvasRecoveryCount() === recoveriesBefore + 1, 'a healthy check runs no recovery');

refuseContexts = true;
gameMap.invalidateAllTileArt();
let threw = false;
try {
  render(gameMap);
} catch (error) {
  threw = true;
  console.error(error);
}
check(!threw, 'a render with no canvas memory left does not throw');

refuseContexts = false;
let recovered: Uint8ClampedArray = new Uint8ClampedArray(0);
for (let frame = 0; frame < FRAMES_TO_OUTLAST_BAKE_HOLD; frame++) recovered = render(gameMap);
check(samePixels(before, recovered), 'the chunks bake again once memory comes back');

// A floor that has been left must not keep the probe reporting purges: its
// chunks are never drawn again, so nothing re-bakes them after a recovery.
// The first check runs the memory-pressure recovery the exhausted render owed;
// the second reads the floor's ink, so the probe knows it was not blank.
render(gameMap);
runDueCheck();
render(gameMap);
render(gameMap);
runDueCheck();
wipeEveryCanvas();
const recoveriesBeforeLeaving = canvasRecoveryCount();
runDueCheck();
check(canvasRecoveryCount() === recoveriesBeforeLeaving + 1, 'a wipe after leaving is noticed');
paintEnvironmentArtNow();
for (let round = 0; round < CHECKS_AFTER_LEAVING; round++) runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeLeaving + 1,
  "a left floor's chunk sets off no further recoveries",
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-canvas-recovery: all checks passed');
