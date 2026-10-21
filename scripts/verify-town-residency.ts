#!/usr/bin/env tsx
/**
 * Far from town, the town's crowd rows give way to a fight that needs the
 * figure cache's room; every way back to the crowd finds its rows in place.
 *
 * Runs the real `SceneManager` and `DungeonScene` headless behind the browser
 * shim, booted at Briar Hollow, at a Retina pixel ratio so the figure cache
 * bakes at full density. A stand-in for a siege wave — a set of large,
 * cheaply painted figures — is drawn every frame while the party stands at
 * the far side of the village. Then, each after its own wave:
 *
 *  - **the wave** settles into the cache: in its last second no cell of its
 *    own misses, so the crowd off screen gave it room rather than leaving it
 *    to evict itself;
 *  - **the walk home**, in a straight line at the fastest walk there is (Speed
 *    Fizz with the stall's boon), one gameplay update per rendered frame;
 *  - **a death** far from town with the last save in the plaza, the death
 *    screen's button pressed every frame until it answers;
 *  - **a recall** to town from the far stand: once with the wave gone, its
 *    channel never raising the prewarm budget, since the channel is played
 *    through; once with the wave drawn on through the channel, when the
 *    landing must come in behind the loading screen; and once with a heavier
 *    wave pinned in place, so no room can be made even under the screen,
 *    which must still lift;
 *  - **a switch** to the other crawler, left standing in the plaza.
 *
 * After each of these but the last recall, no citizen is drawn as a stand-in or painted
 * live. Every check is a count. The figure cache bakes against a simulated
 * clock that charges each cell what a citizen cell costs in node, several
 * times a browser's cost, so the rewarm here is slower than it is in play.
 *
 *   npm run verify:town-residency
 */

import type { Scene } from '../src/core/Scene.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { installBrowserShim, ShimEvent } from './browserShim.js';

const RETINA_DEVICE_PIXEL_RATIO = 2;
const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: RETINA_DEVICE_PIXEL_RATIO } as const;
const shim = installBrowserShim(VIEWPORT);

const WORLD_SEED = 7919;
const windowShim: unknown = Reflect.get(globalThis, 'window');
const shimLocation: unknown =
  typeof windowShim === 'object' && windowShim !== null
    ? Reflect.get(windowShim, 'location')
    : undefined;
if (typeof shimLocation !== 'object' || shimLocation === null) {
  throw new Error('the browser shim has no window.location');
}
Reflect.set(shimLocation, 'search', `?playtest=briar-hollow-village&seed=${WORLD_SEED}`);

const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { createCanvas } = await import('canvas');
const { PLAYER_SPEED, TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { TownLifeSystem } = await import('../src/systems/TownLifeSystem.js');
const { RecallSystem } = await import('../src/systems/RecallSystem.js');
const { MarketSystem } = await import('../src/systems/market/MarketSystem.js');
const { devBootScene } = await import('../src/dev/devBoot.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { renderQuality } = await import('../src/core/RenderQuality.js');
const { SPEED_FIZZ_MULTIPLIER } = await import('../src/Player.js');
const { REFRESHED_SPEED_FACTOR } = await import('../src/core/StatusEffect.js');
const { citizenFigureRows } = await import('../src/creatures/citizenFigure.js');
const { figureStates } = await import('../src/sprites/figure/figureDef.js');
const { environmentPaintDepth } = await import('../src/map/environmentArtCache.js');
const {
  PREWARM_BAKE_BUDGET_MS,
  figurePrewarmBudgetMs,
  pinFigureState,
  unpinFigureState,
  setFigureBakeClock,
  drawFigureCached,
  figurePrewarmDepth,
  figureResidentBytes,
  onFigureUnbakedDraw,
} = await import('../src/sprites/figure/figureFrameCache.js');

const MS_PER_SECOND = 1000;
const FRAMES_PER_SECOND = 60;
const FRAME_MS = MS_PER_SECOND / FRAMES_PER_SECOND;
/** Frames the boot's loading screen may take before the run calls it hung. */
const MAX_ARRIVAL_FRAMES = 4000;
/** Tiles inside the village's north wall the far stand is taken at. */
const FAR_STAND_INSET_TILES = 3;
/** Frames the first stand-in wave is drawn for, and the last of them it must draw without a miss. */
const WAVE_FRAMES = 900;
/** Frames each later wave is drawn for: long enough to take the crowd's room again. */
const LATER_WAVE_FRAMES = 600;
const WAVE_SETTLED_FRAMES = 60;
/**
 * The stand-in wave: enough distinct figures that the crowd's rows, the party's
 * and the wave's cannot all fit the cache at once, and few enough that the
 * party's and the wave's can.
 */
const WAVE_FIGURE_COUNT = 9;
const HEAVY_WAVE_FIGURE_COUNT = 14;
const WAVE_ROW_FRAMES = 8;
const WAVE_CELL_PX = 384;
const WAVE_TILE_SCALE = 64;
const WAVE_STATES = ['walk', 'attack'] as const;
/** Where on the scratch canvas the wave is drawn: anywhere, since nothing reads it. */
const WAVE_DRAW_ORIGIN_PX = 0;
/** Frames counted in the plaza after each way back. */
const SETTLED_STAND_FRAMES = 120;
/** Frames a death, a respawn or a recall may take before the run calls it stuck. */
const MAX_WARP_WAIT_FRAMES = 3000;
const FASTEST_WALK_PX_PER_UPDATE = PLAYER_SPEED * SPEED_FIZZ_MULTIPLIER * REFRESHED_SPEED_FACTOR;
const RESPAWN_KEY = 'Enter';
const SWITCH_KEY = 'Tab';
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MEGABYTE_PLACES = 1;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/**
 * Simulated milliseconds each read of the figure cache's bake clock advances
 * it by. A bake reads it once before painting and once after, so every cell
 * costs twice this — three milliseconds, about what a citizen cell costs in
 * node and several times what it costs in a browser — whatever the machine
 * is doing, so the rewarm's pacing, and every count riding on it, is a
 * property of the code alone.
 */
const SIMULATED_MS_PER_BAKE_CLOCK_READ = 1.5;
let simulatedBakeClockMs = 0;
setFigureBakeClock(() => {
  simulatedBakeClockMs += SIMULATED_MS_PER_BAKE_CLOCK_READ;
  return simulatedBakeClockMs;
});

await loadSprites('src/images/');
const sceneManager = new SceneManager();
let currentScene: Scene | null = null;
const replaceScene = sceneManager.replace.bind(sceneManager);
sceneManager.replace = (next: Scene) => {
  currentScene = next;
  replaceScene(next);
};
if (!devBootScene(sceneManager, new InputManager(), {})) {
  throw new Error('the dev boot did not run');
}

let clockMs = 0;
async function runFrame(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  clockMs += FRAME_MS;
  shim.runAnimationFrame(clockMs);
}

function key(type: 'keydown' | 'keyup', name: string): void {
  shim.window.dispatch(new ShimEvent(type, name, clockMs));
}

function scene(): InstanceType<typeof DungeonScene> {
  const current = currentScene;
  if (!(current instanceof DungeonScene)) throw new Error('the overworld is not running');
  return current;
}

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

const twin = new GameMap({
  mapSize: level3.mapSize,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const plan = twin.townPlan;
const site = twin.briarHollow;
if (plan === undefined || site === null) {
  throw new Error(`seed ${WORLD_SEED} has no town or village`);
}
const farX = site.centre.x * TILE_SIZE;
const farY = (site.palisadeBounds.y + FAR_STAND_INSET_TILES) * TILE_SIZE;
const homeX = plan.centre.x * TILE_SIZE;
const homeY = plan.centre.y * TILE_SIZE;

const townLife: unknown = Reflect.get(scene(), 'townLife');
if (!(townLife instanceof TownLifeSystem)) throw new Error('the overworld has no town crowd');
const market: unknown = Reflect.get(scene(), 'market');
if (!(market instanceof MarketSystem)) throw new Error('the overworld has no market');
const crowdFigures = new Map<string, FigureDef>();
for (const person of [...townLife.people, ...market.vendors]) {
  for (const row of citizenFigureRows(person.figure)) crowdFigures.set(row.def.id, row.def);
}
function crowdBytes(): number {
  let bytes = 0;
  for (const def of crowdFigures.values()) bytes += figureResidentBytes(def);
  return bytes;
}
function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);
}

let citizenUnbakedDraws = 0;
onFigureUnbakedDraw((def) => {
  if (crowdFigures.has(def.id)) citizenUnbakedDraws++;
});

function placeHuman(x: number, y: number): void {
  const { human } = scene().pm;
  human.x = x;
  human.y = y;
}
function placeCat(x: number, y: number): void {
  const { cat } = scene().pm;
  cat.x = x;
  cat.y = y;
}
function placeParty(x: number, y: number): void {
  placeHuman(x, y);
  placeCat(x + TILE_SIZE, y);
}

// ── The stand-in wave ────────────────────────────────────────────────────────

function waveFigure(index: number): FigureDef {
  return {
    id: `residency_wave_${index}`,
    frameWidth: WAVE_CELL_PX,
    frameHeight: WAVE_CELL_PX,
    tileX: (WAVE_CELL_PX - WAVE_TILE_SCALE) / 2,
    tileY: WAVE_CELL_PX - WAVE_TILE_SCALE,
    tileScale: WAVE_TILE_SCALE,
    skipSupersample: true,
    states: figureStates({ walk: WAVE_ROW_FRAMES, attack: WAVE_ROW_FRAMES }),
    paintFrame: (ctx, _state, frame) => {
      ctx.fillRect(frame, frame, WAVE_CELL_PX / 2, WAVE_CELL_PX / 2);
    },
  };
}
const waveFigures = Array.from({ length: WAVE_FIGURE_COUNT }, (_, index) => waveFigure(index));
/**
 * A wave too large to leave the crowd any room even once it stops: pinned,
 * it stands for a cache that cannot make room under a warp's loading screen.
 */
const heavyWaveFigures = Array.from({ length: HEAVY_WAVE_FIGURE_COUNT }, (_, index) =>
  waveFigure(index),
);
const waveContext = createCanvas(WAVE_CELL_PX, WAVE_CELL_PX).getContext('2d');
const waveIds = new Set(waveFigures.map((figure) => figure.id));
let waveUnbakedDraws = 0;
onFigureUnbakedDraw((def) => {
  if (waveIds.has(def.id)) waveUnbakedDraws++;
});

/**
 * Draws the wave for {@link WAVE_FRAMES}, calling `hold` before each frame
 * so a harness can keep its crawlers where it wants them, and returns the
 * wave's own unbaked draws over its last {@link WAVE_SETTLED_FRAMES}.
 */
function drawWave(frame: number, figures: readonly FigureDef[] = waveFigures): void {
  for (const figure of figures) {
    for (const state of WAVE_STATES) {
      drawFigureCached(
        waveContext,
        figure,
        state,
        frame % WAVE_ROW_FRAMES,
        WAVE_DRAW_ORIGIN_PX,
        WAVE_DRAW_ORIGIN_PX,
        TILE_SIZE,
      );
    }
  }
}

async function runWave(
  hold: () => void,
  frames: number,
  figures: readonly FigureDef[] = waveFigures,
): Promise<number> {
  for (let frame = 0; frame < frames; frame++) {
    if (frame === frames - WAVE_SETTLED_FRAMES) waveUnbakedDraws = 0;
    hold();
    await runFrame();
    // Drawn after the frame's own render, as the next frame's wave would be:
    // the cache's frame clock has already moved on, so these count as drawn.
    drawWave(frame, figures);
  }
  return waveUnbakedDraws;
}

async function standCounted(hold: () => void): Promise<void> {
  for (let frame = 0; frame < SETTLED_STAND_FRAMES; frame++) {
    hold();
    await runFrame();
  }
}

const holdFar = (): void => placeParty(farX, farY);
const holdHome = (): void => placeParty(homeX, homeY);

// ── The wave, then the walk home ─────────────────────────────────────────────

const crowdBytesBeforeWave = crowdBytes();
const walkWaveMisses = await runWave(holdFar, WAVE_FRAMES);
const crowdBytesUnderWave = crowdBytes();
check(
  walkWaveMisses === 0,
  `the wave still drew ${walkWaveMisses} cells unbaked in its last ${WAVE_SETTLED_FRAMES} frames`,
);

citizenUnbakedDraws = 0;
let walkFrames = 0;
for (;;) {
  const { human } = scene().pm;
  const dx = homeX - human.x;
  const dy = homeY - human.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= FASTEST_WALK_PX_PER_UPDATE) break;
  const step = FASTEST_WALK_PX_PER_UPDATE / remaining;
  placeParty(human.x + dx * step, human.y + dy * step);
  await runFrame();
  walkFrames++;
}
await standCounted(holdHome);
const walkUnbaked = citizenUnbakedDraws;
check(walkUnbaked === 0, `${walkUnbaked} citizen cells were drawn unbaked on the walk home`);

// ── A death far from town, the last save in the plaza ────────────────────────

/** Whether the arrival's loading screen is up, and so the world is not drawn. */
function loaderUp(): boolean {
  return renderQuality.isLoadingCovered;
}

/**
 * Frames until the loading screen, if a warp put it up, has closed; whether
 * it was up at all.
 */
async function waitOutLoader(): Promise<boolean> {
  let shown = false;
  for (let frame = 0; frame < MAX_WARP_WAIT_FRAMES && loaderUp(); frame++) {
    shown = true;
    await runFrame();
  }
  check(!loaderUp(), `a warp's loading screen stayed up past ${MAX_WARP_WAIT_FRAMES} frames`);
  return shown;
}

const captureSavePoint: unknown = Reflect.get(scene(), 'captureSavePoint');
if (typeof captureSavePoint !== 'function') throw new Error('the scene takes no save points');
Reflect.apply(captureSavePoint, scene(), [{ x: plan.centre.x, y: plan.centre.y }]);
await runWave(holdFar, LATER_WAVE_FRAMES);
const crowdBytesAtDeath = crowdBytes();
scene().pm.human.hp = 0;
let deathFrames = 0;
while (deathFrames < MAX_WARP_WAIT_FRAMES && Reflect.get(scene(), 'gameOver') !== true) {
  holdFar();
  await runFrame();
  deathFrames++;
}
check(deathFrames < MAX_WARP_WAIT_FRAMES, 'the party never died');
let respawnWaitFrames = 0;
while (respawnWaitFrames < MAX_WARP_WAIT_FRAMES && Reflect.get(scene(), 'gameOver') !== false) {
  key('keydown', RESPAWN_KEY);
  await runFrame();
  key('keyup', RESPAWN_KEY);
  respawnWaitFrames++;
}
check(
  respawnWaitFrames < MAX_WARP_WAIT_FRAMES,
  `the death screen never let the party back in ${MAX_WARP_WAIT_FRAMES} frames`,
);
const respawnCovered = await waitOutLoader();
citizenUnbakedDraws = 0;
await standCounted(() => undefined);
const respawnUnbaked = citizenUnbakedDraws;
check(respawnUnbaked === 0, `${respawnUnbaked} citizen cells were drawn unbaked after the respawn`);

// ── Recall home: a channel that covers the rewarm, and one that cannot ───────

const recall: unknown = Reflect.get(scene(), 'recall');
if (!(recall instanceof RecallSystem)) throw new Error('the overworld has no recall');

/** What is drawn while a recall channels: nothing, the wave, or a heavy wave pinned in place. */
type ChannelPressure = 'none' | 'wave' | 'pinnedWave';

/**
 * Recalls the party from the far stand to town under `pressure`, and returns
 * whether the landing was covered, how long the cover stayed up, how many
 * channel frames ran with the prewarm budget raised, and the citizen cells
 * drawn unbaked after it.
 */
async function recallHome(pressure: ChannelPressure): Promise<{
  covered: boolean;
  coverFrames: number;
  boostedFrames: number;
  unbaked: number;
}> {
  const figures = pressure === 'pinnedWave' ? heavyWaveFigures : waveFigures;
  await runWave(holdFar, LATER_WAVE_FRAMES, figures);
  if (pressure === 'pinnedWave') {
    for (const figure of figures) for (const state of WAVE_STATES) pinFigureState(figure, state);
  }
  recall.restoreCheckpoint({ cooldownFrames: 0 });
  check(
    recall.beginChannelTo(scene().pm.human, 'town'),
    'the recall channel would not start at the far stand',
  );
  let channelFrames = 0;
  let boostedFrames = 0;
  while (recall.isChannelling && channelFrames < MAX_WARP_WAIT_FRAMES) {
    if (figurePrewarmBudgetMs() > PREWARM_BAKE_BUDGET_MS) boostedFrames++;
    await runFrame();
    if (pressure !== 'none') drawWave(channelFrames, figures);
    channelFrames++;
  }
  let coverFrames = 0;
  while (loaderUp() && coverFrames < MAX_WARP_WAIT_FRAMES) {
    await runFrame();
    coverFrames++;
  }
  if (pressure === 'pinnedWave') {
    for (const figure of figures) for (const state of WAVE_STATES) unpinFigureState(figure, state);
  }
  citizenUnbakedDraws = 0;
  await standCounted(() => undefined);
  return { covered: coverFrames > 0, coverFrames, boostedFrames, unbaked: citizenUnbakedDraws };
}

const quietRecall = await recallHome('none');
check(
  quietRecall.unbaked === 0,
  `${quietRecall.unbaked} citizen cells were drawn unbaked after a recall`,
);
check(
  quietRecall.boostedFrames === 0,
  `the prewarm budget was raised for ${quietRecall.boostedFrames} frames of a recall channel`,
);
const contestedRecall = await recallHome('wave');
check(
  contestedRecall.covered,
  'a recall whose channel could not make room landed without its loading screen',
);
check(
  contestedRecall.unbaked === 0,
  `${contestedRecall.unbaked} citizen cells were drawn unbaked after a recall the channel could not cover`,
);
const crampedRecall = await recallHome('pinnedWave');
check(
  crampedRecall.coverFrames < MAX_WARP_WAIT_FRAMES,
  `a recall into a cache with no room left its loading screen up for ${crampedRecall.coverFrames} frames`,
);

// ── A switch to the crawler left in the plaza ────────────────────────────────

const holdSplit = (): void => {
  placeHuman(farX, farY);
  placeCat(homeX, homeY);
};
await runWave(holdSplit, LATER_WAVE_FRAMES);
key('keydown', SWITCH_KEY);
holdSplit();
await runFrame();
key('keyup', SWITCH_KEY);
check(scene().pm.cat.isActive, 'the switch to the other crawler did not happen');
citizenUnbakedDraws = 0;
await standCounted(holdSplit);
const switchUnbaked = citizenUnbakedDraws;
check(switchUnbaked === 0, `${switchUnbaked} citizen cells were drawn unbaked after the switch`);

console.log(
  `wave: crowd ${megabytes(crowdBytesBeforeWave)} → ${megabytes(crowdBytesUnderWave)} MB, ` +
    `${walkWaveMisses} wave misses once settled`,
);
console.log(`walk home (${walkFrames} frames): ${walkUnbaked} unbaked citizen draws`);
console.log(
  `death: crowd ${megabytes(crowdBytesAtDeath)} MB, respawn ${respawnCovered ? 'behind' : 'without'} ` +
    `the loading screen, ${respawnUnbaked} unbaked citizen draws`,
);
console.log(
  `recall: quiet ${quietRecall.covered ? 'behind' : 'without'} the loading screen ` +
    `(${quietRecall.boostedFrames} boosted channel frames), ` +
    `${quietRecall.unbaked} unbaked; through a wave ${contestedRecall.covered ? 'behind' : 'without'} ` +
    `it, ${contestedRecall.unbaked} unbaked; into a full cache the screen lifted after ` +
    `${crampedRecall.coverFrames} frames`,
);
console.log(`switch: ${switchUnbaked} unbaked citizen draws`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('verify-town-residency: ok');
process.exit(0);
