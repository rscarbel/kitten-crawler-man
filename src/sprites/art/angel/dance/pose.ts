/**
 * A dance pose and its solve.
 *
 * A pose places her on the stage — where she stands and which way she faces —
 * and plants her feet on the stage floor in world coordinates, so a foot that
 * carries her stays put while she turns over it. Her torso, head and hair are
 * posed in her own body frame; each arm is a weighted blend of what it is
 * doing (held by joint angles, gripping the pole, or resting on her body), so
 * one hand can let go of the pole and travel to her hip without a frame where
 * it is neither.
 *
 * She is painted in three views. Her heading picks the nearest one and the
 * solve is done in that view's frame, so the pole she grips and the floor her
 * feet stand on project exactly where the painter draws them; what the heading
 * has turned past that view is taken up as a twist of her hips and shoulders.
 */

import { clamp01, lerp } from '../../bipedArt';
import { HAND_LENGTH, HEAD_CENTER_Y, WAIST_Y } from '../proportions';
import {
  CHEST_PIVOT_Y,
  PELVIS_PIVOT_Y,
  SIDES,
  add3,
  footClearance,
  footFromAnkle,
  hipFloorFor,
  hipJointOf,
  mirrorSkeleton,
  normalize3,
  placeFoot,
  placeInSection,
  restFrame,
  scale3,
  shoulderOf,
  solveArmFromAngles,
  solveArmToTarget,
  solveKnee,
  sub3,
  targetOfArm,
  v3,
  type AngelArm,
  type AngelLeg,
  type AngelSkeleton,
  type AngelView,
  type ArmAngles,
  type ArmTarget,
  type BodySide,
  type Pt2,
  type SectionFrame,
  type V3,
} from '../skeleton';
import { GRIP_CENTRE_SHARE } from '../arms';
import { STAGE_DEPTH_SCALE, heightToY } from './stage';

/** Radians she faces, measured from facing the camera round toward screen right. */
export const FACING_CAMERA = 0;
export const FACING_RIGHT = Math.PI / 2;
export const FACING_AWAY = Math.PI;
const QUARTER_TURN = Math.PI / 2;
const VIEWS_PER_TURN = 4;

/** A foot on the stage floor, by its pivot (heel, or ball when it stands on its toes). */
export interface StageFoot {
  readonly x: number;
  readonly z: number;
  /** How far the ankle is lifted off its place on the floor. */
  readonly lift: number;
  /** Positive with the toes raised. */
  readonly pitch: number;
  readonly onBall: boolean;
}

/** A section's turn and shift from where the solve would put it. */
export interface SectionPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly roll: number;
  readonly yaw: number;
  readonly pitch: number;
}

export const STILL: SectionPose = { x: 0, y: 0, z: 0, roll: 0, yaw: 0, pitch: 0 };

/** Where on her body a resting hand lies, in that section's rest coordinates, authored for her right hand. */
type BodySection = 'pelvis' | 'chest' | 'head';

export type ArmPose =
  | { readonly kind: 'angles'; readonly angles: ArmAngles }
  /** Closed round the pole at `height` above the floor; the elbow bends toward `elbow`, off the shoulder. */
  | { readonly kind: 'pole'; readonly height: number; readonly elbow: V3 }
  | {
      readonly kind: 'rest';
      readonly section: BodySection;
      readonly at: V3;
      readonly handDirection: V3;
      readonly elbow: V3;
      readonly open: number;
    };

export interface WeightedArm {
  readonly pose: ArmPose;
  readonly weight: number;
}

export interface DancePose {
  /** Her floor origin, between her hips, on the stage. */
  readonly root: { readonly x: number; readonly z: number };
  readonly heading: number;
  readonly pelvis: SectionPose;
  readonly chest: SectionPose;
  readonly feet: Readonly<Record<BodySide, StageFoot>>;
  /** How far each knee's bend turns out from straight ahead, radians. */
  readonly kneeSplay: Readonly<Record<BodySide, number>>;
  readonly arms: Readonly<Record<BodySide, readonly WeightedArm[]>>;
  readonly headRoll: number;
  readonly headPitch: number;
  readonly lookBack: number;
  readonly hairSway: number;
  readonly hairLift: number;
  readonly hairTrail: number;
  readonly hairSwing: number;
}

/* ── Blending ──────────────────────────────────────────────────────────── */

function blendSection(a: SectionPose, b: SectionPose, t: number): SectionPose {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    roll: lerp(a.roll, b.roll, t),
    yaw: lerp(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
  };
}

function blendFoot(a: StageFoot, b: StageFoot, t: number): StageFoot {
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    lift: lerp(a.lift, b.lift, t),
    pitch: lerp(a.pitch, b.pitch, t),
    onBall: t < HALF ? a.onBall : b.onBall,
  };
}

const HALF = 0.5;

function blendArms(a: readonly WeightedArm[], b: readonly WeightedArm[], t: number): WeightedArm[] {
  return [
    ...a.map((arm) => ({ pose: arm.pose, weight: arm.weight * (1 - t) })),
    ...b.map((arm) => ({ pose: arm.pose, weight: arm.weight * t })),
  ].filter((arm) => arm.weight > 0);
}

/** `t` of the way from `a` to `b`. Headings blend the short way round. */
export function blendPose(a: DancePose, b: DancePose, t: number): DancePose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const turn = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return {
    root: { x: lerp(a.root.x, b.root.x, t), z: lerp(a.root.z, b.root.z, t) },
    heading: a.heading + turn * t,
    pelvis: blendSection(a.pelvis, b.pelvis, t),
    chest: blendSection(a.chest, b.chest, t),
    feet: { [1]: blendFoot(a.feet[1], b.feet[1], t), [-1]: blendFoot(a.feet[-1], b.feet[-1], t) },
    kneeSplay: {
      [1]: lerp(a.kneeSplay[1], b.kneeSplay[1], t),
      [-1]: lerp(a.kneeSplay[-1], b.kneeSplay[-1], t),
    },
    arms: { [1]: blendArms(a.arms[1], b.arms[1], t), [-1]: blendArms(a.arms[-1], b.arms[-1], t) },
    headRoll: lerp(a.headRoll, b.headRoll, t),
    headPitch: lerp(a.headPitch, b.headPitch, t),
    lookBack: lerp(a.lookBack, b.lookBack, t),
    hairSway: lerp(a.hairSway, b.hairSway, t),
    hairLift: lerp(a.hairLift, b.hairLift, t),
    hairTrail: lerp(a.hairTrail, b.hairTrail, t),
    hairSwing: lerp(a.hairSwing, b.hairSwing, t),
  };
}

/* ── The solve ─────────────────────────────────────────────────────────── */

/** One painted frame: the skeleton as the painter draws it, and where it stands on the stage. */
export interface AngelFrame {
  /** Already turned for its view: mirrored head-on from the front, and in profile facing left. */
  readonly skeleton: AngelSkeleton;
  readonly view: AngelView;
  /** Drawn mirrored across her own centreline: the profile facing screen left. */
  readonly flip: boolean;
  /** The skeleton's sides are exchanged, so its arm and leg `+1` is her left. */
  readonly mirrored: boolean;
  /** Her floor origin's place on screen relative to the pole's base, in figure units. */
  readonly root: Pt2;
  /** She is behind the pole, so it is drawn over her. */
  readonly poleInFront: boolean;
  /** Both feet are off the floor. */
  readonly airborne: boolean;
}

/** Her heading turned past the nearest view is taken up this much by her hips and shoulders. */
const RESIDUAL_TWIST_SHARE = 0.85;
/** The ribcage rides part of the way across with the hips, so the waist bends rather than shears. */
const CHEST_FOLLOWS_PELVIS_SHIFT = 0.5;
/** A foot this far off the floor is fully in the air for the leg's shading. */
const FULL_SWING_LIFT = 0.06;
/** Head-on, a pole this close to her centre in depth is beside her, not in front of or behind her. */
const POLE_DEPTH_TOLERANCE = 0.01;
/** A foot clear of the floor by more than this is in the air. */
const AIRBORNE_CLEARANCE = 0.004;

interface BodyFrame {
  readonly view: AngelView;
  readonly flip: boolean;
  /** Heading the solve's frame faces. */
  readonly snapped: number;
  /** World to body coordinates. */
  readonly toBody: (x: number, z: number) => { x: number; z: number };
}

function bodyFrameOf(pose: DancePose): BodyFrame {
  const index =
    ((Math.round(pose.heading / QUARTER_TURN) % VIEWS_PER_TURN) + VIEWS_PER_TURN) % VIEWS_PER_TURN;
  const snapped = Math.round(pose.heading / QUARTER_TURN) * QUARTER_TURN;
  const forward = { x: Math.sin(snapped), z: Math.cos(snapped) };
  const right = { x: -Math.cos(snapped), z: Math.sin(snapped) };
  const toBody = (x: number, z: number): { x: number; z: number } => {
    const dx = x - pose.root.x;
    const dz = z - pose.root.z;
    return { x: dx * right.x + dz * right.z, z: dx * forward.x + dz * forward.z };
  };
  const views: readonly AngelView[] = ['front', 'side', 'back', 'side'];
  return { view: views[index], flip: index === 3, snapped, toBody };
}

function sectionFrame(pose: SectionPose): SectionFrame {
  return restFrame({ ...pose });
}

function placeStageFoot(frame: BodyFrame, foot: StageFoot): ReturnType<typeof placeFoot> {
  const at = frame.toBody(foot.x, foot.z);
  const planted = placeFoot(at.x, at.z, foot.pitch, foot.onBall);
  if (foot.lift <= 0) return planted;
  const raised = footFromAnkle(
    v3(planted.ankle.x, planted.ankle.y - foot.lift, planted.ankle.z),
    foot.pitch,
  );
  // A lifted foot pointing its toes would otherwise dip them through the
  // floor as it leaves it; it rises instead, so it never sinks below it.
  const sunk = -footClearance(raised);
  if (sunk <= 0) return raised;
  return footFromAnkle(v3(raised.ankle.x, raised.ankle.y - sunk, raised.ankle.z), foot.pitch);
}

function restingPointOf(
  section: BodySection,
  side: BodySide,
  at: V3,
  pelvis: SectionFrame,
  chest: SectionFrame,
  headTop: V3,
): V3 {
  const mirrored = v3(side * at.x, at.y, at.z);
  if (section === 'pelvis') return placeInSection(pelvis, PELVIS_PIVOT_Y, mirrored);
  if (section === 'chest') return placeInSection(chest, CHEST_PIVOT_Y, mirrored);
  return add3(headTop, v3(mirrored.x, mirrored.y - HEAD_CENTER_Y, mirrored.z));
}

function armTargetOf(
  arm: ArmPose,
  side: BodySide,
  shoulder: V3,
  pole: { x: number; z: number },
  pelvis: SectionFrame,
  chest: SectionFrame,
  headCentre: V3,
): ArmTarget {
  switch (arm.kind) {
    case 'angles':
      return targetOfArm(solveArmFromAngles(side, shoulder, arm.angles));
    case 'pole': {
      const grip = v3(pole.x, heightToY(arm.height), pole.z);
      const across = normalize3(v3(grip.x - shoulder.x, 0, grip.z - shoulder.z));
      const toCentre = HAND_LENGTH * GRIP_CENTRE_SHARE;
      return {
        wrist: sub3(grip, scale3(across, toCentre)),
        elbowToward: add3(shoulder, v3(side * arm.elbow.x, arm.elbow.y, arm.elbow.z)),
        handDirection: across,
        open: 0,
        grip: 1,
      };
    }
    case 'rest': {
      const wrist = restingPointOf(arm.section, side, arm.at, pelvis, chest, headCentre);
      return {
        wrist,
        elbowToward: add3(shoulder, v3(side * arm.elbow.x, arm.elbow.y, arm.elbow.z)),
        handDirection: v3(side * arm.handDirection.x, arm.handDirection.y, arm.handDirection.z),
        open: arm.open,
        grip: 0,
      };
    }
    default: {
      const unhandled: never = arm;
      return unhandled;
    }
  }
}

/**
 * A hand closes on the pole only while the arm is wholly on it. Part-way off
 * it — letting go, or reaching for it — the hand is between the pole and
 * somewhere else, so a fist there would close on air.
 */
const WHOLLY_ON_POLE = 0.999;

function blendTargets(targets: ReadonlyArray<{ target: ArmTarget; weight: number }>): ArmTarget {
  const total = targets.reduce((sum, { weight }) => sum + weight, 0);
  const gripping =
    targets.reduce((acc, { target, weight }) => acc + target.grip * weight, 0) / total;
  const sum = (pick: (t: ArmTarget) => V3): V3 =>
    targets.reduce(
      (acc, { target, weight }) => add3(acc, scale3(pick(target), weight / total)),
      v3(0, 0, 0),
    );
  const scalar = (pick: (t: ArmTarget) => number): number =>
    targets.reduce((acc, { target, weight }) => acc + (pick(target) * weight) / total, 0);
  return {
    wrist: sum((t) => t.wrist),
    elbowToward: sum((t) => t.elbowToward),
    handDirection: sum((t) => normalize3(t.handDirection)),
    open: scalar((t) => t.open),
    grip: gripping >= WHOLLY_ON_POLE ? 1 : 0,
  };
}

/** The side of the drawn skeleton that is her anatomical `side`. */
export function drawnSideOf(frame: AngelFrame, side: BodySide): BodySide {
  return frame.mirrored ? (side > 0 ? -1 : 1) : side;
}

/** Solves a pose into the frame the painter draws. */
export function solveDancePose(pose: DancePose): AngelFrame {
  const frame = bodyFrameOf(pose);
  const twist = (pose.heading - frame.snapped) * RESIDUAL_TWIST_SHARE;

  const feet = {
    [1]: placeStageFoot(frame, pose.feet[1]),
    [-1]: placeStageFoot(frame, pose.feet[-1]),
  } as const;

  const authoredPelvis = sectionFrame({ ...pose.pelvis, yaw: pose.pelvis.yaw + twist });
  let hipY = authoredPelvis.y;
  for (const side of SIDES) {
    if (pose.feet[side].lift > 0) continue;
    const restHip = hipJointOf(authoredPelvis, side);
    hipY = Math.max(hipY, authoredPelvis.y + hipFloorFor(restHip, feet[side].ankle) - restHip.y);
  }
  const pelvis = { ...authoredPelvis, y: hipY };

  const legOf = (side: BodySide): AngelLeg => {
    const hip = hipJointOf(pelvis, side);
    const foot = feet[side];
    return {
      hip,
      knee: solveKnee(hip, foot.ankle, side, pose.kneeSplay[side]),
      ankle: foot.ankle,
      heel: foot.heel,
      ball: foot.ball,
      toe: foot.toe,
      pitch: foot.pitch,
      swing: clamp01(pose.feet[side].lift / FULL_SWING_LIFT),
    };
  };
  const legs = { [1]: legOf(1), [-1]: legOf(-1) } as const;

  const waist = placeInSection(pelvis, PELVIS_PIVOT_Y, v3(0, WAIST_Y, 0));
  const chest = sectionFrame({
    x: waist.x * CHEST_FOLLOWS_PELVIS_SHIFT + pose.chest.x,
    y: waist.y - WAIST_Y + pose.chest.y,
    z: waist.z + pose.chest.z,
    roll: pose.chest.roll,
    yaw: pose.chest.yaw + twist,
    pitch: pose.chest.pitch,
  });

  const pole = frame.toBody(0, 0);
  const headCentre = placeInSection(chest, CHEST_PIVOT_Y, v3(0, HEAD_CENTER_Y, 0));
  const armOf = (side: BodySide): AngelArm => {
    const shoulder = shoulderOf(chest, side);
    const targets = pose.arms[side].map(({ pose: arm, weight }) => ({
      target: armTargetOf(arm, side, shoulder, pole, pelvis, chest, headCentre),
      weight,
    }));
    return solveArmToTarget(shoulder, blendTargets(targets));
  };

  const skeleton: AngelSkeleton = {
    legs,
    arms: { [1]: armOf(1), [-1]: armOf(-1) },
    pelvis,
    chest,
    headRoll: pose.headRoll,
    headPitch: pose.headPitch,
    lookBack: pose.lookBack,
    hairSway: pose.hairSway,
    hairTrail: pose.hairTrail,
    hairLift: pose.hairLift,
    hairSwing: pose.hairSwing,
  };

  const airborne = SIDES.every((side) => footClearance(legs[side]) > AIRBORNE_CLEARANCE);
  const mirrored = frame.view === 'front' || frame.flip;
  return {
    skeleton: mirrored ? mirrorSkeleton(skeleton) : skeleton,
    view: frame.view,
    flip: frame.flip,
    mirrored,
    root: { x: pose.root.x, y: pose.root.z * STAGE_DEPTH_SCALE },
    poleInFront: pose.root.z < -POLE_DEPTH_TOLERANCE,
    airborne,
  };
}
