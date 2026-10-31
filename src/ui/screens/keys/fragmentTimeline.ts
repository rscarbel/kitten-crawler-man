/**
 * When everything happens in a key fragment's ceremony, as pure functions of
 * the frame: the world darkening, the column of gold light slamming down,
 * the fragment spinning up out of it, its reveal, the key's silhouette
 * fading in behind it, the fragment flying into its socket, and the words.
 * Nothing here keeps state, so a skip is a jump to `settledAt` and a gallery
 * fixture is a frame number.
 *
 * Frames are 60 per second. The sound beats are fitted to the recordings as
 * delivered: the column's slam peaks a beat after it starts, the rise is
 * loudest at its start and dies away under the climb, the fanfare swells to
 * full over its first half second and holds while the fragment finds its
 * place, and the socket's click is at the very front of its file.
 */

import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';
import { FULL_TURN } from '../../../sprites/lightMaps';

const DARKEN_FRAMES = 24;
/** The column drops from the top of the screen and lands this many frames later. */
const COLUMN_DROP_FRAMES = 8;
/** The column starts falling this long before the world is fully dark, so the two read as one movement. */
const DROP_BEFORE_DARK_FRAMES = 2;
const SLAM_AT = DARKEN_FRAMES - DROP_BEFORE_DARK_FRAMES + COLUMN_DROP_FRAMES;
/** The slam's impact sits this far into its recording. */
const SLAM_SOUND_LEAD = 9;
const RISE_DELAY_FRAMES = 12;
const RISE_FRAMES = 96;
const REVEAL_HOLD_FRAMES = 12;
/** The fanfare is near full this far into its recording, so it starts just ahead of the flare. */
const FANFARE_SOUND_LEAD = 12;
const SILHOUETTE_FADE_FRAMES = 30;
const SETTLE_BEFORE_FLY_FRAMES = 6;
const FLY_FRAMES = 26;
const LOCK_SOUND_LEAD = 2;
const KICKER_AFTER_LOCK = 6;
const NAME_AFTER_KICKER = 10;
const COUNT_AFTER_NAME = 18;
const LINE_AFTER_COUNT = 10;
const SETTLE_AFTER_LINE = 14;

/** The frames each beat of the ceremony starts or ends on. */
export const FRAGMENT_BEATS = (() => {
  const riseFrom = SLAM_AT + RISE_DELAY_FRAMES;
  const revealAt = riseFrom + RISE_FRAMES;
  const silhouetteFrom = revealAt + REVEAL_HOLD_FRAMES;
  const silhouetteTo = silhouetteFrom + SILHOUETTE_FADE_FRAMES;
  const flyFrom = silhouetteTo + SETTLE_BEFORE_FLY_FRAMES;
  const lockAt = flyFrom + FLY_FRAMES;
  const kickerAt = lockAt + KICKER_AFTER_LOCK;
  const nameAt = kickerAt + NAME_AFTER_KICKER;
  const countAt = nameAt + COUNT_AFTER_NAME;
  const lineAt = countAt + LINE_AFTER_COUNT;
  return {
    darkenEnd: DARKEN_FRAMES,
    columnFrom: SLAM_AT - COLUMN_DROP_FRAMES,
    slamAt: SLAM_AT,
    riseFrom,
    revealAt,
    silhouetteFrom,
    silhouetteTo,
    flyFrom,
    lockAt,
    kickerAt,
    nameAt,
    countAt,
    lineAt,
    settledAt: lineAt + SETTLE_AFTER_LINE,
  } as const;
})();

/** The frames each cue is raised on, so its loudest moment lands on its beat. */
export const FRAGMENT_CUE_FRAMES = {
  fragmentColumnSlam: FRAGMENT_BEATS.slamAt - SLAM_SOUND_LEAD,
  fragmentRise: FRAGMENT_BEATS.riseFrom,
  fragmentFanfare: FRAGMENT_BEATS.revealAt - FANFARE_SOUND_LEAD,
  fragmentSocketLock: FRAGMENT_BEATS.lockAt - LOCK_SOUND_LEAD,
} as const;

/** Continue stays inert this long after the ceremony settles, so a held key cannot dismiss it unseen. */
export const FRAGMENT_CONTINUE_GUARD_FRAMES = 18;

/** 0 before `from`, 1 after `to`, linear between. */
export function span(frame: number, from: number, to: number): number {
  if (to <= from) return frame >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (frame - from) / (to - from)));
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  const HALF = 0.5;
  const rest = 1 - t;
  return t < HALF ? 2 * t * t : 1 - 2 * rest * rest;
}

/** A pulse that rises from nothing and falls back over `frames` from `at`: 0 outside it. */
export function pulse(frame: number, at: number, frames: number): number {
  const p = span(frame, at, at + frames);
  return p <= 0 || p >= 1 ? 0 : Math.sin(p * Math.PI);
}

/** How far a decaying beat that hit at `at` has faded, 1 as it hits and 0 `frames` later. */
export function decay(frame: number, at: number, frames: number): number {
  if (frame < at) return 0;
  return 1 - span(frame, at, at + frames);
}

const BACKDROP_ALPHA = 0.94;

/** How dark the world under the ceremony is. */
export function fragmentBackdrop(frame: number): number {
  return BACKDROP_ALPHA * easeOut(span(frame, 0, FRAGMENT_BEATS.darkenEnd));
}

const COLUMN_FADE_FRAMES = 40;

/**
 * The column of light: how far down the screen it has reached (0 to 1) and
 * how bright it is. It slams down, burns while the fragment rises, and fades
 * as the silhouette takes the stage.
 */
export function fragmentColumn(frame: number): { readonly reach: number; readonly alpha: number } {
  const { columnFrom, slamAt, silhouetteFrom } = FRAGMENT_BEATS;
  const reach = easeOut(span(frame, columnFrom, slamAt));
  const fade = 1 - span(frame, silhouetteFrom, silhouetteFrom + COLUMN_FADE_FRAMES);
  return { reach, alpha: reach * fade };
}

/** Whole turns the fragment makes on its way up, so it ends its climb facing the player. */
const RISE_TURNS = 3;
const RISE_SCALE_FROM = 0.35;
/** The fragment's share of the stage's height below its resting point when it leaves the column's foot. */
const RISE_DEPTH = 0.42;

/** Where the fragment is, relative to its resting point at the stage's middle and the socket it flies to. */
export interface FragmentPose {
  /** 0 at the resting point, 1 in its socket. */
  readonly toSocket: number;
  /** How far below the resting point it is, as a share of the stage's height. */
  readonly drop: number;
  /** Its size as a share of its revealed size. */
  readonly scale: number;
  /** Its turn about its own upright axis, in radians: 0 faces the player. */
  readonly turn: number;
  readonly alpha: number;
  /** 0..1, where the glint sweeping its metal is. */
  readonly glint: number;
}

const FADE_IN_FRAMES = 14;
const GLINT_FRAMES = 30;

export function fragmentPose(frame: number, reducedMotion: boolean): FragmentPose {
  const { riseFrom, revealAt, flyFrom, lockAt } = FRAGMENT_BEATS;
  const rise = easeOut(span(frame, riseFrom, revealAt));
  const alpha = span(frame, riseFrom, riseFrom + FADE_IN_FRAMES);
  const toSocket = easeInOut(span(frame, flyFrom, lockAt));
  const turn = reducedMotion ? 0 : rise * RISE_TURNS * FULL_TURN;
  const flare = span(frame, revealAt, revealAt + GLINT_FRAMES);
  const climbGlint = (rise * RISE_TURNS) % 1;
  return {
    toSocket,
    drop: reducedMotion ? 0 : (1 - rise) * RISE_DEPTH,
    scale: reducedMotion ? 1 : RISE_SCALE_FROM + (1 - RISE_SCALE_FROM) * rise,
    turn,
    alpha,
    glint: frame < revealAt ? climbGlint : flare,
  };
}

/** How solid the key's silhouette behind the fragment is. */
export function fragmentSilhouette(frame: number): number {
  return easeInOut(span(frame, FRAGMENT_BEATS.silhouetteFrom, FRAGMENT_BEATS.silhouetteTo));
}

const SHAKE_FRAMES = 16;
const SLAM_SHAKE = 1;
const LOCK_SHAKE = 0.6;

/** How hard the stage is shaking, 0 to 1: the column's slam and the socket's lock. */
export function fragmentShake(frame: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const { slamAt, lockAt } = FRAGMENT_BEATS;
  return Math.max(
    SLAM_SHAKE * decay(frame, slamAt, SHAKE_FRAMES),
    LOCK_SHAKE * decay(frame, lockAt, SHAKE_FRAMES),
  );
}

const WORD_FADE_FRAMES = 12;
const NAME_SLAM_FRAMES = 12;
/** The fragment's name lands from this much bigger than its resting size. */
const NAME_SLAM_FROM = 1.8;
/** The name is solid halfway through its slam. */
const NAME_SOLID_SHARE = 0.5;

/** How far each line of words has come in: kicker, name (with its slam scale), count and Caroline. */
export function fragmentWords(frame: number): {
  readonly kicker: number;
  readonly name: number;
  readonly nameScale: number;
  readonly count: number;
  readonly line: number;
} {
  const { kickerAt, nameAt, countAt, lineAt } = FRAGMENT_BEATS;
  const slam = easeOut(span(frame, nameAt, nameAt + NAME_SLAM_FRAMES));
  return {
    kicker: span(frame, kickerAt, kickerAt + WORD_FADE_FRAMES),
    name: span(frame, nameAt, nameAt + NAME_SLAM_FRAMES * NAME_SOLID_SHARE),
    nameScale: NAME_SLAM_FROM - (NAME_SLAM_FROM - 1) * slam,
    count: span(frame, countAt, countAt + WORD_FADE_FRAMES),
    line: span(frame, lineAt, lineAt + WORD_FADE_FRAMES),
  };
}

const MS_PER_SECOND = 1000;

/** Milliseconds a frame of the ceremony lasts, for Caroline's decoding text, which runs on a clock. */
export const MS_PER_FRAME = MS_PER_SECOND / WORLD_TICKS_PER_SECOND;
