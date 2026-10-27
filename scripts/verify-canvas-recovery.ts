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
 * - a floor that has been left does not keep setting off recoveries;
 * - a decoration whose blit throws, as Chrome's `drawImage` does for a canvas
 *   whose pixels were given back, is left out without taking every
 *   decoration sorted after it down with it;
 * - a lost context holds every check and recovery until it is restored, then
 *   runs exactly one recovery and steps the variety tier once, however many
 *   canvases report the loss and the restore;
 * - a context never restored recovers once on the timeout, repaints nothing
 *   more while its sentinel reads blank, and a late restore — announced or
 *   noticed by a sentinel that holds its pixels — repaints once more without
 *   stepping the tier again; the main canvas lost meanwhile is a loss of its own;
 * - memory pressure steps the tier, except during a loss already answered or
 *   begun hidden, and once that loss has closed it steps the tier again;
 * - a hidden-begun loss ending on its timeout and a late restore repaints
 *   twice, and one ending through a sentinel that holds again repaints once
 *   more, neither stepping the tier;
 * - a surface refused every frame inside the memory-pressure spacing neither
 *   keeps the periodic check from finding a purge nor an overdue loss from
 *   closing when its sentinel holds again;
 * - an overdue loss whose sentinel is refused closes rather than staying open
 *   for as long as memory is short, and if the context is in fact still lost,
 *   the checks that find it so neither step the tier nor reach the budget cut;
 *   once its sentinel holds, the world repaints once without stepping;
 * - memory pressure requested before a hidden loss begins steps the tier once,
 *   whether that loss ends on its timeout or on its restore;
 * - a loss restored and a loss begun hidden before the next frame still step
 *   the tier for the first, and two visible losses restored before the next
 *   frame step it twice;
 * - a context that stays lost behind a sentinel refused at every check backs
 *   its repaints off with the check interval;
 * - memory pressure merged into a repaint that asks for no less — a hidden-begun
 *   loss's restore, a back-forward cache thaw, a purge found on returning to the
 *   foreground — steps the tier once as memory pressure, never counts toward the
 *   budget cut, and inside its spacing steps nothing;
 * - a page thawed from the back-forward cache repaints without stepping the
 *   tier or counting toward the budget cut;
 * - a purge found by the first check after the page shows again repaints
 *   without stepping the tier; one found by a later regular check steps it;
 * - a lag step never changes a live mob's look, and a purge reaching the tier
 *   that shares it re-dresses the mob in the shared look, same kind and health,
 *   with the shared look's rows warming; a purge that changes no living mob's
 *   look warms nothing;
 * - a purge repaints only the sheets drawn lately; the rest repaint when looked up;
 * - the cache budgets are cut only by repeated purges at the minimal tier.
 *
 *   npx tsx scripts/verify-canvas-recovery.ts
 */

import { createCanvas, type Canvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import {
  beginCanvasRecoveryFrame,
  CANVAS_PURGE_CHECK_INTERVAL_MS,
  canvasRecoveryCount,
  checkCanvasesSoon,
  CONTEXT_RESTORE_TIMEOUT_MS,
  MAX_PURGE_CHECK_INTERVAL_MS,
  MEMORY_PRESSURE_RECOVERY_SPACING_MS,
  onCanvasRecovery,
  PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT,
  registerPurgeProbe,
  reportCanvasAllocationFailure,
  runCanvasRecovery,
  watchForCanvasLoss,
} from '../src/core/rendering/canvasRecovery.js';
import { CanvasContextUnavailableError } from '../src/core/rendering/canvasSurface.js';
import { deviceMemoryBudgetScale, memoryBudgetScale } from '../src/core/perf/deviceMemoryBudget.js';
import { beginRenderFrame } from '../src/core/rendering/renderFrameClock.js';
import { getSpriteDefByKey } from '../src/core/spriteAssets/SpriteLoader.js';
import {
  asVarietyTier,
  FULL_VARIETY_TIER,
  forceVarietyTier,
  MINIMAL_VARIETY_TIER,
  stepVarietyTierDown,
  varietyTier,
} from '../src/core/perf/varietyTier.js';
import type { MobVariantFamily } from '../src/core/mobs/mobVariantFamily.js';
import type { Mob } from '../src/creatures/Mob.js';
import { MOB_KINDS } from '../src/levels/mobKinds.js';
import { liveSpawnContext, spawnMob, type SpawnContext } from '../src/levels/spawnFunnel.js';
import { isFigureStateQueued, isFigureStateWarm } from '../src/sprites/figure/figureFrameCache.js';
import { goblinFigure } from '../src/sprites/goblinSprite.js';
import {
  hasEnvironmentSheet,
  paintEnvironmentArtNow,
  RECENTLY_DRAWN_FRAMES,
} from '../src/map/environmentArtCache.js';
import { DEFAULT_FLOOR_ART_SEED, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';
import { GROUND_SHEET_KEYS, requestGroundSheets } from '../src/map/ground/runtimeGroundSheets.js';
import { GameMap } from '../src/map/GameMap.js';
import { CHUNK_TILES } from '../src/map/tiles/chunkTiles.js';
import { CLIFF, FloorTypeValue, type TileContent } from '../src/map/tileTypes.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';

/** Two chunks a side, so more than one chunk is baked, wiped and rebuilt. */
const MAP_TILES = CHUNK_TILES * 2;
const MAP_PX = MAP_TILES * TILE_SIZE;
/**
 * Frames that are sure to re-bake every stale chunk on the map: a frame of
 * play always paints at least one tile of a visible stale chunk's re-bake, so
 * one frame per tile is the most it can take. The drain stops as soon as the
 * floor matches, which on any machine is a frame or two per chunk.
 */
const FRAMES_TO_DRAIN_STALE_CHUNKS = MAP_TILES * MAP_TILES;
const ALPHA_OFFSET = 3;
const CHANNELS = 4;
/** Well past `CHUNK_BAKE_RETRY_FRAMES`, so a held-off bake has had its retry. */
const FRAMES_TO_OUTLAST_BAKE_HOLD = 90;
/** Past the longest the periodic check backs off to, so every advance makes it due. */
const PAST_LONGEST_CHECK_INTERVAL_MS = MAX_PURGE_CHECK_INTERVAL_MS + 1;
/** Checks run after leaving a floor, each of which a stale probe would turn into a recovery. */
const CHECKS_AFTER_LEAVING = 3;
/** Purge-found checks in a row that stretch the check interval past its base. */
const PURGES_TO_BACK_OFF = 2;
const PAST_BASE_CHECK_INTERVAL_MS = CANVAS_PURGE_CHECK_INTERVAL_MS + 1;
/** Checks run while a restore is overdue, each of which could repaint into the lost context. */
const CHECKS_WHILE_OVERDUE = 3;
/**
 * Checks enough to step a loss from the full tier down to the minimal one and on
 * to the budget cut, were each check that finds the lost context taken for a
 * new loss.
 */
const CHECKS_TO_REACH_BUDGET_CUT =
  MINIMAL_VARIETY_TIER - FULL_VARIETY_TIER + PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT;
/** Base check intervals a context stays lost behind a refused sentinel for. */
const CHECKS_UNDER_PERSISTENT_REFUSAL = 16;
/**
 * Repaints those intervals may hold once the checks back off. Doubling from the
 * base interval, the reopen-and-close loop repaints three times in sixteen; at
 * a fixed interval it would repaint at every other check, eight times.
 */
const MAX_REPAINTS_UNDER_PERSISTENT_REFUSAL = 4;
/** Frames a surface is refused on, each inside the memory-pressure spacing, before the check is due. */
const FRAMES_OF_REFUSALS = 3;
/** A frame's length at sixty frames a second, well inside the memory-pressure spacing. */
const FRAME_MS = 16;
const PROBED_SHEET = GROUND_SHEET_KEYS[0];
/** Cliff tiles laid along one row: each is drawn from its own overlay cache entry. */
const DECORATION_ROW_TILES = 4;
const DECORATION_ROW_Y = 1;
/** The decoration whose blit is made to throw: the first one the pass draws. */
const FAILING_BLIT_INDEX = 0;

/** Where the mobs whose looks are checked stand; anywhere on the floor will do. */
const LOOK_TILE = { x: 1, y: 1 } as const;
/** A row every spawned goblin warms first. */
const WARMED_GOBLIN_STATE = 'idle';

/** A look of `family` that only shows while looks are not shared. */
function unsharedLook<V>(family: MobVariantFamily<V>): V {
  const unshared = family.variants.find((variant) => variant !== family.canonical);
  if (unshared === undefined) throw new Error('a family with one look has nothing to re-dress');
  return unshared;
}

function liveLookCase<V>(label: string, mob: Mob, family: MobVariantFamily<V>, look: () => V) {
  return {
    label,
    mob,
    look,
    spawnedLook: look(),
    canonical: family.canonical,
    sharedFromTier: family.sharedFromTier,
    kind: mob.spawnTypeKey,
    hp: mob.hp,
  };
}

const failures: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

/** Every canvas the game asks for, so the wipe can reach all of them. */
const allocated: Canvas[] = [];
let refuseContexts = false;
/**
 * The events of every canvas that listens for its own context loss, oldest
 * first: the sentinels. `node-canvas` has no events, so each is given its own.
 */
const sentinelEvents: EventTarget[] = [];

/** Gives a `node-canvas` canvas the event methods a browser canvas has. */
function withEvents(canvas: Canvas): void {
  const events = new EventTarget();
  Object.defineProperty(canvas, 'addEventListener', {
    value: (type: string, listener: EventListener) => {
      events.addEventListener(type, listener);
      if (type === 'contextlost' && !sentinelEvents.includes(events)) sentinelEvents.push(events);
    },
  });
}

function installRecordingCanvasGlobals(): void {
  installCanvasGlobals();
  const globals: { document?: unknown; window?: unknown } = globalThis;
  globals.window = Object.assign(new EventTarget(), globals.window);
  globals.document = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`harness cannot create <${tag}>`);
      const canvas = createCanvas(1, 1);
      withEvents(canvas);
      if (refuseContexts) {
        // What iOS does once its canvas memory budget is spent.
        Object.defineProperty(canvas, 'getContext', { value: () => null });
      } else {
        allocated.push(canvas);
      }
      return canvas;
    },
  });
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

/** A floor with a row of cached decorations on it, for the decoration-pass check. */
function decoratedMap(): GameMap {
  const grid: TileContent[][] = [];
  for (let y = 0; y < MAP_TILES; y++) {
    const row: TileContent[] = [];
    for (let x = 0; x < MAP_TILES; x++) {
      const isDecoration = y === DECORATION_ROW_Y && x > 0 && x <= DECORATION_ROW_TILES;
      row.push({ tileId: `${x},${y}`, type: isDecoration ? CLIFF : FloorTypeValue.concrete });
    }
    grid.push(row);
  }
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

/** Alpha a failing blit leaves the context at, as a painter fading its subject would. */
const LEAKED_ALPHA = 0.25;
/** Offset a failing blit leaves the context translated by, as a mirroring painter would. */
const LEAKED_SHIFT_PX = 1000;

/**
 * Runs the decoration pass on a context whose `drawImage` fades and shifts the
 * context and then throws on its first call, and returns whether the pass
 * threw, how many blits it made after the failing one, and how many of those
 * were drawn under the state the failing one left behind.
 */
function decorationPassAfterFailingBlit(gameMap: GameMap): {
  threw: boolean;
  laterBlits: number;
  laterBlitsUnderLeakedState: number;
} {
  const canvas = createCanvas(MAP_PX, MAP_PX);
  const nodeCtx = canvas.getContext('2d');
  const drawImage = nodeCtx.drawImage.bind(nodeCtx);
  let blits = 0;
  let laterBlitsUnderLeakedState = 0;
  const baselineShift = nodeCtx.getTransform().e;
  Object.defineProperty(nodeCtx, 'drawImage', {
    value: (...args: Parameters<typeof drawImage>) => {
      const index = blits++;
      if (index === FAILING_BLIT_INDEX) {
        nodeCtx.globalAlpha = LEAKED_ALPHA;
        nodeCtx.translate(LEAKED_SHIFT_PX, 0);
        throw new Error('drawImage: the image argument is a canvas with a width or height of 0');
      }
      const leaked = nodeCtx.globalAlpha !== 1 || nodeCtx.getTransform().e !== baselineShift;
      if (leaked) laterBlitsUnderLeakedState++;
      drawImage(...args);
    },
  });
  let threw = false;
  try {
    gameMap.renderDecorationsOverlay(asGameContext(nodeCtx), 0, 0, MAP_PX, MAP_PX);
  } catch {
    threw = true;
  }
  return {
    threw,
    laterBlits: Math.max(0, blits - FAILING_BLIT_INDEX - 1),
    laterBlitsUnderLeakedState,
  };
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
requestGroundSheets(GROUND_SHEET_KEYS, () => gameMap.releaseTileArt());
paintEnvironmentArtNow();

let nowMs = 0;

/** Advances the clock far enough that the periodic check is due, whatever its backoff. */
function runDueCheck(): void {
  nowMs += PAST_LONGEST_CHECK_INTERVAL_MS;
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
// colour, as play does while they repaint; landing must re-bake those chunks,
// a frame's budget at a time.
check(opaqueShare(render(gameMap)) === 1, 'the floor draws in fallback colour while it repaints');
paintEnvironmentArtNow();
let after: Uint8ClampedArray = new Uint8ClampedArray(0);
for (let frame = 0; frame < FRAMES_TO_DRAIN_STALE_CHUNKS; frame++) {
  after = render(gameMap);
  if (samePixels(before, after)) break;
}
check(samePixels(before, after), 'the recovered floor matches the floor before the wipe');

checkCanvasesSoon();
beginCanvasRecoveryFrame(nowMs);
check(canvasRecoveryCount() === recoveriesBefore + 1, 'a healthy check runs no recovery');

refuseContexts = true;
gameMap.releaseTileArt();
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

const decorated = decoratedMap();
// Warmed first, so every cliff draws as one blit of its cached entry.
decorated.renderDecorationsOverlay(
  asGameContext(createCanvas(MAP_PX, MAP_PX).getContext('2d')),
  0,
  0,
  MAP_PX,
  MAP_PX,
);
const failingPass = decorationPassAfterFailingBlit(decorated);
check(!failingPass.threw, 'a decoration whose blit throws does not abort the decoration pass');
check(
  failingPass.laterBlits >= DECORATION_ROW_TILES - 1,
  'every decoration after one whose blit threw is still drawn',
);
check(
  failingPass.laterBlitsUnderLeakedState === 0,
  `${failingPass.laterBlitsUnderLeakedState} decoration(s) after a failed one were drawn faded ` +
    'or shifted by the state it left behind',
);

// A GPU context loss. The main canvas and the sentinel each report it; the
// world must be repainted once, after the restore, and ask for less.
const mainCanvas = new EventTarget();
let mainRestores = 0;
let pageHidden = false;
watchForCanvasLoss(
  mainCanvas,
  () => mainRestores++,
  () => pageHidden,
);

function latestSentinel(): EventTarget {
  if (sentinelEvents.length === 0) throw new Error('no sentinel has been painted');
  return sentinelEvents[sentinelEvents.length - 1];
}

function fire(target: EventTarget, type: string): void {
  target.dispatchEvent(new Event(type));
}

function frameAfter(elapsedMs: number): void {
  nowMs += elapsedMs;
  beginCanvasRecoveryFrame(nowMs);
}

function loseContexts(): void {
  fire(latestSentinel(), 'contextlost');
  fire(mainCanvas, 'contextlost');
  wipeEveryCanvas();
}

function restoreContexts(): void {
  fire(mainCanvas, 'contextrestored');
  for (const sentinel of sentinelEvents) fire(sentinel, 'contextrestored');
}

/** What a bfcache restore sends: a `pageshow` that says the page was frozen whole. */
function firePersistedPageshow(): void {
  const pageshow = new Event('pageshow');
  Object.defineProperty(pageshow, 'persisted', { value: true });
  window.dispatchEvent(pageshow);
}

/** One whole loss: lost, held, restored, recovered. */
function loseAndRestore(): void {
  loseContexts();
  frameAfter(0);
  restoreContexts();
  frameAfter(0);
}

function tierAfterSteps(from: number, steps: number): number {
  return Math.min(from + steps, MINIMAL_VARIETY_TIER);
}

forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeLoss = canvasRecoveryCount();
const tierBeforeLoss = varietyTier();
loseContexts();
frameAfter(0);
checkCanvasesSoon();
reportCanvasAllocationFailure();
firePersistedPageshow();
frameAfter(CONTEXT_RESTORE_TIMEOUT_MS - 1);
check(
  canvasRecoveryCount() === recoveriesBeforeLoss,
  'nothing recovers while a lost context is awaited, whatever else asks',
);
check(varietyTier() === tierBeforeLoss, 'the tier holds while a lost context is awaited');
const mainRestoresBefore = mainRestores;
restoreContexts();
frameAfter(0);
check(mainRestores === mainRestoresBefore + 1, "the main canvas's own state is re-established");
check(
  canvasRecoveryCount() === recoveriesBeforeLoss + 1,
  `one loss restored on ${sentinelEvents.length + 1} canvases ran ` +
    `${canvasRecoveryCount() - recoveriesBeforeLoss} recoveries, not one`,
);
check(
  varietyTier() === tierAfterSteps(tierBeforeLoss, 1),
  'one loss steps the variety tier down once',
);
paintEnvironmentArtNow();
for (let round = 0; round < CHECKS_AFTER_LEAVING; round++) runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeLoss + 1,
  'a sentinel painted before the loss does not report it again once restored',
);

loseAndRestore();
check(
  canvasRecoveryCount() === recoveriesBeforeLoss + 2,
  'a second loss runs a recovery of its own',
);
check(
  varietyTier() === tierAfterSteps(tierBeforeLoss, 2),
  'a second loss steps the variety tier again',
);

forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeTimeout = canvasRecoveryCount();
loseContexts();
frameAfter(0);
frameAfter(CONTEXT_RESTORE_TIMEOUT_MS - 1);
check(
  canvasRecoveryCount() === recoveriesBeforeTimeout,
  'no recovery runs before the restore timeout',
);
frameAfter(1);
check(
  canvasRecoveryCount() === recoveriesBeforeTimeout + 1,
  'a context never restored recovers once on the timeout',
);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'the timeout recovery steps the tier once',
);
// The context is still lost, so everything the timeout recovery painted —
// the fresh sentinel among it — was painted into nothing, and the browser
// reports that sentinel lost too.
wipeEveryCanvas();
fire(latestSentinel(), 'contextlost');
for (let round = 0; round < CHECKS_WHILE_OVERDUE; round++) {
  wipeEveryCanvas();
  runDueCheck();
}
check(
  canvasRecoveryCount() === recoveriesBeforeTimeout + 1,
  `${canvasRecoveryCount() - recoveriesBeforeTimeout - 1} recoveries repainted into a context ` +
    'still lost after the restore timeout',
);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a sentinel lost while the restore is overdue does not step the tier again',
);
// A memory-pressure recovery while that loss is open is the same loss.
runCanvasRecovery('memoryPressure');
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'memory pressure during a loss already answered does not step the tier',
);
wipeEveryCanvas();
const recoveriesBeforeLateRestore = canvasRecoveryCount();
restoreContexts();
frameAfter(0);
check(
  canvasRecoveryCount() === recoveriesBeforeLateRestore + 1,
  'a restore after the timeout repaints once more',
);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a restore after the timeout does not step the tier again',
);
restoreContexts();
frameAfter(0);
check(
  canvasRecoveryCount() === recoveriesBeforeLateRestore + 1,
  'a restore with no loss open runs no recovery',
);
loseAndRestore();
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'the next loss after a late restore steps the tier again',
);

/** Loses the sentinel's context alone, and lets the restore go overdue. */
function loseSentinelPastTimeout(): void {
  fire(latestSentinel(), 'contextlost');
  wipeEveryCanvas();
  frameAfter(0);
  frameAfter(CONTEXT_RESTORE_TIMEOUT_MS);
}

// A context that comes back without an event is noticed by its sentinel.
forceVarietyTier(FULL_VARIETY_TIER);
loseSentinelPastTimeout();
wipeEveryCanvas();
runDueCheck();
const recoveriesBeforeSilentReturn = canvasRecoveryCount();
runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeSilentReturn + 1,
  'a context back without contextrestored repaints once when its sentinel holds',
);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a context back without contextrestored does not step the tier again',
);
paintEnvironmentArtNow();
for (let round = 0; round < CHECKS_AFTER_LEAVING; round++) runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeSilentReturn + 1,
  'a silent return repaints only once',
);

// Backoff from earlier purges must not delay noticing a silent return: an
// overdue check repaints nothing while the context stays lost, so it keeps the
// base interval.
forceVarietyTier(FULL_VARIETY_TIER);
for (let round = 0; round < PURGES_TO_BACK_OFF; round++) {
  wipeEveryCanvas();
  runDueCheck();
  frameAfter(0);
}
loseSentinelPastTimeout();
wipeEveryCanvas();
runDueCheck();
const recoveriesBeforeBackedOffReturn = canvasRecoveryCount();
frameAfter(PAST_BASE_CHECK_INTERVAL_MS);
check(
  canvasRecoveryCount() === recoveriesBeforeBackedOffReturn + 1,
  'a silent return after backed-off checks repaints within the base check interval',
);
paintEnvironmentArtNow();
for (let round = 0; round < CHECKS_AFTER_LEAVING; round++) runDueCheck();

// The main canvas losing its context while another loss is overdue is a loss of its own.
forceVarietyTier(FULL_VARIETY_TIER);
loseSentinelPastTimeout();
fire(mainCanvas, 'contextlost');
frameAfter(0);
restoreContexts();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'a main-canvas loss while another is overdue steps the tier once more',
);

// Memory pressure with no loss open asks for less too.
forceVarietyTier(FULL_VARIETY_TIER);
runCanvasRecovery('memoryPressure');
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a memory-pressure recovery steps the variety tier down once',
);

// A page thawed from the back-forward cache repaints, but nothing was seen lost.
forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeThaw = canvasRecoveryCount();
firePersistedPageshow();
frameAfter(0);
check(
  canvasRecoveryCount() === recoveriesBeforeThaw + 1,
  'a page thawed from the back-forward cache repaints once',
);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'a page thawed from the back-forward cache keeps the variety tier',
);

// A mobile browser purges a backgrounded tab's canvases as routine.
forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeForeground = canvasRecoveryCount();
fire(document, 'visibilitychange');
wipeEveryCanvas();
frameAfter(0);
check(
  canvasRecoveryCount() === recoveriesBeforeForeground + 1,
  'a purge found on returning to the foreground repaints once',
);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'a purge found on returning to the foreground keeps the variety tier',
);
wipeEveryCanvas();
runDueCheck();
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a purge found by a later regular check steps the variety tier once',
);

// Android Chrome drops a backgrounded app's GPU context as routine.
forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeHiddenLoss = canvasRecoveryCount();
pageHidden = true;
loseAndRestore();
pageHidden = false;
check(
  canvasRecoveryCount() === recoveriesBeforeHiddenLoss + 1,
  'a loss begun while the page is hidden repaints once',
);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'a loss begun while the page is hidden keeps the variety tier',
);
const recoveriesBeforeHiddenTimeout = canvasRecoveryCount();
pageHidden = true;
loseContexts();
frameAfter(0);
frameAfter(CONTEXT_RESTORE_TIMEOUT_MS);
pageHidden = false;
restoreContexts();
frameAfter(0);
check(
  canvasRecoveryCount() === recoveriesBeforeHiddenTimeout + 2,
  `a loss begun while hidden ran ${canvasRecoveryCount() - recoveriesBeforeHiddenTimeout} ` +
    'recoveries through its timeout and late restore, not two',
);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'a loss begun while hidden keeps the tier through its timeout and late restore',
);
forceVarietyTier(FULL_VARIETY_TIER);
loseAndRestore();
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a loss begun while the page is visible steps the variety tier',
);

/** A loss the page returns to the foreground during, restored once it is visible. */
function loseThenReturnThenRestore(hiddenAtLoss: boolean): void {
  pageHidden = hiddenAtLoss;
  loseContexts();
  frameAfter(0);
  pageHidden = false;
  fire(document, 'visibilitychange');
  frameAfter(0);
  restoreContexts();
  frameAfter(0);
}

for (const hiddenAtLoss of [true, false]) {
  const began = hiddenAtLoss ? 'hidden' : 'visible';
  const stepsForLoss = hiddenAtLoss ? 0 : 1;
  forceVarietyTier(FULL_VARIETY_TIER);
  const recoveriesBeforeReturn = canvasRecoveryCount();
  loseThenReturnThenRestore(hiddenAtLoss);
  check(
    canvasRecoveryCount() === recoveriesBeforeReturn + 1,
    `a loss begun ${began} with a return before its restore recovers once`,
  );
  check(
    varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, stepsForLoss),
    `a loss begun ${began} with a return before its restore steps the tier ${stepsForLoss} time(s)`,
  );
  wipeEveryCanvas();
  runDueCheck();
  check(
    varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, stepsForLoss + 1),
    `the restore of a loss begun ${began} answers the return, so a later purge steps the tier`,
  );
}

forceVarietyTier(FULL_VARIETY_TIER);
fire(document, 'visibilitychange');
loseContexts();
frameAfter(0);
restoreContexts();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a loss right after a return to the foreground steps the tier',
);
wipeEveryCanvas();
runDueCheck();
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'a loss right after a return clears the return, so a later purge steps the tier',
);

/** Lets the next memory-pressure request run rather than be spaced out behind the last. */
function outlastMemoryPressureSpacing(): void {
  nowMs += MEMORY_PRESSURE_RECOVERY_SPACING_MS;
}

// A surface refused while a loss begun hidden is open is that loss, which asks for no less.
forceVarietyTier(FULL_VARIETY_TIER);
pageHidden = true;
loseContexts();
pageHidden = false;
outlastMemoryPressureSpacing();
reportCanvasAllocationFailure();
frameAfter(0);
frameAfter(CONTEXT_RESTORE_TIMEOUT_MS);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'memory pressure while a loss begun hidden is awaited keeps the tier',
);
outlastMemoryPressureSpacing();
reportCanvasAllocationFailure();
frameAfter(0);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'memory pressure while a loss begun hidden is overdue keeps the tier',
);
restoreContexts();
frameAfter(0);
outlastMemoryPressureSpacing();
reportCanvasAllocationFailure();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'memory pressure after a loss begun hidden has closed steps the tier',
);

// A surface refused before a hidden loss began is not that loss, however it ends.
for (const endsOnTimeout of [true, false]) {
  const ending = endsOnTimeout ? 'its timeout' : 'its restore';
  forceVarietyTier(FULL_VARIETY_TIER);
  outlastMemoryPressureSpacing();
  reportCanvasAllocationFailure();
  pageHidden = true;
  loseContexts();
  pageHidden = false;
  frameAfter(0);
  if (endsOnTimeout) frameAfter(CONTEXT_RESTORE_TIMEOUT_MS);
  restoreContexts();
  frameAfter(0);
  check(
    varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
    `memory pressure requested before a hidden loss that ends on ${ending} steps the tier once`,
  );
}

// A loss begun hidden whose context comes back without an event.
forceVarietyTier(FULL_VARIETY_TIER);
const recoveriesBeforeHiddenSilentLoss = canvasRecoveryCount();
pageHidden = true;
loseSentinelPastTimeout();
pageHidden = false;
wipeEveryCanvas();
runDueCheck();
const recoveriesBeforeHiddenSilentReturn = canvasRecoveryCount();
runDueCheck();
check(
  recoveriesBeforeHiddenSilentReturn === recoveriesBeforeHiddenSilentLoss + 1,
  'a loss begun hidden recovers once on its timeout and not again while its sentinel reads blank',
);
check(
  canvasRecoveryCount() === recoveriesBeforeHiddenSilentReturn + 1,
  'a loss begun hidden repaints once when its sentinel holds again',
);
check(
  varietyTier() === FULL_VARIETY_TIER,
  'a loss begun hidden that ends through its sentinel keeps the tier',
);

/**
 * Armed, the first of these probes is refused a context and the second finds
 * its pixels gone, so one purge check asks for both a repaint and less memory.
 * The sentinel is left intact so the probes are the ones that are read.
 */
let refusedAndPurgedProbes = false;
registerPurgeProbe(() => {
  if (refusedAndPurgedProbes) throw new CanvasContextUnavailableError();
  return false;
});
registerPurgeProbe(() => refusedAndPurgedProbes);

/** Recoveries that repainted everything, as opposed to dropping caches for memory pressure. */
let repaintsRun = 0;
onCanvasRecovery((cause) => {
  if (cause === 'purged') repaintsRun++;
});

/** Repaints that ask for no less, each run with a surface refused beside it. */
const repaintsBesideMemoryPressure = [
  {
    label: "a loss begun hidden's restore",
    run: () => {
      outlastMemoryPressureSpacing();
      reportCanvasAllocationFailure();
      pageHidden = true;
      loseContexts();
      pageHidden = false;
      frameAfter(0);
      restoreContexts();
      frameAfter(0);
    },
  },
  {
    label: 'a back-forward cache thaw',
    run: () => {
      outlastMemoryPressureSpacing();
      reportCanvasAllocationFailure();
      firePersistedPageshow();
      frameAfter(0);
    },
  },
  {
    label: 'a purge found on returning to the foreground',
    run: () => {
      outlastMemoryPressureSpacing();
      fire(document, 'visibilitychange');
      refusedAndPurgedProbes = true;
      frameAfter(0);
      refusedAndPurgedProbes = false;
    },
  },
] as const;

const budgetScaleBeforeMerges = memoryBudgetScale();
for (const repaint of repaintsBesideMemoryPressure) {
  forceVarietyTier(FULL_VARIETY_TIER);
  const recoveriesBeforeMerge = canvasRecoveryCount();
  repaint.run();
  check(
    canvasRecoveryCount() === recoveriesBeforeMerge + 1,
    `memory pressure merged into ${repaint.label} runs one recovery`,
  );
  check(
    varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
    `memory pressure merged into ${repaint.label} steps the tier once`,
  );
  forceVarietyTier(MINIMAL_VARIETY_TIER);
  for (let merge = 0; merge < PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT; merge++) repaint.run();
  check(
    memoryBudgetScale() === budgetScaleBeforeMerges,
    `memory pressure merged into ${repaint.label} at the minimal tier never cuts the budgets`,
  );
}

forceVarietyTier(FULL_VARIETY_TIER);
outlastMemoryPressureSpacing();
reportCanvasAllocationFailure();
frameAfter(0);
reportCanvasAllocationFailure();
firePersistedPageshow();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'memory pressure merged into a repaint inside its spacing does not step the tier',
);

/** Runs a memory-pressure recovery now, so the frames after it are inside its spacing. */
function startMemoryPressureSpacing(): void {
  outlastMemoryPressureSpacing();
  reportCanvasAllocationFailure();
  frameAfter(0);
}

/** A frame on which a cache is refused a surface, as `noteDrawFailure` reports every frame. */
function frameWithRefusal(): void {
  reportCanvasAllocationFailure();
  frameAfter(FRAME_MS);
}

forceVarietyTier(FULL_VARIETY_TIER);
startMemoryPressureSpacing();
for (let frame = 0; frame < FRAMES_OF_REFUSALS; frame++) frameWithRefusal();
const recoveriesBeforeStarvedCheck = canvasRecoveryCount();
wipeEveryCanvas();
checkCanvasesSoon();
frameWithRefusal();
check(
  canvasRecoveryCount() === recoveriesBeforeStarvedCheck + 1,
  'a surface refused every frame inside the memory-pressure spacing does not starve the check',
);
paintEnvironmentArtNow();

forceVarietyTier(FULL_VARIETY_TIER);
startMemoryPressureSpacing();
loseSentinelPastTimeout();
wipeEveryCanvas();
checkCanvasesSoon();
frameWithRefusal();
const recoveriesBeforeStarvedReturn = canvasRecoveryCount();
checkCanvasesSoon();
frameWithRefusal();
check(
  canvasRecoveryCount() === recoveriesBeforeStarvedReturn + 1,
  'an overdue loss closes when its sentinel holds again, with a surface refused every frame',
);
paintEnvironmentArtNow();

// A loss closed on a refused sentinel whose context is in fact still lost is
// still one loss, however many checks find it lost.
forceVarietyTier(FULL_VARIETY_TIER);
const budgetScaleBeforeUnconfirmedClose = memoryBudgetScale();
refuseContexts = true;
loseSentinelPastTimeout();
refuseContexts = false;
runDueCheck();
for (let round = 0; round < CHECKS_TO_REACH_BUDGET_CUT; round++) {
  wipeEveryCanvas();
  runDueCheck();
}
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a loss closed on a refused sentinel and still lost steps the tier once, not at every check',
);
check(
  memoryBudgetScale() === budgetScaleBeforeUnconfirmedClose,
  'a loss closed on a refused sentinel and still lost never cuts the budgets',
);
const recoveriesBeforeUnconfirmedReturn = canvasRecoveryCount();
runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeUnconfirmedReturn + 1,
  'a loss closed on a refused sentinel repaints once when its sentinel holds',
);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a loss closed on a refused sentinel does not step the tier when its sentinel holds',
);
paintEnvironmentArtNow();
runDueCheck();
check(
  canvasRecoveryCount() === recoveriesBeforeUnconfirmedReturn + 1,
  'a loss closed on a refused sentinel stays closed once its sentinel holds',
);
wipeEveryCanvas();
runDueCheck();
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'a purge after that loss has closed steps the tier as a new one',
);
paintEnvironmentArtNow();

// A sentinel refused while a restore is overdue says memory is short, not that
// the context is still lost; once the loss closes, a refusal asks for less again.
forceVarietyTier(FULL_VARIETY_TIER);
refuseContexts = true;
loseSentinelPastTimeout();
runDueCheck();
runDueCheck();
refuseContexts = false;
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'an overdue loss whose sentinel is refused closes, so a later refusal steps the tier',
);
runDueCheck();
paintEnvironmentArtNow();

// The first loss's step is owed even when the next loss begins hidden before its frame.
forceVarietyTier(FULL_VARIETY_TIER);
loseContexts();
frameAfter(0);
restoreContexts();
pageHidden = true;
loseContexts();
pageHidden = false;
frameAfter(0);
frameAfter(CONTEXT_RESTORE_TIMEOUT_MS);
restoreContexts();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 1),
  'a loss restored as a hidden loss begins still steps the tier once',
);

// Two visible losses restored before one frame are two losses.
forceVarietyTier(FULL_VARIETY_TIER);
loseContexts();
frameAfter(0);
restoreContexts();
loseContexts();
frameAfter(0);
restoreContexts();
frameAfter(0);
check(
  varietyTier() === tierAfterSteps(FULL_VARIETY_TIER, 2),
  'two visible losses restored before one frame step the tier twice',
);
paintEnvironmentArtNow();

// A context that stays lost behind a sentinel refused at every check backs its
// checks off like any repeating purge, rather than repainting every other check.
refuseContexts = true;
loseSentinelPastTimeout();
refusedAndPurgedProbes = true;
const repaintsBeforeRefusedLoop = repaintsRun;
for (let interval = 0; interval < CHECKS_UNDER_PERSISTENT_REFUSAL; interval++) {
  frameAfter(CANVAS_PURGE_CHECK_INTERVAL_MS);
}
refusedAndPurgedProbes = false;
refuseContexts = false;
const refusedLoopRepaints = repaintsRun - repaintsBeforeRefusedLoop;
check(
  refusedLoopRepaints <= MAX_REPAINTS_UNDER_PERSISTENT_REFUSAL,
  `a loss behind a sentinel refused at every check repainted ${refusedLoopRepaints} times in ` +
    `${CHECKS_UNDER_PERSISTENT_REFUSAL} check intervals, at most ` +
    `${MAX_REPAINTS_UNDER_PERSISTENT_REFUSAL} allowed`,
);
runDueCheck();
runDueCheck();
paintEnvironmentArtNow();

// A live mob changes look only behind a purge's repaint, never on a lag step.
const lookContext = {
  ...liveSpawnContext('dev:spawn'),
  tier: FULL_VARIETY_TIER,
} satisfies SpawnContext;
const goblinFamily = MOB_KINDS.goblin.family;
const hawkfolkFamily = MOB_KINDS.hawkfolk.family;
const ratkinFamily = MOB_KINDS.raised_ratkin.family;
const lookGoblin = spawnMob('goblin', LOOK_TILE, gameMap, {
  ...lookContext,
  variant: unsharedLook(goblinFamily),
});
const lookHawkfolk = spawnMob('hawkfolk', LOOK_TILE, gameMap, {
  ...lookContext,
  variant: unsharedLook(hawkfolkFamily),
});
const lookRatkin = spawnMob('raised_ratkin', LOOK_TILE, gameMap, {
  ...lookContext,
  variant: unsharedLook(ratkinFamily),
});
const liveLookCases = [
  liveLookCase('goblin', lookGoblin, goblinFamily, () => lookGoblin.weapon),
  liveLookCase('Hawkfolk', lookHawkfolk, hawkfolkFamily, () => lookHawkfolk.toughLookId),
  liveLookCase('raised ratkin', lookRatkin, ratkinFamily, () => lookRatkin.look),
];
const sharedLooksTier = asVarietyTier(
  Math.max(...liveLookCases.map((entry) => entry.sharedFromTier)),
);
const tierBeforeSharing = sharedLooksTier === null ? null : asVarietyTier(sharedLooksTier - 1);
if (sharedLooksTier === null || tierBeforeSharing === null) {
  throw new Error('a family shares its look from the full tier, so nothing can be re-dressed');
}
forceVarietyTier(tierBeforeSharing);
stepVarietyTierDown();
for (const entry of liveLookCases) {
  check(
    entry.look() === entry.spawnedLook,
    `a lag step to the shared tier leaves a live ${entry.label}'s look alone`,
  );
}
forceVarietyTier(tierBeforeSharing);
runCanvasRecovery('purged');
check(varietyTier() === sharedLooksTier, 'the purge steps the tier to the shared tier');
for (const entry of liveLookCases) {
  check(
    entry.look() === entry.canonical,
    `a purge reaching the shared tier dresses a live ${entry.label} in its shared look`,
  );
  check(entry.mob.spawnTypeKey === entry.kind, `a re-dressed ${entry.label} keeps its kind`);
  check(entry.mob.hp === entry.hp, `a re-dressed ${entry.label} keeps its health`);
}
const sharedGoblinFigure = goblinFigure(goblinFamily.canonical);
check(
  isFigureStateQueued(sharedGoblinFigure, WARMED_GOBLIN_STATE) ||
    isFigureStateWarm(sharedGoblinFigure, WARMED_GOBLIN_STATE),
  "the shared goblin look's rows are warming after the purge",
);

// A purge warms a kind only where a living mob of it changed look: one already
// in the shared look, or a corpse, gives the cache nothing new to hold.
const deadGoblin = spawnMob('goblin', LOOK_TILE, gameMap, {
  ...lookContext,
  variant: unsharedLook(goblinFamily),
});
deadGoblin.hp = 0;
runCanvasRecovery('purged', null);
check(
  !isFigureStateQueued(sharedGoblinFigure, WARMED_GOBLIN_STATE) &&
    !isFigureStateWarm(sharedGoblinFigure, WARMED_GOBLIN_STATE),
  'a purge with every living mob already in its shared look warms nothing',
);
check(deadGoblin.weapon !== goblinFamily.canonical, 'a purge leaves a dead goblin in its own look');

// A purge repaints only what was drawn lately.
const [drawnSheet, idleSheet] = GROUND_SHEET_KEYS;
paintEnvironmentArtNow();
check(
  hasEnvironmentSheet(drawnSheet) && hasEnvironmentSheet(idleSheet),
  'both sheets are resident before the purge',
);
for (let frame = 0; frame <= RECENTLY_DRAWN_FRAMES; frame++) beginRenderFrame();
getSpriteDefByKey(drawnSheet);
runCanvasRecovery('purged');
paintEnvironmentArtNow();
check(hasEnvironmentSheet(drawnSheet), 'a sheet drawn lately is repainted after a purge');
check(!hasEnvironmentSheet(idleSheet), 'a sheet not drawn lately is not repainted after a purge');
getSpriteDefByKey(idleSheet);
paintEnvironmentArtNow();
check(hasEnvironmentSheet(idleSheet), 'a sheet left out of the repaint paints when looked up');

// Budgets are the last thing given up: only purges at the minimal tier cut them.
const tierBelowMinimal = asVarietyTier(MINIMAL_VARIETY_TIER - 1);
if (tierBelowMinimal === null) throw new Error('the minimal tier has no tier above it');
forceVarietyTier(tierBelowMinimal);
const deviceScale = deviceMemoryBudgetScale();
loseAndRestore();
check(varietyTier() === MINIMAL_VARIETY_TIER, 'a loss steps the tier down to the minimal tier');
check(
  memoryBudgetScale() === deviceScale,
  'the purge that reaches the minimal tier keeps the budgets',
);
runCanvasRecovery('memoryPressure');
check(memoryBudgetScale() === deviceScale, 'memory pressure never cuts the budgets');
for (let purge = 1; purge < PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT; purge++) {
  loseAndRestore();
  check(
    memoryBudgetScale() === deviceScale,
    `purge ${purge} at the minimal tier keeps the budgets`,
  );
}
for (let thaw = 0; thaw < PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT; thaw++) {
  firePersistedPageshow();
  frameAfter(0);
}
check(
  memoryBudgetScale() === deviceScale,
  'back-forward cache thaws at the minimal tier never cut the budgets',
);
loseAndRestore();
check(
  memoryBudgetScale() < deviceScale,
  `purge ${PURGES_AT_MINIMAL_TIER_BEFORE_BUDGET_CUT} at the minimal tier cuts the budgets`,
);
check(deviceMemoryBudgetScale() === deviceScale, "the cut leaves the device's own share unchanged");

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nverify-canvas-recovery: all checks passed');
