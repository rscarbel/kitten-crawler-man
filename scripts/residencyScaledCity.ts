/**
 * The scaled-city routes for `report:residency`:
 *
 * - `walk`: arrive at the city's west edge, walk across it through its middle
 *   row of plazas at the fastest walk, then stand at the east edge for longer
 *   than the figure cache's and the environment sheets' idle windows.
 * - `arrive`: arrive at the east edge with nothing seen before it and stand the
 *   same wait, so what the walk still holds there can be set against what the
 *   place alone needs.
 *
 * The game's systems run as they stand: every block's crowd is built by the
 * real `TownLifeSystem`; one `WorldResidency`, with one `CrowdResidentSet`
 * holding every citizen and vendor of the city, decides from the arrival on
 * as the overworld scene's does for floor 3's; the floor's environment sheets
 * are painted as an arrival paints them; and the citizens in view are drawn
 * every frame through their real render path. There is no scene: the frame
 * boundary is ticked by hand in `SceneManager.step`'s order, so no ground chunk
 * is baked.
 *
 * Import only after the browser shim is installed.
 */

import { createCanvas } from 'canvas';

import { asGameContext } from './nodeGameContext.js';
import {
  ReachabilityTracker,
  FASTEST_WALK_PX_PER_UPDATE,
  SheetCatalogue,
  takeSnapshot,
} from './residencyProbe.js';
import type {
  RESIDENCY_FLOORS,
  ResidencySnapshot,
  RouteMeasure,
  RouteResult,
} from './residencyRoutes.js';
import {
  buildScaledCity,
  cityFocus,
  DEFAULT_BLOCKS_PER_SIDE,
  type ScaledCity,
  type ScaledCityCitizen,
} from './scaledCity.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { loadSprites } from '../src/core/spriteAssets/SpriteLoader.js';
import { settings } from '../src/core/input/Settings.js';
import { forceVarietyTier, FULL_VARIETY_TIER } from '../src/core/perf/varietyTier.js';
import { setRenderScaleValue, setViewportSize } from '../src/core/rendering/Viewport.js';
import { worldPx } from '../src/core/rendering/camera.js';
import { beginRenderFrame } from '../src/core/rendering/renderFrameClock.js';
import { BYTES_PER_MEGABYTE } from '../src/core/rendering/canvasSurface.js';
import { level3 } from '../src/levels/level3.js';
import { BUILDING_SALT, floorArtSubSeed, setFloorArtSeed } from '../src/map/ground/floorArtSeed.js';
import { requestBuildingSheets } from '../src/sprites/buildinggen/runtimeBuildingSheets.js';
import {
  groundSheetKeysAmong,
  requestGroundSheets,
} from '../src/map/ground/runtimeGroundSheets.js';
import { requiredSpriteKeysForLevel } from '../src/core/spriteAssets/systemAssetRequirements.js';
import { requestEnvironmentSheetsForGroups } from '../src/sprites/sheets/environmentSheets.js';
import {
  beginEnvironmentArtFrame,
  ENVIRONMENT_SHEET_BUDGET_MEGABYTES,
  paintEnvironmentArtNow,
  RECENTLY_DRAWN_FRAMES,
} from '../src/map/environmentArtCache.js';
import {
  beginFigureFrame,
  bakeFigurePrewarmFor,
  figureCacheByteBudget,
  figurePrewarmDepth,
  IDLE_FRAMES_BEFORE_RELEASE,
  onFigureUnbakedDraw,
} from '../src/sprites/figure/figureFrameCache.js';
import {
  getFigureCacheStats,
  setFigureCacheStatsRecording,
} from '../src/sprites/figure/figureCacheStats.js';
import { citizenFigureRows, citizenLookKey } from '../src/creatures/citizenFigure.js';
import { CrowdResidentSet, type ResidencyCitizen } from '../src/systems/CrowdResidentSet.js';
import {
  FASTEST_WALK_TILES_PER_SECOND,
  tilesUntilInView,
  WorldResidency,
  type ResidencyOutlook,
} from '../src/systems/WorldResidency.js';
import type { TilePoint } from '../src/map/town/townPlan.js';
import { FACADE_RING } from '../src/systems/EnvironmentSheetResidentSet.js';

const RETINA_DEVICE_PIXEL_RATIO = 2;
const VIEWPORT_W = 1280;
const VIEWPORT_H = 720;
const RESIDENCY_VIEW = { viewWidth: worldPx(VIEWPORT_W), viewHeight: worldPx(VIEWPORT_H) };
const MS_PER_SECOND = 1000;
/** Milliseconds of prewarm baking per drained frame while the arrival's crowd is baked. */
const ARRIVAL_DRAIN_BUDGET_MS = 50;
/** Frames the arrival drain may take before the route stops waiting for it. */
const MAX_ARRIVAL_DRAIN_FRAMES = 20000;
/** Frames past both caches' idle windows the party stands at the far edge. */
const FAR_EDGE_MARGIN_FRAMES = 300;
const FAR_EDGE_WAIT_FRAMES =
  Math.max(IDLE_FRAMES_BEFORE_RELEASE, RECENTLY_DRAWN_FRAMES) + FAR_EDGE_MARGIN_FRAMES;
/** Decisions timed per population size, after as many untimed ones so the timing is of warm code. */
const TIMED_DECISIONS = 200;
const MICROSECONDS_PER_MILLISECOND = 1000;
const MEGABYTE_PLACES = 1;
const SECOND_PLACES = 1;
const TILE_PLACES = 1;
const MICROSECOND_PLACES = 0;
/** How far ahead of coming into view the game holds a facade, for the facade working-set measure. */
const FACADE_HOLD_TILES = FACADE_RING.leadSeconds * FASTEST_WALK_TILES_PER_SECOND;

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);
}

/**
 * Square sub-cities, by blocks per side, whose decision cost is timed beside
 * the whole city's, so the report shows how the cost grows with population.
 */
const LARGEST_DECISION_SAMPLE_SIDE = 4;
const DECISION_SAMPLE_SIDES: readonly number[] = Array.from(
  { length: LARGEST_DECISION_SAMPLE_SIDE },
  (_, index) => index + 1,
);

/** One residency deciding for `people` as the overworld scene's decides for its crowd. */
function crowdResidency(people: ReadonlyArray<ResidencyCitizen>): WorldResidency {
  const residency = new WorldResidency();
  residency.register(new CrowdResidentSet({ people: () => people }));
  return residency;
}

function blocksArg(): number {
  const value = process.argv.find((arg) => arg.startsWith('--blocks='))?.slice('--blocks='.length);
  return value === undefined ? DEFAULT_BLOCKS_PER_SIDE : Number(value);
}

/** Queues and paints every environment sheet the floor plans, every building's included. */
function paintArrivalSheets(city: ScaledCity): void {
  const first = city.blocks[0];
  setFloorArtSeed(first.gameMap.artSeed);
  requestGroundSheets(
    groundSheetKeysAmong(requiredSpriteKeysForLevel(level3.id, level3.spriteGroups)),
    () => undefined,
  );
  requestEnvironmentSheetsForGroups(level3.spriteGroups);
  requestBuildingSheets(floorArtSubSeed(BUILDING_SALT));
  paintEnvironmentArtNow();
}

function citizensOfSquare(city: ScaledCity, side: number): ScaledCityCitizen[] {
  const inSquare = new Set(
    city.blocks
      .filter((block) => block.column < side && block.row < side)
      .map((block) => block.index),
  );
  return city.citizens.filter((citizen) => inSquare.has(citizen.block));
}

/**
 * Mean microseconds one residency decision takes over the citizens of the
 * north-west `side` x `side` blocks. Each sample pins and warms looks in the
 * figure cache, so it runs only once the route's own measurements are taken.
 */
function decisionMicroseconds(city: ScaledCity, side: number, focus: TilePoint): number {
  const people = citizensOfSquare(city, side);
  const residency = crowdResidency(people);
  const outlook: ResidencyOutlook = {
    focus: [cityFocus(focus)],
    view: RESIDENCY_VIEW,
    covered: false,
  };
  for (let decision = 0; decision < TIMED_DECISIONS; decision++) residency.settleNow(outlook);
  const startedAt = performance.now();
  for (let decision = 0; decision < TIMED_DECISIONS; decision++) residency.settleNow(outlook);
  const microseconds =
    ((performance.now() - startedAt) / TIMED_DECISIONS) * MICROSECONDS_PER_MILLISECOND;
  residency.releaseAll();
  return microseconds;
}

export type ScaledCityRoute = (typeof RESIDENCY_FLOORS)['scaled-city']['routes'][number];

/** Drives one scaled-city route and returns everything it measured. */
export async function runScaledCityRoute(route: ScaledCityRoute): Promise<RouteResult> {
  const startedAt = performance.now();
  settings.setDifficultyForSession('normal');
  settings.setQuality('sharp');
  forceVarietyTier(FULL_VARIETY_TIER);
  await loadSprites('src/images/');
  setViewportSize(VIEWPORT_W, VIEWPORT_H);
  setRenderScaleValue(RETINA_DEVICE_PIXEL_RATIO);

  const blocksPerSide = blocksArg();
  const notes: string[] = [];
  const measures: RouteMeasure[] = [];
  const snapshots: ResidencySnapshot[] = [];
  const tracker = new ReachabilityTracker();
  const nothingTracked: ReadonlySet<object> = new Set();
  const catalogue = new SheetCatalogue(level3);
  let frames = 0;

  const buildStartedAt = performance.now();
  const city = buildScaledCity({ blocksPerSide });
  measures.push({
    label: 'city',
    value:
      `${blocksPerSide}x${blocksPerSide} blocks, ${city.bounds.w}x${city.bounds.h} tiles, ` +
      `${city.buildings.length} buildings, ${city.citizens.length} citizens, built in ` +
      `${((performance.now() - buildStartedAt) / MS_PER_SECOND).toFixed(SECOND_PLACES)} s`,
  });

  const looks = new Map<string, ScaledCityCitizen>();
  for (const citizen of city.citizens) looks.set(citizenLookKey(citizen.figure), citizen);
  const looksPerBlock = city.blocks.map(
    (block) =>
      new Set(
        city.citizens
          .filter((citizen) => citizen.block === block.index)
          .map((citizen) => citizenLookKey(citizen.figure)),
      ).size,
  );
  measures.push({
    label: 'looks',
    value: `${looks.size} distinct in the city; per block ${looksPerBlock.join(', ')}`,
  });
  const crowdFigureIds = new Set<string>();
  for (const citizen of looks.values()) {
    for (const row of citizenFigureRows(citizen.figure)) crowdFigureIds.add(row.def.id);
  }

  const facadeKeys = new Set(city.buildings.map((building) => building.sheetKey));
  const facadeWorkingSet = { bytes: 0, sheets: 0 };
  const sharedFacadeBytes = [...facadeKeys].reduce((sum, key) => sum + catalogue.bytesOf(key), 0);
  const distinctFacadeBytes = city.buildings.reduce(
    (sum, building) => sum + catalogue.bytesOf(building.sheetKey),
    0,
  );
  measures.push({
    label: 'facades',
    value:
      `${facadeKeys.size} shared sheets, ${megabytes(sharedFacadeBytes)} MB; if every block's art ` +
      `were its own, ${city.buildings.length} sheets, ${megabytes(distinctFacadeBytes)} MB ` +
      `(environment budget ${ENVIRONMENT_SHEET_BUDGET_MEGABYTES} MB)`,
  });

  paintArrivalSheets(city);

  const west = city.crossing[0];
  const east = city.crossing[city.crossing.length - 1];

  const residency = crowdResidency(city.citizens);

  const canvas = createCanvas(
    VIEWPORT_W * RETINA_DEVICE_PIXEL_RATIO,
    VIEWPORT_H * RETINA_DEVICE_PIXEL_RATIO,
  );
  const nodeCtx = canvas.getContext('2d');
  nodeCtx.scale(RETINA_DEVICE_PIXEL_RATIO, RETINA_DEVICE_PIXEL_RATIO);
  const ctx = asGameContext(nodeCtx);

  let citizenUnbakedDraws = 0;
  onFigureUnbakedDraw((def) => {
    if (crowdFigureIds.has(def.id)) citizenUnbakedDraws++;
  });

  setFigureCacheStatsRecording(true);
  let evictions = 0;
  const arrival = route === 'walk' ? west : east;
  const arrivalLabel = route === 'walk' ? 'west edge, arrived' : 'east edge, arrived';
  let party = cityFocus(arrival);
  /** The per-block facade sheets within the hold distance of the party, as if each block's art were its own. */
  function noteFacadeWorkingSet(): void {
    const near = new Set<string>();
    let bytes = 0;
    for (const building of city.buildings) {
      if (tilesUntilInView(party, building.area, RESIDENCY_VIEW) > FACADE_HOLD_TILES) continue;
      if (near.has(building.distinctSheetId)) continue;
      near.add(building.distinctSheetId);
      bytes += catalogue.bytesOf(building.sheetKey);
    }
    if (bytes > facadeWorkingSet.bytes) {
      facadeWorkingSet.bytes = bytes;
      facadeWorkingSet.sheets = near.size;
    }
  }
  function frame(): void {
    noteFacadeWorkingSet();
    beginRenderFrame();
    beginFigureFrame();
    beginEnvironmentArtFrame();
    residency.update(() => ({ focus: [party], view: RESIDENCY_VIEW, covered: false }));
    const camX = party.x - VIEWPORT_W / 2;
    const camY = party.y - VIEWPORT_H / 2;
    for (const citizen of city.citizens) {
      const inView =
        citizen.x >= camX - TILE_SIZE &&
        citizen.x <= camX + VIEWPORT_W + TILE_SIZE &&
        citizen.y >= camY - TILE_SIZE &&
        citizen.y <= camY + VIEWPORT_H + TILE_SIZE;
      if (inView) citizen.render(ctx, camX, camY);
    }
    evictions += getFigureCacheStats().evictions;
    frames++;
  }

  async function walkAcross(): Promise<void> {
    const evictionsBeforeWalk = evictions;
    citizenUnbakedDraws = 0;
    for (const waypoint of city.crossing.slice(1)) {
      const target = cityFocus(waypoint);
      for (;;) {
        const dx = target.x - party.x;
        const dy = target.y - party.y;
        const remaining = Math.hypot(dx, dy);
        if (remaining <= FASTEST_WALK_PX_PER_UPDATE) {
          party = target;
          frame();
          break;
        }
        const step = FASTEST_WALK_PX_PER_UPDATE / remaining;
        party = { x: party.x + dx * step, y: party.y + dy * step };
        frame();
      }
    }
    measures.push({
      label: 'facade working set',
      value:
        `largest along the walk, if every block's art were its own: ${facadeWorkingSet.sheets} ` +
        `sheets, ${megabytes(facadeWorkingSet.bytes)} MB within ${FACADE_HOLD_TILES.toFixed(TILE_PLACES)} ` +
        `tiles of coming into view`,
    });
    measures.push({
      label: 'walk across',
      value:
        `${citizenUnbakedDraws} citizen cells drawn unbaked (stand-in or live), ` +
        `${evictions - evictionsBeforeWalk} evictions`,
    });
    snapshots.push(
      await takeSnapshot('east edge, after the walk', frames, catalogue, tracker, nothingTracked),
    );
  }

  residency.settleNow({ focus: [party], view: RESIDENCY_VIEW, covered: true });
  let drainFrames = 0;
  for (; drainFrames < MAX_ARRIVAL_DRAIN_FRAMES && figurePrewarmDepth() > 0; drainFrames++) {
    beginRenderFrame();
    beginFigureFrame();
    bakeFigurePrewarmFor(ARRIVAL_DRAIN_BUDGET_MS, true);
    evictions += getFigureCacheStats().evictions;
    frames++;
  }
  if (figurePrewarmDepth() > 0) {
    notes.push(
      `the arrival's prewarm queue still held ${figurePrewarmDepth()} rows after ${drainFrames} frames`,
    );
  }
  measures.push({
    label: 'arrival bake',
    value:
      `${drainFrames} frames, ${evictions} evictions; figure budget ` +
      `${megabytes(figureCacheByteBudget())} MB`,
  });
  citizenUnbakedDraws = 0;
  frame();
  snapshots.push(await takeSnapshot(arrivalLabel, frames, catalogue, tracker, nothingTracked));

  if (route === 'walk') await walkAcross();

  party = cityFocus(east);
  for (let wait = 0; wait < FAR_EDGE_WAIT_FRAMES; wait++) frame();
  snapshots.push(
    await takeSnapshot('east edge, after the wait', frames, catalogue, tracker, nothingTracked),
  );
  if (route === 'walk') {
    const sampleSides = DECISION_SAMPLE_SIDES.filter((side) => side < blocksPerSide);
    for (const side of [...sampleSides, blocksPerSide]) {
      const microseconds = decisionMicroseconds(city, side, west);
      measures.push({
        label: `decision cost, ${side}x${side} blocks`,
        value:
          `${citizensOfSquare(city, side).length} citizens, ` +
          `${microseconds.toFixed(MICROSECOND_PLACES)} µs per decision`,
      });
    }
  }
  residency.releaseAll();

  return {
    floor: 'scaled-city',
    route,
    frames,
    seconds: (performance.now() - startedAt) / MS_PER_SECOND,
    tracked: tracker.trackedCount,
    snapshots,
    retainers: [],
    measures,
    notes,
    crowdFigureIds: [...crowdFigureIds],
    standByFigureIds: [],
  };
}
