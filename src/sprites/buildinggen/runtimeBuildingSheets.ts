/**
 * Paints the town's building facades at runtime, one stage at a time.
 *
 * A facade is by far the most expensive picture the game makes — around a
 * seventh of a second each, and two seconds for the whole town — so it is the
 * one family that cannot be painted as a sheet in a single step. It is painted
 * as the stages `planBuildingPaint` breaks it into instead, none of which is
 * more than a fraction of a frame, and the environment art cache spends a few
 * milliseconds a frame on them.
 *
 * ## Two sheets per building
 *
 * A building's still frame and its life row (lit windows, smoke, forge glow,
 * up to twenty-six frames, each cropped to the rectangle the row inks) are
 * separate sheets. The still frame is what a building is: it is held well
 * ahead of the camera, and it costs one frame's bytes. The life row is most
 * of a building's bytes and is only worth holding while it is in view;
 * without it a building draws still, so letting it go never leaves a gap in
 * the street.
 *
 * Neither is requested by a floor's arrival as a whole: the floor's resident
 * set asks for each building's sheets as the party comes near it, through
 * {@link wantBuildingSheet}.
 */

import { CanvasContextUnavailableError, releaseSurface } from '../../core/rendering/canvasSurface';
import {
  deferEnvironmentSheet,
  environmentSheetState,
  requestEnvironmentSheet,
  type EnvironmentSheetPlan,
  type PaintStep,
} from '../../map/environmentArtCache';
import {
  getManifestEntry,
  sheetSizePx,
  type SpriteKey,
  type SpriteManifestEntry,
  type SpriteStateDef,
} from '../../core/spriteAssets/SpriteLoader';
import { BUILDING_SALT, floorArtSeed, floorArtSubSeed } from '../../map/ground/floorArtSeed';
import { subSeed } from '../person/rng';
import { paintLifeFrame } from './animate';
import { BUILDING_SPECS } from './buildings';
import { planBuildingPaint } from './paint';
import { frameHeightPx, frameWidthPx, type BuildingSpec } from './spec';

/** The frame a building shows when nothing is happening to it. */
export const BUILDING_IDLE_STATE = 'idle';
/** The lit windows, smoke and forge glow composited over the idle frame. */
export const BUILDING_LIFE_STATE = 'life';

function stateFor(key: SpriteKey, name: string): SpriteStateDef {
  const states: Readonly<Record<string, SpriteStateDef | undefined>> = getManifestEntry(key).states;
  const state = states[name];
  if (state === undefined) throw new Error(`Building sheet "${key}" declares no "${name}" row`);
  return state;
}

/**
 * Every facade the game paints for itself.
 *
 * Written out rather than derived from `BUILDING_SPECS`, so the compiler checks
 * each one against the manifest. `overworld_main_tower` is absent on purpose:
 * it is authored art rather than generated, and keeps its file.
 */
export const BUILDING_KEYS = [
  'barracks',
  'blacksmith',
  'blackwood_lodge',
  'cartwrights_workshop',
  'desperado_club',
  'general_store',
  'herb_remedy',
  'hildas_cottage',
  'horned_flagon',
  'millers_farm',
  'plumbline_farm',
  'quiet_needle',
  'sleeping_cat_inn',
  'sunken_stump',
  'temple',
] as const satisfies ReadonlyArray<SpriteKey>;

type BuildingKey = (typeof BUILDING_KEYS)[number];

/** Each facade's life row, a sheet of its own, keyed as `<facade>_life`. */
const BUILDING_LIFE_KEYS = {
  barracks: 'barracks_life',
  blacksmith: 'blacksmith_life',
  blackwood_lodge: 'blackwood_lodge_life',
  cartwrights_workshop: 'cartwrights_workshop_life',
  desperado_club: 'desperado_club_life',
  general_store: 'general_store_life',
  herb_remedy: 'herb_remedy_life',
  hildas_cottage: 'hildas_cottage_life',
  horned_flagon: 'horned_flagon_life',
  millers_farm: 'millers_farm_life',
  plumbline_farm: 'plumbline_farm_life',
  quiet_needle: 'quiet_needle_life',
  sleeping_cat_inn: 'sleeping_cat_inn_life',
  sunken_stump: 'sunken_stump_life',
  temple: 'temple_life',
} as const satisfies Record<BuildingKey, SpriteKey>;

function asBuildingKey(key: string): BuildingKey | undefined {
  return BUILDING_KEYS.find((candidate) => candidate === key);
}

/** The life sheet of a facade, or undefined for a key that is not a painted facade. */
export function buildingLifeKeyOf(key: string): SpriteKey | undefined {
  const building = asBuildingKey(key);
  return building === undefined ? undefined : BUILDING_LIFE_KEYS[building];
}

/** Every life sheet, in `BUILDING_KEYS` order. */
export function buildingLifeKeys(): SpriteKey[] {
  return BUILDING_KEYS.map((key) => BUILDING_LIFE_KEYS[key]);
}

function lifeKeyOwner(key: string): BuildingKey | undefined {
  return BUILDING_KEYS.find((building) => BUILDING_LIFE_KEYS[building] === key);
}

/**
 * Narrows a spec's key to a manifest key.
 *
 * `BuildingSpec` is shared with the offline bakers, which have no `SpriteKey` to
 * speak of, so its key is a plain string. A spec naming no manifest entry is a
 * building that would be painted and never looked up, which is worth failing on.
 */
function buildingKey(spec: BuildingSpec): BuildingKey {
  const found = asBuildingKey(spec.key);
  if (found === undefined) throw new Error(`Building spec "${spec.key}" names no manifest entry`);
  return found;
}

/** The manifest entry a spec's still frame is laid out by, for the offline harnesses. */
export function buildingManifestEntry(spec: BuildingSpec): SpriteManifestEntry {
  return getManifestEntry(buildingKey(spec));
}

/** The manifest entry a spec's life row is laid out by, for the offline harnesses. */
export function buildingLifeManifestEntry(spec: BuildingSpec): SpriteManifestEntry {
  return getManifestEntry(BUILDING_LIFE_KEYS[buildingKey(spec)]);
}

/**
 * How far a floor's art seed reaches into one facade.
 *
 * Forked per building, so two facades never weather in step. It is handed to
 * `planBuildingPaint` as its *weather* seed rather than folded into `spec.seed`,
 * and that distinction is the whole safety argument: a spec seed drives a wall's
 * courses, a roof's tiles, a window's glazing and a life effect's phase as well
 * as its weathering, and those are the things the footprint, the doorway and the
 * animation gates measure. Reseeding all of it breaks roofs against their
 * facades and makes a life loop jump. Weathering alone is what varies.
 */
export function buildingWeatherSeed(index: number, seedTerm: number): number {
  return seedTerm === 0 ? 0 : subSeed(seedTerm, index);
}

function facadePlanFor(
  spec: BuildingSpec,
  key: SpriteKey,
  weatherSeed: number,
  onSettled?: () => void,
): EnvironmentSheetPlan {
  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  const idleState = stateFor(key, BUILDING_IDLE_STATE);
  const paint = planBuildingPaint(spec, weatherSeed);
  const steps: PaintStep[] = paint.stages.map((stage) => ({
    // One class per stage name: the same pass over a different building costs
    // roughly the same, and a facade is painted once per floor so there is no
    // second sample of the same building to learn from.
    costClass: `building:${stage.label}`,
    // Wrapped rather than passed through: a stage's `run` is a method, and the
    // cache calls it with no receiver of its own.
    paint: () => stage.run(),
  }));
  const idleColumn = idleState.colOffset ?? 0;
  steps.push({
    costClass: 'building:compose idle',
    paint: (ctx) => {
      ctx.drawImage(paint.canvas, idleColumn * frameWidth, idleState.row * frameHeight);
      // The facade is on the sheet now, and the surface it was painted on is
      // several megabytes of the largest thing the cache allocates.
      releaseSurface(paint.canvas);
    },
  });
  return {
    key,
    // Read off the manifest entry the steps above lay their frames out by, so
    // the surface and the positions written into it cannot be sized two ways.
    ...sheetSizePx(getManifestEntry(key)),
    steps,
    variesWithFloorSeed: true,
    drawnOnlyByItsBuilding: true,
    onSettled,
    release: paint.release,
    // The steps give back the planes they compose from as they go, so painting
    // the facade again needs a plan of its own.
    replan: () => facadePlanFor(spec, key, weatherSeed),
  };
}

/**
 * A life sheet stores only the rectangle of each frame its row ever inks:
 * the entry's frame size is that rectangle's, and its negative `tileX` and
 * `tileY` are the rectangle's corner within the building's frame, so the
 * loader draws it exactly where the whole frame was drawn. `verify:buildings`
 * checks the entry against the ink.
 */
function lifePlanFor(spec: BuildingSpec, key: SpriteKey): EnvironmentSheetPlan {
  const entry = getManifestEntry(key);
  const cellWidth = entry.frameWidth;
  const cellHeight = entry.frameHeight;
  const cropLeft = -entry.tileX;
  const cropTop = -entry.tileY;
  const lifeState = stateFor(key, BUILDING_LIFE_STATE);
  if (lifeState.frameCount !== spec.life.frames) {
    throw new Error(
      `Building "${key}" paints ${spec.life.frames} life frames but declares ${lifeState.frameCount}`,
    );
  }
  const lifeColumn = lifeState.colOffset ?? 0;
  const steps: PaintStep[] = Array.from({ length: spec.life.frames }, (_unused, step) => ({
    costClass: 'building:life frame',
    paint: (ctx) => {
      const frame = paintLifeFrame(spec, step);
      // Clipped to its own cell, so a glow that reaches past the frame it was
      // sized for cannot bleed into the phase beside it and read as a drawing
      // bug in the next frame.
      const cellLeft = (lifeColumn + step) * cellWidth;
      const cellTop = lifeState.row * cellHeight;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(cellLeft, cellTop, cellWidth, cellHeight);
        ctx.clip();
        ctx.drawImage(frame, cellLeft - cropLeft, cellTop - cropTop);
      } finally {
        ctx.restore();
      }
      releaseSurface(frame);
    },
  }));
  // A life row reads the building's own seed and never the floor's, so it is
  // the same on every floor and can survive the stairs like any unseeded art.
  return {
    key,
    ...sheetSizePx(getManifestEntry(key)),
    steps,
    variesWithFloorSeed: false,
    drawnOnlyByItsBuilding: true,
  };
}

interface QueuedFacade {
  readonly key: BuildingKey;
  /** The floor art seed's building term the facade weathers by. */
  readonly seedTerm: number;
}

/**
 * Facades asked for and not yet queued, nearest last asked first, under the
 * floor art seed {@link facadeQueueSeed}.
 *
 * Planning a facade allocates its sheet and the four planes it is composed
 * from — six megabytes for the largest — and holds them until the stage that
 * draws each hands it back. So facades are queued one at a time, each on the
 * last one's completion, rather than all planned at once. That costs nothing
 * in wall time: the cache paints them one at a time regardless.
 */
const facadesToQueue: QueuedFacade[] = [];
/** Facades already queued under {@link facadeQueueSeed}, so a stalled one is not asked for again. */
const facadesQueued = new Set<BuildingKey>();
let facadeQueueSeed: number | null = null;
/**
 * The facade request being painted, or null. A request is a fresh object, so
 * a settle arriving inside `requestEnvironmentSheet` itself (a refused
 * surface settles at once) clears only its own flight and never one queued
 * after it.
 */
let facadeInFlight: object | null = null;

/** Facades asked for and still to be queued behind the one painting. */
export function buildingSheetsNotYetQueued(): number {
  return facadeQueueSeed === floorArtSeed() ? facadesToQueue.length : 0;
}

/** Forgets what was queued for a floor whose seed is gone. */
function followFloorSeed(): void {
  const current = floorArtSeed();
  if (facadeQueueSeed === current) return;
  facadeQueueSeed = current;
  facadesToQueue.length = 0;
  facadesQueued.clear();
  facadeInFlight = null;
}

function queueNextFacade(): void {
  followFloorSeed();
  while (facadeInFlight === null) {
    const next = facadesToQueue.shift();
    if (next === undefined) return;
    const { key, seedTerm } = next;
    if (environmentSheetState(key) !== 'absent') continue;
    const index = BUILDING_SPECS.findIndex((spec) => spec.key === key);
    if (index < 0) continue;
    const spec = BUILDING_SPECS[index];
    const weatherSeed = buildingWeatherSeed(index, seedTerm);
    const paintingFor = floorArtSeed();
    facadesQueued.add(key);
    const flight = {};
    let plan: EnvironmentSheetPlan;
    try {
      // The queue advances on `onSettled` rather than on publication, because
      // a facade whose painter throws is never published, and a queue hung on
      // publication would leave every building behind it unpainted.
      plan = facadePlanFor(spec, key, weatherSeed, () => {
        if (floorArtSeed() !== paintingFor || facadeInFlight !== flight) return;
        facadeInFlight = null;
        queueNextFacade();
      });
    } catch (error) {
      // Planning allocates the facade's planes up front. Refused memory leaves
      // this facade to be asked for again and the queue carries on.
      if (!(error instanceof CanvasContextUnavailableError)) throw error;
      deferEnvironmentSheet(key, true, () => facadePlanFor(spec, key, weatherSeed));
      continue;
    }
    facadeInFlight = flight;
    const outcome = requestEnvironmentSheet(plan);
    if (outcome !== 'queued' && facadeInFlight === flight) facadeInFlight = null;
  }
}

/**
 * Asks for a building sheet — a facade or its life row — that has never been
 * painted under this floor's seed. A facade joins the one-at-a-time queue,
 * moved behind every other waiting facade, so a caller asking nearest first
 * gets them painted in that order; a life row allocates nothing ahead of its
 * steps and is requested at once. A sheet already painted, owed or let go is
 * the environment cache's business, and one queued before is not asked again.
 */
export function wantBuildingSheet(key: string): void {
  queueBuildingSheet(key, floorArtSubSeed(BUILDING_SALT));
}

function queueBuildingSheet(key: string, seedTerm: number): void {
  followFloorSeed();
  const lifeOwner = lifeKeyOwner(key);
  if (lifeOwner !== undefined) {
    const spec = BUILDING_SPECS.find((candidate) => candidate.key === lifeOwner);
    if (spec !== undefined && environmentSheetState(key) === 'absent') {
      requestEnvironmentSheet(lifePlanFor(spec, BUILDING_LIFE_KEYS[lifeOwner]));
    }
    return;
  }
  const facade = asBuildingKey(key);
  if (facade === undefined || facadesQueued.has(facade)) return;
  const waiting = facadesToQueue.findIndex((queued) => queued.key === facade);
  if (waiting >= 0) facadesToQueue.splice(waiting, 1);
  facadesToQueue.push({ key: facade, seedTerm });
  queueNextFacade();
}

/**
 * Takes back a facade asked for and not yet queued, for a resident set that
 * released it before its turn came: painting it would only paint a building
 * nobody is near.
 */
export function forgetWaitingBuildingSheet(key: string): void {
  const waiting = facadesToQueue.findIndex((queued) => queued.key === key);
  if (waiting >= 0) facadesToQueue.splice(waiting, 1);
}

/**
 * Asks for every facade and life row, the facades weathered by `seedTerm`
 * (zero paints the reviewed art). For the offline harnesses, which paint the
 * whole set to review or compare it; a floor asks building by building
 * through its resident set.
 */
export function requestBuildingSheets(seedTerm: number): void {
  for (const key of BUILDING_KEYS) {
    queueBuildingSheet(key, seedTerm);
    queueBuildingSheet(BUILDING_LIFE_KEYS[key], seedTerm);
  }
}
