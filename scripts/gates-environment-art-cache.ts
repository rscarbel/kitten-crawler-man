#!/usr/bin/env tsx
/**
 * Gates the runtime environment-art cache: that a floor's ground sheets arrive,
 * that they arrive paced, and that they leave cleanly.
 *
 * These are the properties the browser cannot check for itself. A sheet that
 * never lands leaves the whole floor in flat fallback colour; a sheet published
 * half-painted draws holes; a queue that ignores its budget turns a floor
 * transition into a stall; a sheet released without withdrawing its
 * `SpriteLoader` def leaves a def pointing at a surface that has been given up,
 * and the floor never repaints.
 *
 * Pacing is checked by what a frame defers, never by how long it took: the
 * probes that need a step to overspend burn the allowance themselves, and the
 * drain's frame times are printed for reading only, so a busy machine can't
 * fail the gate.
 *
 * Run: npm run gates:environment-art
 */

import { createCanvas } from 'canvas';

import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { asGameContext, asNodeCanvas } from './nodeGameContext.js';
import type { ResidentSet } from '../src/systems/WorldResidency.js';

installCanvasGlobals();

const {
  ENVIRONMENT_PAINT_BUDGET_MS,
  RECENTLY_DRAWN_FRAMES,
  beginEnvironmentArtFrame,
  environmentArtBytes,
  environmentArtSheetCount,
  environmentPaintDepth,
  environmentSheetEvictionStats,
  environmentSheetsAwaiting,
  flushEnvironmentArtCache,
  hasEnvironmentSheet,
  paintEnvironmentArtNow,
  releaseEnvironmentArt,
  requestEnvironmentSheet,
  residentEnvironmentSheetKeys,
  environmentRepaintCursor,
  environmentSheetState,
  environmentSheetsRepaintedSince,
  releaseEnvironmentSheet,
  deferEnvironmentSheet,
  wantEnvironmentSheet,
  environmentRepaintsWaiting,
  environmentSheetsQueued,
  RELEASED_GRACE_FRAMES,
  repaintedSheetRevision,
  setEnvironmentIdleWindowFrames,
  setEnvironmentSheetByteBudget,
} = await import('../src/map/environmentArtCache.js');
const { GROUND_SHEET_KEYS, requestGroundSheets } =
  await import('../src/map/ground/runtimeGroundSheets.js');
const { getManifestEntry, getSpriteDefByKey, getSpriteMissCounts } =
  await import('../src/core/spriteAssets/SpriteLoader.js');
const { drawDecorationLifeLayer } = await import('../src/map/tiles/decorationTiles.js');
const { drawSprite } = await import('../src/core/spriteAssets/SpriteRenderer.js');
const { BUILDING_SPECS } = await import('../src/sprites/buildinggen/buildings.js');
const { paintLifeFrame } = await import('../src/sprites/buildinggen/animate.js');
const { frameHeightPx, frameWidthPx } = await import('../src/sprites/buildinggen/spec.js');
type SpriteKey = Parameters<typeof getManifestEntry>[0];
type EnvironmentSheetPlan = Parameters<typeof requestEnvironmentSheet>[0];
const { BUILDING_SALT, floorArtSubSeed, setFloorArtSeed } =
  await import('../src/map/ground/floorArtSeed.js');
const {
  requestBuildingSheets,
  BUILDING_KEYS,
  BUILDING_LIFE_STATE,
  buildingLifeKeys,
  buildingLifeKeyOf,
  buildingSheetsNotYetQueued,
  wantBuildingSheet,
} = await import('../src/sprites/buildinggen/runtimeBuildingSheets.js');
const { FLOOR_ART_SEEDS } = await import('../src/map/ground/artSeedAlphabet.js');
const { propSheetPlanMismatches } = await import('../src/sprites/sheets/propSheetPlan.js');
const { townscapeSheetPlans, OVERWORLD_MAP_SIZE_TILES } =
  await import('../src/sprites/sheets/townscapeSheets.js');
const { overCitySheetPlans } = await import('../src/sprites/sheets/overCitySheets.js');
const { treeSheetPlans } = await import('../src/sprites/sheets/treeSheets.js');
const { rockSheetPlans } = await import('../src/sprites/sheets/rockSheets.js');
const { campSheetPlans } = await import('../src/sprites/sheets/campSheets.js');
const { villageSheetPlans } = await import('../src/sprites/sheets/villageSheets.js');
const { destructiblePropSheetPlans } =
  await import('../src/sprites/sheets/destructiblePropSheets.js');
const { floorTwoPropVariantSheetPlans } =
  await import('../src/sprites/sheets/propVariantSheets.js');
const { remainsSheetPlans } = await import('../src/sprites/sheets/remainsSheets.js');
const { stairwellSheetPlans } = await import('../src/sprites/sheets/stairwellSheets.js');
const { clubFurnitureSheetPlans } = await import('../src/sprites/sheets/clubFurnitureSheets.js');
const { allBossRoomSheetPlans } = await import('../src/sprites/sheets/bossRoomSheets.js');
const { bathroomSheetPlans } = await import('../src/sprites/sheets/bathroomSheets.js');
const { getLevelDef } = await import('../src/levels/index.js');
const { runCanvasRecovery } = await import('../src/core/rendering/canvasRecovery.js');
const { BYTES_PER_MEGABYTE, CanvasContextUnavailableError } =
  await import('../src/core/rendering/canvasSurface.js');
const { beginRenderFrame, holdIdleClock, releaseIdleClock } =
  await import('../src/core/rendering/renderFrameClock.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { EnvironmentSheetResidentSet, FACADE_LIFE_RING, FACADE_RING } =
  await import('../src/systems/EnvironmentSheetResidentSet.js');
const { FASTEST_WALK_TILES_PER_SECOND, tilesUntilInView, WorldResidency } =
  await import('../src/systems/WorldResidency.js');
const { OverlayTileCache } = await import('../src/map/TileRenderer.js');
const { SPRITE_BUILDING } = await import('../src/map/tileTypes.js');

const MASK_SHEET_KEY = 'ground_masks';
/**
 * Frames the floor's sheets may take to arrive.
 *
 * The town is the heaviest floor there is: roughly 450 ms of ground and two
 * seconds of facades, so at the cache's budget it owes a few hundred frames —
 * several seconds of a fade-in. Every frame runs at least its first step, and
 * this is more frames than the drain has steps, so a loaded machine cannot push
 * a draining queue past it: its job is to catch a queue that has stopped.
 */
const FRAME_BUDGET_TO_FINISH = 1200;

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

interface DrainReport {
  readonly frames: number;
  /** Every step the drain actually ran, including work queued while it ran. */
  readonly stepsDrained: number;
  readonly meanMsPerFrame: number;
  readonly worstFrameMs: number;
  readonly problems: ReadonlyArray<string>;
}

/**
 * Each probe below runs under an art seed no earlier probe used, so a sheet
 * left resident by one probe can never pass for the next probe's repaint.
 */
let nextArtSeedIndex = 1;
function freshArtSeed(): number {
  const seed = FLOOR_ART_SEEDS[nextArtSeedIndex];
  nextArtSeedIndex++;
  return seed;
}

function drainToCompletion(): DrainReport {
  let frames = 0;
  let totalMs = 0;
  let worstFrameMs = 0;
  let residentLastFrame = 0;
  let stepsDrained = 0;
  const problems: string[] = [];

  while (environmentPaintDepth() > 0 && frames < FRAME_BUDGET_TO_FINISH) {
    const owedBefore = environmentPaintDepth();
    const startedAt = performance.now();
    beginEnvironmentArtFrame();
    // Counted as the fall in what is owed *plus* anything queued in the
    // meantime, because a settled sheet's callback may queue the next one.
    stepsDrained += Math.max(0, owedBefore - environmentPaintDepth());
    const elapsed = performance.now() - startedAt;
    frames++;
    totalMs += elapsed;
    worstFrameMs = Math.max(worstFrameMs, elapsed);

    const residentNow = environmentArtSheetCount();
    if (residentNow < residentLastFrame) {
      problems.push(`the resident sheet count fell from ${residentLastFrame} to ${residentNow}`);
    }
    residentLastFrame = residentNow;
  }
  return {
    frames,
    stepsDrained,
    meanMsPerFrame: frames === 0 ? 0 : totalMs / frames,
    worstFrameMs,
    problems,
  };
}

/**
 * Every painted prop family, at an art seed of zero.
 *
 * The seed changes which pixels a variant paints, never how many frames it has
 * or how large they are, so one seed is enough to check a plan against the
 * geometry the manifest declares.
 */
const PROP_FAMILIES = [
  ...townscapeSheetPlans(),
  ...overCitySheetPlans(),
  ...treeSheetPlans(0),
  ...rockSheetPlans(0),
  ...campSheetPlans(0),
  ...villageSheetPlans(0),
  ...destructiblePropSheetPlans(0),
  ...floorTwoPropVariantSheetPlans(),
  ...remainsSheetPlans(),
  ...stairwellSheetPlans(),
  ...clubFurnitureSheetPlans(0),
  ...allBossRoomSheetPlans(0),
  ...bathroomSheetPlans(),
];

let plansChecked = 0;
for (const plan of PROP_FAMILIES) {
  plansChecked++;
  for (const mismatch of propSheetPlanMismatches(plan)) failures.push(mismatch);
}
check(
  plansChecked > 0,
  'no prop sheet plans were checked, so a family could disagree with the manifest unnoticed',
);

// The town's sheet layouts derive their spans from a town plan built at this
// size, and a plan built at the wrong size carries frames for widths no alley
// has — the lines would simply draw nothing.
const level3MapSize = getLevelDef('level3').mapSize;
check(
  OVERWORLD_MAP_SIZE_TILES === level3MapSize,
  `the townscape sheets plan for a ${OVERWORLD_MAP_SIZE_TILES}-tile town, but level 3 is ` +
    `${level3MapSize} tiles across`,
);

setFloorArtSeed(freshArtSeed());
requestGroundSheets(GROUND_SHEET_KEYS);
// The facades go through the queue too, and they are the only family whose
// sheet is assembled from stages rather than painted whole — so they are the
// one that can publish at the wrong size, run its composite before its planes,
// or leave a life frame unpainted. Painting them here is that check: a facade
// that disagrees with its manifest entry throws inside `registerPaintedSprite`.
requestBuildingSheets(floorArtSubSeed(BUILDING_SALT));

/** Every sheet this gate expects to see painted and published. */
const PAINTED_KEYS = [
  ...GROUND_SHEET_KEYS,
  MASK_SHEET_KEY,
  ...BUILDING_KEYS,
  ...buildingLifeKeys(),
];

const owedAtStart = environmentPaintDepth();
check(owedAtStart > 0, 'requesting every ground sheet queued no work at all');
for (const key of PAINTED_KEYS) {
  check(
    !hasEnvironmentSheet(key),
    `"${key}" reported as painted before a single frame had been spent on it`,
  );
  check(
    getSpriteDefByKey(key) === undefined,
    `"${key}" was published to SpriteLoader before it was painted`,
  );
}

const report = drainToCompletion();
for (const problem of report.problems) failures.push(problem);

check(
  environmentPaintDepth() === 0,
  `the queue still owed ${environmentPaintDepth()} steps after ${report.frames} frames — ` +
    `it has stopped draining`,
);
for (const key of PAINTED_KEYS) {
  check(hasEnvironmentSheet(key), `"${key}" never finished painting`);
  check(getSpriteDefByKey(key) !== undefined, `"${key}" was painted but never published`);
}
check(
  environmentArtSheetCount() === PAINTED_KEYS.length,
  `expected ${PAINTED_KEYS.length} resident sheets, found ${environmentArtSheetCount()}`,
);
check(environmentArtBytes() > 0, 'the painted sheets report no memory at all');

const bytesBeforeRelease = environmentArtBytes();
// The town's own keep set: the masks are in it, and nothing else this gate
// painted is, so both release criteria are exercised at once.
releaseEnvironmentArt(new Set([MASK_SHEET_KEY]));
check(
  hasEnvironmentSheet(MASK_SHEET_KEY),
  'the corner masks were released at a floor change, though nothing about them varies with the floor',
);
check(
  getSpriteDefByKey(MASK_SHEET_KEY) !== undefined,
  'the corner masks were withdrawn from SpriteLoader though the cache still holds them',
);
for (const key of GROUND_SHEET_KEYS) {
  check(!hasEnvironmentSheet(key), `"${key}" survived a floor change, but its art is seeded`);
  check(
    getSpriteDefByKey(key) === undefined,
    `"${key}" was released but its SpriteLoader def still points at the surface that was ` +
      `given up — the next lookup draws a zero-sized image instead of repainting`,
  );
}
check(environmentArtBytes() < bytesBeforeRelease, 'a floor change gave no memory back at all');

// The next floor asks for the same keys under a new seed: the released sheets
// must queue again rather than be mistaken for still-resident.
setFloorArtSeed(freshArtSeed());
requestGroundSheets(GROUND_SHEET_KEYS);
check(
  environmentPaintDepth() > 0,
  'the next floor queued nothing — released sheets are being treated as still painted',
);

// ── the hazards no ordinary drain reaches ──────────────────────────────────

/**
 * Burns the frame's whole paint allowance.
 *
 * A gate probe has to be able to say what a step costs, because what it is
 * probing is the pacing: the cache runs the first step of a frame whatever it
 * costs and then refuses anything that will not fit in what is left.
 */
function spendPastTheBudget(): void {
  const until = performance.now() + ENVIRONMENT_PAINT_BUDGET_MS;
  while (performance.now() < until) {
    // Nothing to do but let the clock move.
  }
}

/**
 * A plan whose steps paint a solid block into a sheet, so a gate can read back
 * whether a row was actually inked.
 *
 * Sized and keyed as one of the real ground sheets, because `registerPaintedSprite`
 * refuses anything whose geometry disagrees with its manifest entry — which is
 * the point: this exercises the same publication path the real sheets take.
 */
function blockPlan(
  key: SpriteKey,
  options: {
    readySteps?: number;
    throwOnStep?: number;
    /** A step refused a surface the first time it runs, as a browser out of canvas memory does. */
    refuseOnceOnStep?: number;
    onSettled?: () => void;
  },
): EnvironmentSheetPlan {
  let refused = false;
  const entry = getManifestEntry(key);
  const states = Object.values(entry.states);
  const columns = Math.max(...states.map((state) => (state.colOffset ?? 0) + state.frameCount));
  const rows = Math.max(...states.map((state) => state.row)) + 1;
  const STEP_COUNT = 4;
  const stripeHeight = (rows * entry.frameHeight) / STEP_COUNT;
  return {
    key,
    widthPx: columns * entry.frameWidth,
    heightPx: rows * entry.frameHeight,
    variesWithFloorSeed: true,
    readySteps: options.readySteps,
    onSettled: options.onSettled,
    steps: Array.from({ length: STEP_COUNT }, (_unused, step) => ({
      costClass: `gate:block:${step}`,
      paint: (ctx) => {
        if (step === options.throwOnStep) throw new Error('deliberate painter failure');
        if (step === options.refuseOnceOnStep && !refused) {
          refused = true;
          throw new CanvasContextUnavailableError();
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, step * stripeHeight, columns * entry.frameWidth, stripeHeight);
        // The first step deliberately spends the whole frame's allowance, so the
        // steps behind it are held to the next frame. Without that these four
        // fills all land together and a sheet published at its ready step is
        // already finished — which would make the check below assert nothing.
        if (step === 0) spendPastTheBudget();
      },
    })),
  };
}

/** Whether any pixel of a horizontal band of a published sheet has been painted. */
function bandIsInked(key: SpriteKey, band: number, bands: number): boolean {
  const def = getSpriteDefByKey(key);
  if (def === undefined) return false;
  const surface = def.img;
  if (!('getContext' in surface)) return false;
  const height = Math.floor(surface.height / bands);
  const probe = createCanvas(surface.width, height);
  const probeCtx = probe.getContext('2d');
  probeCtx.drawImage(asNodeCanvas(surface), 0, -band * height);
  const pixels = probeCtx.getImageData(0, 0, surface.width, height).data;
  const ALPHA_OFFSET = 3;
  const CHANNELS_PER_PIXEL = 4;
  for (let index = ALPHA_OFFSET; index < pixels.length; index += CHANNELS_PER_PIXEL) {
    if (pixels[index] > 0) return true;
  }
  return false;
}

const PROBE_KEY: SpriteKey = 'ground_floor1';
const PROBE_BANDS = 4;
const PROBE_READY_STEPS = 1;

flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());

// A sheet published before its last step: the ready band must be drawable the
// moment it is published, and the bands behind it must still be empty. Nothing
// else in this gate reads a pixel, and this is the one family that publishes
// early — a facade shows its walls while its lit windows are still owed.
requestEnvironmentSheet(blockPlan(PROBE_KEY, { readySteps: PROBE_READY_STEPS }));
while (!hasEnvironmentSheet(PROBE_KEY) && environmentPaintDepth() > 0) {
  beginEnvironmentArtFrame();
}
check(hasEnvironmentSheet(PROBE_KEY), 'a plan with ready steps never published at all');
check(
  bandIsInked(PROBE_KEY, 0, PROBE_BANDS),
  'a sheet was published with its ready band still empty — it is drawable and blank',
);
check(
  !bandIsInked(PROBE_KEY, PROBE_BANDS - 1, PROBE_BANDS),
  'a sheet published at its ready step already had its owed rows painted, so the early ' +
    'publication this checks is not being exercised',
);
while (environmentPaintDepth() > 0) beginEnvironmentArtFrame();
check(
  bandIsInked(PROBE_KEY, PROBE_BANDS - 1, PROBE_BANDS),
  'a sheet published early never finished painting the rows it still owed',
);

// A painter that throws must lose its own sheet and nothing else — and must
// still tell whoever queued it, or a caller sequencing sheets stops dead.
flushEnvironmentArtCache();
let settled = false;
requestEnvironmentSheet(
  blockPlan(PROBE_KEY, { throwOnStep: 1, onSettled: () => (settled = true) }),
);
const THROWING_PLAN_FRAMES = 20;
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(!hasEnvironmentSheet(PROBE_KEY), 'a sheet whose painter threw was published anyway');
check(
  getSpriteDefByKey(PROBE_KEY) === undefined,
  'a sheet whose painter threw is still drawable from SpriteLoader — half its art is missing ' +
    'and nothing will ever repaint it',
);
check(
  environmentArtBytes() === 0,
  `a sheet whose painter threw before publishing kept ${environmentArtBytes()} bytes of surface`,
);
check(settled, 'a sheet whose painter threw never told its caller, so a queued chain would stall');
check(environmentPaintDepth() === 0, 'an abandoned sheet left work on the queue');

// The other half of the same rule: a sheet that had already been published keeps
// what it painted. Losing it would take a whole building off the street because
// one of its two dozen life frames failed.
flushEnvironmentArtCache();
let settledAfterPublishing = false;
requestEnvironmentSheet(
  blockPlan(PROBE_KEY, {
    readySteps: PROBE_READY_STEPS,
    throwOnStep: 2,
    onSettled: () => (settledAfterPublishing = true),
  }),
);
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(
  hasEnvironmentSheet(PROBE_KEY),
  'a sheet that had already been published was thrown away when a later step failed, ' +
    'so one bad frame costs the whole picture',
);
check(
  bandIsInked(PROBE_KEY, 0, PROBE_BANDS),
  'a sheet kept after a failed step is drawable but blank',
);
check(settledAfterPublishing, 'a published sheet that then failed never told its caller');
check(environmentPaintDepth() === 0, 'a published sheet that then failed left work on the queue');

// A published sheet one of whose later steps the browser refuses a surface
// must paint the rows it still owes once memory is back — a facade's lit
// windows, a tree's felling row — rather than keep them blank for the floor.
flushEnvironmentArtCache();
const REFUSED_PUBLISHED_STEP = 2;
let refusedPublishedSettles = 0;
requestEnvironmentSheet(
  blockPlan(PROBE_KEY, {
    readySteps: PROBE_READY_STEPS,
    refuseOnceOnStep: REFUSED_PUBLISHED_STEP,
    onSettled: () => refusedPublishedSettles++,
  }),
);
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(hasEnvironmentSheet(PROBE_KEY), 'a published sheet refused a later surface was dropped');
check(
  refusedPublishedSettles === 0,
  'a published sheet refused a later surface told its caller it was finished while rows were owed',
);
runCanvasRecovery('memoryPressure', null);
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(
  bandIsInked(PROBE_KEY, REFUSED_PUBLISHED_STEP, PROBE_BANDS),
  'a published sheet refused a surface for a later row never painted that row',
);
check(
  refusedPublishedSettles === 1,
  `a published sheet refused a later surface told its caller ${refusedPublishedSettles} times, not once`,
);

// Released while still painting. A floor can be left at any moment, including
// mid-paint, and a sheet dropped then must be dropped completely: its work
// forgotten, its surface given back, and — the part that would be silent — it
// must not go on to publish itself onto a floor that no longer exists.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestGroundSheets(GROUND_SHEET_KEYS);
const MID_PAINT_FRAMES = 3;
for (let frame = 0; frame < MID_PAINT_FRAMES; frame++) beginEnvironmentArtFrame();
check(environmentPaintDepth() > 0, 'nothing was still owed, so releasing mid-paint was not tested');
const owedMidPaint = environmentPaintDepth();
releaseEnvironmentArt(new Set());
check(
  environmentPaintDepth() === 0,
  `a sheet released while it was still painting kept ${environmentPaintDepth()} of its ` +
    `${owedMidPaint} owed steps`,
);
const SETTLING_FRAMES = 40;
for (let frame = 0; frame < SETTLING_FRAMES; frame++) beginEnvironmentArtFrame();
for (const key of GROUND_SHEET_KEYS) {
  check(
    !hasEnvironmentSheet(key),
    `"${key}" was released mid-paint and then published itself onto a floor that had gone`,
  );
}
check(
  environmentArtBytes() === 0,
  `releasing every sheet mid-paint left ${environmentArtBytes()} bytes behind`,
);

// A new floor's seed with nothing released: the cache must notice its sheets
// belong to a floor that no longer exists. This is the death-restart path,
// which builds a new map and never takes the stairs.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestGroundSheets(GROUND_SHEET_KEYS);
while (environmentPaintDepth() > 0) beginEnvironmentArtFrame();
const paintedUnderOldSeed = environmentArtSheetCount();
check(
  paintedUnderOldSeed > 0,
  'nothing was painted under the first seed, so staleness is untested',
);
setFloorArtSeed(freshArtSeed());
requestGroundSheets(GROUND_SHEET_KEYS);
check(
  environmentPaintDepth() > 0,
  'a floor that changed its art seed without releasing anything queued no repaint — its ' +
    "ground still carries the previous floor's grain",
);

// Canvas memory spent, as a browser refuses it: every sheet asked for must be
// held to be asked for again, none may stop the requests behind it, and once
// memory is back every one of them must land.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
const canvasGlobals: { document?: unknown } = globalThis;
const contextGivingDocument = canvasGlobals.document;
canvasGlobals.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`harness cannot create <${tag}>`);
    const refused = createCanvas(1, 1);
    Object.defineProperty(refused, 'getContext', { value: () => null });
    return refused;
  },
};
let refusedRequestThrew = false;
try {
  requestGroundSheets(GROUND_SHEET_KEYS);
} catch {
  refusedRequestThrew = true;
}
canvasGlobals.document = contextGivingDocument;
const MASK_SHEETS = 1;
const sheetsAskedFor = GROUND_SHEET_KEYS.length + MASK_SHEETS;
check(!refusedRequestThrew, 'a sheet refused a surface threw out of the floor’s requests');
check(
  environmentSheetsAwaiting() === sheetsAskedFor,
  `${environmentSheetsAwaiting()} of ${sheetsAskedFor} sheets refused a surface are held to be ` +
    'asked for again; the rest are lost until the floor is entered again',
);
runCanvasRecovery('memoryPressure', null);
const FRAMES_TO_LAND_DEFERRED = 4000;
for (
  let frame = 0;
  frame < FRAMES_TO_LAND_DEFERRED &&
  (environmentPaintDepth() > 0 || environmentSheetsAwaiting() > 0);
  frame++
) {
  beginEnvironmentArtFrame();
}
for (const key of GROUND_SHEET_KEYS) {
  check(hasEnvironmentSheet(key), `"${key}" was refused a surface and never painted afterwards`);
}

// A step refused a surface part way through is the browser's doing, not the
// painter's: the sheet must be held and painted again, not abandoned for the
// floor, and its caller told exactly once.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
let refusedMidPaintSettles = 0;
requestEnvironmentSheet(
  blockPlan(PROBE_KEY, { refuseOnceOnStep: 1, onSettled: () => refusedMidPaintSettles++ }),
);
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(
  environmentSheetsAwaiting() === 1,
  'a sheet refused a surface mid-paint was abandoned for the floor instead of held',
);
check(
  refusedMidPaintSettles === 1,
  `a sheet refused a surface mid-paint told its caller ${refusedMidPaintSettles} times, not once`,
);
runCanvasRecovery('memoryPressure', null);
for (
  let frame = 0;
  frame < FRAMES_TO_LAND_DEFERRED &&
  (environmentPaintDepth() > 0 || environmentSheetsAwaiting() > 0);
  frame++
) {
  beginEnvironmentArtFrame();
}
check(
  hasEnvironmentSheet(PROBE_KEY),
  'a sheet refused a surface mid-paint never painted once memory was back',
);

// ── the byte budget ────────────────────────────────────────────────────────

/** Every pixel of a published sheet, or null when it is not published. */
function sheetPixels(key: SpriteKey): Uint8ClampedArray | null {
  const def = getSpriteDefByKey(key);
  if (def === undefined || !('getContext' in def.img)) return null;
  const surface = def.img;
  const probe = createCanvas(surface.width, surface.height);
  const probeCtx = probe.getContext('2d');
  probeCtx.drawImage(asNodeCanvas(surface), 0, 0);
  return probeCtx.getImageData(0, 0, surface.width, surface.height).data;
}

function samePixels(a: Uint8ClampedArray | null, b: Uint8ClampedArray | null): boolean {
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

// Over a budget of nothing, every sheet goes once it has sat undrawn past the
// protection window — except the one looked up on every frame, and the facade
// drawn on every frame only from the overlay entry baked from it — and a
// lookup of an evicted sheet paints it again, pixel for pixel.
const DRAWN_KEY: SpriteKey = 'ground_floor1';
const IDLE_KEY: SpriteKey = 'ground_floor2';
const FACADE_KEY = BUILDING_KEYS[0];
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestGroundSheets([DRAWN_KEY, IDLE_KEY]);
requestBuildingSheets(floorArtSubSeed(BUILDING_SALT));
paintEnvironmentArtNow();
const PROBE_TILE_SIZE = 32;
const FACADE_TILE = { tileId: 'gate-facade', type: SPRITE_BUILDING, spriteKey: FACADE_KEY };
const overlayCache = new OverlayTileCache([[FACADE_TILE]], PROBE_TILE_SIZE);
check(
  overlayCache.get(SPRITE_BUILDING, 0, 0) !== null,
  'the budget probe could not bake an overlay entry from a facade',
);
const keptKeys = new Set<string>([DRAWN_KEY, FACADE_KEY]);
const idleKeys = residentEnvironmentSheetKeys().filter((key) => !keptKeys.has(key));
check(idleKeys.includes(IDLE_KEY), 'the budget probe painted no idle sheet to evict');
const idlePixelsBefore = sheetPixels(IDLE_KEY);
const evictionsBefore = environmentSheetEvictionStats();
setEnvironmentSheetByteBudget(0);
// Only the budget lets go here: the idle sweep has its own probe below.
setEnvironmentIdleWindowFrames(Number.POSITIVE_INFINITY);
for (let frame = 0; frame <= RECENTLY_DRAWN_FRAMES; frame++) {
  beginRenderFrame();
  overlayCache.beginFrame();
  getSpriteDefByKey(DRAWN_KEY);
  overlayCache.get(SPRITE_BUILDING, 0, 0);
  beginEnvironmentArtFrame();
  if (!hasEnvironmentSheet(DRAWN_KEY) || !hasEnvironmentSheet(FACADE_KEY)) break;
}
check(hasEnvironmentSheet(DRAWN_KEY), 'a sheet drawn on every frame was evicted over the budget');
check(
  hasEnvironmentSheet(FACADE_KEY),
  'a facade drawn on every frame from its cached overlay entry was evicted over the budget',
);
for (const key of idleKeys) {
  check(!hasEnvironmentSheet(key), `"${key}" sat undrawn past the window but was not evicted`);
  check(getSpriteDefByKey(key) === undefined, `"${key}" was evicted but is still published`);
}
const evictionsAfter = environmentSheetEvictionStats();
check(
  evictionsAfter.evictions - evictionsBefore.evictions === idleKeys.length,
  `expected ${idleKeys.length} evictions over the budget, counted ` +
    `${evictionsAfter.evictions - evictionsBefore.evictions}`,
);
setEnvironmentSheetByteBudget(null);
setEnvironmentIdleWindowFrames(null);
paintEnvironmentArtNow();
check(hasEnvironmentSheet(IDLE_KEY), 'an evicted sheet looked up again was never repainted');
check(
  environmentSheetEvictionStats().repaintsAfterEviction - evictionsBefore.repaintsAfterEviction ===
    idleKeys.length,
  'an evicted sheet was repainted without being looked up, or looked up without being repainted',
);
check(
  samePixels(idlePixelsBefore, sheetPixels(IDLE_KEY)),
  'an evicted sheet repainted to different pixels than it held before',
);

// ── the idle sweep ─────────────────────────────────────────────────────────

/**
 * The sweep's window for the probes below: long enough for a sheet to be
 * painted inside it, short enough to walk out of and back into.
 */
const PROBE_IDLE_WINDOW_FRAMES = 240;

function idleFrames(frames: number, eachFrame: () => void = () => undefined): void {
  for (let frame = 0; frame < frames; frame++) {
    beginRenderFrame();
    eachFrame();
    beginEnvironmentArtFrame();
  }
}

// Within budget, a sheet nothing draws for the window goes; one drawn every
// frame stays; and a loading screen's hold ages neither.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
setEnvironmentIdleWindowFrames(PROBE_IDLE_WINDOW_FRAMES);
requestGroundSheets([DRAWN_KEY, IDLE_KEY]);
paintEnvironmentArtNow();
const undrawnKeys = residentEnvironmentSheetKeys().filter((key) => key !== DRAWN_KEY);
const sweptBefore = environmentSheetEvictionStats();
holdIdleClock();
idleFrames(PROBE_IDLE_WINDOW_FRAMES * 2, () => getSpriteDefByKey(DRAWN_KEY));
releaseIdleClock();
check(
  hasEnvironmentSheet(IDLE_KEY),
  'a sheet went undrawn only while the idle clock was held (a loading screen, a visit indoors) and the sweep let it go',
);
idleFrames(PROBE_IDLE_WINDOW_FRAMES + 1, () => getSpriteDefByKey(DRAWN_KEY));
check(hasEnvironmentSheet(DRAWN_KEY), 'a sheet drawn on every frame was let go by the idle sweep');
for (const key of undrawnKeys) {
  check(!hasEnvironmentSheet(key), `"${key}" sat undrawn past the idle window but was not let go`);
}
const sweptAfter = environmentSheetEvictionStats();
check(
  sweptAfter.idleReleases - sweptBefore.idleReleases === undrawnKeys.length &&
    sweptAfter.evictions === sweptBefore.evictions,
  `expected the idle sweep to let go of the ${undrawnKeys.length} undrawn sheets and the budget ` +
    `of none; counted ${sweptAfter.idleReleases - sweptBefore.idleReleases} and ` +
    `${sweptAfter.evictions - sweptBefore.evictions}`,
);
check(
  getSpriteDefByKey(IDLE_KEY) === undefined,
  'a sheet let go by the idle sweep is still published',
);
paintEnvironmentArtNow();
check(hasEnvironmentSheet(IDLE_KEY), 'a sheet let go by the idle sweep never repainted on lookup');

// ── the distance hold ──────────────────────────────────────────────────────

const VIEW_W = 1280;
const VIEW_H = 720;
setViewportSize(VIEW_W, VIEW_H);
const UPDATES_PER_SECOND = 60;
const WALK_TILES_PER_FRAME = FASTEST_WALK_TILES_PER_SECOND / UPDATES_PER_SECOND;
const releaseTiles =
  FACADE_RING.leadSeconds * FASTEST_WALK_TILES_PER_SECOND + FACADE_RING.releaseHysteresisTiles;
/** A placed sheet's area, standing in for a building. */
const PLACED_AREA = { x: 0, y: 0, w: 4, h: 4 };
/** Where the party stands just outside the hold ring, so it holds without drawing. */
const HOLD_EDGE_MARGIN_TILES = 1;
/** Tiles out to walk past the ring before turning back, so the sheet is released. */
const FAR_WALK_TILES = 200;
const placedKey = PROBE_KEY;
const floorWideKey: SpriteKey = 'ground_interior';

interface WalkReport {
  /** Frames the placed sheet was in view while it was not drawable. */
  readonly framesMissingInView: number;
  /** Whether the placed sheet was still resident when the party stood near it. */
  readonly heldWhileNear: boolean;
  /** Whether it was let go by the time the party was past the release ring, the sweep held off. */
  readonly releasedOnLeaving: boolean;
}

/**
 * Stands just outside the view of a placed sheet past the idle window, walks
 * past the release ring with the sweep held off, then walks back at the
 * fastest walk: what a party does leaving a district and returning to it.
 */
function walkAwayAndBack(): WalkReport {
  flushEnvironmentArtCache();
  setFloorArtSeed(freshArtSeed());
  // Block plans rather than real art, so a repaint takes a few frames however
  // loaded the machine is, well inside the lead the walk back is given.
  requestEnvironmentSheet(blockPlan(placedKey, {}));
  requestEnvironmentSheet(blockPlan(floorWideKey, {}));
  paintEnvironmentArtNow();
  const residency = new WorldResidency();
  residency.register(
    new EnvironmentSheetResidentSet(
      FACADE_RING,
      [
        { entry: placedKey, area: PLACED_AREA },
        { entry: floorWideKey, area: { x: -FAR_WALK_TILES, y: 0, w: FAR_WALK_TILES * 2, h: 1 } },
      ],
      { bakesUnderLoadingScreen: true },
    ),
  );
  const halfViewTiles = VIEW_W / 2 / TILE_SIZE;
  let partyTileX = PLACED_AREA.x + PLACED_AREA.w + halfViewTiles + HOLD_EDGE_MARGIN_TILES;
  let framesMissingInView = 0;
  const step = (): void => {
    const focus = { x: partyTileX * TILE_SIZE, y: PLACED_AREA.y * TILE_SIZE };
    residency.update(() => ({ focus: [focus], covered: false }));
    if (tilesUntilInView(focus, PLACED_AREA) === 0) {
      if (!hasEnvironmentSheet(placedKey)) framesMissingInView++;
      getSpriteDefByKey(placedKey);
    }
  };
  idleFrames(PROBE_IDLE_WINDOW_FRAMES * 2, step);
  const heldWhileNear = hasEnvironmentSheet(placedKey);
  // Only the release can let it go from here on.
  setEnvironmentIdleWindowFrames(Number.POSITIVE_INFINITY);
  const walkFrames = Math.ceil(FAR_WALK_TILES / WALK_TILES_PER_FRAME);
  idleFrames(walkFrames, () => {
    partyTileX += WALK_TILES_PER_FRAME;
    step();
  });
  const releasedOnLeaving = !hasEnvironmentSheet(placedKey);
  // Back past where it stood, onto the sheet's own area.
  const returnFrames = Math.ceil((partyTileX - PLACED_AREA.x) / WALK_TILES_PER_FRAME);
  idleFrames(returnFrames, () => {
    partyTileX -= WALK_TILES_PER_FRAME;
    step();
  });
  setEnvironmentIdleWindowFrames(PROBE_IDLE_WINDOW_FRAMES);
  return { framesMissingInView, heldWhileNear, releasedOnLeaving };
}

check(
  FAR_WALK_TILES > releaseTiles * 2,
  'the distance-hold probe never walks past the release ring, so it tests nothing',
);
const walk = walkAwayAndBack();
check(
  walk.heldWhileNear,
  'a placed sheet within the hold ring but out of view was let go by the idle sweep',
);
check(
  walk.releasedOnLeaving,
  'a placed sheet past its release ring was kept: what is let go there must not wait out the ' +
    'idle window, or the working set the budget gate measures is not what stays resident',
);
check(
  walk.framesMissingInView === 0,
  `walking back to a placed sheet the sweep had let go, it was missing for ` +
    `${walk.framesMissingInView} frames in view; it must be painted again before the camera reaches it`,
);
check(
  hasEnvironmentSheet(floorWideKey),
  'a sheet placed over the whole floor was let go although the party never left it',
);

// ── a let-go sheet is owed on demand, and announced by key ─────────────────

// A scene rebuilt around a floor asks for the floor's sheets again; one let go
// must stay let go until something wants it, or every door repaints the floor.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
paintEnvironmentArtNow();
releaseEnvironmentSheet(placedKey);
idleFrames(RELEASED_GRACE_FRAMES + 1);
check(!hasEnvironmentSheet(placedKey), 'a sheet released by its resident set outlived its grace');
// Asked for again, as an interior re-entered after the party was outdoors a
// while asks for its own sheets, its repaint must be owed where an arrival
// card counts it, or the card lifts onto a bare room.
const revisionBefore = repaintedSheetRevision();
const cursorBefore = environmentRepaintCursor();
const reaskOutcome = requestEnvironmentSheet(blockPlan(placedKey, {}));
check(
  reaskOutcome === 'owedOnDemand' &&
    environmentSheetState(placedKey) === 'owed' &&
    environmentRepaintsWaiting() > 0,
  `asking again for a sheet let go (${reaskOutcome}) left it ${environmentSheetState(placedKey)} ` +
    'with no repaint waiting, so a loading card would lift before it lands',
);
// It lands announced by its key, not by the revision that makes every chunk
// and overlay entry on the floor re-bake.
paintEnvironmentArtNow();
const announced = environmentSheetsRepaintedSince(cursorBefore).sheets.map((sheet) => sheet.key);
check(hasEnvironmentSheet(placedKey), 'a let-go sheet wanted again was never painted');
check(
  repaintedSheetRevision() === revisionBefore && announced.includes(placedKey),
  'a let-go sheet painted again bumped the floor-wide repaint revision instead of announcing ' +
    'its own key, so every chunk and overlay entry would re-bake',
);

// ── released before it landed ──────────────────────────────────────────────

// A sheet released while still painting lands released, and goes after the
// grace; kept instead, every life row that enters and leaves view at speed
// would stay for the whole idle window.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
releaseEnvironmentSheet(placedKey);
paintEnvironmentArtNow();
idleFrames(RELEASED_GRACE_FRAMES + 1);
check(
  !hasEnvironmentSheet(placedKey),
  'a sheet released while it was still painting was kept after it landed',
);
// Released while painting, then wanted again before it landed: the want
// cancels the release, and it lands kept.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
releaseEnvironmentSheet(placedKey);
wantEnvironmentSheet(placedKey);
paintEnvironmentArtNow();
idleFrames(RELEASED_GRACE_FRAMES + 1);
check(
  hasEnvironmentSheet(placedKey),
  'a sheet released while painting and then wanted again was let go when it landed',
);
// A purge while a released sheet is still painting must not repaint it as
// if it were wanted: it would land unreleased and stay the idle window.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
releaseEnvironmentSheet(placedKey);
runCanvasRecovery('purged', null);
check(
  environmentSheetState(placedKey) === 'evicted',
  `a purge left a sheet released while painting ${environmentSheetState(placedKey)}; ` +
    'repainted, it would land unreleased and stay for the idle window',
);
// Released while painting and then refused a surface mid-paint: nothing
// wants it, so it is owed on demand rather than retried and landed unreleased.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, { refuseOnceOnStep: 1 }));
releaseEnvironmentSheet(placedKey);
for (let frame = 0; frame < THROWING_PLAN_FRAMES; frame++) beginEnvironmentArtFrame();
check(
  environmentSheetState(placedKey) === 'evicted',
  `a sheet released while painting and then refused a surface is ` +
    `${environmentSheetState(placedKey)}; a retry would land it unreleased`,
);
// A sheet waiting out a refused surface when released waits for nothing.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
deferEnvironmentSheet(placedKey, true, () => blockPlan(placedKey, {}));
releaseEnvironmentSheet(placedKey);
check(
  environmentSheetState(placedKey) === 'evicted',
  `a sheet refused a surface and then released is ${environmentSheetState(placedKey)}; ` +
    'it should be owed on demand, not retried',
);
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
paintEnvironmentArtNow();
releaseEnvironmentSheet(placedKey);
idleFrames(RELEASED_GRACE_FRAMES + 1);
// A repaint waiting its turn when released is not started at all.
wantEnvironmentSheet(placedKey);
releaseEnvironmentSheet(placedKey);
check(
  environmentSheetState(placedKey) === 'evicted',
  `a waiting repaint released before its turn is ${environmentSheetState(placedKey)}; it ` +
    'should go back to being owed on demand',
);
// A facade released before its turn in the building queue is taken back.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
const queueProbeSet = new EnvironmentSheetResidentSet(FACADE_RING, [], {
  bakesUnderLoadingScreen: false,
});
queueProbeSet.warm(BUILDING_KEYS[0], 'urgent');
queueProbeSet.warm(BUILDING_KEYS[1], 'urgent');
const waitingBefore = buildingSheetsNotYetQueued();
queueProbeSet.release(BUILDING_KEYS[1]);
check(
  waitingBefore === 1 && buildingSheetsNotYetQueued() === 0,
  `a facade released before its turn stayed in the building queue (${waitingBefore} waiting, ` +
    `then ${buildingSheetsNotYetQueued()})`,
);
flushEnvironmentArtCache();

// A purge does not repaint a sheet its resident set has just released, even
// one drawn a moment ago: it is going anyway.
setFloorArtSeed(freshArtSeed());
requestEnvironmentSheet(blockPlan(placedKey, {}));
paintEnvironmentArtNow();
idleFrames(1, () => getSpriteDefByKey(placedKey));
releaseEnvironmentSheet(placedKey);
runCanvasRecovery('purged', null);
check(
  environmentSheetState(placedKey) === 'evicted',
  `a purge left a just-released sheet ${environmentSheetState(placedKey)}; repainted, it ` +
    'would also lose its release and stay for the idle window',
);
flushEnvironmentArtCache();

// ── a loading screen's budget across the sets that bake ───────────────────

/** A resident set with nothing placed that only bakes, spending what `spendMs` says of its share. */
function bakingProbeSet(
  spendMs: (shareMs: number) => number,
  offered: number[],
): ResidentSet<string> {
  return {
    leadSeconds: FACADE_RING.leadSeconds,
    releaseHysteresisTiles: FACADE_RING.releaseHysteresisTiles,
    entriesStartHeld: false,
    keyOf: (key) => key,
    placements: () => [],
    hold: () => undefined,
    release: () => undefined,
    warm: () => false,
    warmth: () => 'warm',
    bakeFor: (budgetMs) => {
      offered.push(budgetMs);
      const until = performance.now() + spendMs(budgetMs);
      while (performance.now() < until) {
        // Spends its share, as a busy cache would.
      }
    },
  };
}
const PROBE_BAKE_BUDGET_MS = 12;
/** Share of the budget the second set must be offered once the first spent none of its own. */
const UNSPENT_SHARE_PASSED_ON = 0.9;
const offeredToFirst: number[] = [];
const offeredToSecond: number[] = [];
const bakingResidency = new WorldResidency();
bakingResidency.register(bakingProbeSet(() => 0, offeredToFirst));
bakingResidency.register(bakingProbeSet((share) => share, offeredToSecond));
bakingResidency.register(
  new EnvironmentSheetResidentSet(FACADE_LIFE_RING, [], { bakesUnderLoadingScreen: false }),
);
bakingResidency.bakeFor(PROBE_BAKE_BUDGET_MS, true);
check(
  (offeredToSecond[0] ?? 0) >= PROBE_BAKE_BUDGET_MS * UNSPENT_SHARE_PASSED_ON,
  `a set that spent none of its share left the next set only ${offeredToSecond[0] ?? 0} ms ` +
    `of a ${PROBE_BAKE_BUDGET_MS} ms loading-screen frame; unspent budget must pass on`,
);

// ── a building's sheets ────────────────────────────────────────────────────

const LIFE_PROBE_TILE_SIZE = 32;
const LIFE_PROBE_CANVAS_PX = 512;
const LIFE_FACADE_KEY = BUILDING_KEYS[0];
const lifeProbeKey = buildingLifeKeyOf(LIFE_FACADE_KEY);
const lifeProbeStructure = [
  [{ tileId: 'gate-life', type: SPRITE_BUILDING, spriteKey: LIFE_FACADE_KEY }],
];

/** Draws the probe building's life layer, returning whether it inked anything. */
function lifeLayerInks(): boolean {
  const canvas = createCanvas(LIFE_PROBE_CANVAS_PX, LIFE_PROBE_CANVAS_PX);
  const ctx = canvas.getContext('2d');
  drawDecorationLifeLayer(
    asGameContext(ctx),
    lifeProbeStructure,
    SPRITE_BUILDING,
    0,
    0,
    LIFE_PROBE_TILE_SIZE,
    0,
    0,
  );
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  const pixels = ctx.getImageData(0, 0, LIFE_PROBE_CANVAS_PX, LIFE_PROBE_CANVAS_PX).data;
  for (let index = ALPHA_OFFSET; index < pixels.length; index += CHANNELS) {
    if (pixels[index] > 0) return true;
  }
  return false;
}

check(lifeProbeKey !== undefined, `"${LIFE_FACADE_KEY}" has no life sheet to probe`);
if (lifeProbeKey !== undefined) {
  // A life row landed before its facade must not float over the empty plot.
  flushEnvironmentArtCache();
  setFloorArtSeed(freshArtSeed());
  wantBuildingSheet(lifeProbeKey);
  paintEnvironmentArtNow();
  check(hasEnvironmentSheet(lifeProbeKey), 'the life-row probe could not paint a life sheet');
  check(
    !lifeLayerInks(),
    'a building whose facade is not resident drew its life row: windows and smoke over an empty plot',
  );
  // A facade without its life row draws still, and never asks for the missing
  // row: a lookup of a sheet not resident is a miss, every frame it is drawn.
  flushEnvironmentArtCache();
  setFloorArtSeed(freshArtSeed());
  wantBuildingSheet(LIFE_FACADE_KEY);
  paintEnvironmentArtNow();
  const missesBefore = getSpriteMissCounts().get(lifeProbeKey) ?? 0;
  lifeLayerInks();
  check(
    (getSpriteMissCounts().get(lifeProbeKey) ?? 0) === missesBefore,
    'a facade drawn without its life row looked the row up, which records a sprite miss every frame',
  );
  // A facade painted under the last floor's seed is not this floor's: it must
  // read as never painted, or it blocks the new seed's paint.
  check(
    environmentSheetState(LIFE_FACADE_KEY) === 'resident',
    'the stale-seed probe could not paint its facade',
  );
  setFloorArtSeed(freshArtSeed());
  check(
    environmentSheetState(LIFE_FACADE_KEY) === 'absent',
    `a facade painted under the previous floor's seed reads ` +
      `${environmentSheetState(LIFE_FACADE_KEY)}, so the new floor would never paint its own`,
  );
}

// A life sheet stores only the inked rectangle of each frame, anchored by its
// entry; drawn, it must put down exactly what the whole frame did.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
const CROP_PROBE_TILE_SIZE = 32;
const CROP_PROBE_ORIGIN_PX = 3;
for (const spec of BUILDING_SPECS) {
  const lifeKey = buildingLifeKeyOf(spec.key);
  if (lifeKey === undefined) continue;
  wantBuildingSheet(lifeKey);
  paintEnvironmentArtNow();
  const lifeDef = getSpriteDefByKey(lifeKey);
  const lifeRow = lifeDef?.states.get(BUILDING_LIFE_STATE);
  if (lifeDef === undefined || lifeRow === undefined) {
    check(false, `"${lifeKey}" was not painted for the crop probe`);
    continue;
  }
  const scale = CROP_PROBE_TILE_SIZE / lifeDef.tileScale;
  const width = Math.ceil(frameWidthPx(spec) * scale) + CROP_PROBE_ORIGIN_PX * 2;
  const height = Math.ceil(frameHeightPx(spec) * scale) + CROP_PROBE_ORIGIN_PX * 2;
  let differs = 0;
  for (let step = 0; step < spec.life.frames; step++) {
    const cropped = createCanvas(width, height);
    drawSprite(
      asGameContext(cropped.getContext('2d')),
      lifeDef,
      lifeRow,
      step,
      CROP_PROBE_ORIGIN_PX,
      CROP_PROBE_ORIGIN_PX,
      CROP_PROBE_TILE_SIZE,
    );
    const whole = createCanvas(width, height);
    whole
      .getContext('2d')
      .drawImage(
        asNodeCanvas(paintLifeFrame(spec, step)),
        CROP_PROBE_ORIGIN_PX,
        CROP_PROBE_ORIGIN_PX,
        frameWidthPx(spec) * scale,
        frameHeightPx(spec) * scale,
      );
    const a = cropped.getContext('2d').getImageData(0, 0, width, height).data;
    const b = whole.getContext('2d').getImageData(0, 0, width, height).data;
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) differs++;
  }
  check(
    differs === 0,
    `"${lifeKey}" drawn from its cropped sheet differs from its whole frames in ${differs} ` +
      'channel values; the crop must not change a pixel on screen',
  );
}
flushEnvironmentArtCache();

// A facade refused its sheet's surface settles at once, inside the request;
// the queue must still have only one facade in flight.
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
const canvasDocument: { document?: unknown } = globalThis;
const realDocument = canvasDocument.document;
const refusedFacade = getManifestEntry(BUILDING_KEYS[1]);
let refusalArmed = false;
canvasDocument.document = {
  createElement(tag: string) {
    if (tag !== 'canvas') throw new Error(`harness cannot create <${tag}>`);
    const counted = createCanvas(1, 1);
    const realContext = counted.getContext.bind(counted);
    Object.defineProperty(counted, 'getContext', {
      value: (...args: Parameters<typeof realContext>) => {
        // A sheet's surface is the one context of its size asked for without
        // read-back; the planes a facade is composed on read back.
        const settings: unknown = args[1];
        const readsBack =
          typeof settings === 'object' &&
          settings !== null &&
          'willReadFrequently' in settings &&
          settings.willReadFrequently === true;
        const isFacadeSheet =
          counted.width === refusedFacade.frameWidth &&
          counted.height === refusedFacade.frameHeight &&
          !readsBack;
        if (refusalArmed && isFacadeSheet) {
          refusalArmed = false;
          return null;
        }
        return realContext(...args);
      },
    });
    return counted;
  },
};
// The first facade is in flight and the rest wait behind it, so the refused
// one is planned when the first settles, with more still to queue.
for (const key of BUILDING_KEYS) wantBuildingSheet(key);
refusalArmed = true;
const FRAMES_TO_REACH_REFUSAL = 400;
for (
  let frame = 0;
  frame < FRAMES_TO_REACH_REFUSAL && refusalArmed && environmentPaintDepth() > 0;
  frame++
) {
  beginEnvironmentArtFrame();
}
canvasDocument.document = realDocument;
check(!refusalArmed, 'the refused-facade probe never reached the facade it refuses');
check(
  environmentSheetsQueued() === 1,
  `${environmentSheetsQueued()} facades were in flight after one was refused its surface; ` +
    'the building queue paints one at a time',
);
flushEnvironmentArtCache();

// ── a purge repaints what is on screen, not what the idle clock kept ───────

// Inside a building the idle clock stands still, so a purge there must judge
// "in use" by what was drawn just now, or it repaints the whole floor outside.
const PURGE_INDOORS_FRAMES = 600;
flushEnvironmentArtCache();
setFloorArtSeed(freshArtSeed());
setEnvironmentIdleWindowFrames(null);
requestEnvironmentSheet(blockPlan(placedKey, {}));
requestEnvironmentSheet(blockPlan(floorWideKey, {}));
paintEnvironmentArtNow();
holdIdleClock();
idleFrames(PURGE_INDOORS_FRAMES, () => getSpriteDefByKey(floorWideKey));
runCanvasRecovery('purged', null);
releaseIdleClock();
check(
  environmentSheetState(placedKey) === 'evicted',
  `a purge repainted a sheet nothing had drawn for ${PURGE_INDOORS_FRAMES} frames indoors ` +
    `(${environmentSheetState(placedKey)}); it should wait to be wanted`,
);
check(
  environmentSheetState(floorWideKey) === 'owed',
  'a purge left a sheet drawn on every frame waiting for a lookup instead of repainting it',
);
setEnvironmentIdleWindowFrames(null);

flushEnvironmentArtCache();
check(environmentPaintDepth() === 0, 'a flush left work on the queue');
check(environmentArtSheetCount() === 0, 'a flush left sheets resident');
check(environmentSheetsAwaiting() === 0, 'a flush left sheets waiting to be asked for again');

// A gate that measured nothing passes vacuously.
check(
  report.frames > 0,
  'the queue finished without a single frame being spent, so nothing was drained',
);

console.log(
  `[environment-art] drained ${report.stepsDrained} steps in ${report.frames} frames ` +
    `(${owedAtStart} queued up front, the rest chained behind them)`,
);
console.log(
  `  mean per frame   ${report.meanMsPerFrame.toFixed(1)} ms (budget ${ENVIRONMENT_PAINT_BUDGET_MS})`,
);
console.log(`  worst frame      ${report.worstFrameMs.toFixed(1)} ms`);
console.log(`  resident         ${(bytesBeforeRelease / BYTES_PER_MEGABYTE).toFixed(1)} MB`);

if (failures.length > 0) {
  console.error(`\n[environment-art] FAIL — ${failures.length} problems`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log('[environment-art] OK');
