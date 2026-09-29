/**
 * The dance vocabulary both club casts share: which routines exist, how long
 * a loop is, how fast it plays, and — for the routine with a turn in it —
 * which way the dancer faces on each frame.
 *
 * Every routine is one bar of two beats. A beat is eight frames, so the
 * fastest thing any routine does (a bounce or a shimmy, once a beat) spans
 * eight frames and stays well clear of the per-frame limit where an
 * oscillation aliases into a freeze or a strobe. At {@link DANCE_FPS} a bar
 * lasts one second: 120 beats a minute, the club's house tempo.
 *
 * Dance rows are baked facing the camera only, because a dancer never walks:
 * the turn is painted into the spin routine's own frames instead of being a
 * second row per view.
 */

export type DanceStyle = 'pump' | 'shimmy' | 'spin';

/** Every routine, in the order a dance floor hands them out. */
export const DANCE_STYLES: readonly DanceStyle[] = ['pump', 'shimmy', 'spin'];

export const DANCE_FRAMES_PER_BEAT = 8;
export const DANCE_BEATS_PER_LOOP = 2;
export const DANCE_FRAMES = DANCE_FRAMES_PER_BEAT * DANCE_BEATS_PER_LOOP;
/** Frames a second a dance row plays at: one bar a second. */
export const DANCE_FPS = 16;

/** The state a routine is baked under. */
export function danceStateName(style: DanceStyle): string {
  return `dance_${style}`;
}

/** Which way a dancer faces on a frame: the camera, either profile, or away. */
export type DanceFacing = 'down' | 'right' | 'up' | 'left';

/**
 * The spin routine's facing per frame: the first beat faces the camera, the
 * second turns a full circle two frames to a quarter and lands facing the
 * camera again as the bar wraps.
 */
const SPIN_FACINGS: readonly DanceFacing[] = [
  'down',
  'down',
  'down',
  'down',
  'down',
  'down',
  'down',
  'down',
  'right',
  'right',
  'up',
  'up',
  'left',
  'left',
  'down',
  'down',
];

/** The frame the spin starts turning on. */
export const SPIN_TURN_START_FRAME = SPIN_FACINGS.indexOf('right');

export function danceFacingAt(style: DanceStyle, frame: number): DanceFacing {
  if (style !== 'spin') return 'down';
  const wrapped = ((frame % DANCE_FRAMES) + DANCE_FRAMES) % DANCE_FRAMES;
  return SPIN_FACINGS[wrapped];
}

/** Where a frame sits in its beat, 0 on the beat to just under 1. */
export function beatPhase(frame: number): number {
  return (frame % DANCE_FRAMES_PER_BEAT) / DANCE_FRAMES_PER_BEAT;
}

/** Which beat of the bar a frame is on, 0 or 1. */
export function beatIndex(frame: number): number {
  return Math.floor((frame % DANCE_FRAMES) / DANCE_FRAMES_PER_BEAT);
}

/** Where a frame sits in the whole bar, 0 to just under 1. */
export function barPhase(frame: number): number {
  return (frame % DANCE_FRAMES) / DANCE_FRAMES;
}
