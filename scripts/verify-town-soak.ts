#!/usr/bin/env tsx
/**
 * Soak test for the town: arrive, then go in and out of buildings many times,
 * and assert that nothing the round trip touches accumulates.
 *
 * Runs the game's real `SceneManager`, `DungeonScene` and
 * `BuildingInteriorScene` headless behind a recording browser shim
 * (`browserShim.ts`), ticking the real frame loop by hand. The party walks onto
 * a door with the movement keys, accepts the door menu with Space through the
 * same capture-phase handler a browser delivers it to, walks around inside,
 * walks onto the exit mat, accepts with Space, and walks around outside again.
 *
 * Every building exit builds a whole new `DungeonScene` around the same map, so
 * anything a scene registers with something longer-lived — a window listener,
 * a pinned figure row, a prewarm request, a timer, the render-quality probe's
 * loading cover — is added again on every trip unless the outgoing scene gives
 * it back. After each trip this records, and at the end asserts flat:
 *
 *  - frame cost (update and render, measured around the scene's own methods);
 *  - the figure cache's prewarm queue, resident bytes and pinned rows;
 *  - listeners left on `window`, `document` and the canvas;
 *  - how many scenes are still reachable after a full GC (a scene that is still
 *    reachable after it was replaced is a leak of everything it owns);
 *  - that no frame threw, the idle sweep is not left held, and the loading
 *    cover is not left on;
 *  - that no prewarm is given up on for a row something is drawing. Rows
 *    warmed speculatively for the map's wild mobs yield to a cache full of
 *    the crowd, by design, and are only counted.
 *
 * Node's canvas costs are not a browser's, so frame times here are compared
 * with themselves across the soak rather than against a budget.
 *
 *   npm run verify:town-soak
 *   npx tsx scripts/verify-town-soak.ts --cycles=5          # shorter run
 *   npx tsx scripts/verify-town-soak.ts --dpr=1             # a 1x display
 */

import type { Scene } from '../src/core/Scene.js';
import type { BuildingEntry } from '../src/map/OverworldGenerator.js';
import { installBrowserShim, ShimEvent } from './browserShim.js';

/**
 * A Retina display by default, as the game is played on: below a ratio of 2
 * the figure cache bakes every cell at half density, a quarter of the bytes,
 * which would hide any pressure on its budget.
 */
const RETINA_DEVICE_PIXEL_RATIO = 2;
const dprArg = process.argv.find((arg) => arg.startsWith('--dpr='));
const VIEWPORT = {
  width: 1280,
  height: 720,
  devicePixelRatio:
    dprArg === undefined ? RETINA_DEVICE_PIXEL_RATIO : Number(dprArg.slice('--dpr='.length)),
} as const;
const shim = installBrowserShim(VIEWPORT);

const WORLD_SEED = 1;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { renderQuality } = await import('../src/core/RenderQuality.js');
const { environmentPaintDepth } = await import('../src/map/environmentArtCache.js');
const {
  CACHE_BYTE_BUDGET,
  figurePrewarmDepth,
  figurePrewarmGiveUps,
  pinnedFigureRowCount,
  pinnedFigureFootprint,
  isFigureIdleSweepHeld,
} = await import('../src/sprites/figure/figureFrameCache.js');
const { setFigureCacheStatsRecording, getFigureCacheStats } =
  await import('../src/sprites/figure/figureCacheStats.js');
const { BIG_TOP_BUILDING_NAME } = await import('../src/core/CircusQuestProgress.js');
const { menuFocusContextId } = await import('../src/ui/Button.js');

const cyclesArg = process.argv.find((arg) => arg.startsWith('--cycles='));
const DEFAULT_TRIPS = 20;
const CYCLES =
  cyclesArg === undefined ? DEFAULT_TRIPS : Number(cyclesArg.slice('--cycles='.length));
const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const FRAME_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
/** Frames the arrival's loading screen may take before the soak calls it hung. */
const MAX_ARRIVAL_FRAMES = 3000;
/** Frames of play after the arrival settles, before the first trip. */
const SETTLE_FRAMES = 60;
/** Frames a walk onto a door or an exit mat may take. */
const MAX_WALK_FRAMES = 90;
/** Frames spent walking about inside, and again outside, on each trip. */
const WANDER_FRAMES = 40;
/** Frames the party stands still after a scene change before it is driven. */
const ARRIVAL_PAUSE_FRAMES = 5;
/** The first and last trips compared for drift. */
const COMPARE_WINDOW = 5;
/**
 * How much slower the last trips' frames may be than the first trips'. Loose,
 * because it is a timing on a shared machine: it exists to catch cost that
 * grows with every trip, which after twenty trips is multiples, not percent.
 */
const MAX_FRAME_COST_GROWTH = 1.5;
/** Absolute slack on the frame-cost comparison, for a fast baseline. */
const FRAME_COST_SLACK_MS = 5;
/** A prewarm backlog this small passes however it compares with earlier trips. */
const MAX_SETTLED_PREWARM_DEPTH = 64;
/** How far the late trips' prewarm backlog may exceed the earlier trips' peak. */
const MAX_PREWARM_BACKLOG_GROWTH = 1.25;
/**
 * How far the pin set may exceed the first trip's. Each rebuilt town pins its
 * own freshly rolled crowd, so the count wanders with which looks were drawn;
 * a scene that never gave its pins back adds a whole crowd's worth per trip.
 */
const MAX_PIN_GROWTH = 2;
/** Growth in resident figure-cache bytes allowed once the cache has levelled off. */
const MAX_CACHE_GROWTH_MEGABYTES = 16;
/**
 * The town scene now running, the interior it was built from, and the town
 * scene before that, whose exit callback the interior holds until the next
 * trip replaces both. A fourth is a scene nothing will ever let go of.
 */
const MAX_LIVE_SCENES = 3;
/** The focus rings the door menu and the exit-mat menu declare. */
const DOOR_MENU_FOCUS = 'building-entry';
const EXIT_MENU_FOCUS = 'exit-building';
/** Every conversation page and row declares a ring under this prefix. */
const CONVERSATION_FOCUS_PREFIX = 'quest-dialog';
/** Escapes tried on one conversation before the trip gives up on it. */
const MAX_CONVERSATION_DISMISSALS = 8;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MAX_CACHE_GROWTH_BYTES = MAX_CACHE_GROWTH_MEGABYTES * BYTES_PER_MEGABYTE;
const MS_PLACES = 1;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

await loadSprites('src/images/');

const input = new InputManager();
const sceneManager = new SceneManager();

// ── Scene tracking and per-scene timing ─────────────────────────────────────

/** Whether an object is still reachable, without keeping it so. */
interface WeakHandle {
  readonly alive: () => boolean;
}

/**
 * A `WeakRef`, reached through the global because the scripts' `lib` predates
 * it; Node has had it since 14.
 */
function weakHandle(target: object): WeakHandle {
  const WeakRefConstructor: unknown = Reflect.get(globalThis, 'WeakRef');
  if (typeof WeakRefConstructor !== 'function') throw new Error('this Node has no WeakRef');
  const ref: unknown = Reflect.construct(WeakRefConstructor, [target]);
  const deref: unknown = typeof ref === 'object' && ref !== null ? Reflect.get(ref, 'deref') : null;
  if (typeof deref !== 'function') throw new Error('WeakRef has no deref');
  return { alive: () => Reflect.apply(deref, ref, []) !== undefined };
}

let current: Scene | null = null;
const constructed: WeakHandle[] = [];
let updateMs = 0;
let renderMs = 0;

function instrument(scene: Scene): void {
  const update = scene.update.bind(scene);
  const render = scene.render.bind(scene);
  scene.update = () => {
    const startedAt = performance.now();
    try {
      update();
    } finally {
      updateMs += performance.now() - startedAt;
    }
  };
  scene.render = (ctx) => {
    const startedAt = performance.now();
    try {
      render(ctx);
    } finally {
      renderMs += performance.now() - startedAt;
    }
  };
}

const replace = sceneManager.replace.bind(sceneManager);
sceneManager.replace = (scene: Scene) => {
  instrument(scene);
  constructed.push(weakHandle(scene));
  current = scene;
  replace(scene);
};

// ── Frame and input driving ─────────────────────────────────────────────────

let clockMs = 0;
const thrown: string[] = [];

/** Lets promise callbacks run, as a browser does between frames. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function runFrame(): Promise<void> {
  await yieldToEventLoop();
  clockMs += FRAME_MS;
  try {
    shim.runAnimationFrame(clockMs);
  } catch (error) {
    thrown.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  const stats = getFigureCacheStats();
  cacheWork.lazyBakes += stats.bakes;
  cacheWork.directDraws += stats.directDraws;
  cacheWork.approxDraws += stats.approxDraws;
  cacheWork.evictions += stats.evictions;
}

/** Render-path figure work summed since the last reset: what a warm cache never does. */
const cacheWork = { lazyBakes: 0, directDraws: 0, approxDraws: 0, evictions: 0 };
function resetCacheWork(): void {
  cacheWork.lazyBakes = 0;
  cacheWork.directDraws = 0;
  cacheWork.approxDraws = 0;
  cacheWork.evictions = 0;
}

function key(type: 'keydown' | 'keyup', name: string): void {
  shim.window.dispatch(new ShimEvent(type, name, clockMs));
}

async function press(name: string): Promise<void> {
  key('keydown', name);
  await runFrame();
  key('keyup', name);
  await runFrame();
}

/** Holds `name` until `done` says so or `maxFrames` pass. Returns whether `done` came true. */
async function holdUntil(name: string, maxFrames: number, done: () => boolean): Promise<boolean> {
  key('keydown', name);
  let reached = false;
  for (let frame = 0; frame < maxFrames; frame++) {
    await runFrame();
    if (done()) {
      reached = true;
      break;
    }
  }
  key('keyup', name);
  await runFrame();
  return reached;
}

async function runFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame++) await runFrame();
}

async function wander(): Promise<void> {
  await holdUntil('a', WANDER_FRAMES / 2, () => false);
  await holdUntil('d', WANDER_FRAMES / 2, () => false);
}

/**
 * Walks away from whatever conversation greeted the party — the club's
 * doorman stops everyone who comes in — with Escape, the key that always
 * leaves one.
 */
async function dismissConversations(): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONVERSATION_DISMISSALS; attempt++) {
    if (menuFocusContextId()?.startsWith(CONVERSATION_FOCUS_PREFIX) !== true) return;
    await press('Escape');
  }
}

function currentScene(): Scene {
  if (current === null) throw new Error('no scene is running');
  return current;
}

// ── The town, and the doors to walk through ─────────────────────────────────

const twinMap = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
// The Big Top is sealed until its questline opens it.
const doors = twinMap.buildingEntries.filter((entry) => entry.name !== BIG_TOP_BUILDING_NAME);
check(doors.length > 0, 'the town has no doors to walk through');

sceneManager.replace(
  new DungeonScene(level3, input, sceneManager, { worldSeed: WORLD_SEED, skipIntro: true }),
);

let arrivalFrames = 0;
while (
  arrivalFrames < MAX_ARRIVAL_FRAMES &&
  (environmentPaintDepth() > 0 || figurePrewarmDepth() > 0 || renderQuality.isLoadingCovered)
) {
  await runFrame();
  arrivalFrames++;
}
check(
  arrivalFrames < MAX_ARRIVAL_FRAMES,
  `the arrival never settled in ${MAX_ARRIVAL_FRAMES} frames`,
);
await runFrames(SETTLE_FRAMES);
setFigureCacheStatsRecording(true);

interface CycleSample {
  readonly door: string;
  readonly frameMs: number;
  readonly updateMs: number;
  readonly renderMs: number;
  readonly prewarmDepth: number;
  readonly cacheBytes: number;
  readonly pinnedRows: number;
  readonly pinnedMegabytes: number;
  /** Frames the exit's loading screen stayed up, 0 when the exit owed none. */
  readonly exitLoadFrames: number;
  /** Cells baked on the render path, and painted straight into the frame, while walking about inside. */
  readonly indoorLazyBakes: number;
  readonly indoorDirectDraws: number;
  readonly lazyBakes: number;
  readonly directDraws: number;
  readonly approxDraws: number;
  readonly evictions: number;
  readonly windowListeners: number;
  readonly documentListeners: number;
  readonly liveScenes: number;
}

function liveSceneCount(): number {
  const collect: unknown = Reflect.get(globalThis, 'gc');
  if (typeof collect === 'function') Reflect.apply(collect, undefined, []);
  const alive = constructed.flatMap((handle, index) => (handle.alive() ? [index] : []));
  if (process.env.SOAK_DEBUG !== undefined) console.log('alive scenes', alive.join(','));
  return alive.length;
}

/** Stands the party on the tile south of `door`, facing it. */
function placePartyBelow(door: { readonly x: number; readonly y: number }): void {
  const scene = currentScene();
  if (!(scene instanceof DungeonScene)) throw new Error('not outdoors');
  const { human, cat } = scene.pm;
  human.x = door.x * TILE_SIZE;
  human.y = (door.y + 1) * TILE_SIZE;
  cat.x = door.x * TILE_SIZE;
  cat.y = (door.y + 2) * TILE_SIZE;
}

const samples: CycleSample[] = [];
const hasGc = typeof Reflect.get(globalThis, 'gc') === 'function';

const unreachableDoors = new Set<string>();

/**
 * Walks up to one door after another, from `firstIndex`, until a door menu
 * opens. A door can be out of reach from the tile below it — a market stall or
 * a crowd of townsfolk the twin map knows nothing about — which says nothing
 * about the round trip, so the next door is tried instead.
 */
async function walkOntoSomeDoor(firstIndex: number): Promise<BuildingEntry | null> {
  for (let offset = 0; offset < doors.length; offset++) {
    const door = doors[(firstIndex + offset) % doors.length];
    if (unreachableDoors.has(door.name)) continue;
    placePartyBelow(door.doorTile);
    await runFrames(ARRIVAL_PAUSE_FRAMES);
    const opened = await holdUntil(
      'w',
      MAX_WALK_FRAMES,
      () => menuFocusContextId() === DOOR_MENU_FOCUS,
    );
    if (opened) return door;
    unreachableDoors.add(door.name);
  }
  return null;
}

for (let cycle = 0; cycle < CYCLES; cycle++) {
  const outdoors = currentScene();
  const door = await walkOntoSomeDoor(cycle);
  if (door === null) {
    failures.push(`trip ${cycle}: no door in town could be walked onto`);
    break;
  }
  await press(' ');
  if (!(currentScene() instanceof BuildingInteriorScene)) {
    failures.push(`trip ${cycle}: Space on the door of ${door.name} did not go inside`);
    break;
  }
  await runFrames(ARRIVAL_PAUSE_FRAMES);
  await dismissConversations();
  const interior = currentScene();
  if (!(interior instanceof BuildingInteriorScene)) throw new Error('not indoors');
  // The party is set down on the doorstep inside, just north of the mat; the
  // wander can leave it anywhere, so it is put back there before walking out.
  const doorstep = { x: interior.pm.human.x, y: interior.pm.human.y };
  resetCacheWork();
  await wander();
  const indoorCacheWork = { ...cacheWork };
  interior.pm.human.x = doorstep.x;
  interior.pm.human.y = doorstep.y;
  await dismissConversations();
  const onMat = await holdUntil(
    's',
    MAX_WALK_FRAMES,
    () => menuFocusContextId() === EXIT_MENU_FOCUS,
  );
  if (onMat) await press(' ');
  const leftBuilding = currentScene() !== interior;
  if (!leftBuilding || !(currentScene() instanceof DungeonScene)) {
    failures.push(`trip ${cycle}: could not walk out of ${door.name}`);
    break;
  }
  check(currentScene() !== outdoors, `trip ${cycle}: the exit did not rebuild the town scene`);
  let exitLoadFrames = 0;
  while (renderQuality.isLoadingCovered && exitLoadFrames < MAX_ARRIVAL_FRAMES) {
    await runFrame();
    exitLoadFrames++;
  }
  await runFrames(ARRIVAL_PAUSE_FRAMES);

  updateMs = 0;
  renderMs = 0;
  resetCacheWork();
  let measuredFrames = 0;
  const measureStart = performance.now();
  const countFrames = (): boolean => {
    measuredFrames++;
    return false;
  };
  await holdUntil('a', WANDER_FRAMES / 2, countFrames);
  await holdUntil('d', WANDER_FRAMES / 2, countFrames);
  const elapsed = performance.now() - measureStart;
  const frames = Math.max(1, measuredFrames);
  const stats = getFigureCacheStats();
  samples.push({
    door: door.name,
    frameMs: elapsed / frames,
    updateMs: updateMs / frames,
    renderMs: renderMs / frames,
    prewarmDepth: figurePrewarmDepth(),
    cacheBytes: stats.bytes,
    pinnedRows: pinnedFigureRowCount(),
    pinnedMegabytes: pinnedFigureFootprint().bytes / BYTES_PER_MEGABYTE,
    exitLoadFrames,
    indoorLazyBakes: indoorCacheWork.lazyBakes,
    indoorDirectDraws: indoorCacheWork.directDraws,
    ...cacheWork,
    windowListeners: shim.window.listenerTotal,
    documentListeners: shim.document.listenerTotal,
    liveScenes: liveSceneCount(),
  });
}

// ── Verdict ─────────────────────────────────────────────────────────────────

const giveUps = figurePrewarmGiveUps();
check(
  giveUps.drawnAbandons === 0,
  `${giveUps.drawnAbandons} prewarm(s) were given up on for a row on screen or one no cache could hold`,
);
check(thrown.length === 0, `${thrown.length} frame(s) threw; first:\n${thrown[0] ?? ''}`);
check(!isFigureIdleSweepHeld(), 'the figure idle sweep was left held');
check(!renderQuality.isLoadingCovered, 'the render-quality loading cover was left on');
check(samples.length === CYCLES, `only ${samples.length} of ${CYCLES} trips completed`);

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (samples.length >= COMPARE_WINDOW * 2) {
  const first = samples.slice(0, COMPARE_WINDOW);
  const last = samples.slice(-COMPARE_WINDOW);
  const firstCost = mean(first.map((sample) => sample.updateMs + sample.renderMs));
  const lastCost = mean(last.map((sample) => sample.updateMs + sample.renderMs));
  check(
    lastCost <= firstCost * MAX_FRAME_COST_GROWTH + FRAME_COST_SLACK_MS,
    `frame cost grew from ${firstCost.toFixed(MS_PLACES)} ms to ${lastCost.toFixed(MS_PLACES)} ms over the soak`,
  );
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MS_PLACES);
}

// The cache fills as the soak meets looks it has not drawn yet, then levels
// off; a leak keeps climbing. So the last trips are compared with the highest
// the cache reached before them, not with the first trip.
// Each rebuilt town queues its wild mobs' speculative rows again, and in a full
// cache the ones with no free room wait out their retries; that backlog is
// bounded by the rows there are to ask for. A leak is a backlog that climbs.
if (samples.length > COMPARE_WINDOW) {
  const earlierDepth = Math.max(
    ...samples.slice(0, -COMPARE_WINDOW).map((sample) => sample.prewarmDepth),
  );
  const lateDepth = Math.max(
    ...samples.slice(-COMPARE_WINDOW).map((sample) => sample.prewarmDepth),
  );
  check(
    lateDepth <= Math.max(earlierDepth * MAX_PREWARM_BACKLOG_GROWTH, MAX_SETTLED_PREWARM_DEPTH),
    `the prewarm backlog kept growing: ${lateDepth} requests in the last ${COMPARE_WINDOW} trips ` +
      `against ${earlierDepth} before them`,
  );
}

if (samples.length > COMPARE_WINDOW) {
  const earlierPeak = Math.max(
    ...samples.slice(0, -COMPARE_WINDOW).map((sample) => sample.cacheBytes),
  );
  const latePeak = Math.max(...samples.slice(-COMPARE_WINDOW).map((sample) => sample.cacheBytes));
  check(
    latePeak <= earlierPeak + MAX_CACHE_GROWTH_BYTES,
    `the figure cache kept growing: ${megabytes(latePeak)} MB in the last ${COMPARE_WINDOW} trips ` +
      `against a peak of ${megabytes(earlierPeak)} MB before them`,
  );
}

if (samples.length > 0) {
  const baseline = samples[0];
  for (const [index, sample] of samples.entries()) {
    check(
      sample.pinnedRows <= baseline.pinnedRows * MAX_PIN_GROWTH,
      `trip ${index}: ${sample.pinnedRows} pinned rows, up from ${baseline.pinnedRows}`,
    );
    check(
      sample.windowListeners <= baseline.windowListeners,
      `trip ${index}: ${sample.windowListeners} window listeners, up from ${baseline.windowListeners}`,
    );
    check(
      sample.documentListeners <= baseline.documentListeners,
      `trip ${index}: ${sample.documentListeners} document listeners, up from ${baseline.documentListeners}`,
    );
    check(
      sample.cacheBytes <= CACHE_BYTE_BUDGET,
      `trip ${index}: figure cache at ${megabytes(sample.cacheBytes)} MB, over its ${megabytes(CACHE_BYTE_BUDGET)} MB budget`,
    );
    check(
      sample.exitLoadFrames === 0,
      `trip ${index}: walking out of ${sample.door} put the loading screen up for ${sample.exitLoadFrames} frames`,
    );
    if (hasGc) {
      check(
        sample.liveScenes <= MAX_LIVE_SCENES,
        `trip ${index}: ${sample.liveScenes} scenes still reachable after a full GC`,
      );
    }
  }
}

console.log(`town soak — ${samples.length} trips, arrival settled in ${arrivalFrames} frames`);
/** Each column's heading, and the cell it prints for one trip. */
const COLUMNS: ReadonlyArray<readonly [string, (sample: CycleSample, index: number) => string]> = [
  ['trip', (_, index) => String(index)],
  ['frame ms', (sample) => sample.frameMs.toFixed(MS_PLACES)],
  ['update', (sample) => sample.updateMs.toFixed(MS_PLACES)],
  ['render', (sample) => sample.renderMs.toFixed(MS_PLACES)],
  ['prewarm', (sample) => String(sample.prewarmDepth)],
  ['cache MB', (sample) => megabytes(sample.cacheBytes)],
  ['pins', (sample) => String(sample.pinnedRows)],
  ['pin MB', (sample) => sample.pinnedMegabytes.toFixed(MS_PLACES)],
  ['exit load', (sample) => String(sample.exitLoadFrames)],
  ['in lazy', (sample) => String(sample.indoorLazyBakes)],
  ['in direct', (sample) => String(sample.indoorDirectDraws)],
  ['lazy', (sample) => String(sample.lazyBakes)],
  ['direct', (sample) => String(sample.directDraws)],
  ['approx', (sample) => String(sample.approxDraws)],
  ['evict', (sample) => String(sample.evictions)],
  ['win', (sample) => String(sample.windowListeners)],
  ['doc', (sample) => String(sample.documentListeners)],
  ['scenes', (sample) => (hasGc ? String(sample.liveScenes) : '-')],
];
console.log([...COLUMNS.map(([heading]) => heading), 'door'].join('  '));
for (const [index, sample] of samples.entries()) {
  const cells = COLUMNS.map(([heading, cell]) => cell(sample, index).padStart(heading.length));
  console.log([...cells, sample.door].join('  '));
}
if (unreachableDoors.size > 0) {
  console.log(`  doors not reachable from the tile below: ${[...unreachableDoors].join(', ')}`);
}
console.log(
  `  speculative prewarms that yielded to a full cache: ${giveUps.speculativeYields}; ` +
    `given up on while drawn: ${giveUps.drawnAbandons}`,
);
if (!hasGc) console.log('  (run under --expose-gc to count reachable scenes)');

if (failures.length > 0) {
  console.error(`FAIL verify:town-soak`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('PASS verify:town-soak');
process.exit(0);
