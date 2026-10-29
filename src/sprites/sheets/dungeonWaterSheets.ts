/**
 * How standing water looks on each dungeon floor: the plan the dungeon water
 * column (`src/map/tiles/dungeonWaterColumn.ts`) and its moving surface
 * (`src/map/tiles/dungeonWaterSurface.ts`) paint from.
 *
 * Dungeon water is service runoff churned by pumps and whatever lives in it,
 * not a river: a deep murky blue, and opaque. Only the shallowest step lets a
 * little of the floor show, so a flooded corridor still reads as wading in
 * from dry ground; from the second step down nothing beneath is visible, which
 * is what lets a fin or a waterline mean something is hidden under it. Each
 * floor's tints lean toward that floor's own materials — a slate blue over
 * the cellars' stone, a colder teal-blue over the service level's concrete — so the
 * water never looks borrowed from the other floor, or from the river on
 * floor 3.
 */

import type { DungeonFloorThemeId } from '../../map/dungeon/floorTheme';

/** One sample of the water column: its colour, and how much of the floor beneath it hides. */
export interface WaterColumnTint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 0..1. */
  readonly opacity: number;
}

export interface WaterInk {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The chop painted over the column: lit wave faces, the troughs between them,
 * and the foam the churn whips up.
 */
export interface DungeonWaterSurfaceInk {
  readonly crest: WaterInk;
  readonly trough: WaterInk;
  readonly foam: WaterInk;
  /**
   * How strongly the chop is laid over each `waterDepth`, indexed like
   * `byDepth`: the shallows are calmer than the open water.
   */
  readonly strengthByDepth: readonly [number, number, number, number];
}

/**
 * Where the water meets dry floor: the band of floor the water has soaked
 * dark, and the thin film and foam that lap up over it and back.
 */
export interface DungeonWaterShoreInk {
  readonly wet: WaterInk;
  /** How dark the soaked floor is at the waterline, 0..1, fading to dry over its reach. */
  readonly wetAlpha: number;
  /** The sheet of water a lap leaves on the floor as it runs up and drains back. */
  readonly filmAlpha: number;
  /** The foam riding the front of each lap. */
  readonly lapFoamAlpha: number;
  /** The scum that stays strung along the waterline between laps. */
  readonly restFoamAlpha: number;
}

export interface DungeonWaterPlan {
  /**
   * The water at each `waterDepth`, indexed by depth. Index 0 is never a water
   * tile's own depth; it is what a tile reads as in the instant it drains dry.
   */
  readonly byDepth: readonly [WaterColumnTint, WaterColumnTint, WaterColumnTint, WaterColumnTint];
  /**
   * What a dry floor tile beside the water contributes to the smoothed column:
   * thinner than the shallowest water, so the edge feathers out across the
   * last half tile instead of ending in a hard line at the tile edge.
   */
  readonly dryEdge: WaterColumnTint;
  readonly surface: DungeonWaterSurfaceInk;
  readonly shore: DungeonWaterShoreInk;
}

export const DUNGEON_WATER_PLANS: Readonly<Record<DungeonFloorThemeId, DungeonWaterPlan>> = {
  cellars: {
    byDepth: [
      { r: 72, g: 84, b: 98, opacity: 0.4 },
      { r: 52, g: 66, b: 86, opacity: 0.64 },
      { r: 36, g: 51, b: 74, opacity: 0.97 },
      { r: 24, g: 37, b: 58, opacity: 1 },
    ],
    dryEdge: { r: 52, g: 66, b: 86, opacity: 0.6 },
    surface: {
      crest: { r: 118, g: 146, b: 176 },
      trough: { r: 8, g: 16, b: 30 },
      foam: { r: 196, g: 210, b: 224 },
      strengthByDepth: [0.3, 0.78, 0.92, 1],
    },
    shore: {
      wet: { r: 18, g: 22, b: 30 },
      wetAlpha: 0.6,
      filmAlpha: 0.38,
      lapFoamAlpha: 0.55,
      restFoamAlpha: 0.3,
    },
  },
  service_level: {
    byDepth: [
      { r: 66, g: 84, b: 96, opacity: 0.4 },
      { r: 48, g: 67, b: 84, opacity: 0.64 },
      { r: 33, g: 52, b: 70, opacity: 0.97 },
      { r: 21, g: 38, b: 54, opacity: 1 },
    ],
    dryEdge: { r: 48, g: 67, b: 84, opacity: 0.6 },
    surface: {
      crest: { r: 112, g: 148, b: 170 },
      trough: { r: 7, g: 17, b: 27 },
      foam: { r: 192, g: 212, b: 222 },
      strengthByDepth: [0.3, 0.78, 0.92, 1],
    },
    shore: {
      wet: { r: 16, g: 22, b: 28 },
      wetAlpha: 0.6,
      filmAlpha: 0.38,
      lapFoamAlpha: 0.55,
      restFoamAlpha: 0.3,
    },
  },
};
