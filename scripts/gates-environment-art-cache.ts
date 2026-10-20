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
import { asNodeCanvas } from './nodeGameContext.js';

installCanvasGlobals();

const {
  ENVIRONMENT_PAINT_BUDGET_MS,
  beginEnvironmentArtFrame,
  environmentArtBytes,
  environmentArtSheetCount,
  environmentPaintDepth,
  environmentSheetsAwaiting,
  flushEnvironmentArtCache,
  hasEnvironmentSheet,
  releaseEnvironmentArt,
  requestEnvironmentSheet,
} = await import('../src/map/environmentArtCache.js');
const { GROUND_SHEET_KEYS, requestGroundSheets } =
  await import('../src/map/ground/runtimeGroundSheets.js');
const { getManifestEntry, getSpriteDefByKey } = await import('../src/core/SpriteLoader.js');
type SpriteKey = Parameters<typeof getManifestEntry>[0];
type EnvironmentSheetPlan = Parameters<typeof requestEnvironmentSheet>[0];
const { BUILDING_SALT, floorArtSubSeed, setFloorArtSeed } =
  await import('../src/map/ground/floorArtSeed.js');
const { requestBuildingSheets, BUILDING_KEYS } =
  await import('../src/sprites/buildinggen/runtimeBuildingSheets.js');
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
const { runCanvasRecovery } = await import('../src/core/canvasRecovery.js');
const { CanvasContextUnavailableError } = await import('../src/core/canvasSurface.js');

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
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
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
const PAINTED_KEYS = [...GROUND_SHEET_KEYS, MASK_SHEET_KEY, ...BUILDING_KEYS];

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
runCanvasRecovery('memoryPressure');
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
runCanvasRecovery('memoryPressure');
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
runCanvasRecovery('memoryPressure');
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
