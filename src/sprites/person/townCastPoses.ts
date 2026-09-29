/**
 * The gesture the closed-set cast plays that a walk/idle clock alone cannot
 * express: a talking loop. It starts from the idle pose `poseForMotion`
 * already produces — so a talking figure still breathes and settles the way
 * a standing one does — and lays a small cyclic offset on top of it.
 */

import type { PersonAppearance } from './PersonAppearance';
import { poseForMotion } from './gait';
import type { Facing, Pose } from './skeleton';

const TWO_PI = Math.PI * 2;

/** How far the head tilts through a talk loop, as a fraction of draw size. */
const TALK_HEAD_TILT_AMPLITUDE = 0.012;
/** How far the near hand lifts through a talk loop's gesture beat. */
const TALK_HAND_SWING_AMPLITUDE = 0.5;
const TALK_HAND_BEND = 0.9;

/** A talking figure's near arm lifts and falls once per loop, underlining speech. */
export function talkPose(appearance: PersonAppearance, facing: Facing, phase: number): Pose {
  const base = poseForMotion(appearance, facing, phase, false);
  const cycle = phase * TWO_PI;
  const gesture = Math.sin(cycle);
  const profile = facing === 'left' || facing === 'right';
  const gestureArm = profile ? base.rightArm : base.leftArm;
  const raised = {
    swing: gestureArm.swing + gesture * TALK_HAND_SWING_AMPLITUDE,
    bend: TALK_HAND_BEND,
  };
  return {
    ...base,
    headTilt: base.headTilt + Math.sin(cycle * 0.5) * TALK_HEAD_TILT_AMPLITUDE,
    leftArm: profile ? base.leftArm : raised,
    rightArm: profile ? raised : base.rightArm,
  };
}
