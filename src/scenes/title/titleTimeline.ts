/**
 * The title's one-shot sequences as data: when each beat of the ignition and
 * the dive lands, as keyframes the scene hands to every layer. Retiming a beat
 * is an edit to a constant here; no layer keeps its own copy of these times.
 */

/**
 * A beat of a title sequence, delivered to every layer's `onCue`:
 * - `ignite`: the music has started; the reveal begins.
 * - `torchesLight`: the hall's torches flare one after another (a layer staggers them itself).
 * - `spotlightOn`: the spotlight snaps onto the heroes.
 * - `logoSlam`: the logo begins its fall onto the screen.
 * - `shake`: the camera shake as the logo lands, with its dust burst.
 * - `menuFlash`: the menu buttons flash once, in time with the slam.
 * - `settle`: the reveal is over and the idle loop takes over.
 * - `diveStart`: a menu choice was taken; the camera starts its push.
 * - `blackout`: the light collapses to black, just before the scene is replaced.
 */
export type TitleCue =
  | 'ignite'
  | 'torchesLight'
  | 'spotlightOn'
  | 'logoSlam'
  | 'shake'
  | 'menuFlash'
  | 'settle'
  | 'diveStart'
  | 'blackout';

/** A cue and when it fires, in milliseconds from the start of its sequence. */
export interface TitleKeyframe {
  readonly atMs: number;
  readonly cue: TitleCue;
}

/** How long the ignition reveal runs before the idle loop takes over. */
export const IGNITION_DURATION_MS = 3600;

const IGNITE_AT_MS = 0;
/** When the first torch down the hall begins to flare; the torch layer staggers the rest from here. */
export const TORCHES_LIGHT_AT_MS = 150;
/** The spotlight snaps on just after the nearest torches have caught. */
export const SPOTLIGHT_ON_AT_MS = 1250;
/** When the logo starts its fall toward the screen. */
export const LOGO_SLAM_AT_MS = 1700;
/** How long the logo falls before it lands. */
export const LOGO_FALL_MS = 260;
/** The instant the logo lands: the shake, the dust and the menu's flash all hit together. */
export const LOGO_IMPACT_AT_MS = LOGO_SLAM_AT_MS + LOGO_FALL_MS;
/** The ignition, in firing order. */
export const IGNITION_TIMELINE: readonly TitleKeyframe[] = [
  { atMs: IGNITE_AT_MS, cue: 'ignite' },
  { atMs: TORCHES_LIGHT_AT_MS, cue: 'torchesLight' },
  { atMs: SPOTLIGHT_ON_AT_MS, cue: 'spotlightOn' },
  { atMs: LOGO_SLAM_AT_MS, cue: 'logoSlam' },
  { atMs: LOGO_IMPACT_AT_MS, cue: 'shake' },
  { atMs: LOGO_IMPACT_AT_MS, cue: 'menuFlash' },
  { atMs: IGNITION_DURATION_MS, cue: 'settle' },
];

/**
 * How long a menu choice waits on the dive before its scene replaces the
 * title. Short, because the player has already chosen: it is a transition,
 * never a wait.
 */
export const DIVE_DURATION_MS = 700;

const DIVE_START_AT_MS = 0;
/** When the last of the light gives out and the picture goes to black. */
export const BLACKOUT_AT_MS = 420;

/** The dive, in firing order. */
export const DIVE_TIMELINE: readonly TitleKeyframe[] = [
  { atMs: DIVE_START_AT_MS, cue: 'diveStart' },
  { atMs: BLACKOUT_AT_MS, cue: 'blackout' },
];

/**
 * Plays one sequence forward: each call hands back the keyframes whose time has
 * come since the last call, in order, each exactly once. Jumping straight to a
 * late time fires everything before it, so a sequence entered part-way (the
 * fast path, a review render) leaves every layer as if it had watched.
 */
export class TimelineCursor {
  private nextIndex = 0;

  constructor(private readonly keyframes: readonly TitleKeyframe[]) {}

  advanceTo(elapsedMs: number): TitleKeyframe[] {
    const due: TitleKeyframe[] = [];
    while (this.nextIndex < this.keyframes.length) {
      const keyframe = this.keyframes[this.nextIndex];
      if (keyframe.atMs > elapsedMs) break;
      due.push(keyframe);
      this.nextIndex += 1;
    }
    return due;
  }
}
