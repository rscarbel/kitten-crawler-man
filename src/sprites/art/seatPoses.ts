/**
 * The seated vocabulary both club casts share: what a seated patron can be
 * doing, how long each piece plays and whether it loops, and the height of
 * the seat they sit on.
 *
 * Every one-shot pose starts and ends on the seated rest, the first frame of
 * `idle`, so a caller can chain idle → play → idle → cheer in any order and the
 * figure never pops between rows.
 */

import { ramp } from './bipedArt';

export type SeatPose = 'idle' | 'play' | 'cheer' | 'slump';

export const SEAT_POSES: readonly SeatPose[] = ['idle', 'play', 'cheer', 'slump'];

/** The views a seated row is baked in: facing the camera, in profile, facing away. */
export type SeatView = 'down' | 'side' | 'up';

export const SEAT_VIEWS: readonly SeatView[] = ['down', 'side', 'up'];

/**
 * Frames per pose. The idle is one slow breath; a lever pull or a chip toss is
 * a reach and a return; a cheer and a slump rise, hold and settle back.
 */
export const SEAT_POSE_FRAMES: Readonly<Record<SeatPose, number>> = {
  idle: 8,
  play: 8,
  cheer: 12,
  slump: 12,
};

/** Only the idle loops; every other pose plays once and hands back to it. */
export const SEAT_POSE_LOOPS: Readonly<Record<SeatPose, boolean>> = {
  idle: true,
  play: false,
  cheer: false,
  slump: false,
};

/** Frames a second every seated row plays at, the idle included. */
export const SEAT_POSE_FPS = 6;

/** How long one pass of each pose lasts at {@link SEAT_POSE_FPS}, in seconds. */
export const SEAT_POSE_SECONDS: Readonly<Record<SeatPose, number>> = {
  idle: SEAT_POSE_FRAMES.idle / SEAT_POSE_FPS,
  play: SEAT_POSE_FRAMES.play / SEAT_POSE_FPS,
  cheer: SEAT_POSE_FRAMES.cheer / SEAT_POSE_FPS,
  slump: SEAT_POSE_FRAMES.slump / SEAT_POSE_FPS,
};

const VIEW_SUFFIX: Readonly<Record<SeatView, string>> = {
  down: '',
  side: '_side',
  up: '_away',
};

/** The state a seated pose is baked under in a view. */
export function seatStateName(pose: SeatPose, view: SeatView): string {
  return `sit_${pose}${VIEW_SUFFIX[view]}`;
}

/**
 * Height of a club bar stool's seat above the bottom edge of the tile it
 * stands on, in tiles: where a sitter's weight rests. The stool's painter
 * puts the cushion's centre a hair below its footprint row's top edge.
 */
export const BAR_STOOL_SEAT_HEIGHT_TILES = 0.96;

/** Shares of a one-shot pose: the rise ends here, and the hold lasts until here. */
const ONE_SHOT_RISE_END = 0.35;
const ONE_SHOT_HOLD_END = 0.7;

/**
 * How far into a one-shot pose's motion a frame is, 0 at rest to 1 at its
 * peak: eased up, held, eased back down, and back at exactly 0 on the frame
 * after the last so the row hands back to the idle without a jump.
 */
export function seatPoseWeight(pose: SeatPose, frame: number): number {
  if (SEAT_POSE_LOOPS[pose]) return 0;
  const t = frame / SEAT_POSE_FRAMES[pose];
  return ramp(t, 0, ONE_SHOT_RISE_END) * (1 - ramp(t, ONE_SHOT_HOLD_END, 1));
}

/** Where a frame sits in the idle's breath, 0 to just under 1. */
export function seatIdlePhase(frame: number): number {
  return frame / SEAT_POSE_FRAMES.idle;
}
