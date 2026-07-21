/**
 * Turns an animation clock into a `Pose` for the skeleton. The walk cycle is a
 * real gait: arms and legs swing contralaterally (left leg forward pairs with
 * right arm forward), the knee of the swinging leg bends to clear the ground,
 * the body bobs twice per stride at each foot-plant, and the torso counter-
 * rotates slightly. Amplitudes differ by facing — a profile shows a big
 * fore/aft leg swing, while a front/back view reads the step mostly through
 * knee lift — and each person's `gait` traits scale stride, bounce, and arm
 * swing so a crowd never marches in lockstep.
 */

import type { PersonAppearance } from './PersonAppearance';
import type { Facing, Pose } from './skeleton';

const WALK_CYCLE_SPEED = 0.14;

const LEG_SWING_PROFILE = 0.52;
const LEG_SWING_FRONT = 0.13;
const KNEE_BASE = 0.06;
const KNEE_AMP_PROFILE = 0.7;
const KNEE_AMP_FRONT = 0.95;

const ARM_SWING_PROFILE = 0.42;
const ARM_SWING_FRONT = 0.12;
const ARM_BEND_BASE = 0.16;
const ARM_BEND_AMP = 0.3;

const BOB_AMP = 0.02;
const LEAN_SWAY = 0.012;
const HEAD_SWAY = 0.01;

const IDLE_BREATHE_SPEED = 0.045;
const IDLE_BOB_AMP = 0.01;
const IDLE_ARM_BEND = 0.12;

function isProfileFacing(facing: Facing): boolean {
  return facing === 'left' || facing === 'right';
}

function idlePose(appearance: PersonAppearance, phase: number): Pose {
  const { gait } = appearance;
  const t = phase * IDLE_BREATHE_SPEED + gait.phaseOffset;
  const breathe = ((Math.sin(t) + 1) / 2) * IDLE_BOB_AMP * gait.bounceScale;
  const rest = { swing: 0, bend: KNEE_BASE };
  return {
    bob: breathe,
    lean: gait.postureLean,
    headTilt: 0,
    leftLeg: rest,
    rightLeg: rest,
    leftArm: { swing: 0, bend: IDLE_ARM_BEND },
    rightArm: { swing: 0, bend: IDLE_ARM_BEND },
  };
}

function walkPose(appearance: PersonAppearance, facing: Facing, phase: number): Pose {
  const { gait } = appearance;
  const profile = isProfileFacing(facing);
  const t = phase * WALK_CYCLE_SPEED * gait.strideScale + gait.phaseOffset;
  const swing = Math.sin(t);

  const legAmp = profile ? LEG_SWING_PROFILE : LEG_SWING_FRONT;
  const armAmp = (profile ? ARM_SWING_PROFILE : ARM_SWING_FRONT) * gait.armSwingScale;
  const kneeAmp = profile ? KNEE_AMP_PROFILE : KNEE_AMP_FRONT;

  // A leg's knee bends while it swings forward to clear the ground; the arm on
  // the same side swings opposite its leg, elbow flexing on its forward reach.
  const leftForward = Math.max(0, swing);
  const rightForward = Math.max(0, -swing);

  return {
    bob: Math.abs(swing) * BOB_AMP * gait.bounceScale,
    lean: gait.postureLean + LEAN_SWAY * swing,
    headTilt: HEAD_SWAY * swing,
    leftLeg: { swing: swing * legAmp, bend: KNEE_BASE + kneeAmp * leftForward },
    rightLeg: { swing: -swing * legAmp, bend: KNEE_BASE + kneeAmp * rightForward },
    leftArm: { swing: -swing * armAmp, bend: ARM_BEND_BASE + ARM_BEND_AMP * rightForward },
    rightArm: { swing: swing * armAmp, bend: ARM_BEND_BASE + ARM_BEND_AMP * leftForward },
  };
}

/** The pose for a person at animation `phase`, facing `facing`, moving or not. */
export function poseForMotion(
  appearance: PersonAppearance,
  facing: Facing,
  phase: number,
  moving: boolean,
): Pose {
  return moving ? walkPose(appearance, facing, phase) : idlePose(appearance, phase);
}
