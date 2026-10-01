/**
 * How dark the dungeon gets: the numbers to retune after a playtest, in one
 * place.
 *
 * The mood comes from warm pools of light and gentle falloff over a scene
 * that stays readable, never from hiding the art. Every number here is the
 * alpha of the darkness laid over the world: 0 leaves the art untouched, 1
 * would paint it out.
 */

import type { AmbientLevel } from '../../map/dungeon/roomCharacters';

export const LIGHTING_TUNING = {
  /** How dark each ambient level of a room or hallway is before any light. */
  ambient: {
    lit: 0,
    dim: 0.25,
    dark: 0.5,
  } satisfies Record<AmbientLevel, number>,
  /**
   * The most dark the ambient may ever be, an unlit room included. At this a
   * body, a prop or a spell outside every light still reads clearly.
   */
  cap: 0.5,
  /** How far each level of Night Vision lowers the cap. */
  nightVisionCapDropPerLevel: 0.04,
  /** The lowest Night Vision can bring the cap. */
  nightVisionMinCap: 0.2,
  /** Extra reach each level of Night Vision gives a crawler's light, in tiles. */
  nightVisionReachPerLevel: 0.35,
  /**
   * Darkness at or above which a hostile outside every light shows eye-shine:
   * only where its body is genuinely hard to read.
   */
  eyeShineMinDarkness: 0.45,
} as const;
