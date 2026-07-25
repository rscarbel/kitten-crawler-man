/**
 * Colour ramps for material painters.
 *
 * Every palette here is anchored to colours sampled from art that already works —
 * the two hand-repaired overworld tiles and the dungeon sheet — so generated
 * ground sits next to the existing building PNGs without a hue clash. What the
 * generated versions add is *range*: the sampled grass spans only 91→110 red
 * across its 5th–95th percentile, which is exactly why it reads as flat colour.
 */

import type { RGB } from './raster.js';

export interface Ramp {
  /** Deepest shadow value. */
  readonly shadow: RGB;
  /** Bulk colour — most pixels land near here. */
  readonly mid: RGB;
  /** Lit value. */
  readonly light: RGB;
  /** Rare sparkle/bleached value, used sparingly for detail. */
  readonly accent: RGB;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Samples a ramp with `t` in [0, 1]: shadow → mid → light. */
export function sampleRamp(ramp: Ramp, t: number): RGB {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const MIDPOINT = 0.5;
  return clamped < MIDPOINT
    ? mix(ramp.shadow, ramp.mid, clamped / MIDPOINT)
    : mix(ramp.mid, ramp.light, (clamped - MIDPOINT) / MIDPOINT);
}

export function shade(color: RGB, factor: number): RGB {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

// Sampled from overworld_tileset row 0 col 0 (hand-repaired grass), then widened.
export const GRASS_RAMP: Ramp = {
  shadow: [58, 72, 30],
  mid: [99, 112, 50],
  light: [136, 150, 70],
  accent: [172, 182, 96],
};

export const DEAD_GRASS_RAMP: Ramp = {
  shadow: [92, 84, 44],
  mid: [140, 128, 68],
  light: [174, 160, 96],
  accent: [196, 182, 118],
};

// Sampled from overworld_tileset row 3 col 0 (hand-repaired village street).
export const STREET_STONE_RAMP: Ramp = {
  shadow: [84, 70, 52],
  mid: [140, 120, 90],
  light: [178, 156, 122],
  accent: [200, 180, 148],
};

export const COBBLE_RAMP: Ramp = {
  shadow: [72, 66, 60],
  mid: [124, 116, 106],
  light: [166, 158, 146],
  accent: [190, 182, 170],
};

export const FLAGSTONE_RAMP: Ramp = {
  shadow: [104, 98, 88],
  mid: [156, 148, 134],
  light: [192, 184, 168],
  accent: [212, 204, 188],
};

export const DIRT_RAMP: Ramp = {
  shadow: [62, 46, 32],
  mid: [108, 84, 58],
  light: [148, 120, 88],
  accent: [176, 148, 112],
};

export const GRAVEL_RAMP: Ramp = {
  shadow: [66, 60, 54],
  mid: [116, 108, 98],
  light: [162, 154, 142],
  accent: [188, 180, 168],
};

// Sampled from dungeon_tileset row 0 col 0 (floor_plain), widened.
export const DUNGEON_STONE_RAMP: Ramp = {
  shadow: [96, 97, 102],
  mid: [165, 166, 170],
  light: [198, 198, 202],
  accent: [216, 216, 220],
};

// Sampled from dungeon_tileset row 3 col 0 (floor_mossy).
export const MOSS_RAMP: Ramp = {
  shadow: [52, 74, 48],
  mid: [88, 118, 82],
  light: [124, 156, 112],
  accent: [152, 182, 134],
};

// Sampled from dungeon_tileset row 7 col 0 (wall_plain).
export const DUNGEON_WALL_RAMP: Ramp = {
  shadow: [34, 29, 25],
  mid: [70, 60, 52],
  light: [104, 90, 76],
  accent: [128, 112, 94],
};

export const WATER_RAMP: Ramp = {
  shadow: [22, 32, 38],
  mid: [40, 56, 64],
  light: [70, 92, 100],
  accent: [128, 156, 164],
};
