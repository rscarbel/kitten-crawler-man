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
   * body, a prop or a spell outside every light still reads clearly. Fixed:
   * darkness exists only for contrast, so nothing the player has may lower it.
   */
  cap: 0.5,
  /**
   * Darkness at or above which a hostile outside every light shows eye-shine:
   * only where its body is genuinely hard to read.
   */
  eyeShineMinDarkness: 0.45,
  /**
   * The spider lab's approach, graded along its walk: a shade darker than any
   * other hallway where it leaves the host room, and at the cap by the lab.
   */
  labHallway: {
    mouthDarkness: 0.32,
    labEndDarkness: 0.5,
  },
} as const;
