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
 * floor 3. The storm drain's is the exception to the blue: town runoff, a murky
 * green-brown over its brick and silt, but just as opaque from the second step.
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
 * Where the water meets dry floor: the stone kerb along the floor's edge, and
 * the flat waterline on the water beneath it.
 */
interface DungeonWaterKerbInk {
  /** The kerb's top, a little lighter than the floor behind it. */
  readonly top: WaterInk;
  /** The worn outer edge of the top, catching the light. */
  readonly highlight: WaterInk;
  /** The face dropping to the water, at its top and at the waterline. */
  readonly face: WaterInk;
  readonly faceFoot: WaterInk;
  /** The mortar line behind the kerb and between its stones. */
  readonly joint: WaterInk;
  readonly jointAlpha: number;
  /** The kerb's shadow on the water, strongest against the stone. */
  readonly waterShadow: WaterInk;
  readonly waterShadowAlpha: number;
  /** The pale line where the water touches the stone, in the surface's foam. */
  readonly waterGlintAlpha: number;
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
  readonly kerb: DungeonWaterKerbInk;
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
    kerb: {
      top: { r: 128, g: 118, b: 100 },
      highlight: { r: 166, g: 154, b: 130 },
      face: { r: 74, g: 66, b: 54 },
      faceFoot: { r: 30, g: 27, b: 22 },
      joint: { r: 26, g: 22, b: 18 },
      jointAlpha: 0.7,
      waterShadow: { r: 6, g: 10, b: 18 },
      waterShadowAlpha: 0.55,
      waterGlintAlpha: 0.35,
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
    kerb: {
      top: { r: 138, g: 144, b: 148 },
      highlight: { r: 178, g: 184, b: 188 },
      face: { r: 74, g: 80, b: 86 },
      faceFoot: { r: 28, g: 33, b: 38 },
      joint: { r: 24, g: 28, b: 32 },
      jointAlpha: 0.7,
      waterShadow: { r: 5, g: 12, b: 18 },
      waterShadowAlpha: 0.55,
      waterGlintAlpha: 0.35,
    },
  },
  sewer: {
    byDepth: [
      { r: 74, g: 76, b: 52, opacity: 0.42 },
      { r: 56, g: 60, b: 38, opacity: 0.7 },
      { r: 40, g: 44, b: 28, opacity: 0.97 },
      { r: 28, g: 31, b: 20, opacity: 1 },
    ],
    dryEdge: { r: 56, g: 60, b: 38, opacity: 0.6 },
    surface: {
      crest: { r: 128, g: 134, b: 92 },
      trough: { r: 14, g: 16, b: 8 },
      foam: { r: 176, g: 174, b: 136 },
      strengthByDepth: [0.25, 0.6, 0.72, 0.8],
    },
    kerb: {
      top: { r: 118, g: 120, b: 108 },
      highlight: { r: 152, g: 152, b: 136 },
      face: { r: 64, g: 64, b: 52 },
      faceFoot: { r: 26, g: 27, b: 20 },
      joint: { r: 22, g: 22, b: 16 },
      jointAlpha: 0.7,
      waterShadow: { r: 10, g: 12, b: 6 },
      waterShadowAlpha: 0.55,
      waterGlintAlpha: 0.3,
    },
  },
};
