#!/usr/bin/env tsx
/**
 * Headless perf/residency baseline for the Over City's plaza.
 *
 * Builds the real level-3 town the way `render-town.ts` does — the real
 * `GameMap` overworld generator, the real `TownPropSystem`/`TownDecorSystem`/
 * `MarketSystem` street furniture — then stands up the real `TownLifeSystem`
 * crowd and drives it through the real update/render path for a fixed number
 * of frames with the camera parked on the plaza: `TownLifeSystem.update`,
 * `renderCanvas`/`renderDecorationsOverlay` for the ground, and each visible
 * `Townsperson.render`, which draws through `drawTownCastSprite` and so
 * exercises the shared `figureFrameCache` the same way the active player's own
 * sprite does.
 *
 * It exists because no script anywhere in the repo produces the two numbers
 * every later change to the town's crowd has to be measured against: the
 * figure frame-cache's peak resident bytes under a real crowd, and a mean
 * per-frame update/render cost. `gates:figure-cache` only asserts cache
 * *behaviour* against a synthetic painter; `townMetrics.ts` never timed
 * anything.
 *
 * The timings are Node's `node-canvas`, not Chrome's canvas: the two diverge
 * by multiples and sometimes in opposite directions (see the
 * `node-and-chrome-canvas-costs-diverge` note), so every ms figure here is
 * labeled "headless" and is a *shape* to compare future runs against, not a
 * claim about what a browser tab would show.
 *
 * The overworld generator occasionally fails to site Briar Hollow for an
 * unlucky world seed (a pre-existing bug tracked elsewhere). This harness
 * pins one `worldSeed` (default 1) that is known not to hit it, rather than
 * rerolling — rerolling would also break the determinism this measurement
 * needs. `Math.random` itself is reseeded with the same value before the town
 * is built, so every role pick, wander target and pause length in the run is
 * reproducible too — the reported town population and mean visible count
 * reproduce exactly run to run. `figureCache`'s own numbers can still drift by
 * a few bakes between runs on the same machine: that cache's bake pacing is a
 * wall-clock millisecond budget (`PREWARM_BAKE_BUDGET_MS` for the player's own
 * prewarm, `FRAME_BAKE_BUDGET_MS` for everyone else), which is real machine
 * timing, not seeded state.
 *
 *   npx tsx scripts/measure-town-plaza.ts
 *   npx tsx scripts/measure-town-plaza.ts --frames=1200 --json
 *   npx tsx scripts/measure-town-plaza.ts --seed=42 --png=preview/plaza.png
 */

import { createCanvas, type Canvas } from 'canvas';

import { installCanvasGlobals, paintEnvironmentArtInNode } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { asGameContext } from './nodeGameContext.js';

interface CanvasGlobals {
  Image?: unknown;
  document?: unknown;
  window?: unknown;
}
const globals: CanvasGlobals = globalThis;
/** Matches the bake resolution the shipped sheets are authored at. */
const REVIEW_DEVICE_PIXEL_RATIO = 2;

const nodeCanvasModule = await import('canvas');
globals.Image = nodeCanvasModule.Image;
globals.window = { devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO };
globals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`headless renderer cannot create <${tag}>`);
    return createCanvas(1, 1);
  },
};

const { mulberry32 } = await import('../src/sprites/person/rng.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { renderCanvas, renderDecorationsOverlay } = await import('../src/map/TileRenderer.js');
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
  touchFigureState,
  CACHE_BUDGET_MEGABYTES: FIGURE_CACHE_BUDGET_MEGABYTES,
  CACHE_BYTE_BUDGET: FIGURE_CACHE_BYTE_BUDGET,
} = await import('../src/sprites/figure/figureFrameCache.js');
const { setFigureCacheStatsRecording, getFigureCacheStats, BYTES_PER_MEGABYTE } =
  await import('../src/sprites/figure/figureCacheStats.js');
const { prewarmAndPinCitizenTalk } = await import('../src/creatures/citizenFigure.js');
const { townCastStateFor } = await import('../src/sprites/townCastSprite.js');
const { townCastOutfitFigure } = await import('../src/sprites/art/townCastFigure.js');
const { skyfowlCastStateFor } = await import('../src/sprites/skyfowlCastSprite.js');
const { skyfowlCastFigure } = await import('../src/sprites/art/skyfowlCastFigure.js');

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Length of the `--` prefix plus the `=` separator around a flag name. */
const FLAG_PREFIX_LENGTH = 3;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + FLAG_PREFIX_LENGTH);
}

function intArg(name: string, fallback: number): number {
  const raw = stringArg(name, '');
  if (raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

function boolFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function floatArg(name: string, fallback: number): number {
  const raw = stringArg(name, '');
  if (raw === '') return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
  return value;
}

/** The town this size at every other headless town harness. */
const MAP_SIZE = 280;
/** A worldSeed confirmed not to hit the Briar Hollow siting bug (see file doc). */
const DEFAULT_WORLD_SEED = 1;
/** Long enough to see the cache fill, settle, and hold steady past that point. */
const DEFAULT_FRAMES = 600;
/** A common desktop viewport in CSS pixels — matches `verify-village-quest.ts`. */
const DEFAULT_VIEWPORT_W = 1280;
const DEFAULT_VIEWPORT_H = 720;

const frameCount = intArg('frames', DEFAULT_FRAMES);
const worldSeed = intArg('seed', DEFAULT_WORLD_SEED);
const viewportW = intArg('width', DEFAULT_VIEWPORT_W);
const viewportH = intArg('height', DEFAULT_VIEWPORT_H);
const asJson = boolFlag('json');
const pngOut = stringArg('png', `${PREVIEW_DIR}/town-plaza.png`);
const gateMode = boolFlag('gate');
/**
 * Frames counted as the plaza's own arrival window before the "steady state"
 * window below starts being measured — ten seconds at 60 Hz, matching
 * `IDLE_FRAMES_BEFORE_RELEASE`. Deliberately short rather than run out to
 * where headless Node's own cheap per-cell cost eventually lets even an
 * unprewarmed crowd catch up: a player feels the first several seconds after
 * walking into the plaza, not whatever a script converges to a minute in.
 */
const DEFAULT_WARMUP_FRAMES = 300;
const warmupFrames = intArg('warmup', DEFAULT_WARMUP_FRAMES);
/**
 * Cell bakes (prewarm, on arrival) one frame may admit before the gate calls
 * it a spike — a coarse, secondary check; {@link DEFAULT_MAX_FRAME_BAKE_MS}
 * is the one that actually bounds cost, since a cell's price swings by an
 * order of magnitude across the two casts (a skyfowl cell is a fraction of a
 * human one). Generous enough that the arrival window's own boosted budget
 * admitting a dozen cheap cells in one frame is not, on its own, a failure.
 */
const DEFAULT_PER_FRAME_BAKE_CEILING = 20;
const perFrameBakeCeiling = intArg('per-frame-bake-ceiling', DEFAULT_PER_FRAME_BAKE_CEILING);
/**
 * Minimum hit rate the gate requires, measured only after the plaza's
 * arrival window (`warmupFrames`) — not the whole run, which deliberately
 * counts every approximate draw the crowd's arrival makes as a miss (see
 * `drawFigureCachedApprox`) even though none of them cost a bake. The crowd's
 * own working set is pinned resident for as long as the scene stays active
 * (`pinCitizenFigure`), so a real run measures at or near 100% here — the
 * small margin below that is for a state this harness never exercises (a
 * citizen's `talk` row, warmed lazily on purpose since dialog is a rare,
 * one-off cost) rather than an expected steady miss.
 */
const DEFAULT_MIN_HIT_RATE_PERCENT = 99;
const minHitRatePercent = intArg('min-hit-rate', DEFAULT_MIN_HIT_RATE_PERCENT);

/**
 * Cell bakes per steady-state frame the render path itself may pay, held to
 * zero: the crowd's idle and walk rows are baked before the scene's first
 * frame and pinned against the idle sweep for as long as it stays active, so
 * nothing should ever miss on the render path again once warmup ends. A
 * `prewarmBakes` cell is unaffected by this — see the lazy/prewarm split this
 * gate reads — because the active player's own figure keeps warming on its
 * own schedule regardless of the town crowd around it.
 */
const DEFAULT_MAX_STEADY_STATE_BAKE_RATE = 0;
const maxSteadyStateBakeRate = floatArg('max-steady-bake-rate', DEFAULT_MAX_STEADY_STATE_BAKE_RATE);

/**
 * Milliseconds one arrival frame may spend baking before the gate calls it a
 * stall rather than a slice. The configured budget itself is 10 ms
 * (`ARRIVAL_BOOST_BUDGET_MS` in `TownLifeSystem.ts`) — this ceiling sits well
 * above it because the cache's own admission check (`fitsBakeAllowance`) lets
 * a figure it has no cost estimate for yet bake regardless of budget, so that
 * more than one never-before-seen figure landing in the same early frame
 * compounds past the nominal budget. That escape is what keeps a large,
 * unfamiliar figure from being refused forever, is shared by every other
 * figure in the game, and is not this gate's to narrow — measured worst case
 * across several seeds was ~22 ms; this leaves real margin above that rather
 * than chasing the nominal 10 ms exactly.
 */
const DEFAULT_MAX_FRAME_BAKE_MS = 30;
const maxFrameBakeMs = floatArg('max-frame-bake-ms', DEFAULT_MAX_FRAME_BAKE_MS);

// Reseeds the one RNG every cohort spawn, wander target and pause draws from,
// so the whole run — crowd composition included — replays identically for a
// fixed --seed.
Math.random = mulberry32(worldSeed);

// ── World setup ──────────────────────────────────────────────────────────────

await loadSprites('src/images/');
paintEnvironmentArtInNode();
installCanvasGlobals();

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed,
});

// Built in `DungeonScene`'s order: the market claims its stall tiles first so
// the other street furniture steers clear of them.
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

const townLife = new TownLifeSystem(gameMap);

const plazaCentre = gameMap.townSquareCentre ?? { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
const human = new HumanPlayer(plazaCentre.x, plazaCentre.y, TILE_SIZE);
const cat = new CatPlayer(plazaCentre.x + 1, plazaCentre.y, TILE_SIZE);
human.isActive = true;
cat.isActive = false;

const roster = new MobRoster(gameMap, new SpellSystem());

setViewportSize(viewportW, viewportH);
setRenderScaleValue(REVIEW_DEVICE_PIXEL_RATIO);

const camX = plazaCentre.x * TILE_SIZE - viewportW / 2;
const camY = plazaCentre.y * TILE_SIZE - viewportH / 2;
/** Matches `RenderPipeline`'s own townsfolk cull margin: one tile past the frame. */
const CULL_MARGIN = TILE_SIZE;
const viewMinX = camX - CULL_MARGIN;
const viewMinY = camY - CULL_MARGIN;
const viewMaxX = camX + viewportW + CULL_MARGIN;
const viewMaxY = camY + viewportH + CULL_MARGIN;
/** Matches `RenderPipeline.ENTITY_SORT_Y_OFFSET`: a figure sorts by its foot. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;

const canvas: Canvas = createCanvas(
  viewportW * REVIEW_DEVICE_PIXEL_RATIO,
  viewportH * REVIEW_DEVICE_PIXEL_RATIO,
);
const ctx = canvas.getContext('2d');
ctx.scale(REVIEW_DEVICE_PIXEL_RATIO, REVIEW_DEVICE_PIXEL_RATIO);
const gameCtx = asGameContext(ctx);

// ── Measurement ──────────────────────────────────────────────────────────────

setFigureCacheStatsRecording(true);

interface FrameSample {
  updateMs: number;
  renderMs: number;
  visiblePeople: number;
}

interface PerFrameFigureSample {
  frame: number;
  bakes: number;
  prewarmBakes: number;
  evictions: number;
  renderMs: number;
  bakeMs: number;
  hits: number;
  misses: number;
}

const samples: FrameSample[] = [];
const perFrameFigure: PerFrameFigureSample[] = [];
let peakFigureBytes = 0;
let peakFigureFigures = 0;
let totalFigureBakes = 0;
let totalFigurePrewarmBakes = 0;
let totalFigureEvictions = 0;
let totalFigureHits = 0;
let totalFigureMisses = 0;
let peakFigureBakeMs = 0;

for (let frame = 0; frame < frameCount; frame++) {
  const updateStart = performance.now();
  townLife.update({
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  });
  const updateMs = performance.now() - updateStart;

  const renderStart = performance.now();
  beginFigureFrame();

  renderCanvas(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewportW, viewportH);
  renderDecorationsOverlay(gameCtx, gameMap.structure, TILE_SIZE, camX, camY, viewportW, viewportH);

  const visiblePeople = townLife.people.filter(
    (person) =>
      person.x >= viewMinX && person.x <= viewMaxX && person.y >= viewMinY && person.y <= viewMaxY,
  );

  interface Renderable {
    sortY: number;
    draw: () => void;
  }
  const renderables: Renderable[] = [
    ...props.map((prop) => ({
      sortY: prop.y + ENTITY_SORT_Y_OFFSET,
      draw: () => {
        prop.render(gameCtx, camX, camY, TILE_SIZE);
      },
    })),
    ...visiblePeople.map((person) => ({
      sortY: person.y + ENTITY_SORT_Y_OFFSET,
      draw: () => {
        person.render(gameCtx, camX, camY, TILE_SIZE);
      },
    })),
  ];
  renderables.sort((a, b) => a.sortY - b.sortY);
  for (const renderable of renderables) renderable.draw();

  const renderMs = performance.now() - renderStart;
  samples.push({ updateMs, renderMs, visiblePeople: visiblePeople.length });

  const figureStats = getFigureCacheStats();
  peakFigureBytes = Math.max(peakFigureBytes, figureStats.bytes);
  peakFigureFigures = Math.max(peakFigureFigures, figureStats.figures);
  totalFigureBakes += figureStats.bakes;
  totalFigurePrewarmBakes += figureStats.prewarmBakes;
  totalFigureEvictions += figureStats.evictions;
  totalFigureHits += figureStats.hits;
  totalFigureMisses += figureStats.misses;
  peakFigureBakeMs = Math.max(peakFigureBakeMs, figureStats.bakeMs);
  perFrameFigure.push({
    frame,
    bakes: figureStats.bakes,
    prewarmBakes: figureStats.prewarmBakes,
    evictions: figureStats.evictions,
    renderMs,
    bakeMs: figureStats.bakeMs,
    hits: figureStats.hits,
    misses: figureStats.misses,
  });
}

// ── Scenario: a citizen frozen for dialog gets its talk row baked and drawn
// exactly, not approximated forever ─────────────────────────────────────────
//
// `Townsperson.render` only ever asks for `talk` while `frozen`, and the
// citizen sprite wrappers draw every citizen through the approximate path —
// so without a dedicated prewarm+pin call at the moment a conversation opens
// (`prewarmAndPinCitizenTalk`, called here exactly as the two real dialog
// sites call it), the one citizen a player is looking straight at would show
// an idle/walk stand-in forever.

const talkTarget = townLife.people[0];
const talkFacing = talkTarget.facingXY();
talkTarget.frozen = true;
prewarmAndPinCitizenTalk(talkTarget.figure, talkFacing.x, talkFacing.y);

/** Frames given for a frozen citizen's talk row to warm — well under a second at 60 Hz. */
const TALK_WARM_FRAMES = 30;
for (let i = 0; i < TALK_WARM_FRAMES; i++) {
  beginFigureFrame();
  talkTarget.render(gameCtx, camX, camY, TILE_SIZE);
}

const talkCitizenFigure =
  talkTarget.figure.species === 'skyfowl'
    ? skyfowlCastFigure(talkTarget.figure.look.id)
    : townCastOutfitFigure(talkTarget.figure.look);
const talkStateKey =
  talkTarget.figure.species === 'skyfowl'
    ? skyfowlCastStateFor('talk', talkFacing.x, talkFacing.y)
    : townCastStateFor('talk', talkTarget.figure.look, talkFacing.x, talkFacing.y);
const talkRowFullyWarm = touchFigureState(talkCitizenFigure, talkStateKey);

beginFigureFrame();
talkTarget.render(gameCtx, camX, camY, TILE_SIZE);
const talkDrawStats = getFigureCacheStats();
const talkDrawnExactly =
  talkDrawStats.hits >= 1 && talkDrawStats.approxDraws === 0 && talkDrawStats.bakes === 0;

// ── Scenario: a competing bake burst on the active player's own figure must
// not evict a pinned citizen row, and no citizen may fall to a direct paint
// while it runs ─────────────────────────────────────────────────────────────
//
// Stands in for Carl acting in town — new gear, a spell, anything that queues
// fresh rows on his own figure while the plaza's crowd sits pinned nearby.

human.inventory.addItem('nightgaunt_cloak', 1);
human.inventory.equipByItemId('nightgaunt_cloak');
human.onEquipmentChanged();

/** Frames the competing bake burst runs for. */
const BURST_FRAMES = 90;
let burstEvictions = 0;
let burstCitizenDirectDraws = 0;
for (let i = 0; i < BURST_FRAMES; i++) {
  townLife.update({
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap,
  });
  beginFigureFrame();
  const visible = townLife.people.filter(
    (p) => p.x >= viewMinX && p.x <= viewMaxX && p.y >= viewMinY && p.y <= viewMaxY,
  );
  for (const p of visible) p.render(gameCtx, camX, camY, TILE_SIZE);
  // Snapshotted before Carl draws, so his own figure's first-frame cost after
  // an outfit change (a real, one-time cost of a fresh row, not a citizen
  // regression) never counts against the citizens' own count.
  const afterCitizens = getFigureCacheStats();
  human.render(gameCtx, camX, camY, TILE_SIZE);
  const afterCarl = getFigureCacheStats();
  burstEvictions += afterCarl.evictions;
  burstCitizenDirectDraws += afterCitizens.directDraws;
}
const burstCleanRun = burstEvictions === 0 && burstCitizenDirectDraws === 0;

if (pngOut !== '') {
  const outPath = writePreviewPng(pngOut, canvas.toBuffer('image/png'));
  console.log(`wrote final-frame snapshot: ${outPath}`);
}

// ── Report ───────────────────────────────────────────────────────────────────

/** Percentage, for hit-rate and coverage readouts. */
const PERCENT = 100;
/** Decimal places printed for millisecond readouts. */
const MS_DECIMAL_PLACES = 3;
/** Worst frames listed in the spike report. */
const SPIKE_REPORT_COUNT = 10;

function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const rank = Math.min(sortedValues.length - 1, Math.floor(fraction * sortedValues.length));
  return sortedValues[rank];
}

const P95_FRACTION = 0.95;

function summarizeMs(values: readonly number[]): { mean: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
  return {
    mean,
    p95: percentile(sorted, P95_FRACTION),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

const updateSummary = summarizeMs(samples.map((s) => s.updateMs));
const renderSummary = summarizeMs(samples.map((s) => s.renderMs));
const meanVisiblePeople =
  samples.reduce((sum, s) => sum + s.visiblePeople, 0) / Math.max(1, samples.length);
const figureHitRate =
  (totalFigureHits / Math.max(1, totalFigureHits + totalFigureMisses)) * PERCENT;

// ── Steady-state and spike analysis ─────────────────────────────────────────
//
// A frame count and a total tell you the cache warmed up eventually; they
// cannot tell you whether it ever *stopped* baking, or which frames paid for
// it. Both matter to a player: a cache still baking after the crowd has
// settled is a permanent tax on every later frame, and a bake concentrated
// into one frame is the hitch a player actually feels, however small the
// run's mean looks.

const warmupBoundary = Math.min(warmupFrames, perFrameFigure.length);
// The town's own arrival window, not the whole run: the active player's own
// figure (`HumanPlayer.prewarmHumanSprite`) keeps warming in the background
// for as long as the scene is open, on its own combat-rig rows that can cost
// far more than a citizen's idle/walk cell — a real cost, but not one the
// citizen crowd causes or this gate is scoped to bound. Bounding it to
// arrival is what the per-frame bake-ms gate below actually means to hold.
const arrivalFrames = perFrameFigure.slice(0, warmupBoundary);
const steadyStateFrames = perFrameFigure.slice(warmupBoundary);
const steadyStateBakes = steadyStateFrames.reduce((sum, s) => sum + s.bakes + s.prewarmBakes, 0);
// Only `bakes` costs the render path a frame it wasn't going to spend anyway —
// a `prewarmBakes` cell is paid for on the cache's own paced queue, off the
// frame that first draws it, which is the whole point of prewarming it. A
// steady state with plenty of `prewarmBakes` and few `bakes` is the crowd's
// backlog draining in the background, not a lag spike a player would feel.
const steadyStateLazyBakes = steadyStateFrames.reduce((sum, s) => sum + s.bakes, 0);
const steadyStatePrewarmBakes = steadyStateFrames.reduce((sum, s) => sum + s.prewarmBakes, 0);
const steadyStateEvictions = steadyStateFrames.reduce((sum, s) => sum + s.evictions, 0);
const steadyStateHits = steadyStateFrames.reduce((sum, s) => sum + s.hits, 0);
const steadyStateMisses = steadyStateFrames.reduce((sum, s) => sum + s.misses, 0);
// Gated on this rather than the whole run's hit rate: the arrival window
// deliberately trades a true hit for an approximate draw while the crowd's
// closed set is still warming (see `drawFigureCachedApprox`), which counts as
// a miss there on purpose. A run-wide rate would fold that intentional,
// bounded trade in with the number that actually says whether the crowd
// finished warming — this one only reads the plaza after arrival.
const steadyStateHitRate =
  (steadyStateHits / Math.max(1, steadyStateHits + steadyStateMisses)) * PERCENT;
const steadyStateBakingFrames = steadyStateFrames.filter((s) => s.bakes + s.prewarmBakes > 0);

const worstBakeFrames = [...perFrameFigure]
  .filter((s) => s.bakes + s.prewarmBakes > 0)
  .sort((a, b) => b.bakes + b.prewarmBakes - (a.bakes + a.prewarmBakes))
  .slice(0, SPIKE_REPORT_COUNT);
const worstRenderFrames = [...perFrameFigure]
  .sort((a, b) => b.renderMs - a.renderMs)
  .slice(0, SPIKE_REPORT_COUNT);
const worstBakeMsFrames = [...perFrameFigure]
  .filter((s) => s.bakeMs > 0)
  .sort((a, b) => b.bakeMs - a.bakeMs)
  .slice(0, SPIKE_REPORT_COUNT);

const overBakeCeilingFrames = arrivalFrames.filter(
  (s) => s.bakes + s.prewarmBakes > perFrameBakeCeiling,
);
const arrivalPeakBakeMs = arrivalFrames.reduce((peak, s) => Math.max(peak, s.bakeMs), 0);
const overFrameBakeMsFrames = arrivalFrames.filter((s) => s.bakeMs > maxFrameBakeMs);

const report = {
  headless: true,
  worldSeed,
  frames: frameCount,
  viewport: { width: viewportW, height: viewportH, devicePixelRatio: REVIEW_DEVICE_PIXEL_RATIO },
  townPopulation: townLife.people.length,
  meanVisiblePeoplePerFrame: meanVisiblePeople,
  updateMs: updateSummary,
  renderMs: renderSummary,
  figureCache: {
    peakBytes: peakFigureBytes,
    peakMegabytes: peakFigureBytes / BYTES_PER_MEGABYTE,
    budgetMegabytes: FIGURE_CACHE_BUDGET_MEGABYTES,
    budgetBytes: FIGURE_CACHE_BYTE_BUDGET,
    peakFigures: peakFigureFigures,
    totalBakes: totalFigureBakes,
    totalPrewarmBakes: totalFigurePrewarmBakes,
    totalEvictions: totalFigureEvictions,
    hitRatePercent: figureHitRate,
    peakFrameBakeMs: peakFigureBakeMs,
    note:
      'shared by the active player (HumanPlayer.prewarmHumanSprite) and every plaza citizen ' +
      '(Townsperson.render draws through drawTownCastSprite, which bakes into this same cache), ' +
      'so this is the crowd and the player together, not the player alone',
  },
  steadyState: {
    warmupFrames: warmupBoundary,
    framesMeasured: steadyStateFrames.length,
    bakes: steadyStateBakes,
    lazyBakes: steadyStateLazyBakes,
    prewarmBakes: steadyStatePrewarmBakes,
    bakingFrames: steadyStateBakingFrames.length,
    evictions: steadyStateEvictions,
    hitRatePercent: steadyStateHitRate,
  },
  spikes: {
    perFrameBakeCeiling,
    framesOverCeiling: overBakeCeilingFrames.length,
    maxFrameBakeMs,
    peakFrameBakeMsWholeRun: peakFigureBakeMs,
    peakFrameBakeMsArrival: arrivalPeakBakeMs,
    framesOverFrameBakeMs: overFrameBakeMsFrames.length,
    worstBakeFrames,
    worstRenderFrames,
    worstBakeMsFrames,
  },
  scenarios: {
    talkRow: {
      warmFrames: TALK_WARM_FRAMES,
      fullyWarm: talkRowFullyWarm,
      drawnExactly: talkDrawnExactly,
    },
    competingBakeBurst: {
      frames: BURST_FRAMES,
      evictions: burstEvictions,
      citizenDirectDraws: burstCitizenDirectDraws,
      clean: burstCleanRun,
    },
  },
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Town plaza measurement — headless node-canvas, worldSeed=${worldSeed}, ${frameCount} frames`,
  );
  console.log(`  viewport: ${viewportW}x${viewportH} CSS px @ ${REVIEW_DEVICE_PIXEL_RATIO}x DPR`);
  console.log(`  town population (all cohorts): ${townLife.people.length}`);
  console.log(`  people visible per frame (mean): ${meanVisiblePeople.toFixed(1)}`);
  console.log(
    `  update ms: mean ${updateSummary.mean.toFixed(MS_DECIMAL_PLACES)}, p95 ${updateSummary.p95.toFixed(MS_DECIMAL_PLACES)}, max ${updateSummary.max.toFixed(MS_DECIMAL_PLACES)}`,
  );
  console.log(
    `  render ms: mean ${renderSummary.mean.toFixed(MS_DECIMAL_PLACES)}, p95 ${renderSummary.p95.toFixed(MS_DECIMAL_PLACES)}, max ${renderSummary.max.toFixed(MS_DECIMAL_PLACES)}`,
  );
  console.log(
    `  figure cache: peak ${(peakFigureBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB / ${FIGURE_CACHE_BUDGET_MEGABYTES} MB budget, ` +
      `peak ${peakFigureFigures} figures, ${totalFigureBakes} bakes + ${totalFigurePrewarmBakes} prewarm bakes, ` +
      `${totalFigureEvictions} evictions, ${figureHitRate.toFixed(1)}% hit rate ` +
      `(shared by the player's own prewarmed sprite and every plaza citizen)`,
  );
  console.log(
    `  steady state (frames ${warmupBoundary}-${frameCount}): ${steadyStateBakes} bakes ` +
      `(${steadyStateLazyBakes} lazy, ${steadyStatePrewarmBakes} paced prewarm) across ` +
      `${steadyStateBakingFrames.length}/${steadyStateFrames.length} frames, ${steadyStateEvictions} evictions`,
  );
  console.log(
    `  frames baking more than ${perFrameBakeCeiling} cell(s): ${overBakeCeilingFrames.length}/${frameCount}`,
  );
  console.log(
    `  peak single-frame bake time: ${arrivalPeakBakeMs.toFixed(MS_DECIMAL_PLACES)} ms during ` +
      `arrival (frames 0-${warmupBoundary}), ${peakFigureBakeMs.toFixed(MS_DECIMAL_PLACES)} ms whole run ` +
      `(gate ceiling ${maxFrameBakeMs} ms on arrival, ${overFrameBakeMsFrames.length} frame(s) over it)`,
  );
  if (worstBakeMsFrames.length > 0) {
    console.log('  worst bake-ms frames:');
    for (const s of worstBakeMsFrames) {
      console.log(
        `    frame ${s.frame}: ${s.bakeMs.toFixed(MS_DECIMAL_PLACES)} ms baking (${s.bakes} bakes + ${s.prewarmBakes} prewarm)`,
      );
    }
  }
  if (worstBakeFrames.length > 0) {
    console.log('  worst bake frames:');
    for (const s of worstBakeFrames) {
      console.log(
        `    frame ${s.frame}: ${s.bakes} bakes + ${s.prewarmBakes} prewarm, ${s.evictions} evictions, render ${s.renderMs.toFixed(MS_DECIMAL_PLACES)} ms`,
      );
    }
  }
  console.log('  worst render frames:');
  for (const s of worstRenderFrames) {
    console.log(
      `    frame ${s.frame}: render ${s.renderMs.toFixed(MS_DECIMAL_PLACES)} ms, ${s.bakes} bakes + ${s.prewarmBakes} prewarm`,
    );
  }
  console.log(
    `  talk row (frozen citizen, ${TALK_WARM_FRAMES} warm frames): fully warm ${talkRowFullyWarm}, drawn exactly ${talkDrawnExactly}`,
  );
  console.log(
    `  competing bake burst (${BURST_FRAMES} frames): ${burstEvictions} evictions, ${burstCitizenDirectDraws} citizen direct draws`,
  );
}

if (gateMode) {
  const failures: string[] = [];
  // Gated on the lazy rate, not the total: a `prewarmBakes` cell is paid for
  // off the render path by design, and a large one-time backlog draining
  // through the paced queue is the fix working, not a regression of it.
  const steadyStateLazyBakeRate = steadyStateLazyBakes / Math.max(1, steadyStateFrames.length);
  if (steadyStateLazyBakeRate > maxSteadyStateBakeRate) {
    failures.push(
      `steady-state lazy bake rate: ${steadyStateLazyBakeRate.toFixed(MS_DECIMAL_PLACES)} cell bake(s)/frame ` +
        `paid on the render path after warmup (frames ${warmupBoundary}-${frameCount}, ` +
        `${steadyStateLazyBakes} total), want <= ${maxSteadyStateBakeRate}`,
    );
  }
  if (steadyStateEvictions > 0) {
    failures.push(
      `steady-state evictions: ${steadyStateEvictions} row(s) evicted after warmup — the crowd is ` +
        `thrashing against the cache budget, not just paying an idle-release trickle`,
    );
  }
  if (overBakeCeilingFrames.length > 0) {
    failures.push(
      `${overBakeCeilingFrames.length} arrival frame(s) baked more than ${perFrameBakeCeiling} cell(s) in one frame`,
    );
  }
  if (overFrameBakeMsFrames.length > 0) {
    failures.push(
      `${overFrameBakeMsFrames.length} arrival frame(s) spent more than ${maxFrameBakeMs} ms baking ` +
        `in one frame (peak ${arrivalPeakBakeMs.toFixed(MS_DECIMAL_PLACES)} ms) — the arrival warm-up's ` +
        `own per-frame slice, not the ordinary steady-state budget`,
    );
  }
  if (steadyStateHitRate < minHitRatePercent) {
    failures.push(
      `steady-state figure cache hit rate ${steadyStateHitRate.toFixed(1)}% is under the ${minHitRatePercent}% gate`,
    );
  }
  if (!talkRowFullyWarm || !talkDrawnExactly) {
    failures.push(
      `a citizen frozen for dialog did not get its talk row baked and drawn exactly within ` +
        `${TALK_WARM_FRAMES} frames (fully warm: ${talkRowFullyWarm}, drawn exactly: ${talkDrawnExactly}) ` +
        `— it is still showing an approximate idle/walk stand-in while a player would be looking at it`,
    );
  }
  if (!burstCleanRun) {
    failures.push(
      `a competing bake burst on the active player's own figure produced ${burstEvictions} ` +
        `eviction(s) and ${burstCitizenDirectDraws} citizen direct draw(s) over ${BURST_FRAMES} ` +
        `frames — a pinned citizen row was evicted, a citizen fell back to a direct paint, or both`,
    );
  }
  if (failures.length > 0) {
    console.error('FAIL verify:plaza-perf');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('PASS verify:plaza-perf');
  }
}
