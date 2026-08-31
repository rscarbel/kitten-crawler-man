/**
 * What makes one floor art seed shippable.
 *
 * Shared by the seed-alphabet builder and by the sweep that re-verifies it, so
 * the rule a seed was admitted under and the rule it is held to afterwards are
 * the same rule rather than two copies of one.
 *
 * The properties are the ones the reviewed art has and that variation must not
 * cost it: patches that wrap, materials that stay at the brightness their
 * measured `GroundPalette.fallbackColor` claims, texture energy that does not
 * flatten or roughen, and a wall that stays clearly readable against the floor
 * in front of it.
 *
 * **Everything here is measured on the patch, before the renderer composites
 * it.** The world-space tone layer darkens a tile by up to its own depth after
 * these numbers are taken, and its fields carry a floor seed of their own. That
 * does not undo the wall-to-floor separation below, because the tone fields have
 * periods of dozens of tiles: a wall and the ground in front of it are one tile
 * apart and are darkened by very nearly the same amount, so the separation
 * survives the composite even though the absolute luminances do not. What would
 * break that argument is a tone field short enough to vary within a tile or two,
 * which is exactly the change that should bring a composite gate with it.
 */

import { getMaterial, paintPatch } from '../src/map/tilegen/materials.js';
import { measureWrapError, patchTears } from '../src/map/tilegen/patchSlice.js';
import type { Surface } from '../src/map/tilegen/raster.js';
import {
  GROUND_SHEETS,
  materialStructureSeed,
  variantDetailSeed,
  type GroundSheetConfig,
} from '../src/map/tilegen/sheetConfigs.js';
import { DEFAULT_FLOOR_ART_SEED, GROUND_STRUCTURE_SALT } from '../src/map/ground/floorArtSeed.js';
import { subSeed } from '../src/sprites/person/rng.js';
import { OVERWORLD_GROUND } from '../src/map/town/groundMaterials.js';
import { DUNGEON_GROUND } from '../src/map/dungeon/groundMaterials.js';
import { FLOOR1_GROUND, FLOOR1_WALL_MATERIAL } from '../src/map/dungeon/floor1Materials.js';
import { FLOOR2_GROUND, FLOOR2_WALL_MATERIAL } from '../src/map/dungeon/floor2Materials.js';
import { INTERIOR_WALL_MATERIAL, TOWN_INTERIOR_GROUND } from '../src/map/town/interiorMaterials.js';

/**
 * How far a material's mean luminance may move from the reviewed art at seed 0,
 * on the 0..255 scale.
 *
 * Set from the measured spread with room to spare rather than tight against it:
 * the point is to catch a material that has gone dark or washed out, not to
 * re-litigate grain. It is also what keeps `GroundPalette.fallbackColor` — a
 * measured mean, drawn for the frame before a sheet finishes painting — honest.
 */
export const LUMINANCE_DRIFT_LIMIT = 14;

/**
 * How far a material's texture energy may move, as a factor of the reviewed art's.
 *
 * This is the "same statistics, different grain" rule made checkable. A seed that
 * flattens a floor's stones into one tone, or roughens a calm surface into
 * noise, changes how busy the floor reads — which is the one axis variation is
 * not allowed to touch. Measured as the RMS luminance deviation over every
 * variant of the material.
 */
export const CONTRAST_DRIFT_FACTOR = 1.3;

/**
 * Least luminance difference a floor theme's wall must keep from each of its
 * floors, on the 0..255 scale.
 *
 * Separation, not ordering: a cellar wall is far darker than its floors, while a
 * shop's plaster is lighter than its boards. What must never happen is a wall
 * and the ground in front of it landing at the same brightness, which reads as
 * one continuous surface and makes a room unreadable. Enforced only by
 * convention until now; seeded variation is exactly what makes convention
 * insufficient.
 */
export const MIN_WALL_FLOOR_SEPARATION = 15;

/**
 * How far a palette's declared `fallbackColor` may sit from the mean its
 * material actually paints, per channel.
 *
 * That colour is what a tile is filled with for the frame or two before its
 * sheet finishes painting, and every palette's comment claims it was measured
 * rather than guessed. Three of them had quietly stopped being true — a street
 * declared twenty points lighter than it paints — which is the exact failure the
 * comment warns about, so the claim is now checked rather than asserted. One
 * unit of slack absorbs the rounding of a mean to a hex byte.
 */
export const FALLBACK_COLOR_CHANNEL_TOLERANCE = 1;

const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;

interface ThemeSeparation {
  readonly name: string;
  readonly wall: string;
  readonly floors: ReadonlyArray<string>;
}

/**
 * Read off each palette's own blend order rather than restated, so a material
 * added to a floor is swept the day it is added. The wall is excluded from its
 * own floor list: a palette lists it only because the `satisfies` check demands
 * a blend order for every state of the sheet.
 */
function floorsOf(blendOrder: Readonly<Record<string, number>>, wall: string): string[] {
  return Object.keys(blendOrder).filter((material) => material !== wall);
}

const THEMES: ReadonlyArray<ThemeSeparation> = [
  {
    name: 'cellars',
    wall: FLOOR1_WALL_MATERIAL,
    floors: floorsOf(FLOOR1_GROUND.blendOrder, FLOOR1_WALL_MATERIAL),
  },
  {
    name: 'service_level',
    wall: FLOOR2_WALL_MATERIAL,
    floors: floorsOf(FLOOR2_GROUND.blendOrder, FLOOR2_WALL_MATERIAL),
  },
  {
    name: 'town_interior',
    wall: INTERIOR_WALL_MATERIAL,
    floors: floorsOf(TOWN_INTERIOR_GROUND.blendOrder, INTERIOR_WALL_MATERIAL),
  },
];

export interface MaterialStats {
  /** Channel means, for checking a palette's declared fallback colour. */
  readonly meanColor: readonly [number, number, number];
  readonly meanLuminance: number;
  /** RMS luminance deviation — how much texture the material carries. */
  readonly contrast: number;
  readonly tearingVariants: ReadonlyArray<number>;
  readonly worstWrapRatio: number;
}

function luminanceOf(patch: Surface, x: number, y: number): number {
  const [red, green, blue] = patch.get(x, y);
  return LUMINANCE_RED * red + LUMINANCE_GREEN * green + LUMINANCE_BLUE * blue;
}

/** Paints every variant of one material and measures it. */
export function measureMaterial(
  sheet: GroundSheetConfig,
  materialIndex: number,
  structureTerm: number,
): MaterialStats {
  const material = getMaterial(sheet.materials[materialIndex]);
  const structure = materialStructureSeed(sheet, materialIndex, structureTerm);
  const tearingVariants: number[] = [];
  let worstWrapRatio = 0;
  let total = 0;
  let totalSquares = 0;
  let samples = 0;
  const channelTotals: [number, number, number] = [0, 0, 0];

  for (let variant = 0; variant < material.variants; variant++) {
    const patch = paintPatch(material, structure, variantDetailSeed(structure, variant));
    const report = measureWrapError(patch);
    worstWrapRatio = Math.max(worstWrapRatio, report.ratio);
    if (patchTears(report)) tearingVariants.push(variant);
    for (let y = 0; y < patch.size; y++) {
      for (let x = 0; x < patch.size; x++) {
        const [red, green, blue] = patch.get(x, y);
        channelTotals[0] += red;
        channelTotals[1] += green;
        channelTotals[2] += blue;
        const luminance = luminanceOf(patch, x, y);
        total += luminance;
        totalSquares += luminance * luminance;
        samples++;
      }
    }
  }

  const meanLuminance = total / samples;
  const variance = Math.max(0, totalSquares / samples - meanLuminance * meanLuminance);
  return {
    meanColor: [channelTotals[0] / samples, channelTotals[1] / samples, channelTotals[2] / samples],
    meanLuminance,
    contrast: Math.sqrt(variance),
    tearingVariants,
    worstWrapRatio,
  };
}

/** Every material's stats, keyed by material id. */
export type SeedProfile = ReadonlyMap<string, MaterialStats>;

export function profileArtSeed(artSeed: number): SeedProfile {
  const structureTerm =
    artSeed === DEFAULT_FLOOR_ART_SEED ? 0 : subSeed(artSeed, GROUND_STRUCTURE_SALT);
  const profile = new Map<string, MaterialStats>();
  for (const sheet of GROUND_SHEETS) {
    sheet.materials.forEach((materialId, materialIndex) => {
      profile.set(materialId, measureMaterial(sheet, materialIndex, structureTerm));
    });
  }
  return profile;
}

/** The reviewed art: every material as it is painted at an art seed of zero. */
export function reviewedProfile(): SeedProfile {
  return profileArtSeed(DEFAULT_FLOOR_ART_SEED);
}

/** Every palette's declared fallback colour, keyed by material. */
const DECLARED_FALLBACKS = new Map<string, string>();
for (const palette of [
  FLOOR1_GROUND,
  FLOOR2_GROUND,
  TOWN_INTERIOR_GROUND,
  OVERWORLD_GROUND,
  DUNGEON_GROUND,
]) {
  for (const [material, color] of Object.entries(palette.fallbackColor)) {
    DECLARED_FALLBACKS.set(material, color);
  }
}

const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;

function hexChannels(color: string): [number, number, number] {
  const digits = color.replace('#', '');
  const channel = (index: number): number =>
    Number.parseInt(
      digits.slice(index * HEX_CHANNEL_DIGITS, (index + 1) * HEX_CHANNEL_DIGITS),
      HEX_RADIX,
    );
  return [channel(0), channel(1), channel(2)];
}

/**
 * Checks that every palette's declared fallback colour is still the mean its
 * material paints. A property of the reviewed art rather than of any one seed,
 * so it is measured once against the baseline instead of per seed.
 */
export function auditFallbackColors(baseline: SeedProfile): string[] {
  const problems: string[] = [];
  let checked = 0;
  for (const [material, declared] of DECLARED_FALLBACKS) {
    const stats = baseline.get(material);
    if (stats === undefined) {
      problems.push(`"${material}" has a declared fallback colour but paints nothing`);
      continue;
    }
    checked++;
    const wanted = hexChannels(declared);
    const worst = Math.max(
      ...stats.meanColor.map((painted, channel) => Math.abs(painted - wanted[channel])),
    );
    if (worst > FALLBACK_COLOR_CHANNEL_TOLERANCE) {
      problems.push(
        `"${material}" declares fallback ${declared} but paints a mean of ` +
          `(${stats.meanColor.map((value) => Math.round(value)).join(', ')}) — ` +
          `${worst.toFixed(1)} off on its worst channel`,
      );
    }
  }
  if (checked === 0) problems.push('no fallback colour was checked at all');
  return problems;
}

export interface SeedVerdict {
  readonly artSeed: number;
  readonly failures: ReadonlyArray<string>;
  readonly worstWrapRatio: number;
  readonly worstLuminanceDrift: number;
  readonly worstContrastRatio: number;
  readonly tightestSeparation: number;
}

/**
 * Judges one art seed against the reviewed art.
 *
 * Returns its failures rather than throwing, because the alphabet builder's job
 * is to *reject* seeds and the sweep's is to prove none of the shipped ones can
 * be rejected — the same measurement read two ways.
 */
export function judgeArtSeed(artSeed: number, baseline: SeedProfile): SeedVerdict {
  const profile = profileArtSeed(artSeed);
  const failures: string[] = [];
  let worstWrapRatio = 0;
  let worstLuminanceDrift = 0;
  let worstContrastRatio = 1;
  let tightestSeparation = Infinity;

  for (const [materialId, stats] of profile) {
    worstWrapRatio = Math.max(worstWrapRatio, stats.worstWrapRatio);
    if (stats.tearingVariants.length > 0) {
      failures.push(
        `${materialId}: variants ${stats.tearingVariants.join(', ')} have a wrap joint ` +
          `harder than any line inside the patch`,
      );
    }
    const reviewed = baseline.get(materialId);
    if (reviewed === undefined) {
      failures.push(`${materialId}: no reviewed baseline was measured`);
      continue;
    }
    const drift = Math.abs(stats.meanLuminance - reviewed.meanLuminance);
    worstLuminanceDrift = Math.max(worstLuminanceDrift, drift);
    if (drift > LUMINANCE_DRIFT_LIMIT) {
      failures.push(
        `${materialId}: mean luminance drifts ${drift.toFixed(1)} points from the reviewed ` +
          `art (limit ${LUMINANCE_DRIFT_LIMIT})`,
      );
    }
    const contrastRatio = stats.contrast / Math.max(reviewed.contrast, Number.EPSILON);
    const awayFromOne = Math.max(contrastRatio, 1 / Math.max(contrastRatio, Number.EPSILON));
    if (awayFromOne > worstContrastRatio) worstContrastRatio = awayFromOne;
    if (awayFromOne > CONTRAST_DRIFT_FACTOR) {
      failures.push(
        `${materialId}: texture energy is ${contrastRatio.toFixed(2)}x the reviewed art's ` +
          `(limit ${CONTRAST_DRIFT_FACTOR}x either way)`,
      );
    }
  }

  for (const theme of THEMES) {
    const wall = profile.get(theme.wall);
    if (wall === undefined) {
      failures.push(`${theme.name}: nothing was measured for its wall "${theme.wall}"`);
      continue;
    }
    for (const floor of theme.floors) {
      const ground = profile.get(floor);
      if (ground === undefined) {
        failures.push(`${theme.name}: nothing was measured for its floor "${floor}"`);
        continue;
      }
      const separation = Math.abs(wall.meanLuminance - ground.meanLuminance);
      tightestSeparation = Math.min(tightestSeparation, separation);
      if (separation < MIN_WALL_FLOOR_SEPARATION) {
        failures.push(
          `${theme.name}: "${theme.wall}" and "${floor}" are only ${separation.toFixed(1)} ` +
            `luminance points apart (minimum ${MIN_WALL_FLOOR_SEPARATION})`,
        );
      }
    }
  }

  // A judgement that measured nothing is not a pass. A renamed material, an
  // empty theme list or a sheet table that failed to load would each leave every
  // check above unrun and hand back an empty failure list.
  if (profile.size === 0) failures.push('no materials were measured at all');
  if (!Number.isFinite(tightestSeparation)) {
    failures.push('no wall-to-floor separation was measured at all');
  }

  return {
    artSeed,
    failures,
    worstWrapRatio,
    worstLuminanceDrift,
    worstContrastRatio,
    tightestSeparation,
  };
}

/**
 * The stream candidate art seeds are drawn from.
 *
 * A fixed stream rather than `Math.random`, so the alphabet is reproducible: the
 * builder and anybody re-running it walk the same candidates in the same order
 * and land on the same set.
 */
export const ART_SEED_STREAM_BASE = 0x5eed_0a27;

export function candidateArtSeed(index: number): number {
  return subSeed(ART_SEED_STREAM_BASE, index);
}
