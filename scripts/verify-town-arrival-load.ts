#!/usr/bin/env tsx
/**
 * Headless gate for the town's arrival loading screen: once it closes, the
 * plaza must already be in its steady state on the very first frame of play.
 *
 * Builds floor 3 the way `DungeonScene` does for everything this touches — the
 * real overworld `GameMap`, its art seed pushed before anything paints, the
 * ground and environment sheets *queued* (not painted outright, as the other
 * harnesses do), the street furniture, the whole `TownLifeSystem` crowd and the
 * party — then runs the real `floorArrivalLoadTasks` through a real
 * `LoadRunner`, frame by frame, with the caches' own frame-boundary slices
 * ticking beside it exactly as `SceneManager.step` ticks them.
 *
 * Then it plays the plaza for a stretch and asserts, from frame 0:
 *  - no figure cell is baked on the render path, approximated by a stand-in,
 *    or painted directly (every citizen draws from a warm, pinned row);
 *  - no ground chunk is baked (the first screenful was baked behind the screen);
 *  - no environment step is still owed or painted (the art all landed);
 * and that a walk back out of a building — the same floor rebuilt around the
 * same map — owes too little to put the screen up again.
 *
 * Also reports how long each task took, headless. Node's canvas costs are not
 * a browser's (they diverge by multiples, in both directions), so the timings
 * are a shape to compare runs against, not a claim about a player's wait.
 *
 *   npm run verify:town-arrival-load
 *   npx tsx scripts/verify-town-arrival-load.ts --fault=skip-loader   # must fail
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';

installCanvasGlobals();
interface WindowGlobals {
  window?: unknown;
}
const REVIEW_DEVICE_PIXEL_RATIO = 2;
const windowGlobals: WindowGlobals = globalThis;
windowGlobals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };

const { mulberry32 } = await import('../src/sprites/person/rng.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { setFloorArtSeed } = await import('../src/map/ground/floorArtSeed.js');
const { groundSheetKeysAmong, requestGroundSheets } =
  await import('../src/map/ground/runtimeGroundSheets.js');
const { requiredSpriteKeysForLevel } = await import('../src/core/systemAssetRequirements.js');
const { requestEnvironmentSheetsForGroups } =
  await import('../src/sprites/sheets/environmentSheets.js');
const { beginEnvironmentArtFrame, environmentPaintDepth, environmentPaintedStepCount } =
  await import('../src/map/environmentArtCache.js');
const { buildingSheetsNotYetQueued } =
  await import('../src/sprites/buildinggen/runtimeBuildingSheets.js');
const { tileChunkBakeCount } = await import('../src/map/TileRenderer.js');
const { level3 } = await import('../src/levels/level3.js');
const { MarketSystem } = await import('../src/systems/market/MarketSystem.js');
const { createMarketStock } = await import('../src/systems/market/MarketStock.js');
const { TownPropSystem } = await import('../src/systems/TownPropSystem.js');
const { TownDecorSystem } = await import('../src/systems/TownDecorSystem.js');
const { TownLifeSystem } = await import('../src/systems/TownLifeSystem.js');
const { HumanPlayer } = await import('../src/creatures/HumanPlayer.js');
const { CatPlayer } = await import('../src/creatures/CatPlayer.js');
const { MobRoster } = await import('../src/systems/kits/SceneWorld.js');
const { SpellSystem } = await import('../src/systems/SpellSystem.js');
const { setViewportSize, setRenderScaleValue } = await import('../src/core/Viewport.js');
const {
  beginFigureFrame,
  figurePrewarmDepth,
  figurePrewarmOwed,
  holdFigureIdleSweep,
  releaseFigureIdleSweep,
} = await import('../src/sprites/figure/figureFrameCache.js');
const { setFigureCacheStatsRecording, getFigureCacheStats } =
  await import('../src/sprites/figure/figureCacheStats.js');
const { LoadRunner } = await import('../src/core/LoadRunner.js');
const { floorArrivalLoadTasks, floorArrivalOwesWork } =
  await import('../src/scenes/floorArrivalLoad.js');

const faultArg = process.argv.find((arg) => arg.startsWith('--fault='))?.slice('--fault='.length);
const skipLoader = faultArg === 'skip-loader';

const MAP_SIZE = level3.mapSize;
/** A worldSeed confirmed not to hit the Briar Hollow siting bug (see `measure-town-plaza.ts`). */
const WORLD_SEED = 1;
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
/** Frames of play measured after the loading screen closes. */
const PLAY_FRAMES = 120;
/** Frames the loader may take before the gate calls it hung. */
const MAX_LOAD_FRAMES = 20000;
/** Matches `RenderPipeline`'s townsfolk cull margin. */
const CULL_MARGIN = TILE_SIZE;
/** Matches `RenderPipeline.ENTITY_SORT_Y_OFFSET`: a figure sorts by its foot. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;
/**
 * How much slower than the steady state the first frame of play may be. Loose,
 * because it is a timing: it exists to catch a whole screenful of baking left
 * for frame 0 (several times the steady cost), not a few cold branches.
 */
const MAX_FIRST_FRAME_RATIO = 2;
/** Decimal places for millisecond readouts. */
const MS_PLACES = 1;

Math.random = mulberry32(WORLD_SEED);

await loadSprites('src/images/');
setViewportSize(VIEWPORT_W, VIEWPORT_H);
setRenderScaleValue(REVIEW_DEVICE_PIXEL_RATIO);

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
setFloorArtSeed(gameMap.artSeed);
const plazaCentre = gameMap.townSquareCentre ?? { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };

const invalidateTileArt = (): void => gameMap.invalidateAllTileArt();
const queueFloorArt = (): void => {
  requestGroundSheets(
    groundSheetKeysAmong(requiredSpriteKeysForLevel(level3.id, level3.spriteGroups)),
    invalidateTileArt,
  );
  requestEnvironmentSheetsForGroups(level3.spriteGroups, {
    onSheetPainted: invalidateTileArt,
    town:
      gameMap.townPlan === undefined
        ? undefined
        : { plan: gameMap.townPlan, spawnTile: plazaCentre },
  });
};
queueFloorArt();

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
const townDecor = new TownDecorSystem(
  gameMap,
  new Set([...market.reservedTiles, ...townProps.reservedTiles]),
);
const props = [...market.props, ...townProps.props, ...townDecor.props];
let townLife = new TownLifeSystem(gameMap);
const human = new HumanPlayer(plazaCentre.x, plazaCentre.y, TILE_SIZE);
const cat = new CatPlayer(plazaCentre.x + 1, plazaCentre.y, TILE_SIZE);
human.isActive = true;
cat.isActive = false;
const roster = new MobRoster(gameMap, new SpellSystem());

const camX = plazaCentre.x * TILE_SIZE - VIEWPORT_W / 2;
const camY = plazaCentre.y * TILE_SIZE - VIEWPORT_H / 2;

const failures: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

// ── The loading screen ───────────────────────────────────────────────────────

/** A generous cell cost for the report's owed-work estimate; see `floorArrivalLoad.ts`. */
const REPORT_UNMEASURED_CELL_MS = 5;
const owedAtStart = {
  environmentSteps: environmentPaintDepth(),
  facadesNotYetQueued: buildingSheetsNotYetQueued(),
  figureCells: figurePrewarmOwed(REPORT_UNMEASURED_CELL_MS).cells,
};
check(
  floorArrivalOwesWork(false),
  'a first arrival in town owed too little to show the loading screen',
);

const runner = new LoadRunner(
  floorArrivalLoadTasks({
    gameMap,
    camera: () => ({ x: camX, y: camY }),
    viewport: () => ({ width: VIEWPORT_W, height: VIEWPORT_H }),
    spriteGroupsReady: Promise.resolve(),
  }),
  { minDisplayMs: 0 },
);

setFigureCacheStatsRecording(true);
const msByTask = new Map<string, number>();
let loadFrames = 0;
let worstTickMs = 0;
let worstTickLabel = '';
const loadStartedAt = performance.now();
if (!skipLoader) {
  holdFigureIdleSweep();
  for (; loadFrames < MAX_LOAD_FRAMES && !runner.isFinished; loadFrames++) {
    // `SceneManager.step`'s order: the caches' own slices at the frame
    // boundary, then the scene's render — which, while loading, is the loader.
    const frameStartedAt = performance.now();
    beginFigureFrame();
    beginEnvironmentArtFrame();
    const label = runner.statusLabel;
    runner.tick();
    const frameMs = performance.now() - frameStartedAt;
    msByTask.set(label, (msByTask.get(label) ?? 0) + frameMs);
    if (runner.lastTickMs > worstTickMs) {
      worstTickMs = runner.lastTickMs;
      worstTickLabel = label;
    }
    // Lets the sprite-group promise settle between frames, as the event loop would.
    await Promise.resolve();
  }
  check(runner.isFinished, `the loader had not finished after ${MAX_LOAD_FRAMES} frames`);
  releaseFigureIdleSweep();
}
const loadMs = performance.now() - loadStartedAt;

// ── The first frames of play ────────────────────────────────────────────────

const canvas = createCanvas(
  VIEWPORT_W * REVIEW_DEVICE_PIXEL_RATIO,
  VIEWPORT_H * REVIEW_DEVICE_PIXEL_RATIO,
);
const nodeCtx = canvas.getContext('2d');
nodeCtx.scale(REVIEW_DEVICE_PIXEL_RATIO, REVIEW_DEVICE_PIXEL_RATIO);
const ctx = asGameContext(nodeCtx);

interface PlayFrame {
  readonly lazyBakes: number;
  readonly approxDraws: number;
  readonly directDraws: number;
  readonly chunkBakes: number;
  readonly environmentSteps: number;
  readonly renderMs: number;
  readonly groundMs: number;
  readonly overlayMs: number;
}

function playFrame(): PlayFrame {
  townLife.update({
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  });
  const chunksBefore = tileChunkBakeCount();
  const stepsBefore = environmentPaintedStepCount();
  const startedAt = performance.now();
  beginFigureFrame();
  beginEnvironmentArtFrame();
  gameMap.renderCanvas(ctx, camX, camY, VIEWPORT_W, VIEWPORT_H);
  const groundDoneAt = performance.now();
  gameMap.renderDecorationsOverlay(ctx, camX, camY, VIEWPORT_W, VIEWPORT_H);
  const overlayDoneAt = performance.now();
  const inView = townLife.people.filter(
    (person) =>
      person.x >= camX - CULL_MARGIN &&
      person.x <= camX + VIEWPORT_W + CULL_MARGIN &&
      person.y >= camY - CULL_MARGIN &&
      person.y <= camY + VIEWPORT_H + CULL_MARGIN,
  );
  const drawables = [
    ...props.map((prop) => ({
      sortY: prop.y + ENTITY_SORT_Y_OFFSET,
      draw: () => prop.render(ctx, camX, camY, TILE_SIZE),
    })),
    ...inView.map((person) => ({
      sortY: person.y + ENTITY_SORT_Y_OFFSET,
      draw: () => person.render(ctx, camX, camY, TILE_SIZE),
    })),
  ].sort((a, b) => a.sortY - b.sortY);
  for (const drawable of drawables) drawable.draw();
  const stats = getFigureCacheStats();
  return {
    lazyBakes: stats.bakes,
    approxDraws: stats.approxDraws,
    directDraws: stats.directDraws,
    chunkBakes: tileChunkBakeCount() - chunksBefore,
    environmentSteps: environmentPaintedStepCount() - stepsBefore,
    renderMs: performance.now() - startedAt,
    groundMs: groundDoneAt - startedAt,
    overlayMs: overlayDoneAt - groundDoneAt,
  };
}

const played: PlayFrame[] = [];
for (let frame = 0; frame < PLAY_FRAMES; frame++) played.push(playFrame());

const sum = (pick: (frame: PlayFrame) => number): number =>
  played.reduce((total, frame) => total + pick(frame), 0);
const firstFrame = played[0];
check(
  sum((f) => f.lazyBakes) === 0,
  `${sum((f) => f.lazyBakes)} figure cell(s) baked on the render path in the first ${PLAY_FRAMES} frames (frame 0: ${firstFrame.lazyBakes})`,
);
check(
  sum((f) => f.approxDraws) === 0,
  `${sum((f) => f.approxDraws)} citizen draw(s) served by a stand-in pose in the first ${PLAY_FRAMES} frames (frame 0: ${firstFrame.approxDraws})`,
);
check(
  sum((f) => f.directDraws) === 0,
  `${sum((f) => f.directDraws)} figure(s) painted directly in the first ${PLAY_FRAMES} frames`,
);
check(
  sum((f) => f.chunkBakes) === 0,
  `${sum((f) => f.chunkBakes)} ground chunk(s) baked during play (frame 0: ${firstFrame.chunkBakes})`,
);
check(
  sum((f) => f.environmentSteps) === 0 && environmentPaintDepth() === 0,
  `${sum((f) => f.environmentSteps)} environment step(s) painted during play, ${environmentPaintDepth()} still owed`,
);
const steadyRenderMs = played
  .slice(1)
  .map((f) => f.renderMs)
  .sort((a, b) => a - b);
const medianSteadyRenderMs = steadyRenderMs[Math.floor(steadyRenderMs.length / 2)] ?? 0;
check(
  firstFrame.renderMs <= medianSteadyRenderMs * MAX_FIRST_FRAME_RATIO,
  `frame 0 took ${firstFrame.renderMs.toFixed(MS_PLACES)} ms against a steady median of ` +
    `${medianSteadyRenderMs.toFixed(MS_PLACES)} ms — something still bakes on the first frame of play`,
);
check(
  figurePrewarmDepth() === 0,
  `${figurePrewarmDepth()} prewarm request(s) still queued after loading`,
);

// ── A walk back out of a building: same floor, same map, rebuilt scene ──────

townLife.dispose();
queueFloorArt();
townLife = new TownLifeSystem(gameMap);
const exitOwesWork = floorArrivalOwesWork(true);
check(
  !exitOwesWork,
  `a building exit with everything still painted and warm owed enough work to show the loading screen ` +
    `(${environmentPaintDepth()} env steps, ${figurePrewarmOwed(REPORT_UNMEASURED_CELL_MS).cells} figure cells)`,
);

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`Town arrival loading screen — headless node-canvas, worldSeed=${WORLD_SEED}`);
console.log(
  `  owed at arrival: ${owedAtStart.environmentSteps} environment steps queued + ` +
    `${owedAtStart.facadesNotYetQueued} facades not yet queued, ${owedAtStart.figureCells} figure cells`,
);
console.log(
  `  loader: ${loadFrames} frames, ${loadMs.toFixed(MS_PLACES)} ms wall, ` +
    `worst loader tick ${worstTickMs.toFixed(MS_PLACES)} ms in "${worstTickLabel}" (budget ${runner.budgetMs} ms; ` +
    `one indivisible unit may run over it)`,
);
for (const [label, ms] of msByTask) {
  console.log(
    `    ${label}: ${ms.toFixed(MS_PLACES)} ms (frames spent while this task was current)`,
  );
}
console.log(
  `  first ${PLAY_FRAMES} frames of play: ${sum((f) => f.lazyBakes)} lazy bakes, ` +
    `${sum((f) => f.approxDraws)} stand-ins, ${sum((f) => f.directDraws)} direct paints, ` +
    `${sum((f) => f.chunkBakes)} chunk bakes, ${sum((f) => f.environmentSteps)} env steps; ` +
    `frame 0 render ${firstFrame.renderMs.toFixed(MS_PLACES)} ms`,
);
/** Frames of play shown individually in the report, to show the first against the rest. */
const REPORTED_FRAMES = 4;
for (const [index, frame] of played.slice(0, REPORTED_FRAMES).entries()) {
  console.log(
    `    frame ${index}: render ${frame.renderMs.toFixed(MS_PLACES)} ms ` +
      `(ground ${frame.groundMs.toFixed(MS_PLACES)}, decorations ${frame.overlayMs.toFixed(MS_PLACES)})`,
  );
}
console.log(`  building exit owes a loading screen: ${exitOwesWork}`);

if (failures.length > 0) {
  console.error(`FAIL verify:town-arrival-load${skipLoader ? ' (fault=skip-loader)' : ''}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS verify:town-arrival-load');
}
