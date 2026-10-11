/**
 * Ground passes: the impassable void border and the scatter that breaks up
 * otherwise flat expanses of grass and street.
 *
 * Scatter runs last, after every structure is placed, so it can be suppressed
 * over reserved plots — weeds painted under a building's art would show through
 * nowhere and be wasted, and dirt painted under it would fight the facade.
 */

import {
  FloorTypeValue,
  VOID_TYPE,
  GRASSY_WEED,
  DIRT_PATCH,
  HIGHLAND_GRASS,
  SCREE,
  WILDFLOWER_TUFT,
  PEBBLE_SCATTER,
} from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { TileRect, TownPlan } from './townPlan';
import type { KeepOut } from '../overworld/keepOut';
import { isWithinCamp, type CampSite } from '../overworld/camps';
import { worldRandom } from '../../core/WorldRandom';
import { MEADOW_MAX, smoothstepUnit } from '../overworld/elevation';
import {
  chooseWeighted,
  DriftField,
  scatterSalt,
  type DriftOctave,
  type LandformSampler,
  type WeightedTile,
} from '../overworld/landformScatter';

/** Paints the impassable ring of void that frames the map. */
export function paintVoidBorder(grid: TileGrid, borderTiles: number): void {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const isBorder =
        y < borderTiles ||
        y >= grid.size - borderTiles ||
        x < borderTiles ||
        x >= grid.size - borderTiles;
      if (isBorder) grid.set(x, y, VOID_TYPE);
    }
  }
}

/**
 * Scatters weeds over open grass and worn patches over the packed-earth tracks.
 *
 * The two passes sweep the map separately rather than deciding both in one
 * sweep so each keeps its own independent density.
 *
 * **The verge gets no scatter**, though it is the town's soft ground and looks
 * like the obvious place for weeds. `GRASSY_WEED` reports `grass` as the material
 * under its tufts — correctly, since that is what it is scattered on outdoors —
 * so painted onto a verge it draws the *field grass* row instead of the verge row,
 * and because grass is the softest material in the blend order it also becomes an
 * island the surrounding verge bleeds into through the corner masks, eroding the
 * tuft the tile exists to show. Scattering it there would put about four tiles of
 * the wrong material inside the walls per generation, breaking the rule that
 * every surface inside the walls is a decision, in the only place that matters —
 * what gets drawn. The verge material already depicts grass invaded by stone and
 * weeds, so nothing is lost; planting inside the walls is `paintYards`'s job, and
 * any decoration for it needs its own tile type mapping to `verge` rather than a
 * reuse of the outdoor one.
 */
export function scatterGroundCover(
  grid: TileGrid,
  plan: TownPlan,
  borderTiles: number,
  reservedPlots: ReadonlyArray<TileRect>,
  landmarks: KeepOut,
): void {
  const isReserved = (x: number, y: number) =>
    landmarks.contains(x, y) ||
    reservedPlots.some(
      (plot) => x >= plot.x && x < plot.x + plot.w && y >= plot.y && y < plot.y + plot.h,
    );

  const scatter = (
    sourceType: number,
    scatterType: number,
    density: number,
    applies: (x: number, y: number) => boolean,
  ) => {
    for (let y = borderTiles + 1; y < grid.size - borderTiles - 1; y++) {
      for (let x = borderTiles + 1; x < grid.size - borderTiles - 1; x++) {
        if (isReserved(x, y) || !applies(x, y)) continue;
        if (grid.typeAt(x, y) === sourceType && worldRandom() < density) {
          grid.set(x, y, scatterType);
        }
      }
    }
  };
  const everywhere = () => true;

  // Only round the town: out past the safe radius the wilderness pass grows
  // weeds in drifts over the ground they favour.
  scatter(FloorTypeValue.grass, GRASSY_WEED, plan.groundCover.weedDensityOnGrass, (x, y) =>
    isWithinSafeRadius(plan, x, y),
  );
  // Only the packed-earth track takes worn patches. The town's paved materials are
  // broken up by the renderer's own world-space tone and by the fringe where they
  // meet, and a scatter of worn dirt across cobble would read as neglect on a
  // street that is supposed to be the town's spine.
  scatter(FloorTypeValue.road, DIRT_PATCH, plan.groundCover.dirtPatchDensityOnRoad, everywhere);
}

function isWithinSafeRadius(plan: TownPlan, x: number, y: number): boolean {
  return Math.hypot(x - plan.centre.x, y - plan.centre.y) <= plan.safeRadiusTiles;
}

/**
 * Per-tile chance of each wilderness cover type on the surface it belongs to,
 * averaged over every tile of that surface.
 *
 * Deliberately sparse: these exist to stop a long walk across open country
 * reading as one repeating material, and cover dense enough to notice tile by
 * tile is cover dense enough to notice *as a grid*. They are constants here
 * rather than fields on `TownPlan` because it describes the town, and none of
 * this is inside the walls. The weeds out here keep the town's density.
 */
const WILDFLOWER_DENSITY_ON_GRASS = 0.03;
const PEBBLE_DENSITY_ON_HIGHLAND = 0.022;
const PEBBLE_DENSITY_ON_SCREE = 0.03;

/**
 * The drifts each type grows in: octave periods in tiles, the share of the
 * field's range below which nothing grows, and how far above it a drift takes
 * to thicken to its heart. Flowers grow in tight patches, weeds in looser
 * sweeps, stones in spills.
 */
const FLOWER_DRIFT: readonly DriftOctave[] = [
  { periodTiles: 11, weight: 0.65 },
  { periodTiles: 5, weight: 0.35 },
];
const FLOWER_DRIFT_THRESHOLD = 0.55;
const WEED_DRIFT: readonly DriftOctave[] = [
  { periodTiles: 14, weight: 0.6 },
  { periodTiles: 6, weight: 0.4 },
];
const WEED_DRIFT_THRESHOLD = 0.46;
const PEBBLE_DRIFT: readonly DriftOctave[] = [
  { periodTiles: 9, weight: 0.6 },
  { periodTiles: 4, weight: 0.4 },
];
const PEBBLE_DRIFT_THRESHOLD = 0.5;
const DRIFT_SOFTNESS = 0.12;
/** No tile in a drift's heart is more likely than this to carry cover, so a drift never goes solid. */
const MAX_COVER_CHANCE = 0.4;

/**
 * Meadow cover favours the low, lush ground: full weight from this far below
 * the meadow's ceiling, in normalised elevation, falling to a floor at the
 * ceiling, so the drier upper meadow still has a little.
 */
const LUSH_COVER_SPAN = 0.24;
const UPPER_MEADOW_COVER_WEIGHT = 0.2;
/**
 * Loose stones favour the steep ground they have rolled down: a floor on flat
 * upland, full weight once the slope reaches the steep end of this range.
 */
const STONE_SLOPE_FLAT = 0.006;
const STONE_SLOPE_STEEP = 0.02;
const FLAT_UPLAND_STONE_WEIGHT = 0.3;

const FLOWER_DRIFT_SALT = 9101;
const WEED_DRIFT_SALT = 9111;
const PEBBLE_DRIFT_SALT = 9121;
const FLOWER_CHOICE_SALT = 9131;
const WEED_CHOICE_SALT = 9141;
const HIGHLAND_PEBBLE_CHOICE_SALT = 9151;
const SCREE_PEBBLE_CHOICE_SALT = 9161;

function unitRamp(value: number, from: number, to: number): number {
  const t = (value - from) / (to - from);
  return smoothstepUnit(t < 0 ? 0 : t > 1 ? 1 : t);
}

/** How strongly meadow cover is drawn to a tile by how low and lush it lies. */
function lushCoverWeight(landform: LandformSampler, x: number, y: number): number {
  const lushness = unitRamp(MEADOW_MAX - landform.height(x, y), 0, LUSH_COVER_SPAN);
  return UPPER_MEADOW_COVER_WEIGHT + (1 - UPPER_MEADOW_COVER_WEIGHT) * lushness;
}

/** How strongly loose stones are drawn to a tile by how steep it is. */
function steepStoneWeight(landform: LandformSampler, x: number, y: number): number {
  const steepness = unitRamp(landform.slope(x, y), STONE_SLOPE_FLAT, STONE_SLOPE_STEEP);
  return FLAT_UPLAND_STONE_WEIGHT + (1 - FLAT_UPLAND_STONE_WEIGHT) * steepness;
}

/**
 * Wildflower clumps and weeds over the open meadows, loose stones over the
 * uplands — each in drifts, weighted toward the ground it grows on.
 *
 * Separate from `scatterGroundCover` rather than another pair of calls inside
 * it, because the two passes answer to different rules: that one is a town pass
 * that must be suppressed over building plots and yards, this one is held
 * outside the safe radius entirely and so needs no plot list at all.
 *
 * Written with `setStanding`, not `set`. `PEBBLE_SCATTER` falls on two different
 * materials — highland turf and bare scree — so it cannot name one in
 * `groundMaterialForTileType` the way `GRASSY_WEED` names grass, and the surface
 * it replaced is the only record of which of the two it is standing on.
 */
export function scatterWildernessGroundCover(
  grid: TileGrid,
  plan: TownPlan,
  borderTiles: number,
  landmarks: KeepOut,
  camps: ReadonlyArray<CampSite>,
  landform: LandformSampler,
): void {
  const seed = landform.elevation.seed;
  const candidatesOn = (
    sourceType: number,
    weightAt: (x: number, y: number) => number,
  ): WeightedTile[] => {
    const candidates: WeightedTile[] = [];
    for (let y = borderTiles + 1; y < grid.size - borderTiles - 1; y++) {
      for (let x = borderTiles + 1; x < grid.size - borderTiles - 1; x++) {
        if (grid.typeAt(x, y) !== sourceType) continue;
        // A landmark dresses its own ground.
        if (landmarks.contains(x, y)) continue;
        if (isWithinCamp(camps, x, y)) continue;
        if (isWithinSafeRadius(plan, x, y)) continue;
        candidates.push({ x, y, weight: weightAt(x, y) });
      }
    }
    return candidates;
  };
  const scatter = (
    sourceType: number,
    coverType: number,
    density: number,
    choiceSalt: number,
    weightAt: (x: number, y: number) => number,
  ) => {
    const chosen = chooseWeighted(
      candidatesOn(sourceType, weightAt),
      density,
      MAX_COVER_CHANCE,
      scatterSalt(seed, choiceSalt),
    );
    for (const { x, y } of chosen) grid.setStanding(x, y, coverType);
  };

  const flowers = new DriftField(seed, FLOWER_DRIFT_SALT, grid.size, FLOWER_DRIFT);
  const weeds = new DriftField(seed, WEED_DRIFT_SALT, grid.size, WEED_DRIFT);
  const stones = new DriftField(seed, PEBBLE_DRIFT_SALT, grid.size, PEBBLE_DRIFT);
  const flowerWeight = (x: number, y: number) =>
    flowers.presence(x, y, FLOWER_DRIFT_THRESHOLD, DRIFT_SOFTNESS) *
    lushCoverWeight(landform, x, y);
  const weedWeight = (x: number, y: number) =>
    weeds.presence(x, y, WEED_DRIFT_THRESHOLD, DRIFT_SOFTNESS) * lushCoverWeight(landform, x, y);
  const stoneWeight = (x: number, y: number) =>
    stones.presence(x, y, PEBBLE_DRIFT_THRESHOLD, DRIFT_SOFTNESS) *
    steepStoneWeight(landform, x, y);

  scatter(
    FloorTypeValue.grass,
    WILDFLOWER_TUFT,
    WILDFLOWER_DENSITY_ON_GRASS,
    FLOWER_CHOICE_SALT,
    flowerWeight,
  );
  scatter(
    FloorTypeValue.grass,
    GRASSY_WEED,
    plan.groundCover.weedDensityOnGrass,
    WEED_CHOICE_SALT,
    weedWeight,
  );
  scatter(
    HIGHLAND_GRASS,
    PEBBLE_SCATTER,
    PEBBLE_DENSITY_ON_HIGHLAND,
    HIGHLAND_PEBBLE_CHOICE_SALT,
    stoneWeight,
  );
  scatter(SCREE, PEBBLE_SCATTER, PEBBLE_DENSITY_ON_SCREE, SCREE_PEBBLE_CHOICE_SALT, stoneWeight);
}
