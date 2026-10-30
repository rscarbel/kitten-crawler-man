/**
 * The roosters' attack timing in game frames: how long each one-shot runs and
 * where in it the blow lands, the weight leaves the hand or the crow peaks.
 *
 * Three things have to agree about when an attack connects: the row the figure
 * paints, the countdown in the creature that resolves the damage, and the frame
 * the sprite draws on that countdown. Row lengths and impact frames are read
 * from the figure's own table (`ROOSTER_ROW_TIMING`); this module only adds how
 * many game frames each sprite frame is held, which is gameplay pacing rather
 * than art. A retune of either moves all three together.
 */

import { ROOSTER_ROW_TIMING, rowImpactProgress } from './art/roosterFigure';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

/** Sprite frames a second every rooster's idle plays at, off the wall clock. */
export const ROOSTER_IDLE_FPS = 8;
/** Game frames one loop of the idle lasts at {@link ROOSTER_IDLE_FPS}. */
export const ROOSTER_IDLE_GAME_FRAMES =
  (ROOSTER_ROW_TIMING.idle.frames / ROOSTER_IDLE_FPS) * WORLD_TICKS_PER_SECOND;

/** Game frames before a one-shot's impact, for a row of `spriteFrames` held `hold` frames each. */
function windupFramesOf(spriteFrames: number, hold: number, impactProgress: number): number {
  return Math.round(spriteFrames * hold * impactProgress);
}

/** Game frames after a one-shot's impact to the end of its row. */
function recoverFramesOf(spriteFrames: number, hold: number, impactProgress: number): number {
  return spriteFrames * hold - windupFramesOf(spriteFrames, hold, impactProgress);
}

/**
 * How far through a one-shot its impact frame first shows. A hand-off between
 * the drawn hand and something else (the dumbbell leaving it, or arriving in
 * it) happens here rather than mid-frame, because the figure stops or starts
 * drawing the held dumbbell on exactly this frame: any later and the weight
 * vanishes from the fist for a few frames before it appears in the air.
 */
function impactFrameStartProgress(base: 'throw' | 'pickup'): number {
  const timing = ROOSTER_ROW_TIMING[base];
  return (timing.impactFrame ?? 0) / timing.frames;
}

/**
 * How far through a one-shot row a wind-up-then-recovery attack is, split at
 * its impact so the row's own impact frame is drawn on the frame the damage
 * fires: the two halves have their own lengths, so a linear ramp across both
 * would drift the drawn blow away from the real one.
 */
export function splitAtImpactProgress(
  inWindup: boolean,
  framesLeft: number,
  windupFrames: number,
  recoverFrames: number,
  impactProgress: number,
): number {
  if (inWindup) return ((windupFrames - framesLeft) / windupFrames) * impactProgress;
  const elapsed = (recoverFrames - framesLeft) / recoverFrames;
  return impactProgress + elapsed * (1 - impactProgress);
}

/** Game frames each peck frame is held: a short wind-up with the neck drawn back. */
const ROOSTER_PECK_FRAME_HOLD = 5;
/** Where in the peck the beak reaches furthest, as a fraction of the row. */
export const ROOSTER_PECK_IMPACT_PROGRESS = rowImpactProgress('peck');
export const ROOSTER_PECK_WINDUP_FRAMES = windupFramesOf(
  ROOSTER_ROW_TIMING.peck.frames,
  ROOSTER_PECK_FRAME_HOLD,
  ROOSTER_PECK_IMPACT_PROGRESS,
);
export const ROOSTER_PECK_RECOVER_FRAMES = recoverFramesOf(
  ROOSTER_ROW_TIMING.peck.frames,
  ROOSTER_PECK_FRAME_HOLD,
  ROOSTER_PECK_IMPACT_PROGRESS,
);

/** Game frames each punch frame is held: a medium wind-up, slower than the peck's. */
const ROOSTER_PUNCH_FRAME_HOLD = 6;
/** Where in the punch the fist lands, as a fraction of the row. */
export const ROOSTER_PUNCH_IMPACT_PROGRESS = rowImpactProgress('punch');
export const ROOSTER_PUNCH_WINDUP_FRAMES = windupFramesOf(
  ROOSTER_ROW_TIMING.punch.frames,
  ROOSTER_PUNCH_FRAME_HOLD,
  ROOSTER_PUNCH_IMPACT_PROGRESS,
);
export const ROOSTER_PUNCH_RECOVER_FRAMES = recoverFramesOf(
  ROOSTER_ROW_TIMING.punch.frames,
  ROOSTER_PUNCH_FRAME_HOLD,
  ROOSTER_PUNCH_IMPACT_PROGRESS,
);

/**
 * Game frames each swing frame is held: the dumbbell stays raised behind his
 * shoulder long enough for the cone on the floor to be read and left.
 */
const BIG_ROOSTER_CLUB_SWING_FRAME_HOLD = 6;
/** Where in the swing the dumbbell reaches the front of its arc, as a fraction of the row. */
export const BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS = rowImpactProgress('club_swing');
export const BIG_ROOSTER_CLUB_SWING_WINDUP_FRAMES = windupFramesOf(
  ROOSTER_ROW_TIMING.club_swing.frames,
  BIG_ROOSTER_CLUB_SWING_FRAME_HOLD,
  BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
);
export const BIG_ROOSTER_CLUB_SWING_RECOVER_FRAMES = recoverFramesOf(
  ROOSTER_ROW_TIMING.club_swing.frames,
  BIG_ROOSTER_CLUB_SWING_FRAME_HOLD,
  BIG_ROOSTER_CLUB_SWING_IMPACT_PROGRESS,
);

/** Where in the throw the dumbbell leaves his hand, as a fraction of the row. */
export const BIG_ROOSTER_THROW_RELEASE_PROGRESS = impactFrameStartProgress('throw');

/** Game frames from the dumbbell going back to the end of the throw's follow-through. */
export const BIG_ROOSTER_THROW_WINDUP_FRAMES = 60;

/**
 * The frame of the throw's wind-up on which the weight leaves his hands: the
 * locked telegraph a crawler gets to step off the line.
 *
 * A frame counter rather than a fraction compared each frame: the progress is a
 * float and the release has to happen on exactly one frame, or the throw
 * either fires twice or never fires at all.
 */
export const BIG_ROOSTER_THROW_RELEASE_FRAME = Math.max(
  1,
  Math.round(BIG_ROOSTER_THROW_WINDUP_FRAMES * BIG_ROOSTER_THROW_RELEASE_PROGRESS),
);

/**
 * Game frames of rearing back before the fists land. This is the whole
 * counter-play: the circle sits on the floor for three quarters of a second
 * and the point it marks is never revised, so walking off it is always
 * available.
 */
export const BIG_ROOSTER_SLAM_WINDUP_FRAMES = 45;
/** Game frames of settling out of the crouch before he can act again. */
export const BIG_ROOSTER_SLAM_RECOVER_FRAMES = 30;

/** Where in the slam the fists meet the floor, as a fraction of the row. */
export const BIG_ROOSTER_SLAM_IMPACT_PROGRESS = rowImpactProgress('slam');

/** Sprite frames in Big Rooster's one-shot dumbbell pickup. */
export const BIG_ROOSTER_PICKUP_FRAMES = ROOSTER_ROW_TIMING.pickup.frames;

/** Where in the pickup his hand closes on the dumbbell, as a fraction of the row. */
export const BIG_ROOSTER_PICKUP_GRAB_PROGRESS = impactFrameStartProgress('pickup');

/** Sprite frames in Big Rooster's one-shot crow. */
export const BIG_ROOSTER_CROW_FRAMES = ROOSTER_ROW_TIMING.crow.frames;

/** Game frames each sprite frame of a one-shot row is held for. */
const ROOSTER_FRAME_HOLD = 3;

/** How many game frames a one-shot row of `spriteFrames` frames occupies. */
export function roosterActionFrames(spriteFrames: number): number {
  return spriteFrames * ROOSTER_FRAME_HOLD;
}

/**
 * How far through the throw row he is, given game frames elapsed in its
 * wind-up.
 *
 * Split at the release rather than ramped straight across, so the release
 * frame lands on {@link BIG_ROOSTER_THROW_RELEASE_PROGRESS} exactly whatever
 * {@link BIG_ROOSTER_THROW_WINDUP_FRAMES} is retuned to. That equality closes
 * the hand-off: the figure stops drawing the held dumbbell at exactly that
 * progress, so the overlay disappears on the frame the projectile appears.
 */
export function bigRoosterThrowProgressAt(elapsedFrames: number): number {
  const release = BIG_ROOSTER_THROW_RELEASE_FRAME;
  if (elapsedFrames <= release) {
    return (elapsedFrames / release) * BIG_ROOSTER_THROW_RELEASE_PROGRESS;
  }
  const followThrough = (elapsedFrames - release) / (BIG_ROOSTER_THROW_WINDUP_FRAMES - release);
  return (
    BIG_ROOSTER_THROW_RELEASE_PROGRESS + followThrough * (1 - BIG_ROOSTER_THROW_RELEASE_PROGRESS)
  );
}
