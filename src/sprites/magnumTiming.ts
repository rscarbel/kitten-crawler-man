/**
 * Frame counts and playback speeds for Magnum's stage act.
 *
 * The choreography (`src/sprites/art/magnumFigure.ts`, `magnumDance.ts`) and
 * whatever drives him at runtime both read these, so the two cannot drift.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

/**
 * His stage tempo, in beats a minute: slower and heavier than the dance
 * floor's 120, the strip-club grind rather than the house beat.
 */
export const MAGNUM_DANCE_BPM = 96;
/**
 * Frames to a beat. Eight, the crowd's own, so the fastest thing he does once
 * a beat (a pop, a thrust) spans eight frames and never aliases into a strobe.
 */
export const MAGNUM_FRAMES_PER_BEAT = 8;
/** A phrase is two beats, sixteen frames: the unit every routine is built from. */
export const MAGNUM_BEATS_PER_PHRASE = 2;
export const MAGNUM_PHRASE_FRAMES = MAGNUM_FRAMES_PER_BEAT * MAGNUM_BEATS_PER_PHRASE;

const SECONDS_PER_MINUTE = 60;
/** Frames a second the dance plays at: the tempo times the frames in a beat. */
export const MAGNUM_DANCE_FPS = (MAGNUM_DANCE_BPM / SECONDS_PER_MINUTE) * MAGNUM_FRAMES_PER_BEAT;
