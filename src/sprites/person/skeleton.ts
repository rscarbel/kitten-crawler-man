/**
 * A jointed stick-figure skeleton built by forward kinematics: every joint is
 * placed relative to its parent's endpoint, so a limb physically cannot detach
 * no matter how the pose swings it — that construction is what makes "limbs
 * connect at the right spot" true by design rather than by tuning.
 *
 * The renderer draws flesh/cloth over these joints. Only three facings are
 * built here — `down` (toward camera), `up` (away), and `right` (profile);
 * `left` is the mirror of `right`, handled by a horizontal flip in the
 * renderer, so the skeleton never has to reason about it.
 */

import type { PersonAppearance } from './PersonAppearance';

export type Facing = 'down' | 'up' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

/** Rotation of a limb's two segments. `swing` rotates the whole limb away from
 * straight-down (positive = forward in the walk direction); `bend` flexes the
 * lower segment (knee/elbow) back toward straight. Radians. */
export interface LimbAngles {
  swing: number;
  bend: number;
}

export interface Pose {
  /** Whole-body vertical bob as a fraction of draw size (subtracted from y). */
  bob: number;
  /** Torso lean: horizontal shoulder shift as a fraction of draw size. */
  lean: number;
  /** Head horizontal tilt as a fraction of draw size. */
  headTilt: number;
  leftLeg: LimbAngles;
  rightLeg: LimbAngles;
  leftArm: LimbAngles;
  rightArm: LimbAngles;
}

/** A limb's three tracked points: shoulder/hip, elbow/knee, hand/foot. */
export interface Limb {
  root: Point;
  mid: Point;
  end: Point;
}

export interface Skeleton {
  facing: Facing;
  headCenter: Point;
  headRadiusX: number;
  headRadiusY: number;
  neck: Point;
  shoulderCenter: Point;
  hipCenter: Point;
  shoulderHalf: number;
  hipHalf: number;
  /** "Near" limbs are drawn over the torso; "far" limbs behind it. */
  nearLeg: Limb;
  farLeg: Limb;
  nearArm: Limb;
  farArm: Limb;
}

// Vertical layout as fractions of draw size, measured up from the feet.
const FOOT_BASE_FRAC = 0.97;
const NECK_FRAC = 0.05;
const THIGH_SHARE = 0.52;
const UPPER_ARM_SHARE = 0.48;

// In profile the two legs/arms sit near the centerline instead of splayed to
// the body's full width, so the figure reads as a side view rather than a front
// view seen edge-on.
const PROFILE_LATERAL_FACTOR = 0.28;

// Legs root well inboard of the hip joints so the thighs come together under the
// torso instead of splaying out at the full hip width — a person stands with
// their legs close, not planted at shoulder width.
const LEG_STANCE_FACTOR = 0.55;

// Head-on, a limb swings in the plane perpendicular to the screen, so its
// fore/aft motion should mostly foreshorten (lift the foot/hand) rather than
// slide sideways. Squashing the horizontal component of the FK for front/back
// facings turns a knee/elbow bend into a vertical lift — the difference between
// a natural marching step and legs kicking out to the sides.
const FRONTAL_X_SCALE = 0.32;

function fkLimb(
  root: Point,
  upperLen: number,
  lowerLen: number,
  angles: LimbAngles,
  xScale: number,
): Limb {
  const upperAngle = angles.swing;
  const mid: Point = {
    x: root.x + upperLen * Math.sin(upperAngle) * xScale,
    y: root.y + upperLen * Math.cos(upperAngle),
  };
  const lowerAngle = upperAngle - angles.bend;
  const end: Point = {
    x: mid.x + lowerLen * Math.sin(lowerAngle) * xScale,
    y: mid.y + lowerLen * Math.cos(lowerAngle),
  };
  return { root, mid, end };
}

/**
 * Places every joint in absolute screen pixels for a person centered on `cx`
 * with the drawing box top at `sy`, sized `s`. Consumers read the returned
 * joints directly; nothing here draws.
 */
export function buildSkeleton(
  appearance: PersonAppearance,
  pose: Pose,
  facing: Facing,
  cx: number,
  sy: number,
  s: number,
): Skeleton {
  const { body, head } = appearance;
  const h = body.heightScale;

  const footBaseY = sy + s * FOOT_BASE_FRAC - pose.bob * s;
  const legLen = body.legLength * s * h;
  const armLen = body.armLength * s * h;
  const torsoLen = body.torsoLength * s * h;
  const neckLen = NECK_FRAC * s * h;
  const headH = head.heightFrac * s * h;

  const hipY = footBaseY - legLen;
  const shoulderY = hipY - torsoLen;
  const shoulderCX = cx + pose.lean * s;

  const isProfile = facing === 'left' || facing === 'right';
  const lateral = isProfile ? PROFILE_LATERAL_FACTOR : 1;
  const shoulderHalf = body.shoulderWidth * s * lateral;
  const hipHalf = body.hipWidth * s * lateral;

  const thigh = legLen * THIGH_SHARE;
  const shin = legLen * (1 - THIGH_SHARE);
  const upperArm = armLen * UPPER_ARM_SHARE;
  const foreArm = armLen * (1 - UPPER_ARM_SHARE);

  const legRootHalf = hipHalf * LEG_STANCE_FACTOR;
  const leftHip: Point = { x: cx - legRootHalf, y: hipY };
  const rightHip: Point = { x: cx + legRootHalf, y: hipY };
  const leftShoulder: Point = { x: shoulderCX - shoulderHalf, y: shoulderY };
  const rightShoulder: Point = { x: shoulderCX + shoulderHalf, y: shoulderY };

  const xScale = isProfile ? 1 : FRONTAL_X_SCALE;
  const leftLeg = fkLimb(leftHip, thigh, shin, pose.leftLeg, xScale);
  const rightLeg = fkLimb(rightHip, thigh, shin, pose.rightLeg, xScale);
  const leftArm = fkLimb(leftShoulder, upperArm, foreArm, pose.leftArm, xScale);
  const rightArm = fkLimb(rightShoulder, upperArm, foreArm, pose.rightArm, xScale);

  // In profile the right-side limbs face the camera; front/back both show the
  // left limb foremost so contralateral swing stays readable.
  const rightIsNear = facing === 'right' || facing === 'down';

  const headCenter: Point = {
    x: shoulderCX + pose.headTilt * s,
    y: shoulderY - neckLen - headH * 0.5,
  };

  return {
    facing,
    headCenter,
    headRadiusX: head.widthFrac * s * 0.5,
    headRadiusY: headH * 0.5,
    neck: { x: shoulderCX, y: shoulderY - neckLen * 0.5 },
    shoulderCenter: { x: shoulderCX, y: shoulderY },
    hipCenter: { x: cx, y: hipY },
    shoulderHalf,
    hipHalf,
    nearLeg: rightIsNear ? rightLeg : leftLeg,
    farLeg: rightIsNear ? leftLeg : rightLeg,
    nearArm: rightIsNear ? rightArm : leftArm,
    farArm: rightIsNear ? leftArm : rightArm,
  };
}
