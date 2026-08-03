/**
 * A jointed stick-figure skeleton for a procedural person.
 *
 * The legs are solved by **inverse kinematics to a foot target**: `gait.ts`
 * decides where each foot is in ground space, and the knee is whatever angle
 * puts the ankle there. That is the same structure the player character's
 * generator uses (`scripts/generate-human-sprite.ts`), and it is the reason his
 * walk is the only convincing one in the game — you cannot plant a foot whose
 * position you do not control. Driving the legs forward from the hip instead,
 * as this file used to, makes the planted foot slide backward at a rate with no
 * relation to the body's speed, which is the skating read.
 *
 * The arms stay forward-kinematic. Almost all of a walking arm's travel belongs
 * to the shoulder, and a hand target forces both segments to swing together.
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
 * lower segment (elbow) back toward straight. Radians. */
export interface LimbAngles {
  swing: number;
  bend: number;
}

/** Where one foot is, in ground space, as fractions of draw size. */
export interface FootPlacement {
  /** Offset ahead of the leg's neutral stance position; positive = the way the figure faces. */
  forward: number;
  /** Height above the ground line. Zero while the foot is planted. */
  lift: number;
  /** Toe-down rotation in radians. Negative pitches the toe up, for a heel strike. */
  pitch: number;
}

export interface Pose {
  /**
   * How far the pelvis is lowered from its standing height, as a fraction of
   * draw size. Positive is *down*: a real pelvis troughs at foot contact and
   * peaks over the straight stance leg, and dropping the hip at contact is also
   * what buys the stride — a leg is barely longer than the hip is high, so a
   * foot planted a stride ahead is out of reach from full standing height.
   */
  hipDrop: number;
  /** Torso lean: horizontal shoulder shift as a fraction of draw size. */
  lean: number;
  /** Whole-body lateral shift as a fraction of draw size — a stagger, not a lean. */
  sway: number;
  /** Head horizontal tilt as a fraction of draw size. */
  headTilt: number;
  /**
   * Shoulder-line roll as a fraction of draw size, positive dropping the right
   * shoulder. Head-on this is most of what carries the arm swing: the shoulders
   * counter-rotate against the pelvis, and a vertical differential survives the
   * foreshortening that flattens the arms' own travel to nothing.
   */
  shoulderRoll: number;
  leftFoot: FootPlacement;
  rightFoot: FootPlacement;
  leftArm: LimbAngles;
  rightArm: LimbAngles;
}

/** A limb's three tracked points, plus the end segment's rotation. */
export interface Limb {
  root: Point;
  mid: Point;
  end: Point;
  /** Foot pitch in radians; zero for arms, which have no equivalent. */
  pitch: number;
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
export const FOOT_BASE_FRAC = 0.97;
export const NECK_FRAC = 0.05;
const THIGH_SHARE = 0.52;
const UPPER_ARM_SHARE = 0.48;

// In profile the two legs/arms sit near the centerline instead of splayed to
// the body's full width, so the figure reads as a side view rather than a front
// view seen edge-on.
const PROFILE_LATERAL_FACTOR = 0.28;

// Legs root well inboard of the hip joints so the thighs come together under the
// torso instead of splaying out at the full hip width — a person stands with
// their legs close, not planted at shoulder width.
export const LEG_STANCE_FACTOR = 0.55;

/**
 * Head-on, an arm swings in the plane perpendicular to the screen, so only a
 * fraction of its travel survives as sideways motion. Arms get their own share
 * rather than the legs' because the legs' share is what stops them splaying
 * sideways, while an arm crossing the body silhouette is exactly the read that
 * sells a head-on walk — and head-on is most of what the player sees.
 */
const ARM_FRONTAL_X_SCALE = 0.6;

/** Reach is clamped just inside full extension; a fully straight two-bone chain has no solution. */
const MAX_EXTENSION = 0.999;

/**
 * Places the knee and the ankle for a hip and a desired foot position.
 *
 * The ankle comes back clamped to what the leg can actually reach rather than
 * left where it was asked for: an out-of-reach target drawn as given stretches
 * the shin, and a limb that changes length is exactly the defect the jointed
 * construction exists to make impossible. `gait.ts` sizes the pelvic drop so the
 * clamp almost never binds.
 */
function solveTwoBone(
  root: Point,
  target: Point,
  upperLen: number,
  lowerLen: number,
  bendSign: number,
): { joint: Point; end: Point } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const reach = Math.hypot(dx, dy);
  if (reach === 0) {
    const straightDown = { x: root.x, y: root.y + upperLen + lowerLen };
    return { joint: { x: root.x, y: root.y + upperLen }, end: straightDown };
  }

  const maxReach = (upperLen + lowerLen) * MAX_EXTENSION;
  const minReach = Math.abs(upperLen - lowerLen) + (upperLen + lowerLen) * (1 - MAX_EXTENSION);
  const solved = Math.min(maxReach, Math.max(minReach, reach));
  const dirX = dx / reach;
  const dirY = dy / reach;

  const alongUpper = (upperLen * upperLen - lowerLen * lowerLen + solved * solved) / (2 * solved);
  const offAxis = Math.sqrt(Math.max(0, upperLen * upperLen - alongUpper * alongUpper));
  return {
    joint: {
      x: root.x + dirX * alongUpper - dirY * offAxis * bendSign,
      y: root.y + dirY * alongUpper + dirX * offAxis * bendSign,
    },
    end: { x: root.x + dirX * solved, y: root.y + dirY * solved },
  };
}

/**
 * A leg whose knee stays on the hip→ankle line.
 *
 * Head-on a knee hinges away from the camera, not across it, so an in-plane
 * bend reads as the leg snapping sideways. The step has to be sold by the leg
 * foreshortening as the foot rises, which is what a straight column does.
 */
function columnLeg(root: Point, target: Point, upperShare: number): Point {
  return {
    x: root.x + (target.x - root.x) * upperShare,
    y: root.y + (target.y - root.y) * upperShare,
  };
}

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
  return { root, mid, end, pitch: 0 };
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

  // Fixed: the feet stand on the ground and the pelvis moves, not the reverse.
  const groundY = sy + s * FOOT_BASE_FRAC;
  const legLen = body.legLength * s * h;
  const armLen = body.armLength * s * h;
  const torsoLen = body.torsoLength * s * h;
  const neckLen = NECK_FRAC * s * h;
  const headH = head.heightFrac * s * h;

  const bodyCX = cx + pose.sway * s;
  const hipY = groundY - legLen + pose.hipDrop * s;
  const shoulderY = hipY - torsoLen;
  const shoulderCX = bodyCX + pose.lean * s;

  const isProfile = facing === 'left' || facing === 'right';
  const lateral = isProfile ? PROFILE_LATERAL_FACTOR : 1;
  const shoulderHalf = body.shoulderWidth * s * lateral;
  const hipHalf = body.hipWidth * s * lateral;

  const thigh = legLen * THIGH_SHARE;
  const shin = legLen * (1 - THIGH_SHARE);
  const upperArm = armLen * UPPER_ARM_SHARE;
  const foreArm = armLen * (1 - UPPER_ARM_SHARE);

  const legRootHalf = hipHalf * LEG_STANCE_FACTOR;
  const leftHip: Point = { x: bodyCX - legRootHalf, y: hipY };
  const rightHip: Point = { x: bodyCX + legRootHalf, y: hipY };
  const roll = pose.shoulderRoll * s;
  const leftShoulder: Point = { x: shoulderCX - shoulderHalf, y: shoulderY - roll };
  const rightShoulder: Point = { x: shoulderCX + shoulderHalf, y: shoulderY + roll };

  const leftLeg = ikLeg(leftHip, pose.leftFoot, thigh, shin, groundY, s, isProfile);
  const rightLeg = ikLeg(rightHip, pose.rightFoot, thigh, shin, groundY, s, isProfile);

  const armXScale = isProfile ? 1 : ARM_FRONTAL_X_SCALE;
  const leftArm = fkLimb(leftShoulder, upperArm, foreArm, pose.leftArm, armXScale);
  const rightArm = fkLimb(rightShoulder, upperArm, foreArm, pose.rightArm, armXScale);

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
    // Scaled by stature on *both* axes. `headH` already carries `h`, so leaving
    // the width without it stretched a short genome's head sideways as it got
    // shorter: a child came out squat and wide-headed, which is what the crowd
    // reads first because the head is the largest single shape on the figure.
    headRadiusX: head.widthFrac * s * h * 0.5,
    headRadiusY: headH * 0.5,
    neck: { x: shoulderCX, y: shoulderY - neckLen * 0.5 },
    shoulderCenter: { x: shoulderCX, y: shoulderY },
    hipCenter: { x: bodyCX, y: hipY },
    shoulderHalf,
    hipHalf,
    nearLeg: rightIsNear ? rightLeg : leftLeg,
    farLeg: rightIsNear ? leftLeg : rightLeg,
    nearArm: rightIsNear ? rightArm : leftArm,
    farArm: rightIsNear ? leftArm : rightArm,
  };
}

/** The knee always breaks forward, toward the direction of travel. */
const PROFILE_KNEE_BREAK = -1;

function ikLeg(
  hip: Point,
  foot: FootPlacement,
  thigh: number,
  shin: number,
  groundY: number,
  s: number,
  isProfile: boolean,
): Limb {
  const target: Point = {
    x: hip.x + foot.forward * s,
    y: groundY - foot.lift * s,
  };
  if (!isProfile) {
    return {
      root: hip,
      mid: columnLeg(hip, target, thigh / (thigh + shin)),
      end: target,
      pitch: foot.pitch,
    };
  }
  const solved = solveTwoBone(hip, target, thigh, shin, PROFILE_KNEE_BREAK);
  return { root: hip, mid: solved.joint, end: solved.end, pitch: foot.pitch };
}
