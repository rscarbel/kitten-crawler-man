/**
 * Paints the town's building facades at runtime, one stage at a time.
 *
 * A facade is by far the most expensive picture the game makes — around a
 * seventh of a second each, and two seconds for the whole town — so it is the
 * one family that cannot be painted as a sheet in a single step. It is painted
 * as the stages `planBuildingPaint` breaks it into instead, none of which is
 * more than a fraction of a frame, and the environment art cache spends a few
 * milliseconds a frame on them while the floor fades in.
 *
 * ## The sheet is one row, not two
 *
 * A building's `idle` is a single frame and its `life` row is up to twenty-four,
 * and the sheet used to be two rows of the wider of those — so most of it was
 * transparent padding that still cost four bytes a pixel. Laying the idle frame
 * in column zero and starting the life row at column one puts the same frames on
 * half the canvas: the town's facades went from 116 MB resident to 62 MB for a
 * manifest `colOffset` the loader has always understood.
 */

import {
  hasEnvironmentSheet,
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
} from '../../core/SpriteLoader';
import { floorArtSeed } from '../../map/ground/floorArtSeed';
import { subSeed } from '../person/rng';
import { paintLifeFrame } from './animate';
import { BUILDING_SPECS } from './buildings';
import { planBuildingPaint } from './paint';
import { frameHeightPx, frameWidthPx, type BuildingSpec } from './spec';
import type { TilePoint, TownPlan } from '../../map/town/townPlan';

/** The frame a building shows when nothing is happening to it. */
export const BUILDING_IDLE_STATE = 'idle';
/** The lit windows, smoke and forge glow composited over the idle frame. */
export const BUILDING_LIFE_STATE = 'life';

function stateFor(key: SpriteKey, name: string): SpriteStateDef {
  const states: Readonly<Record<string, SpriteStateDef | undefined>> = getManifestEntry(key).states;
  const state = states[name];
  if (state === undefined) throw new Error(`Building "${key}" declares no "${name}" row`);
  return state;
}

/**
 * Narrows a spec's key to a manifest key.
 *
 * `BuildingSpec` is shared with the offline bakers, which have no `SpriteKey` to
 * speak of, so its key is a plain string. A spec naming no manifest entry is a
 * building that would be painted and never looked up, which is worth failing on.
 */
function buildingKey(spec: BuildingSpec): SpriteKey {
  const found = BUILDING_KEYS.find((candidate) => candidate === spec.key);
  if (found === undefined) throw new Error(`Building spec "${spec.key}" names no manifest entry`);
  return found;
}

/** The manifest entry a spec's sheet is laid out by, for the offline harnesses. */
export function buildingManifestEntry(spec: BuildingSpec): SpriteManifestEntry {
  return getManifestEntry(buildingKey(spec));
}

/**
 * Every facade the game paints for itself.
 *
 * Written out rather than derived from `BUILDING_SPECS`, so the compiler checks
 * each one against the manifest. `overworld_main_tower` and `hoarders_room` are
 * absent on purpose: both are authored art rather than generated, and both keep
 * their files.
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
  'quiet_needle',
  'shepherds_cabin',
  'sleeping_cat_inn',
  'sunken_stump',
  'temple',
] as const satisfies ReadonlyArray<SpriteKey>;

/**
 * How far a floor's art seed reaches into one facade.
 *
 * Forked per building, so two facades never weather in step. It is handed to
 * `planBuildingPaint` as its *weather* seed rather than folded into `spec.seed`,
 * and that distinction is the whole safety argument: a spec seed drives a wall's
 * courses, a roof's tiles, a window's glazing and a life effect's phase as well
 * as its weathering, and those are the things the footprint, the doorway and the
 * animation gates measure. Reseeding all of it was tried and the sweep caught it
 * — roofs stopped reading against their facades and one life loop developed a
 * jump. Weathering alone is what varies.
 */
export function buildingWeatherSeed(index: number, seedTerm: number): number {
  return seedTerm === 0 ? 0 : subSeed(seedTerm, index);
}

function sheetPlanFor(
  spec: BuildingSpec,
  key: SpriteKey,
  weatherSeed: number,
  callbacks: { onReady?: () => void; onSettled?: () => void },
): EnvironmentSheetPlan {
  const frameWidth = frameWidthPx(spec);
  const frameHeight = frameHeightPx(spec);
  const idleState = stateFor(key, BUILDING_IDLE_STATE);
  const lifeState = stateFor(key, BUILDING_LIFE_STATE);
  if (lifeState.frameCount !== spec.life.frames) {
    throw new Error(
      `Building "${key}" paints ${spec.life.frames} life frames but declares ${lifeState.frameCount}`,
    );
  }

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

  const lifeColumn = lifeState.colOffset ?? 0;
  const idleColumn = idleState.colOffset ?? 0;
  steps.push({
    costClass: 'building:compose idle',
    paint: (ctx) => {
      ctx.drawImage(paint.canvas, idleColumn * frameWidth, idleState.row * frameHeight);
      // The facade is on the sheet now, and the surface it was painted on is
      // several megabytes of the largest thing the cache allocates.
      paint.canvas.width = 0;
      paint.canvas.height = 0;
    },
  });
  for (let step = 0; step < spec.life.frames; step++) {
    steps.push({
      costClass: 'building:life frame',
      paint: (ctx) => {
        const frame = paintLifeFrame(spec, step);
        // Clipped to its own cell, so a glow that reaches past the frame it was
        // sized for cannot bleed into the phase beside it and read as a drawing
        // bug in the next frame.
        ctx.save();
        try {
          ctx.beginPath();
          ctx.rect(
            (lifeColumn + step) * frameWidth,
            lifeState.row * frameHeight,
            frameWidth,
            frameHeight,
          );
          ctx.clip();
          ctx.drawImage(frame, (lifeColumn + step) * frameWidth, lifeState.row * frameHeight);
        } finally {
          ctx.restore();
        }
        frame.width = 0;
        frame.height = 0;
      },
    });
  }

  return {
    key,
    // Read off the manifest entry the steps above lay their frames out by, so
    // the surface and the positions written into it cannot be sized two ways.
    ...sheetSizePx(getManifestEntry(key)),
    steps,
    // Published as soon as the facade itself is on the sheet. A building with no
    // life frames yet is a building with its windows unlit for a moment, which
    // is the difference between a town that fills in and a town that is not
    // there.
    readySteps: paint.stages.length + 1,
    variesWithFloorSeed: true,
    ...callbacks,
  };
}

/**
 * Queues every generated facade the town needs, under the floor's art seed.
 *
 * **One at a time, chained on each other's completion.** Planning a facade
 * allocates its sheet and the four planes it is composed from — six megabytes
 * for the largest — and every one of those is held from the moment the plan is
 * built until the stage that draws it hands it back. Queueing all fifteen at
 * once would therefore hold ninety megabytes of surfaces nothing has painted
 * yet, on top of the sheets, at the exact moment a floor is loading. Chaining
 * costs nothing in wall time, because the queue drains in order and paints them
 * one at a time regardless.
 *
 * Requested after the ground and the street furniture, for the same reason a
 * town with no paving is unreadable while a town with no inn is merely
 * unfinished.
 */
export interface BuildingPaintOrder {
  /**
   * The town plan whose plots these facades stand on, so they can be painted
   * outward from the player. Passed in rather than derived here, because the
   * scene already holds the plan its map was generated from and a second
   * derivation is a second thing to keep in step.
   */
  readonly plan?: TownPlan;
  /** Where the party arrives, in map tiles. */
  readonly nearestTo?: TilePoint;
  readonly onSheetPainted?: () => void;
}

export function requestBuildingSheets(seedTerm: number, options: BuildingPaintOrder = {}): void {
  // Captured, so a chain outliving its floor stops instead of queueing the next
  // facade under a seed the floor it belongs to no longer has.
  const paintingFor = floorArtSeed();
  const order = paintOrder(options.plan, options.nearestTo);
  const queueFrom = (position: number): void => {
    if (position >= order.length || floorArtSeed() !== paintingFor) return;
    const index = order[position];
    const spec = BUILDING_SPECS[index];
    const key = buildingKey(spec);
    // Asked before planning, not after: planning a facade allocates its sheet
    // and its four planes, and re-entering the town from a shop asks for all
    // fifteen again. The cache would refuse each one — after it had been built.
    if (hasEnvironmentSheet(key)) {
      queueFrom(position + 1);
      return;
    }
    requestEnvironmentSheet(
      sheetPlanFor(spec, key, buildingWeatherSeed(index, seedTerm), {
        onReady: options.onSheetPainted,
        // The chain advances on `onSettled` rather than on `onReady`, because a
        // facade whose painter throws is never published — and a chain hung on
        // publication would leave every building behind it unqueued for the life
        // of the floor.
        onSettled: () => queueFrom(position + 1),
      }),
    );
  };
  queueFrom(0);
}

/**
 * The order the facades are painted in: nearest the player first.
 *
 * The whole town's facades are several seconds of painting, and which of them a
 * player is looking at while that happens is entirely a matter of where they
 * came in. Painting outward from the spawn turns "the town materialises over ten
 * seconds" into "the street I am standing in is finished, and the rest arrives
 * before I walk to it".
 *
 * The seed is *not* reordered with them: a building's own art comes from
 * `subSeed(seedTerm, index)` on its index in `BUILDING_SPECS`, so where a player
 * happens to enter cannot change what the town looks like.
 */
function paintOrder(plan: TownPlan | undefined, nearestTo: TilePoint | undefined): number[] {
  const order = BUILDING_SPECS.map((_spec, index) => index);
  if (plan === undefined || nearestTo === undefined) return order;
  const byKey = new Map(plan.buildings.map((plot) => [plot.spriteKey, plot]));
  const distanceOf = (index: number): number => {
    const plot = byKey.get(BUILDING_SPECS[index].key);
    // A facade with no plot on this map is painted last rather than skipped:
    // something else may still draw it, and last is where it costs least. A
    // finite sentinel rather than infinity, because two of them subtract to NaN
    // and a NaN comparator leaves the order unspecified.
    if (plot === undefined) return Number.MAX_SAFE_INTEGER;
    // A plot's `west` and `frontRow` are offsets from the plaza centre, not map
    // tiles — the same conversion `paintPlots` makes when it stamps them.
    return Math.hypot(
      plan.centre.x + plot.west - nearestTo.x,
      plan.centre.y + plot.frontRow - nearestTo.y,
    );
  };
  return order.sort((a, b) => distanceOf(a) - distanceOf(b));
}
