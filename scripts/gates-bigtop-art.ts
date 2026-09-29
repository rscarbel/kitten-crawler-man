#!/usr/bin/env tsx
/**
 * The Big Top's art gates: the stage lights may set the mood, but never at the
 * cost of a hazard the player has to read.
 *
 *   npm run gates:bigtop-art
 *   npm run gates:bigtop-art -- --fault=dark-telegraph
 *
 * Every measurement is taken on the real tent through `bigTopInteriorHarness`,
 * drawn the way the scene draws it:
 *
 *  - **Hazards stay readable.** Every forced hazard state, lit, keeps at least
 *    the contrast and colour salience it has in the same tent drawn
 *    full-bright in the same run, less a small named tolerance where the flame
 *    painters' random flicker demands one; and the pixels each hazard paints
 *    keep their own full-bright colour, which is what a dark laid over a
 *    warning and its floor alike changes.
 *  - **The floor stays readable.** The sawdust of the act on stage never falls
 *    below a luminance floor; an act the party has finished stays dimly
 *    visible; an act not yet reached is darker than the one on stage.
 *  - **The mass is darker and calmer than the floor** it surrounds.
 *  - **The lights change with the show**: the next act comes up over about a
 *    second when its curtain rises, with the curtain's cue, and the act left
 *    behind dims; once Grimaldi is freed every light comes up.
 *  - **Budgets**: the maze's own layers make at most a fixed number of
 *    `drawImage` calls in the heaviest frame; the lighting's canvases stay
 *    under a memory budget; every lighting painter is drawn through the
 *    strict-canvas watch.
 *  - **Cost**: the lighting pass is timed in node and held to a node budget.
 *    It catches a pass that has grown, not a browser frame time — that is
 *    measured in Chrome with `?perf`, whose `lighting` row is this pass.
 *
 *  - **The act props** (the cached prop frames): every picture in each act's
 *    catalogue is painted on its own at both game scales through the strict
 *    canvas, keeps its ink off every side it does not rightly run on from,
 *    and the frames the acts actually draw fit the prop cache's memory budget
 *    without it ever evicting.
 *
 * `--fault=ink-overrun` adds a painter that runs off its cell, and must turn
 * the act-prop section red.
 *
 * `--fault=dark-telegraph` draws the stage lights over every warning and flame
 * instead of under them, and must turn every hazard state red on its own; the
 * run says which state, if any, the fault slipped past.
 */

import { createCanvas } from 'canvas';

import { TILE_SIZE } from '../src/core/constants.js';
import { setViewportSize } from '../src/core/Viewport.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import {
  MAZE_CURTAINS,
  MAZE_GRIMALDI_TILE,
  MAZE_SECTIONS,
  type MazeSectionId,
} from '../src/map/bigTopMazeLayout.js';
import { INTERIOR_WALL, SAWDUST_FLOOR, VOID_TYPE } from '../src/map/tileTypes.js';
import type { GameMap } from '../src/map/GameMap.js';
import {
  BigTopLighting,
  FOLLOW_SPOT_TINT_STEPS,
  LIGHTS_UP_FRAMES,
  STRUCK_ACT_LEVEL,
  bigTopMaskBytes,
  bigTopMaskDimensions,
  paintBigTopDarkness,
  type LightFixtureKind,
  type StageCue,
} from '../src/systems/bigTop/bigTopLighting.js';
import { radialGlowTextureBytes } from '../src/sprites/radialGlow.js';
import {
  HAZARD_ACT,
  HAZARD_STATES,
  buildTent,
  enterAct,
  forceHazard,
  hazardFocus,
  placeAt,
  renderTentFrame,
  stepUntil,
  tick,
  viewCentredOn,
  wholeTentView,
  type HazardState,
  type TentHarness,
  type TentLighting,
  type TentView,
} from './bigTopInteriorHarness.js';
import {
  framePixels,
  measureFloorInRows,
  measureHazardContrast,
  measureHazardFidelity,
  spreadOf,
  tileLuminance,
  tileTexture,
  type FramePixels,
} from './bigTopLightingFairness.js';
import { asGameContext, asNodeCanvas } from './nodeGameContext.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { watchCanvas } from './strictCanvas.js';
import {
  BIG_TOP_PROP_CACHE_BUDGET_BYTES,
  ONE_TILE_BOX,
  bakeBigTopPropFrame,
  bigTopPropCacheBytes,
  bigTopPropCacheEvictions,
  bigTopPropCacheFrameCount,
  clearBigTopPropCache,
  observeBigTopPropBakes,
  type BigTopPropCatalogueEntry,
  type BigTopPropEdge,
} from '../src/sprites/art/bigTop/bigTopPropCache.js';
import { fireWalkPropCatalogue } from '../src/sprites/art/bigTop/fireWalkProps.js';
import { menageriePropCatalogue } from '../src/sprites/art/bigTop/menagerieProps.js';
import { mirrorHallPropCatalogue } from '../src/sprites/art/bigTop/mirrorHallProps.js';
import { finalePropCatalogue } from '../src/sprites/art/bigTop/finaleProps.js';
import { curtainPropCatalogue } from '../src/sprites/art/bigTop/curtainProps.js';
import { MAX_REFLECTING_PANES } from '../src/systems/BigTopMazeSystem.js';

const ARG_PREFIX_LENGTH = '--='.length;

function stringArg(name: string, fallback: string): string {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + ARG_PREFIX_LENGTH);
}

const FAULTS = ['none', 'dark-telegraph', 'ink-overrun'] as const;
type Fault = (typeof FAULTS)[number];
const faultArg = stringArg('fault', 'none');
const fault: Fault | undefined = FAULTS.find((candidate) => candidate === faultArg);
if (fault === undefined) throw new Error(`unknown --fault=${faultArg}`);
const hazardLighting: TentLighting = fault === 'dark-telegraph' ? 'darkTelegraph' : 'lit';

const ART_SEED = FLOOR_ART_SEEDS[0] ?? 0;
const MEASURE_SCALE = 1;
const DIGITS = 3;
/** Tile texture is a mean luminance step, four places down before it differs. */
const TEXTURE_DIGITS = 4;

// ── Limits ───────────────────────────────────────────────────────────────────

/**
 * The flame painters draw a little random flicker, so a vent state drawn
 * twice — full-bright, then lit — wanders in the third decimal of contrast and
 * by about a unit of salience. Only the vent states get this slack; every
 * other state is held to its full-bright reading exactly.
 */
const FLICKER_CONTRAST_TOLERANCE = 0.01;
const FLICKER_SALIENCE_TOLERANCE = 1.5;
const FLICKERING_STATES: ReadonlySet<HazardState> = new Set<HazardState>([
  'vent-telegraph',
  'vent-flame',
]);
/**
 * Slack for the single worst tile of a state, lit against full-bright. The
 * ring of floor round a tile can straddle the edge of a lamp's pool, and then
 * the dark shifts the ring's mean on one side only; a state's median tile is
 * held exactly.
 */
const WORST_TILE_CONTRAST_TOLERANCE = 0.03;
const WORST_TILE_SALIENCE_TOLERANCE = 2;

/**
 * The share of a hazard's full-bright look its own pixels must keep in the
 * lit frame. Lit, a warning is drawn over the stage lights and keeps its
 * colour wherever it is opaque; only where it is translucent does the dark
 * under it show through. Drawn beneath the lights, the same warning keeps
 * about four-fifths or less.
 */
const HAZARD_FIDELITY_MIN = 0.85;
/**
 * The lantern's beam is a translucent shaft drawn over the warm pool its own
 * lantern throws, so lit it already gives up about a quarter of its
 * full-bright colour to that pool. Drawn beneath the lights it gives up well
 * over a third.
 */
const POOLED_HAZARD_FIDELITY_MIN = 0.7;
const HAZARDS_OVER_THEIR_OWN_POOL: ReadonlySet<HazardState> = new Set<HazardState>([
  'spotlight-beam',
]);

/**
 * The sawdust of the act on stage, per tile, as WCAG relative luminance. The
 * twentieth percentile-low tile must reach the first and no tile may fall
 * below the second: dim, but a floor anybody can read. For scale, the tent
 * full-bright sits near 0.2 at its median.
 */
const STAGE_FLOOR_P5_MIN = 0.04;
const STAGE_FLOOR_MIN = 0.03;
/** An act the party has finished stays dimly lit, so walking back is never walking blind. */
const STRUCK_FLOOR_MIN = 0.015;
/** The mass is at most this share of the stage floor's median luminance. */
const MASS_TO_FLOOR_LUMINANCE_MAX = 0.25;
/** The mass's median texture is at most this share of the stage floor's. */
const MASS_TO_FLOOR_TEXTURE_MAX = 1;

/**
 * `drawImage` calls the maze's own layers may make in one frame, bodies not
 * counted — the same budget `gates:boss-rooms` holds a boss room's dressing
 * to.
 */
const MAX_DRESSING_DRAW_IMAGES = 120;
/** How many strict-canvas violations a failing frame check quotes. */
const VIOLATIONS_SHOWN = 3;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** Bytes of canvas the stage lights may hold: the mask and every glow texture baked. */
const MAX_LIGHTING_MEGABYTES = 6;

/**
 * Node milliseconds for one frame of the lighting pass (mask, house board and
 * live lights) at the game's own view size. A node limit, not a frame budget:
 * node's CPU canvas pays about 0.2 ms to shrink each baked glow onto the
 * frame, which a browser's GPU canvas does for a small fraction of that, so
 * this catches a pass that has grown rather than certifying a frame time.
 */
const NODE_LIGHTING_BUDGET_MS = 8;
const BENCH_WARMUP_FRAMES = 20;
const BENCH_FRAMES = 120;

// ── Reporting ────────────────────────────────────────────────────────────────

let failures = 0;
let checksRun = 0;

function check(ok: boolean, message: string): void {
  checksRun++;
  if (ok) console.log(`  ok   ${message}`);
  else {
    failures++;
    console.log(` FAIL  ${message}`);
  }
}

await loadGameSpritesInNode(ART_SEED);

function renderWhole(tent: TentHarness, lighting: TentLighting, bareStage = false): FramePixels {
  const view = wholeTentView(tent.map);
  const canvas = renderTentFrame(tent, view, {
    scale: MEASURE_SCALE,
    withParty: false,
    withMobs: false,
    lighting,
    bareStage,
  });
  return framePixels(canvas, view, MEASURE_SCALE);
}

// ── Hazards stay readable ────────────────────────────────────────────────────

console.log(
  `Checking every hazard state against the same tent full-bright (${hazardLighting} frame)…`,
);
{
  let statesMeasured = 0;
  const statesRed: HazardState[] = [];
  for (const state of HAZARD_STATES) {
    const tent = buildTent(ART_SEED);
    enterAct(tent, HAZARD_ACT[state]);
    const forced = forceHazard(tent, state);
    const fullBright = renderWhole(tent, 'fullBright');
    const fullBrightBare = renderWhole(tent, 'fullBright', true);
    const shown = renderWhole(tent, hazardLighting);
    const report = measureHazardContrast(shown, tent.map, forced);
    const reference = measureHazardContrast(fullBright, tent.map, forced);
    const flickers = FLICKERING_STATES.has(state);
    const contrastSlack = flickers ? FLICKER_CONTRAST_TOLERANCE : 0;
    const salienceSlack = flickers ? FLICKER_SALIENCE_TOLERANCE : 0;
    const measured =
      report.samples.length > 0 &&
      report.unmeasured.length === 0 &&
      reference.samples.length === report.samples.length;
    if (measured) statesMeasured++;
    check(
      measured,
      `${state}: every tile scored (${report.samples.length} scored, ${report.unmeasured.length} not; ` +
        `${reference.samples.length} full-bright)`,
    );
    // A state the fault turns red must be red for readability, not for a tile
    // it could not score.
    const failuresBefore = failures;
    const pairs = [
      [
        'min contrast',
        report.minContrast,
        reference.minContrast,
        contrastSlack + WORST_TILE_CONTRAST_TOLERANCE,
      ],
      ['median contrast', report.medianContrast, reference.medianContrast, contrastSlack],
      [
        'min salience',
        report.minSalience,
        reference.minSalience,
        salienceSlack + WORST_TILE_SALIENCE_TOLERANCE,
      ],
      ['median salience', report.medianSalience, reference.medianSalience, salienceSlack],
    ] as const;
    for (const [name, value, floor, slack] of pairs) {
      check(
        value >= floor - slack,
        `${state}: ${name} ${value.toFixed(DIGITS)} ≥ full-bright ${floor.toFixed(DIGITS)}` +
          (slack > 0 ? ` − ${Number(slack.toFixed(DIGITS))}` : ''),
      );
    }
    const fidelity = measureHazardFidelity(shown, fullBright, fullBrightBare, forced);
    const fidelityMin = HAZARDS_OVER_THEIR_OWN_POOL.has(state)
      ? POOLED_HAZARD_FIDELITY_MIN
      : HAZARD_FIDELITY_MIN;
    check(
      fidelity.pixels > 0 && fidelity.fidelity >= fidelityMin,
      `${state}: its own pixels keep ${fidelity.fidelity.toFixed(DIGITS)} of their full-bright ` +
        `colour ≥ ${fidelityMin} (${fidelity.pixels} px, signal ${fidelity.meanSignal.toFixed(1)}, ` +
        `drift ${fidelity.meanDrift.toFixed(1)})`,
    );
    if (failures > failuresBefore) statesRed.push(state);
  }
  check(
    statesMeasured === HAZARD_STATES.length,
    `every hazard state was forced and scored (${statesMeasured}/${HAZARD_STATES.length})`,
  );
  if (fault === 'dark-telegraph') {
    const missed = HAZARD_STATES.filter((state) => !statesRed.includes(state));
    check(
      missed.length === 0,
      `the fault turns every hazard state red on its own (${statesRed.length}/${HAZARD_STATES.length}` +
        (missed.length > 0 ? `; slipped past ${missed.join(', ')}` : '') +
        ')',
    );
  }
}

// ── The floor, the mass ──────────────────────────────────────────────────────

/** Solid tiles with no floor within a tile: the backstage mass, drapes excluded. */
function massTilesInRows(map: GameMap, y0: number, y1: number): Array<{ x: number; y: number }> {
  const isFloorType = (x: number, y: number): boolean => {
    const row = map.structure[y] ?? [];
    if (y < 0 || x < 0 || y >= map.structure.length || x >= row.length) return false;
    const type = row[x]?.type;
    return type !== INTERIOR_WALL && type !== VOID_TYPE;
  };
  const mass: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y++) {
    const width = map.structure[y]?.length ?? 0;
    for (let x = 0; x < width; x++) {
      if (isFloorType(x, y)) continue;
      let nearFloor = false;
      for (let dy = -1; dy <= 1 && !nearFloor; dy++) {
        for (let dx = -1; dx <= 1 && !nearFloor; dx++) nearFloor = isFloorType(x + dx, y + dy);
      }
      if (!nearFloor) mass.push({ x, y });
    }
  }
  return mass;
}

function floorTilesInRows(map: GameMap, y0: number, y1: number): Array<{ x: number; y: number }> {
  const floor: Array<{ x: number; y: number }> = [];
  for (let y = y0; y <= y1; y++) {
    (map.structure[y] ?? []).forEach((tile, x) => {
      if (tile.type === SAWDUST_FLOOR && map.isWalkable(x, y)) floor.push({ x, y });
    });
  }
  return floor;
}

function medianOf(
  frame: FramePixels,
  tiles: ReadonlyArray<{ x: number; y: number }>,
  measure: (frame: FramePixels, tile: { x: number; y: number }) => number | null,
): number {
  const values: number[] = [];
  for (const tile of tiles) {
    const value = measure(frame, tile);
    if (value !== null) values.push(value);
  }
  return spreadOf(values).median;
}

console.log('\nChecking the floor on stage, behind and ahead, and the mass…');
for (const [order, section] of MAZE_SECTIONS.entries()) {
  const tent = buildTent(ART_SEED);
  enterAct(tent, section.id);
  const frame = renderWhole(tent, 'lit');
  const stage = measureFloorInRows(frame, tent.map, section.rowRange, SAWDUST_FLOOR);
  check(stage.tiles > 0, `${section.id}: the stage has floor to measure (${stage.tiles} tiles)`);
  check(
    stage.p5 >= STAGE_FLOOR_P5_MIN && stage.min >= STAGE_FLOOR_MIN,
    `${section.id}: stage floor p5 ${stage.p5.toFixed(DIGITS)} ≥ ${STAGE_FLOOR_P5_MIN}, ` +
      `min ${stage.min.toFixed(DIGITS)} ≥ ${STAGE_FLOOR_MIN} (median ${stage.median.toFixed(DIGITS)})`,
  );
  for (const [otherOrder, other] of MAZE_SECTIONS.entries()) {
    if (other.id === section.id) continue;
    const spread = measureFloorInRows(frame, tent.map, other.rowRange, SAWDUST_FLOOR);
    if (otherOrder < order) {
      check(
        spread.min >= STRUCK_FLOOR_MIN,
        `${section.id} on stage: struck ${other.id} floor min ${spread.min.toFixed(DIGITS)} ≥ ${STRUCK_FLOOR_MIN}`,
      );
    } else {
      check(
        spread.median < stage.median,
        `${section.id} on stage: ${other.id} ahead is darker (median ${spread.median.toFixed(DIGITS)} < ${stage.median.toFixed(DIGITS)})`,
      );
    }
  }
  const { y0, y1 } = section.rowRange;
  const mass = massTilesInRows(tent.map, y0, y1);
  const floor = floorTilesInRows(tent.map, y0, y1);
  const massLuminance = medianOf(frame, mass, tileLuminance);
  const floorTexture = medianOf(frame, floor, tileTexture);
  const massTexture = medianOf(frame, mass, tileTexture);
  check(mass.length > 0, `${section.id}: the act has backstage mass to measure (${mass.length})`);
  check(
    massLuminance <= stage.median * MASS_TO_FLOOR_LUMINANCE_MAX,
    `${section.id}: mass median luminance ${massLuminance.toFixed(DIGITS)} ≤ ` +
      `${MASS_TO_FLOOR_LUMINANCE_MAX} × floor ${stage.median.toFixed(DIGITS)}`,
  );
  check(
    massTexture <= floorTexture * MASS_TO_FLOOR_TEXTURE_MAX,
    `${section.id}: mass median texture ${massTexture.toFixed(TEXTURE_DIGITS)} ≤ floor ${floorTexture.toFixed(TEXTURE_DIGITS)}`,
  );
}

// ── The lights change with the show ──────────────────────────────────────────

console.log('\nChecking the lights follow the show…');
{
  const tent = buildTent(ART_SEED);
  const curtain = MAZE_CURTAINS[0];
  const lighting = tent.maze.lighting;
  tent.maze.drainSounds();
  placeAt(tent.human, { x: curtain.humanRoom.x0, y: curtain.humanRoom.y0 });
  placeAt(tent.cat, { x: curtain.catRoom.x0, y: curtain.catRoom.y0 });
  tick(tent);
  const cues = tent.maze.drainSounds().map((cue) => cue.id);
  check(cues.includes('gate_opening'), `the curtain's rise is heard (${cues.join(', ')})`);
  // One more frame so the board has read the new act.
  tick(tent);
  check(
    lighting.actLevel('menagerie') > 0 && lighting.actLevel('menagerie') < 1,
    `the menagerie's lights are coming up, not snapped on (${lighting.actLevel('menagerie').toFixed(DIGITS)})`,
  );
  check(
    lighting.actLevel('firewalk') < 1,
    `the fire walk has begun to dim (${lighting.actLevel('firewalk').toFixed(DIGITS)})`,
  );
  let framesToLit = 1;
  const onStage = (act: MazeSectionId): boolean => lighting.actLevel(act) >= 1;
  while (!onStage('menagerie') && framesToLit < LIGHTS_UP_FRAMES * 2) {
    tick(tent);
    framesToLit++;
  }
  check(
    framesToLit <= LIGHTS_UP_FRAMES + 1,
    `the menagerie is fully up within about a second (${framesToLit} frames)`,
  );
  stepUntil(tent, () => tent.maze.lightsSettled);
  check(
    lighting.actLevel('firewalk') === STRUCK_ACT_LEVEL &&
      lighting.actLevel('mirrors') === 0 &&
      lighting.actLevel('finale') === 0,
    `then the fire walk rests struck and the acts ahead stay dark ` +
      `(${MAZE_SECTIONS.map((section) => `${section.id} ${lighting.actLevel(section.id).toFixed(2)}`).join(', ')})`,
  );

  const house = new BigTopLighting(lighting.lightFixtures);
  const HOUSE_LIGHTS_SEARCH_FRAMES = 600;
  let frames = 0;
  while (frames < HOUSE_LIGHTS_SEARCH_FRAMES) {
    house.tick({ currentAct: 'finale', cure: 1, freed: true });
    frames++;
    if (house.settledFor({ currentAct: 'finale', cure: 1, freed: true })) break;
  }
  check(
    MAZE_SECTIONS.every((section) => house.actLevel(section.id) === 1) &&
      house.houseLightsLevel === 1,
    `once Grimaldi is freed every light in the tent comes up (${frames} frames)`,
  );
}

// ── Budgets: draw calls, memory, the strict canvas ──────────────────────────

/** Longer than any fade the house board makes. */
const LIGHTING_SETTLE_FRAMES = 600;

function stepLightingUntilSettled(lighting: BigTopLighting, cue: StageCue): void {
  for (let frame = 0; frame < LIGHTING_SETTLE_FRAMES; frame++) {
    if (lighting.settledFor(cue)) return;
    lighting.tick(cue);
  }
  throw new Error(
    `the lights did not settle for ${cue.currentAct} in ${LIGHTING_SETTLE_FRAMES} frames`,
  );
}

console.log('\nChecking the budgets…');
{
  const fixtures = buildTent(ART_SEED).maze.lighting.lightFixtures;
  const kinds = new Set<LightFixtureKind>(fixtures.map((fixture) => fixture.kind));
  const everyKind: ReadonlyArray<LightFixtureKind> = [
    'footlight',
    'archPost',
    'intervalLamp',
    'limelight',
    'actBoard',
    'hallLamp',
    'ringWash',
  ];
  check(
    everyKind.every((kind) => kinds.has(kind)),
    `every kind of lamp throws a pool (${[...kinds].join(', ')}; ${fixtures.length} lamps)`,
  );

  const { width, height } = bigTopMaskDimensions();
  const maskCanvas = createCanvas(width, height);
  const maskCtx = asGameContext(maskCanvas.getContext('2d'));
  const maskWatch = watchCanvas(maskCtx);
  paintBigTopDarkness(maskCtx, fixtures);
  check(
    maskWatch.violations.length === 0,
    `the mask painter is clean (${maskWatch.violations.join('; ')})`,
  );
  check(maskWatch.saveDepth() === 0, 'the mask painter restores every save');
  const alpha = maskCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  let darkest = 0;
  let lightest = Number.POSITIVE_INFINITY;
  for (let index = ALPHA_OFFSET; index < alpha.length; index += CHANNELS) {
    const value = alpha[index] ?? 0;
    darkest = Math.max(darkest, value);
    lightest = Math.min(lightest, value);
  }
  check(
    darkest > 0 && lightest < darkest,
    `the mask is dark with pools cut out of it (alpha ${lightest}..${darkest})`,
  );

  let heaviest = 0;
  let heaviestShot = '';
  let heaviestEffects = 0;
  let heaviestEffectsShot = '';
  const violations: string[] = [];
  let unbalanced = 0;
  const views: Array<{
    id: string;
    act: MazeSectionId;
    state: HazardState | null;
    view: TentView;
  }> = [
    ...MAZE_SECTIONS.map((section) => ({
      id: section.id,
      act: section.id,
      state: null,
      view: viewCentredOn(section.humanSpawn),
    })),
    ...HAZARD_STATES.map((state) => ({
      id: state,
      act: HAZARD_ACT[state],
      state,
      view: viewCentredOn(hazardFocus(state)),
    })),
  ];
  for (const shot of views) {
    const tent = buildTent(ART_SEED);
    enterAct(tent, shot.act);
    if (shot.state !== null) forceHazard(tent, shot.state);
    const layerCalls = { dressing: 0, effects: 0 };
    let counting: keyof typeof layerCalls | null = null;
    const frameWatch: { report: ReturnType<typeof watchCanvas> | null } = { report: null };
    renderTentFrame(tent, shot.view, {
      scale: MEASURE_SCALE,
      withParty: false,
      withMobs: false,
      wrapContext: (ctx) => {
        frameWatch.report = watchCanvas(ctx);
        const original: unknown = Reflect.get(ctx, 'drawImage');
        if (typeof original !== 'function') throw new Error('context has no drawImage()');
        Reflect.set(ctx, 'drawImage', (...args: unknown[]): unknown => {
          if (counting !== null) layerCalls[counting]++;
          const result: unknown = Reflect.apply(original, ctx, args);
          return result;
        });
      },
      hooks: {
        overMap: () => {
          counting = 'dressing';
        },
        overGround: () => {
          counting = null;
        },
        overFigures: () => {
          counting = 'effects';
        },
        overEffects: () => {
          counting = null;
        },
      },
    });
    const watched = frameWatch.report;
    if (watched === null) {
      violations.push(`${shot.id}: the frame was never watched`);
    } else {
      violations.push(...watched.violations.map((violation) => `${shot.id}: ${violation}`));
      if (watched.saveDepth() !== 0) unbalanced++;
    }
    if (layerCalls.dressing > heaviest) {
      heaviest = layerCalls.dressing;
      heaviestShot = shot.id;
    }
    if (layerCalls.effects > heaviestEffects) {
      heaviestEffects = layerCalls.effects;
      heaviestEffectsShot = shot.id;
    }
  }
  check(
    views.length > 0 && heaviest > 0,
    `the maze's layers drew something (${views.length} frames)`,
  );
  check(
    heaviest <= MAX_DRESSING_DRAW_IMAGES,
    `heaviest frame's dressing, lights and warnings make ${heaviest} drawImage calls ` +
      `(${heaviestShot}; budget ${MAX_DRESSING_DRAW_IMAGES})`,
  );
  // The hazard effects are the fire and beams themselves, not dressing; they are
  // reported so a painter that grows is seen, not held to the dressing budget.
  console.log(
    `  info heaviest frame's hazard effects make ${heaviestEffects} drawImage calls (${heaviestEffectsShot})`,
  );
  check(
    violations.length === 0,
    `every frame is strict-canvas clean (${violations.slice(0, VIOLATIONS_SHOWN).join('; ')})`,
  );
  check(unbalanced === 0, `every frame restores every save (${unbalanced} left a save open)`);

  // The follow-spot bakes a glow per tint step of its cross-fade from sick
  // green to warm white, and only the cure walks it through them; without a
  // cure frame those textures are never counted.
  const glowBytesBeforeCure = radialGlowTextureBytes();
  const cureSpot = new BigTopLighting(fixtures);
  const finaleCue = { currentAct: 'finale', cure: 0, freed: false } as const;
  const cureView = viewCentredOn(MAZE_GRIMALDI_TILE);
  setViewportSize(cureView.widthPx, cureView.heightPx);
  const cureCtx = asGameContext(createCanvas(cureView.widthPx, cureView.heightPx).getContext('2d'));
  stepLightingUntilSettled(cureSpot, finaleCue);
  for (let step = 0; step <= FOLLOW_SPOT_TINT_STEPS; step++) {
    cureSpot.tick({ ...finaleCue, cure: step / FOLLOW_SPOT_TINT_STEPS });
    cureSpot.renderLiveLights(cureCtx, cureView.camX, cureView.camY, {
      ventFlames: [],
      spotlightBeams: [],
      beamSteps: [],
      stars: [],
      openedCurtains: [],
      grimaldi: { x: MAZE_GRIMALDI_TILE.x * TILE_SIZE, y: MAZE_GRIMALDI_TILE.y * TILE_SIZE },
    });
  }
  const cureGlowBytes = radialGlowTextureBytes() - glowBytesBeforeCure;
  check(
    cureGlowBytes > 0,
    `the cure's follow-spot is drawn and its tints counted ` +
      `(${(cureGlowBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB)`,
  );

  const lightingBytes = bigTopMaskBytes() + radialGlowTextureBytes();
  check(
    lightingBytes <= MAX_LIGHTING_MEGABYTES * BYTES_PER_MEGABYTE,
    `the lighting holds ${(lightingBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB of canvas ` +
      `(mask ${(bigTopMaskBytes() / BYTES_PER_MEGABYTE).toFixed(2)} MB; budget ${MAX_LIGHTING_MEGABYTES} MB)`,
  );
}

// ── The act props ────────────────────────────────────────────────────────────

/** Device pixels per tile the props are baked at in play: the game's scale, and its sharp preset. */
const PROP_BAKE_SCALES = [TILE_SIZE, TILE_SIZE * 2] as const;
/** Alpha above which a pixel on a frame's outermost ring counts as ink that hit the cell's edge. */
const EDGE_INK_ALPHA = 24;
const RGBA_CHANNELS = 4;
const RGBA_ALPHA_OFFSET = 3;
/** How many offending frames the report names. */
const OVERRUNS_LISTED = Number(stringArg('list-overruns', '4'));

/** Which sides of a baked frame carry ink on their outermost pixel ring. */
function inkedEdges(data: Uint8ClampedArray, width: number, height: number): BigTopPropEdge[] {
  const alphaAt = (x: number, y: number): number =>
    data[(y * width + x) * RGBA_CHANNELS + RGBA_ALPHA_OFFSET] ?? 0;
  const edges: BigTopPropEdge[] = [];
  const rowInked = (y: number): boolean => {
    for (let x = 0; x < width; x++) if (alphaAt(x, y) > EDGE_INK_ALPHA) return true;
    return false;
  };
  const columnInked = (x: number): boolean => {
    for (let y = 0; y < height; y++) if (alphaAt(x, y) > EDGE_INK_ALPHA) return true;
    return false;
  };
  if (rowInked(0)) edges.push('top');
  if (rowInked(height - 1)) edges.push('bottom');
  if (columnInked(0)) edges.push('left');
  if (columnInked(width - 1)) edges.push('right');
  return edges;
}

console.log('\nChecking the act props…');
{
  const overrun: BigTopPropCatalogueEntry = {
    key: { prop: 'faultOverrun', state: 'wide', frame: 0 },
    box: ONE_TILE_BOX,
    painter: (paintCtx, originX, originY, size) => {
      paintCtx.fillStyle = '#fff';
      paintCtx.fillRect(originX - size, originY + size / 4, size * 3, size / 2);
    },
  };
  const catalogue: BigTopPropCatalogueEntry[] = [
    ...fireWalkPropCatalogue(),
    ...menageriePropCatalogue(),
    ...mirrorHallPropCatalogue(),
    ...finalePropCatalogue(),
    ...curtainPropCatalogue(MAZE_SECTIONS.map((section) => section.banner)),
    ...(fault === 'ink-overrun' ? [overrun] : []),
  ];
  check(catalogue.length > 0, `the act catalogues list their pictures (${catalogue.length})`);
  const propViolations: string[] = [];
  const overruns: string[] = [];
  let unbalancedBakes = 0;
  let bakes = 0;
  const bakeWatch: { report: ReturnType<typeof watchCanvas> | null } = { report: null };
  const latestBakeWatch = (): ReturnType<typeof watchCanvas> | null => bakeWatch.report;
  observeBigTopPropBakes({
    beforePaint: (bakeCtx) => {
      bakeWatch.report = watchCanvas(bakeCtx);
    },
    afterPaint: () => undefined,
  });
  for (const entry of catalogue) {
    for (const scale of PROP_BAKE_SCALES) {
      const name = `${entry.key.prop}/${entry.key.state}/${entry.key.frame}@${scale}`;
      bakeWatch.report = null;
      let surfaceData: { data: Uint8ClampedArray; width: number; height: number } | null = null;
      try {
        const surface = bakeBigTopPropFrame(entry.key, entry.box, entry.painter, scale);
        const readCtx = asGameContext(asNodeCanvas(surface).getContext('2d'));
        const image = readCtx.getImageData(0, 0, surface.width, surface.height);
        surfaceData = { data: image.data, width: surface.width, height: surface.height };
      } catch (error) {
        propViolations.push(
          `${name}: threw ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      bakes++;
      const watched = latestBakeWatch();
      if (watched === null) propViolations.push(`${name}: the bake was never watched`);
      else {
        propViolations.push(...watched.violations.map((violation) => `${name}: ${violation}`));
        if (watched.saveDepth() !== 0) unbalancedBakes++;
      }
      if (surfaceData === null) continue;
      const open = new Set(entry.openEdges ?? []);
      const stray = inkedEdges(surfaceData.data, surfaceData.width, surfaceData.height).filter(
        (edge) => !open.has(edge),
      );
      if (stray.length > 0) overruns.push(`${name} (${stray.join(', ')})`);
    }
  }
  observeBigTopPropBakes(null);
  check(
    bakes === catalogue.length * PROP_BAKE_SCALES.length,
    `every act prop was baked (${bakes})`,
  );
  check(
    propViolations.length === 0,
    `every act prop paints strict-canvas clean (${propViolations.slice(0, 3).join('; ')})`,
  );
  check(unbalancedBakes === 0, `every act prop restores every save (${unbalancedBakes} did not)`);
  check(
    overruns.length === 0,
    `no act prop inks a side of its cell it does not run on from (${overruns.length}: ${overruns.slice(0, OVERRUNS_LISTED).join('; ')})`,
  );

  // The frames the acts really draw, at both scales, must all fit at once.
  clearBigTopPropCache();
  const actShots: ReadonlyArray<{ act: MazeSectionId; state: HazardState | null }> = [
    { act: 'firewalk', state: null },
    { act: 'firewalk', state: 'vent-telegraph' },
    { act: 'firewalk', state: 'vent-flame' },
    { act: 'menagerie', state: null },
    { act: 'menagerie', state: 'spotlight-warm' },
    { act: 'menagerie', state: 'spotlight-beam' },
    { act: 'menagerie', state: 'held-row' },
    { act: 'mirrors', state: null },
    { act: 'mirrors', state: 'beam-hot' },
    { act: 'finale', state: null },
  ];
  for (const shot of actShots) {
    for (const scale of [1, 2]) {
      const tent = buildTent(ART_SEED);
      enterAct(tent, shot.act);
      const focus =
        shot.state === null
          ? (MAZE_SECTIONS.find((section) => section.id === shot.act)?.humanSpawn ?? { x: 0, y: 0 })
          : hazardFocus(shot.state);
      if (shot.state !== null) forceHazard(tent, shot.state);
      renderTentFrame(tent, viewCentredOn(focus), { scale, withParty: false });
    }
  }
  const residentMegabytes = bigTopPropCacheBytes() / BYTES_PER_MEGABYTE;
  check(
    bigTopPropCacheFrameCount() > 0 && bigTopPropCacheEvictions() === 0,
    `the act props' frames all stay resident at both scales (${bigTopPropCacheFrameCount()} frames, ` +
      `${bigTopPropCacheEvictions()} evicted)`,
  );
  check(
    bigTopPropCacheBytes() <= BIG_TOP_PROP_CACHE_BUDGET_BYTES,
    `the act props hold ${residentMegabytes.toFixed(2)} MB of canvas ` +
      `(budget ${(BIG_TOP_PROP_CACHE_BUDGET_BYTES / BYTES_PER_MEGABYTE).toFixed(0)} MB)`,
  );
}

// ── The hall's reflections ──────────────────────────────────────────────────

/** Where the crawlers stand for the reflection check: each beside a wall of panes. */
const REFLECTION_NEAR = { human: { x: 5, y: 22 }, cat: { x: 20, y: 21 } } as const;
/** And out in the middle of each hall, out of every pane's reach. */
const REFLECTION_FAR = { human: { x: 12, y: 30 }, cat: { x: 30, y: 30 } } as const;
const REFLECTION_VIEW_FOCUS = { x: 12, y: 22 } as const;
const PARTY_SIZE = 2;

console.log('\nChecking the hall of mirrors reflects the crawlers, and what it costs…');
{
  const tent = buildTent(ART_SEED);
  enterAct(tent, 'mirrors');
  const blitsWith = (stand: {
    readonly human: { readonly x: number; readonly y: number };
    readonly cat: { readonly x: number; readonly y: number };
  }): number => {
    placeAt(tent.human, stand.human);
    placeAt(tent.cat, stand.cat);
    tick(tent);
    let calls = 0;
    let counting = false;
    renderTentFrame(tent, viewCentredOn(REFLECTION_VIEW_FOCUS), {
      scale: MEASURE_SCALE,
      withParty: false,
      withMobs: false,
      wrapContext: (ctx) => {
        const original: unknown = Reflect.get(ctx, 'drawImage');
        if (typeof original !== 'function') throw new Error('context has no drawImage()');
        Reflect.set(ctx, 'drawImage', (...args: unknown[]): unknown => {
          if (counting) calls++;
          const result: unknown = Reflect.apply(original, ctx, args);
          return result;
        });
      },
      hooks: {
        overMap: () => {
          counting = true;
        },
        overGround: () => {
          counting = false;
        },
      },
    });
    return calls;
  };
  const far = blitsWith(REFLECTION_FAR);
  const farReflections = tent.maze.lastReflectionBlits;
  const near = blitsWith(REFLECTION_NEAR);
  const nearReflections = tent.maze.lastReflectionBlits;
  const extraBlits = near - far;
  check(
    farReflections === 0,
    `out in the middle of the halls nothing is reflected (${farReflections} reflections)`,
  );
  check(
    nearReflections > 0,
    `a crawler beside the hall's panes shows in them (${nearReflections} reflections)`,
  );
  check(
    extraBlits === nearReflections,
    `every extra blit is a reflection (${extraBlits} counted, ${nearReflections} reported)`,
  );
  const perCrawler = [
    { name: 'Carl', stand: { human: REFLECTION_NEAR.human, cat: REFLECTION_FAR.cat } },
    { name: 'Donut', stand: { human: REFLECTION_FAR.human, cat: REFLECTION_NEAR.cat } },
  ].map(({ name, stand }) => {
    blitsWith(stand);
    return { name, reflections: tent.maze.lastReflectionBlits };
  });
  check(
    perCrawler.every((crawler) => crawler.reflections <= MAX_REFLECTING_PANES) &&
      nearReflections <= MAX_REFLECTING_PANES * PARTY_SIZE,
    `reflections cost at most ${MAX_REFLECTING_PANES} sprite blits per crawler (` +
      `${perCrawler.map((crawler) => `${crawler.name} ${crawler.reflections}`).join(', ')}; ` +
      `${nearReflections} for both)`,
  );
}

// ── Cost ─────────────────────────────────────────────────────────────────────

console.log('\nTiming the lighting pass in node…');
{
  const tent = buildTent(ART_SEED);
  enterAct(tent, 'menagerie');
  forceHazard(tent, 'spotlight-beam');
  const view = viewCentredOn(hazardFocus('spotlight-beam'));
  const canvas = createCanvas(view.widthPx, view.heightPx);
  const ctx = asGameContext(canvas.getContext('2d'));
  renderTentFrame(tent, view, { scale: MEASURE_SCALE, withParty: false, withMobs: false });
  const samples: number[] = [];
  for (let frame = 0; frame < BENCH_WARMUP_FRAMES + BENCH_FRAMES; frame++) {
    const startedAt = performance.now();
    tent.maze.renderLighting(ctx, view.camX, view.camY);
    const elapsed = performance.now() - startedAt;
    if (frame >= BENCH_WARMUP_FRAMES) samples.push(elapsed);
    tick(tent);
  }
  const perFrame = spreadOf(samples);
  check(
    perFrame.median <= NODE_LIGHTING_BUDGET_MS,
    `lighting costs ${perFrame.median.toFixed(2)} ms a frame in node, median ` +
      `(worst ${Math.max(...samples).toFixed(2)} ms; node budget ${NODE_LIGHTING_BUDGET_MS} ms, ` +
      `${view.widthPx}×${view.heightPx} at ${TILE_SIZE} px per tile)`,
  );
}

console.log(
  `\n${checksRun} checks, ${failures} failed${fault === 'none' ? '' : ` (fault: ${fault})`}`,
);
if (checksRun === 0) {
  console.log(' FAIL  no check ran');
  process.exit(1);
}
process.exit(failures === 0 ? 0 : 1);
