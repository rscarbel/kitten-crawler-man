/**
 * Dong Quixote's painter: a tall, seventy-year-old knight-errant in a morion
 * helmet, an open crimson vest over a bodybuilder's torso, tiny blue spandex
 * shorts and cavalry boots, carrying a war lance with a pennon.
 *
 * The rig is solved in three dimensions and projected into each of the three
 * views, so one pose describes him from the front, from behind and in profile.
 * `x` is his own right, `y` runs down (heights are negative), `z` is the way
 * he faces; the origin is on the floor between his feet, in tile units. The
 * front view reflects him (his right hand is on the viewer's left) because it
 * is a projection of the same body seen from the other side, not a mirrored
 * picture, so the lance never changes hands when he turns round.
 *
 * His signature is the breath: `DongPose.breath` runs from 1, every muscle
 * pumped, to 0, where the chest sags into the belly, the shoulders narrow and
 * drop and the arms go soft. It is carried by the silhouette first — the V of
 * the torso head-on, the chest and the paunch in profile — because interior
 * banding alone does not survive the 32 px tile.
 *
 * Knows nothing about animation; `dongQuixoteFigure.ts` choreographs him.
 */

import { type Pt, clamp01, easeInOut, lerp, mix, rgba } from './carlArt';
import { fillSoftEllipse, withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Vector maths ─────────────────────────────────────────────────────────────

/** A point or direction in figure space: `x` his right, `y` down, `z` ahead. */
export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

export function add3(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub3(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale3(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

export function dot3(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length3(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** Below this a vector has no usable direction. */
const DEGENERATE = 1e-9;

export function normalize3(a: V3): V3 {
  const length = length3(a);
  return length < DEGENERATE ? v3(0, 1, 0) : scale3(a, 1 / length);
}

export function mix3(a: V3, b: V3, t: number): V3 {
  return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

function cross3(a: V3, b: V3): V3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/** Tips a direction forward about his left–right axis: "up" leans ahead. */
export function pitchForward(a: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return v3(a.x, a.y * c + a.z * s, -a.y * s + a.z * c);
}

/** Tips a direction toward his right about the facing axis: "up" leans right. */
export function rollRight(a: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return v3(a.x * c - a.y * s, a.x * s + a.y * c, a.z);
}

/** Turns a direction about the vertical: "right" swings ahead. */
function yawRight(a: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return v3(a.x * c - a.z * s, a.y, a.x * s + a.z * c);
}

const UP: V3 = v3(0, -1, 0);
const DOWN: V3 = v3(0, 1, 0);
const RIGHT: V3 = v3(1, 0, 0);
const AHEAD: V3 = v3(0, 0, 1);

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Sole to the crown of the skull. Carl's rig is 2.03 units drawn at 0.72 of a
 * tile, about 1.46 tiles; Dong stands a head taller, so he is visibly the
 * bigger man beside him before the helmet and lance add anything.
 */
export const FIGURE_HEIGHT = 1.78;
/**
 * A tall, lean-limbed old man is more heads tall than Carl's 5.5: size is read
 * by counting heads, and a longer count is what says "tall" rather than "big".
 */
const HEADS_TALL = 6.2;
export const HEAD_RY = FIGURE_HEIGHT / HEADS_TALL / 2;
/** The skull is a tall oval head-on and a deeper one in profile. */
const HEAD_RX = HEAD_RY * 0.74;
const HEAD_DEPTH = HEAD_RY * 0.86;

export const ANKLE_HEIGHT = 0.075;
export const HIP_HEIGHT = 0.88;
const KNEE_HEIGHT = 0.47;
const SHOULDER_HEIGHT = 1.405;
const CHIN_HEIGHT = 1.5;
/** How far the chin hangs below the head's centre, in head radii. */
const HEAD_CHIN_DROP = 1.08;

/**
 * Keeps a standing leg a hair short of locked: the knee's sideways travel grows
 * as the square root of the slack, so it stays tiny.
 */
const LEG_SLACK = 1.004;
export const THIGH_LENGTH = (HIP_HEIGHT - KNEE_HEIGHT) * LEG_SLACK;
export const SHIN_LENGTH = (KNEE_HEIGHT - ANKLE_HEIGHT) * LEG_SLACK;
/** The IK never lets a limb reach its full span, so a straight limb keeps a sliver of bend. */
const JOINT_SLACK = 0.0003;
export const LEG_MAX_REACH = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

export const UPPER_ARM_LENGTH = 0.3;
export const FOREARM_LENGTH = 0.265;
export const ARM_MAX_REACH = UPPER_ARM_LENGTH + FOREARM_LENGTH - JOINT_SLACK;

/** Leg roots either side of the pelvis centre. */
const LEG_ROOT_HALF = 0.085;
/** Arm roots head-on, pumped and slumped: the breath narrows the shoulders. */
const SHOULDER_HALF_PUMPED = 0.235;
const SHOULDER_HALF_SLUMPED = 0.155;
/** On the exhale the shoulders sink as the chest does. */
const SHOULDER_SLUMP_DROP = 0.06;
/** On the exhale the upper back rounds forward. */
const SLUMP_LEAN = 0.13;
/** The spine rises above the hip this far to the base of the neck. */
const NECK_BASE_RISE = SHOULDER_HEIGHT - HIP_HEIGHT + 0.045;
/**
 * In profile the limbs sit almost on the centreline, but not exactly: a
 * little of each root's lateral offset shows as a forward shift, which keeps
 * the two legs from drawing as one.
 */
const PROFILE_LATERAL_SKEW = 0.22;

// ── The lance ────────────────────────────────────────────────────────────────

/**
 * Butt to point. A war lance is longer than the man carrying it — this one is
 * about 1.2 of his height — and it is that length, far more than the vamplate
 * or the point, that tells a lance from a spear at the tile.
 */
export const LANCE_LENGTH = 2.1;
const LANCE_BUTT_RADIUS = 0.028;
const LANCE_GRIP_RADIUS = 0.034;
const LANCE_TIP_RADIUS = 0.013;
/** The steel point's length and half-width. */
const LANCE_POINT_LENGTH = 0.14;
const LANCE_POINT_HALF = 0.03;
/** The conical hand guard ahead of the grip. */
const VAMPLATE_RADIUS = 0.064;
const VAMPLATE_LENGTH = 0.17;
const VAMPLATE_SET_BACK = 0.035;
/** The pennon hangs from the shaft this far back from the point, and flies this long. */
const PENNON_FROM_TIP = 0.16;
const PENNON_HOIST = 0.12;
const PENNON_FLY = 0.34;
const PENNON_NOTCH = 0.1;
const PENNON_WAVE = 0.03;
/** Where along its fly the pennon's edges are sampled between hoist and tail. */
const PENNON_MID = 0.5;
/** A streaming pennon lifts a little off a levelled shaft, so it reads as cloth and not as a barb. */
const PENNON_RISE = 0.6;
/** A limp pennon hangs mostly down and a little back along the shaft. */
const PENNON_HANG_ALONG = 0.4;
/**
 * Head-on, a lance pointed at the camera would draw as a dot. The floor is
 * seen from above, so the picture tips anything reaching toward the camera
 * down the screen; a long prop gets a larger share of that than the body,
 * which stands as if seen level, so the lance keeps enough length to read.
 */
const LANCE_DEPTH_SHARE = 0.12;

// ── Views ────────────────────────────────────────────────────────────────────

export type DongView = 'front' | 'side' | 'back';

/**
 * Head-on the floor is foreshortened under an upright figure: a foot a stride
 * ahead draws a little lower on the screen, a knee at hip height not at all.
 */
const FLOOR_SHARE = 0.15;
const DEPTH_FULL_BELOW = 0.12;

function floorShareAt(height: number): number {
  const upright = easeInOut(clamp01((height - DEPTH_FULL_BELOW) / (HIP_HEIGHT - DEPTH_FULL_BELOW)));
  return FLOOR_SHARE * (1 - upright);
}

/** A point projected into a view: screen position in figure units, and nearness to the camera. */
export interface P2 extends Pt {
  readonly depth: number;
}

export function projectPoint(p: V3, view: DongView): P2 {
  switch (view) {
    case 'side':
      return { x: p.z + p.x * PROFILE_LATERAL_SKEW, y: p.y, depth: p.x };
    case 'front':
      return { x: -p.x, y: p.y + p.z * floorShareAt(-p.y), depth: p.z };
    case 'back':
      return { x: p.x, y: p.y - p.z * floorShareAt(-p.y), depth: -p.z };
  }
}

/**
 * A lance aimed along his facing, head-on, is swung out toward his lance side
 * by this share of its reach. Tipped down the screen alone it still reads as
 * a stub pointing at his feet; angled out past his right hip as well, it is a
 * lance levelled at the viewer — the three-quarter cheat every top-down game
 * with a long weapon makes.
 */
const LANCE_SPLAY = 0.42;

/**
 * A direction projected as a long prop is: see {@link LANCE_DEPTH_SHARE}, and
 * {@link LANCE_SPLAY} for a lance in his hand. A lance lying on the floor is
 * not splayed: it is not being aimed at anything, and splayed it would reach
 * far off the side of the picture.
 */
function projectPropDirection(d: V3, view: DongView, held = true): Pt {
  const splay = held ? Math.abs(d.z) * LANCE_SPLAY : 0;
  switch (view) {
    case 'side':
      return { x: d.z + d.x * PROFILE_LATERAL_SKEW, y: d.y };
    case 'front':
      return { x: -(d.x + splay), y: d.y + d.z * LANCE_DEPTH_SHARE };
    case 'back':
      return { x: d.x + splay, y: d.y - d.z * LANCE_DEPTH_SHARE };
  }
}

/** Nearness of a direction to the camera, for ordering. */
function depthOf(d: V3, view: DongView): number {
  switch (view) {
    case 'side':
      return d.x;
    case 'front':
      return d.z;
    case 'back':
      return -d.z;
  }
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/** An arm posed by its joints: the walking swing, and anything raised overhead. */
export interface ArmAngles {
  /** The upper arm's swing forward from hanging, in radians. */
  readonly swing: number;
  /** The upper arm's lift out to his side. */
  readonly abduct: number;
  /** The elbow's flex: the forearm swings further forward by this. */
  readonly elbow: number;
}

export type ArmPose =
  | { readonly kind: 'reach'; readonly hand: V3 }
  | { readonly kind: 'angles'; readonly angles: ArmAngles };

export type HandShape = 'fist' | 'grip' | 'open';

export interface FootPose {
  /** The ankle joint. */
  readonly ankle: V3;
  /** Toe up is positive. */
  readonly pitch: number;
  readonly planted: boolean;
}

/**
 * The lance in his right hand, or lying free. `dir` runs from the butt to the
 * point; `gripAlong` is how far from the butt his hand closes on it.
 */
export type LancePose =
  | { readonly kind: 'held'; readonly dir: V3; readonly gripAlong: number }
  | { readonly kind: 'loose'; readonly butt: V3; readonly dir: V3 };

/**
 * A whole-body rotation about a floor point, applied after the rig is solved:
 * the fall at the end of the death. `sagittal` pitches him forward about his
 * left–right axis; `frontal` rolls him toward his left.
 */
export interface Topple {
  readonly pivot: V3;
  readonly angle: number;
  readonly plane: 'sagittal' | 'frontal';
}

export interface DongPose {
  /** The pelvis centre. */
  hip: V3;
  /** Spine pitched forward (+) about the pelvis. */
  lean: number;
  /** Spine tipped toward his right (+). */
  roll: number;
  /** Shoulders turned so the right one comes forward (+). */
  twist: number;
  /** Head nodded forward (+) on the neck; negative lifts the chin. */
  headPitch: number;
  /** 1 pumped, 0 deflated; a little past 1 is a showman's over-puff. */
  breath: number;
  leftFoot: FootPose;
  rightFoot: FootPose;
  leftArm: ArmPose;
  rightArm: ArmPose;
  leftHand: HandShape;
  rightHand: HandShape;
  lance: LancePose;
  /** 0 shut, 1 a shout. */
  mouth: number;
  /** 0 open, 1 shut. */
  blink: number;
  /** The vest's hem trailing behind (+) or swinging ahead (−), in tile units. */
  vestSwing: number;
  /** The beard's point trailing behind (+), in tile units. */
  beardSwing: number;
  /** The pennon's wave, in radians. */
  pennonPhase: number;
  /** 1 streams out flat, 0 hangs from the shaft. */
  pennonLift: number;
  topple: Topple | null;
}

/** He stands tall with his feet a little apart and the lance upright at his right side. */
export function restingPose(): DongPose {
  return {
    hip: v3(0, -HIP_HEIGHT, 0),
    lean: 0,
    roll: 0,
    twist: 0,
    headPitch: 0,
    breath: 1,
    leftFoot: { ankle: v3(-STANCE_HALF, -ANKLE_HEIGHT, 0), pitch: 0, planted: true },
    rightFoot: { ankle: v3(STANCE_HALF, -ANKLE_HEIGHT, 0), pitch: 0, planted: true },
    leftArm: { kind: 'reach', hand: v3(-0.27, -0.84, 0.01) },
    rightArm: { kind: 'reach', hand: UPRIGHT_CARRY_HAND },
    leftHand: 'fist',
    rightHand: 'grip',
    lance: { kind: 'held', dir: UPRIGHT_LANCE_DIR, gripAlong: UPRIGHT_GRIP_ALONG },
    mouth: 0,
    blink: 0,
    vestSwing: 0,
    beardSwing: 0,
    pennonPhase: 0,
    pennonLift: 0.6,
    topple: null,
  };
}

/** Half the distance between his ankles standing. */
export const STANCE_HALF = 0.1;
/**
 * Where the lance hand rides when he carries it upright: forearm raised and
 * held out ahead of him like a standard-bearer's, fist at chest height. Held
 * low against his side, the forearm and shaft covered his belly in profile —
 * and the belly deflating is the whole joke.
 */
export const UPRIGHT_CARRY_HAND: V3 = v3(0.26, -1.18, 0.27);
/** The upright lance leans a touch forward, as a carried pole does. */
export const UPRIGHT_LANCE_DIR: V3 = normalize3(v3(0.02, -1, 0.07));
/** Held about half way up, which keeps the butt a hand off the floor. */
export const UPRIGHT_GRIP_ALONG = 1.03;

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface Chain {
  readonly root: V3;
  readonly joint: V3;
  readonly end: V3;
  /** How far the limb was asked to reach, root to target. */
  readonly demand: number;
  /** True when the target lay outside the limb's span and was clamped. */
  readonly clamped: boolean;
}

export interface Skeleton {
  readonly hip: V3;
  readonly up: V3;
  readonly right: V3;
  readonly fwd: V3;
  readonly neckBase: V3;
  readonly chin: V3;
  readonly headCentre: V3;
  readonly headUp: V3;
  readonly leftShoulder: V3;
  readonly rightShoulder: V3;
  readonly leftLeg: Chain;
  readonly rightLeg: Chain;
  readonly leftArm: Chain;
  readonly rightArm: Chain;
  readonly leftToe: V3;
  readonly rightToe: V3;
  readonly leftHeel: V3;
  readonly rightHeel: V3;
  readonly lanceButt: V3;
  readonly lanceTip: V3;
  readonly lanceGrip: V3;
  readonly lanceDir: V3;
  /** False once the lance has left his hand. */
  readonly lanceHeld: boolean;
  readonly breath: number;
}

/**
 * Places a two-segment limb so its end sits on `target`, bending the joint
 * toward `pole`.
 */
function solveTwoBone(root: V3, target: V3, upper: number, lower: number, pole: V3): Chain {
  const toTarget = sub3(target, root);
  const raw = length3(toTarget);
  const dir = raw < DEGENERATE ? DOWN : scale3(toTarget, 1 / raw);
  const minReach = Math.abs(upper - lower) + JOINT_SLACK;
  const maxReach = upper + lower - JOINT_SLACK;
  const dist = Math.min(Math.max(raw, minReach), maxReach);
  const along = (dist * dist + upper * upper - lower * lower) / (2 * dist);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  let bend = sub3(pole, scale3(dir, dot3(pole, dir)));
  if (length3(bend) < DEGENERATE) bend = sub3(AHEAD, scale3(dir, dot3(AHEAD, dir)));
  const bendDir = normalize3(bend);
  const joint = add3(root, add3(scale3(dir, along), scale3(bendDir, out)));
  const end = add3(root, scale3(dir, dist));
  return { root, joint, end, demand: raw, clamped: Math.abs(dist - raw) > DEGENERATE };
}

/** Forward kinematics for an arm: lift out, swing forward, then flex the elbow. */
function armFromAngles(shoulder: V3, side: number, angles: ArmAngles): Chain {
  const lifted = rollRight(DOWN, -side * angles.abduct);
  const upperDir = pitchForward(lifted, -angles.swing);
  const foreDir = pitchForward(lifted, -(angles.swing + angles.elbow));
  const joint = add3(shoulder, scale3(upperDir, UPPER_ARM_LENGTH));
  const end = add3(joint, scale3(foreDir, FOREARM_LENGTH));
  return { root: shoulder, joint, end, demand: length3(sub3(end, shoulder)), clamped: false };
}

/** A knee always breaks forward, and a little outward so two knees never share a line. */
const KNEE_POLE_OUT = 0.25;
/** An elbow bends back and out. */
const ELBOW_POLE: V3 = v3(0.55, 0.25, -0.8);

/** The heel sits behind the ankle, the toe well ahead of it, both on the sole. */
const HEEL_BACK = 0.055;
const TOE_AHEAD = 0.17;

function footPoints(foot: FootPose): { heel: V3; toe: V3 } {
  const along = v3(0, -Math.sin(foot.pitch), Math.cos(foot.pitch));
  const down = v3(0, Math.cos(foot.pitch), Math.sin(foot.pitch));
  const sole = add3(foot.ankle, scale3(down, ANKLE_HEIGHT));
  return {
    heel: add3(sole, scale3(along, -HEEL_BACK)),
    toe: add3(sole, scale3(along, TOE_AHEAD)),
  };
}

/** The ankle for a foot resting on its heel or toe at a floor distance ahead, pitched. */
export function ankleOverPivot(pivotAhead: number, pivot: 'heel' | 'toe', pitch: number): V3 {
  const along = v3(0, -Math.sin(pitch), Math.cos(pitch));
  const down = v3(0, Math.cos(pitch), Math.sin(pitch));
  const reach = pivot === 'heel' ? -HEEL_BACK : TOE_AHEAD;
  const soleFromAnkle = add3(scale3(down, ANKLE_HEIGHT), scale3(along, reach));
  return sub3(v3(0, 0, pivotAhead), soleFromAnkle);
}

function rotateAbout(p: V3, topple: Topple): V3 {
  const local = sub3(p, topple.pivot);
  const turned =
    topple.plane === 'sagittal'
      ? pitchForward(local, topple.angle)
      : rollRight(local, -topple.angle);
  return add3(topple.pivot, turned);
}

function rotateDir(d: V3, topple: Topple): V3 {
  return topple.plane === 'sagittal' ? pitchForward(d, topple.angle) : rollRight(d, -topple.angle);
}

export function buildSkeleton(pose: DongPose): Skeleton {
  const breath = pose.breath;
  const slump = clamp01(1 - breath);
  const lean = pose.lean + slump * SLUMP_LEAN;
  const up = normalize3(pitchForward(rollRight(UP, pose.roll), lean));
  const right = normalize3(yawRight(rollRight(RIGHT, pose.roll), pose.twist));
  const fwd = normalize3(cross3(up, right));
  const hip = pose.hip;
  const neckBase = add3(hip, scale3(up, NECK_BASE_RISE - slump * SHOULDER_SLUMP_DROP));
  const shoulderCentre = add3(
    hip,
    scale3(up, SHOULDER_HEIGHT - HIP_HEIGHT - slump * SHOULDER_SLUMP_DROP),
  );
  const shoulderHalf = lerp(SHOULDER_HALF_SLUMPED, SHOULDER_HALF_PUMPED, clamp01(breath));
  const leftShoulder = add3(shoulderCentre, scale3(right, -shoulderHalf));
  const rightShoulder = add3(shoulderCentre, scale3(right, shoulderHalf));
  const headUp = normalize3(pitchForward(up, pose.headPitch));
  const chin = add3(neckBase, scale3(up, CHIN_HEIGHT - SHOULDER_HEIGHT - 0.045 + slump * 0.01));
  const headCentre = add3(
    add3(chin, scale3(headUp, HEAD_RY * HEAD_CHIN_DROP)),
    scale3(pitchForward(AHEAD, pose.headPitch), -HEAD_DEPTH * 0.12),
  );

  const leftRoot = add3(hip, v3(-LEG_ROOT_HALF, 0.02, 0));
  const rightRoot = add3(hip, v3(LEG_ROOT_HALF, 0.02, 0));
  const leftLeg = solveTwoBone(
    leftRoot,
    pose.leftFoot.ankle,
    THIGH_LENGTH,
    SHIN_LENGTH,
    v3(-KNEE_POLE_OUT, 0, 1),
  );
  const rightLeg = solveTwoBone(
    rightRoot,
    pose.rightFoot.ankle,
    THIGH_LENGTH,
    SHIN_LENGTH,
    v3(KNEE_POLE_OUT, 0, 1),
  );
  const leftArm =
    pose.leftArm.kind === 'angles'
      ? armFromAngles(leftShoulder, -1, pose.leftArm.angles)
      : solveTwoBone(
          leftShoulder,
          pose.leftArm.hand,
          UPPER_ARM_LENGTH,
          FOREARM_LENGTH,
          v3(-ELBOW_POLE.x, ELBOW_POLE.y, ELBOW_POLE.z),
        );
  const rightArm =
    pose.rightArm.kind === 'angles'
      ? armFromAngles(rightShoulder, 1, pose.rightArm.angles)
      : solveTwoBone(
          rightShoulder,
          pose.rightArm.hand,
          UPPER_ARM_LENGTH,
          FOREARM_LENGTH,
          ELBOW_POLE,
        );
  const leftFootPts = footPoints(pose.leftFoot);
  const rightFootPts = footPoints(pose.rightFoot);

  const lance = pose.lance;
  const lanceDir = normalize3(lance.dir);
  const lanceButt =
    lance.kind === 'held' ? sub3(rightArm.end, scale3(lanceDir, lance.gripAlong)) : lance.butt;
  const gripAlong = lance.kind === 'held' ? lance.gripAlong : LANCE_LENGTH / 2;
  const lanceGrip = add3(lanceButt, scale3(lanceDir, gripAlong));
  const lanceTip = add3(lanceButt, scale3(lanceDir, LANCE_LENGTH));

  const skeleton: Skeleton = {
    hip,
    up,
    right,
    fwd,
    neckBase,
    chin,
    headCentre,
    headUp,
    leftShoulder,
    rightShoulder,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    leftToe: leftFootPts.toe,
    rightToe: rightFootPts.toe,
    leftHeel: leftFootPts.heel,
    rightHeel: rightFootPts.heel,
    lanceButt,
    lanceTip,
    lanceGrip,
    lanceDir,
    lanceHeld: lance.kind === 'held',
    breath,
  };
  return pose.topple === null ? skeleton : toppled(skeleton, pose.topple);
}

function toppledChain(chain: Chain, topple: Topple): Chain {
  return {
    ...chain,
    root: rotateAbout(chain.root, topple),
    joint: rotateAbout(chain.joint, topple),
    end: rotateAbout(chain.end, topple),
  };
}

function toppled(s: Skeleton, t: Topple): Skeleton {
  const at = (p: V3): V3 => rotateAbout(p, t);
  const along = (d: V3): V3 => rotateDir(d, t);
  return {
    ...s,
    hip: at(s.hip),
    up: along(s.up),
    right: along(s.right),
    fwd: along(s.fwd),
    neckBase: at(s.neckBase),
    chin: at(s.chin),
    headCentre: at(s.headCentre),
    headUp: along(s.headUp),
    leftShoulder: at(s.leftShoulder),
    rightShoulder: at(s.rightShoulder),
    // He falls about his knees: the thighs go down with him, and the shins and
    // feet already lying on the floor stay where they are.
    leftLeg: { ...s.leftLeg, root: at(s.leftLeg.root) },
    rightLeg: { ...s.rightLeg, root: at(s.rightLeg.root) },
    leftArm: toppledChain(s.leftArm, t),
    rightArm: toppledChain(s.rightArm, t),
    // A lance lying free is placed on the floor by the choreography, not carried down with him.
    lanceButt: s.lanceButt,
    lanceTip: s.lanceTip,
    lanceGrip: s.lanceGrip,
    lanceDir: s.lanceDir,
  };
}

/** The lance's point and butt projected into a view, for gates and runtime anchors. */
export function lanceEndsInView(skeleton: Skeleton, view: DongView): { butt: Pt; tip: Pt } {
  const butt = projectPoint(skeleton.lanceButt, view);
  const dir = projectPropDirection(skeleton.lanceDir, view, skeleton.lanceHeld);
  return {
    butt,
    tip: { x: butt.x + dir.x * LANCE_LENGTH, y: butt.y + dir.y * LANCE_LENGTH },
  };
}

// ── Palette ──────────────────────────────────────────────────────────────────

/** A seven-step hue-shifted ramp: cooler and more saturated going down, warmer and paler going up. */
interface Ramp {
  readonly deep: string;
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly base: string;
  readonly light: string;
  readonly rim: string;
}

/** Weathered, sun-browned skin. */
const SKIN: Ramp = {
  deep: '#3f1d1c',
  shadow: '#652f27',
  dark: '#8a4a34',
  mid: '#ab6a48',
  base: '#c7885e',
  light: '#e2ae82',
  rim: '#f6d3a8',
};
/** White hair and beard, cool in its shadows. */
const WHITE: Ramp = {
  deep: '#4d4a5c',
  shadow: '#7c7a8c',
  dark: '#a3a2b0',
  mid: '#c6c5cd',
  base: '#e3e1e2',
  light: '#f5f2ec',
  rim: '#ffffff',
};
/** The hair seen from behind: the beard's white a step down, so a head of it reads as hair and not as a white hood. */
const MANE: Ramp = {
  deep: '#46434f',
  shadow: '#6d6a7a',
  dark: '#8f8d9b',
  mid: '#adabb6',
  base: '#c4c2c8',
  light: '#dcd9d6',
  rim: '#eeebe4',
};
const STEEL: Ramp = {
  deep: '#1f2431',
  shadow: '#3c4556',
  dark: '#5c6778',
  mid: '#808b9c',
  base: '#a3adbb',
  light: '#d2d9e2',
  rim: '#f5f8fb',
};
/** The open vest: crimson leather. */
const VEST: Ramp = {
  deep: '#240a10',
  shadow: '#43121a',
  dark: '#621a22',
  mid: '#7e222a',
  base: '#9b2e30',
  light: '#bb4a3f',
  rim: '#d86b55',
};
/** Tiny spandex shorts, royal blue with a hard sheen. */
const SPANDEX: Ramp = {
  deep: '#0b1038',
  shadow: '#161f66',
  dark: '#222f92',
  mid: '#2e40b6',
  base: '#3b55d0',
  light: '#7b94f2',
  rim: '#d2dcff',
};
const BOOT: Ramp = {
  deep: '#1a0f09',
  shadow: '#2e1b0e',
  dark: '#442914',
  mid: '#58371c',
  base: '#6e4724',
  light: '#8e6134',
  rim: '#b0824e',
};
const WOOD: Ramp = {
  deep: '#2a170b',
  shadow: '#452612',
  dark: '#61381a',
  mid: '#7a4a24',
  base: '#93602f',
  light: '#b27f47',
  rim: '#d3a56b',
};
/** The Meat Shields armband, in the club's zone orange. */
const ARMBAND = '#e06040';
const ARMBAND_DARK = '#9a3522';
const ARMBAND_LIGHT = '#f59a6e';
const VEST_TRIM = '#d8a444';
const VEST_TRIM_DARK = '#8d6420';
const PENNON_RED = '#c3262d';
const PENNON_RED_DARK = '#7d1419';
const PENNON_GOLD = '#efc03a';
const EYE_DARK = '#1c1012';
const MOUTH_INNER = '#3a1414';
/** The silhouette outline: a warm plum at partial alpha rather than black ink. */
const OUTLINE = '#24141c';
const OUTLINE_ALPHA = 0.9;
/** Figure units the outline stroke spans: about a screen pixel outside the ink at the 32 px tile. */
const OUTLINE_WIDTH = 0.062;
/** Shadow laid by a nearer part on what it overlaps, falling away from the upper-left key light. */
const CAST_TONE = '#2b1a2e';
const CAST_ALPHA = 0.42;
const CAST_OFFSET: Pt = { x: 0.022, y: 0.026 };
const GROUND_SHADOW_ALPHA = 0.34;
const GROUND_SHADOW_RX = 0.34;
const GROUND_SHADOW_RY = 0.1;
/** Key light from the upper left, as a unit vector toward it. */
const LIGHT: Pt = { x: -0.62, y: -0.78 };

// ── Paint primitives ─────────────────────────────────────────────────────────

/** Samples a width table (evenly spaced along the limb) at `t`. */
function sampleWidths(widths: readonly number[], t: number): number {
  const scaled = clamp01(t) * (widths.length - 1);
  const index = Math.min(widths.length - 2, Math.floor(scaled));
  return lerp(widths[index], widths[index + 1], scaled - index);
}

/** Number of samples a limb outline takes down each side. */
const LIMB_SAMPLES = 9;

interface LimbOutline {
  readonly a: Pt;
  readonly b: Pt;
  /** Unit normal on the "lead" side. */
  readonly lead: Pt;
  readonly leadWidths: readonly number[];
  readonly trailWidths: readonly number[];
}

function limbOutline(
  a: Pt,
  b: Pt,
  leadHint: Pt,
  leadWidths: readonly number[],
  trailWidths: readonly number[],
): LimbOutline {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), DEGENERATE);
  let normal = { x: -dy / length, y: dx / length };
  if (normal.x * leadHint.x + normal.y * leadHint.y < 0) normal = { x: -normal.x, y: -normal.y };
  return { a, b, lead: normal, leadWidths, trailWidths };
}

/**
 * The same limb with its two sides' roles swapped, so that tracing it lead
 * side first runs clockwise on screen (see {@link traceLoop}).
 */
function clockwiseLimb(limb: LimbOutline): LimbOutline {
  const dx = limb.b.x - limb.a.x;
  const dy = limb.b.y - limb.a.y;
  const turnsAnticlockwise = dx * limb.lead.y - dy * limb.lead.x > 0;
  if (!turnsAnticlockwise) return limb;
  return {
    ...limb,
    lead: { x: -limb.lead.x, y: -limb.lead.y },
    leadWidths: limb.trailWidths,
    trailWidths: limb.leadWidths,
  };
}

function limbEdge(limb: LimbOutline, t: number, side: 1 | -1): Pt {
  const w = sampleWidths(side === 1 ? limb.leadWidths : limb.trailWidths, t);
  return {
    x: lerp(limb.a.x, limb.b.x, t) + limb.lead.x * w * side,
    y: lerp(limb.a.y, limb.b.y, t) + limb.lead.y * w * side,
  };
}

/** Traces a limb as a smooth tapered tube with round ends, wound clockwise. */
function traceLimb(ctx: Ctx, drawn: LimbOutline): void {
  const limb = clockwiseLimb(drawn);
  const angle = Math.atan2(limb.b.y - limb.a.y, limb.b.x - limb.a.x);
  const leadStart = limbEdge(limb, 0, 1);
  ctx.moveTo(leadStart.x, leadStart.y);
  smoothThrough(
    ctx,
    Array.from({ length: LIMB_SAMPLES }, (_unused, i) => limbEdge(limb, i / (LIMB_SAMPLES - 1), 1)),
  );
  const endRadius = (sampleWidths(limb.leadWidths, 1) + sampleWidths(limb.trailWidths, 1)) / 2;
  const endCentre = {
    x:
      limb.b.x +
      (limb.lead.x * (sampleWidths(limb.leadWidths, 1) - sampleWidths(limb.trailWidths, 1))) / 2,
    y:
      limb.b.y +
      (limb.lead.y * (sampleWidths(limb.leadWidths, 1) - sampleWidths(limb.trailWidths, 1))) / 2,
  };
  const leadAngle = Math.atan2(limb.lead.y, limb.lead.x);
  ctx.arc(
    endCentre.x,
    endCentre.y,
    endRadius,
    leadAngle,
    leadAngle + Math.PI,
    isClockwise(angle, leadAngle),
  );
  smoothThrough(
    ctx,
    Array.from({ length: LIMB_SAMPLES }, (_unused, i) =>
      limbEdge(limb, 1 - i / (LIMB_SAMPLES - 1), -1),
    ),
  );
  const startRadius = (sampleWidths(limb.leadWidths, 0) + sampleWidths(limb.trailWidths, 0)) / 2;
  const startCentre = {
    x:
      limb.a.x +
      (limb.lead.x * (sampleWidths(limb.leadWidths, 0) - sampleWidths(limb.trailWidths, 0))) / 2,
    y:
      limb.a.y +
      (limb.lead.y * (sampleWidths(limb.leadWidths, 0) - sampleWidths(limb.trailWidths, 0))) / 2,
  };
  ctx.arc(
    startCentre.x,
    startCentre.y,
    startRadius,
    leadAngle + Math.PI,
    leadAngle + 2 * Math.PI,
    isClockwise(angle, leadAngle),
  );
  ctx.closePath();
}

/**
 * Which way round an end cap has to sweep so it bulges away from the limb:
 * the cap runs from the lead edge to the trail edge through the limb's
 * direction of travel at the far end.
 */
function isClockwise(axisAngle: number, leadAngle: number): boolean {
  const cross =
    Math.cos(leadAngle) * Math.sin(axisAngle) - Math.sin(leadAngle) * Math.cos(axisAngle);
  return cross < 0;
}

/** Draws a smooth curve through points already begun at `points[0]`, by midpoint quadratics. */
function smoothThrough(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length < 2) return;
  ctx.lineTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

/** Twice the signed area of a polygon; positive when it runs clockwise on a y-down screen. */
function signedArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * A closed smooth loop through `points`, always wound clockwise on screen.
 *
 * Every shape a part traces is wound the same way as `ctx.ellipse` winds by
 * default, because a part's shapes are filled and clipped together under the
 * nonzero rule: two overlapping loops wound in opposite directions cancel,
 * and the overlap is cut out of the clip as a hole — a moustache laid over a
 * beard painted as a black gap.
 */
function traceLoop(ctx: Ctx, loop: readonly Pt[]): void {
  const points = signedArea(loop) >= 0 ? loop : [...loop].reverse();
  const n = points.length;
  const midpoint = (i: number): Pt => {
    const a = points[i % n];
    const b = points[(i + 1) % n];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const start = midpoint(n - 1);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const mid = midpoint(i);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  ctx.closePath();
}

/** A closed straight-sided polygon, wound clockwise like every other shape (see {@link traceLoop}). */
function tracePolygon(ctx: Ctx, polygon: readonly Pt[]): void {
  const points = signedArea(polygon) >= 0 ? polygon : [...polygon].reverse();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

/**
 * Shades a traced form as a cylinder lit from the upper left: a gradient
 * across the form from its lit edge to its shadow edge. `across` is the unit
 * direction across the form and `halfWidth` how far it reaches each way.
 */
function cylinderShade(
  ctx: Ctx,
  centre: Pt,
  across: Pt,
  halfWidth: number,
  ramp: Ramp,
  contrast = 1,
): void {
  const facing = across.x * LIGHT.x + across.y * LIGHT.y >= 0 ? 1 : -1;
  const lit = {
    x: centre.x + across.x * halfWidth * facing,
    y: centre.y + across.y * halfWidth * facing,
  };
  const dark = {
    x: centre.x - across.x * halfWidth * facing,
    y: centre.y - across.y * halfWidth * facing,
  };
  const gradient = ctx.createLinearGradient(lit.x, lit.y, dark.x, dark.y);
  gradient.addColorStop(0, mix(ramp.base, ramp.light, contrast));
  gradient.addColorStop(0.3, ramp.base);
  gradient.addColorStop(0.55, mix(ramp.base, ramp.mid, contrast));
  gradient.addColorStop(0.78, mix(ramp.base, ramp.dark, contrast));
  gradient.addColorStop(1, mix(ramp.base, ramp.shadow, contrast));
  ctx.fillStyle = gradient;
  ctx.fillRect(centre.x - 2, centre.y - 2, 4, 4);
}

/** A soft dark line: a groove between two muscles, a fold, a seam. */
function groove(
  ctx: Ctx,
  points: readonly Pt[],
  color: string,
  width: number,
  alpha: number,
): void {
  if (alpha <= 0 || points.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(color, alpha * 0.35);
  ctx.lineWidth = width * 2.2;
  strokePath(ctx, points);
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  strokePath(ctx, points);
  ctx.restore();
}

function strokePath(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    smoothThrough(ctx, points);
  }
  ctx.stroke();
}

function ellipsePath(ctx: Ctx, c: Pt, rx: number, ry: number, rotation = 0): void {
  ctx.moveTo(c.x + Math.cos(rotation) * rx, c.y + Math.sin(rotation) * rx);
  ctx.ellipse(
    c.x,
    c.y,
    Math.max(rx, DEGENERATE),
    Math.max(ry, DEGENERATE),
    rotation,
    0,
    Math.PI * 2,
  );
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function offsetPt(p: Pt, dir: Pt, k: number): Pt {
  return { x: p.x + dir.x * k, y: p.y + dir.y * k };
}

function unit(p: Pt): Pt {
  const length = Math.hypot(p.x, p.y);
  return length < DEGENERATE ? { x: 0, y: -1 } : { x: p.x / length, y: p.y / length };
}

function perp(p: Pt): Pt {
  return { x: -p.y, y: p.x };
}

// ── Parts ────────────────────────────────────────────────────────────────────

/**
 * One painted part: its outline path, its painting, and where it sits in the
 * draw order. Every part's path is stroked in the silhouette colour before any
 * part is filled, so only the outer edge of the whole figure keeps an outline
 * and no part inks a line across another.
 */
interface Part {
  readonly order: number;
  readonly trace: (ctx: Ctx) => void;
  readonly paint: (ctx: Ctx) => void;
  /** Lays a soft shadow on what is already painted beneath it. */
  readonly casts: boolean;
}

interface Scene {
  readonly view: DongView;
  readonly s: Skeleton;
  readonly pose: DongPose;
  readonly p: (v: V3) => P2;
  /** Screen direction of his own forward, for the anterior side of a limb. */
  readonly fwd2: Pt;
  /** Screen direction of his own right. */
  readonly right2: Pt;
  readonly up2: Pt;
  readonly breath: number;
}

function sceneFor(pose: DongPose, view: DongView): Scene {
  const s = buildSkeleton(pose);
  const p = (v: V3): P2 => projectPoint(v, view);
  const dir2 = (d: V3): Pt => {
    const a = p(s.hip);
    const b = p(add3(s.hip, scale3(d, 0.3)));
    return { x: b.x - a.x, y: b.y - a.y };
  };
  return {
    view,
    s,
    pose,
    p,
    fwd2: dir2(s.fwd),
    right2: dir2(s.right),
    up2: unit(dir2(s.up)),
    breath: clamp01(pose.breath),
  };
}

// ── Legs and boots ───────────────────────────────────────────────────────────

const THIGH_FRONT = [0.084, 0.086, 0.078, 0.064, 0.05];
const THIGH_BACK = [0.08, 0.08, 0.07, 0.058, 0.047];
const THIGH_OUTER = [0.086, 0.08, 0.07, 0.058, 0.046];
const THIGH_INNER = [0.07, 0.066, 0.058, 0.05, 0.043];
const SHIN_FRONT = [0.046, 0.042, 0.037, 0.033, 0.031];
const SHIN_CALF = [0.048, 0.064, 0.058, 0.043, 0.033];
const SHIN_OUTER = [0.047, 0.058, 0.052, 0.04, 0.033];
const SHIN_INNER = [0.044, 0.052, 0.047, 0.038, 0.031];
/** How far down the shin the boot's cuff sits. */
const BOOT_TOP = 0.5;
const BOOT_BULK = 0.012;
const BOOT_CUFF_DEPTH = 0.07;

function legParts(scene: Scene, side: -1 | 1, order: number): Part[] {
  const { s, p, view } = scene;
  const chain = side === 1 ? s.rightLeg : s.leftLeg;
  const toe3 = side === 1 ? s.rightToe : s.leftToe;
  const heel3 = side === 1 ? s.rightHeel : s.leftHeel;
  const hip = p(chain.root);
  const knee = p(chain.joint);
  const ankle = p(chain.end);
  const toe = p(toe3);
  const heel = p(heel3);
  const profile = view === 'side';
  const outward = { x: scene.right2.x * side, y: scene.right2.y * side };
  const thighHint = profile ? scene.fwd2 : outward;
  const thigh = limbOutline(
    hip,
    knee,
    thighHint,
    profile ? THIGH_FRONT : THIGH_OUTER,
    profile ? THIGH_BACK : THIGH_INNER,
  );
  const shinHint = profile ? scene.fwd2 : outward;
  const shin = limbOutline(
    knee,
    ankle,
    shinHint,
    profile ? SHIN_FRONT : SHIN_OUTER,
    profile ? SHIN_CALF : SHIN_INNER,
  );
  const bootTop = lerpPt(knee, ankle, BOOT_TOP);
  const bootShin = limbOutline(
    bootTop,
    ankle,
    shinHint,
    (profile ? SHIN_FRONT : SHIN_OUTER).slice(2).map((w) => w + BOOT_BULK),
    (profile ? SHIN_CALF : SHIN_INNER).slice(2).map((w) => w + BOOT_BULK),
  );

  const traceBootFoot = (ctx: Ctx): void => {
    if (profile) {
      const along = unit({ x: toe.x - heel.x, y: toe.y - heel.y });
      const upFoot = perp(along);
      const lift = upFoot.y < 0 ? upFoot : { x: -upFoot.x, y: -upFoot.y };
      const instep = offsetPt(lerpPt(heel, toe, 0.45), lift, 0.1);
      const toeTop = offsetPt(lerpPt(heel, toe, 0.86), lift, 0.055);
      const heelTop = offsetPt(heel, lift, 0.11);
      traceLoop(ctx, [
        heel,
        lerpPt(heel, toe, 0.9),
        { x: toe.x + along.x * 0.03, y: toe.y + along.y * 0.03 - 0.02 },
        toeTop,
        instep,
        { x: ankle.x + along.x * 0.04, y: ankle.y },
        { x: heelTop.x - along.x * 0.01, y: heelTop.y },
        { x: heel.x - along.x * 0.03, y: heel.y - 0.02 },
      ]);
      return;
    }
    // Head-on the boot is seen toe-on: a rounded block widening to the sole.
    const toeScreen = { x: lerp(heel.x, toe.x, 0.5), y: Math.max(heel.y, toe.y) };
    const halfTop = 0.045;
    const halfSole = 0.058;
    traceLoop(ctx, [
      { x: ankle.x - halfTop, y: ankle.y - 0.02 },
      { x: ankle.x + halfTop, y: ankle.y - 0.02 },
      { x: toeScreen.x + halfSole + 0.01, y: toeScreen.y - 0.03 },
      { x: toeScreen.x + halfSole, y: toeScreen.y },
      { x: toeScreen.x - halfSole, y: toeScreen.y },
      { x: toeScreen.x - halfSole - 0.01, y: toeScreen.y - 0.03 },
    ]);
  };

  const legPart: Part = {
    order,
    casts: order > 0,
    trace: (ctx) => {
      traceLimb(ctx, thigh);
      traceLimb(ctx, shin);
    },
    paint: (ctx) => {
      const leg = (limb: LimbOutline, widths: readonly number[]): void => {
        withClip(
          ctx,
          () => {
            ctx.beginPath();
            traceLimb(ctx, limb);
          },
          () => {
            cylinderShade(
              ctx,
              lerpPt(limb.a, limb.b, 0.4),
              limb.lead,
              Math.max(...widths),
              SKIN,
              1,
            );
          },
        );
      };
      leg(thigh, profile ? THIGH_FRONT : THIGH_OUTER);
      leg(shin, profile ? SHIN_CALF : SHIN_OUTER);
      // The quad's teardrop above the knee and the calf's belly: the old man's legs are still a lifter's.
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceLimb(ctx, thigh);
          traceLimb(ctx, shin);
        },
        () => {
          const quad = offsetPt(lerpPt(hip, knee, 0.55), thigh.lead, 0.03);
          fillSoftEllipse(
            ctx,
            quad.x,
            quad.y,
            0.05,
            0.1,
            SKIN.light,
            0.45,
            Math.atan2(knee.y - hip.y, knee.x - hip.x) - Math.PI / 2,
          );
          const kneeShade = offsetPt(knee, thigh.lead, -0.01);
          fillSoftEllipse(ctx, kneeShade.x, kneeShade.y + 0.02, 0.05, 0.03, SKIN.shadow, 0.35);
          const calfSide = profile ? -1 : 1;
          const calf = offsetPt(lerpPt(knee, ankle, 0.28), shin.lead, 0.02 * calfSide);
          fillSoftEllipse(
            ctx,
            calf.x - 0.01,
            calf.y - 0.01,
            0.03,
            0.07,
            SKIN.light,
            0.4,
            Math.atan2(ankle.y - knee.y, ankle.x - knee.x) - Math.PI / 2,
          );
        },
      );
    },
  };

  const bootPart: Part = {
    order: order + 0.01,
    casts: false,
    trace: (ctx) => {
      traceLimb(ctx, bootShin);
      traceBootFoot(ctx);
    },
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceLimb(ctx, bootShin);
          traceBootFoot(ctx);
        },
        () => {
          ctx.fillStyle = BOOT.base;
          ctx.fillRect(bootTop.x - 1, bootTop.y - 1, 2, 2);
          cylinderShade(ctx, lerpPt(bootTop, ankle, 0.5), bootShin.lead, 0.07, BOOT, 1);
          ctx.fillStyle = BOOT.deep;
          const soleY = Math.max(heel.y, toe.y);
          ctx.fillRect(
            Math.min(heel.x, toe.x) - 0.1,
            soleY - 0.022,
            Math.abs(toe.x - heel.x) + 0.2,
            0.05,
          );
          const cuffEnd = lerpPt(
            bootTop,
            ankle,
            BOOT_CUFF_DEPTH / Math.max(0.01, Math.hypot(ankle.x - bootTop.x, ankle.y - bootTop.y)),
          );
          ctx.strokeStyle = BOOT.light;
          ctx.lineWidth = 0.03;
          const across = bootShin.lead;
          ctx.beginPath();
          ctx.moveTo(cuffEnd.x - across.x * 0.08, cuffEnd.y - across.y * 0.08);
          ctx.lineTo(cuffEnd.x + across.x * 0.08, cuffEnd.y + across.y * 0.08);
          ctx.stroke();
          fillSoftEllipse(
            ctx,
            toe.x - (profile ? 0.05 : 0),
            toe.y - 0.05,
            0.04,
            0.025,
            BOOT.rim,
            0.5,
          );
        },
      );
    },
  };
  return [legPart, bootPart];
}

// ── Torso ────────────────────────────────────────────────────────────────────

/** One height up the torso and its half-width head-on and depth either side in profile, pumped and slumped. */
interface TorsoLevel {
  readonly rise: number;
  readonly half: readonly [number, number];
  readonly front: readonly [number, number];
  readonly back: readonly [number, number];
}

/**
 * The torso's silhouette, crotch to trapezius, each value as [slumped, pumped].
 * Pumped he is a V: lats flared wider than anything below them, a waist
 * narrower than his hips. Slumped the chest caves, the lats fold in and the
 * belly pushes out past them — a pear — and in profile the paunch overtakes
 * the chest. These are the numbers that carry the breath at 32 px.
 */
const TORSO_LEVELS: readonly TorsoLevel[] = [
  { rise: -0.08, half: [0.13, 0.122], front: [0.085, 0.07], back: [0.1, 0.1] },
  { rise: 0.02, half: [0.165, 0.142], front: [0.14, 0.085], back: [0.125, 0.12] },
  { rise: 0.12, half: [0.205, 0.13], front: [0.28, 0.08], back: [0.1, 0.095] },
  { rise: 0.21, half: [0.21, 0.128], front: [0.285, 0.088], back: [0.088, 0.085] },
  { rise: 0.3, half: [0.185, 0.168], front: [0.16, 0.12], back: [0.09, 0.092] },
  { rise: 0.4, half: [0.15, 0.232], front: [0.07, 0.19], back: [0.095, 0.105] },
  { rise: 0.48, half: [0.148, 0.268], front: [0.06, 0.145], back: [0.1, 0.11] },
  { rise: 0.555, half: [0.095, 0.125], front: [0.04, 0.05], back: [0.06, 0.066] },
];

/** The heights (above the hip) that the torso's landmarks are painted at. */
const RISE_NAVEL = 0.17;
const RISE_PEC_TOP = 0.49;
const RISE_PEC_LOW = 0.36;
const RISE_WAISTBAND = 0.075;
const RISE_VEST_HEM = 0.16;
const RISE_ARMHOLE = 0.36;

function levelValue(pair: readonly [number, number], breath: number): number {
  return lerp(pair[0], pair[1], breath);
}

/** The spine point `rise` above the hip. */
function spineAt(scene: Scene, rise: number): P2 {
  return scene.p(add3(scene.s.hip, scale3(scene.s.up, rise)));
}

interface TorsoEdge {
  readonly centre: Pt;
  readonly a: Pt;
  readonly b: Pt;
}

/**
 * The torso's two screen edges at a level. Head-on they sit either side of
 * the spine across his shoulders; in profile, in front of and behind it.
 */
function torsoEdgeAt(scene: Scene, level: TorsoLevel, bulk = 0): TorsoEdge {
  const centre = spineAt(scene, level.rise);
  if (scene.view === 'side') {
    const fwd = unit(perp(scene.up2));
    const forward =
      fwd.x * scene.fwd2.x + fwd.y * scene.fwd2.y >= 0 ? fwd : { x: -fwd.x, y: -fwd.y };
    return {
      centre,
      a: offsetPt(centre, forward, levelValue(level.front, scene.breath) + bulk),
      b: offsetPt(centre, forward, -(levelValue(level.back, scene.breath) + bulk)),
    };
  }
  const across = unit(perp(scene.up2));
  // How squarely the shoulders face the camera: a twist narrows the torso.
  const squareness = Math.max(0.55, Math.hypot(scene.right2.x, scene.right2.y) / 0.3);
  const half = levelValue(level.half, scene.breath) * Math.min(1, squareness) + bulk;
  return { centre, a: offsetPt(centre, across, half), b: offsetPt(centre, across, -half) };
}

/** The torso's level at any rise, interpolated between the table's rows. */
function levelAt(rise: number): TorsoLevel {
  const upperIndex = Math.max(
    1,
    TORSO_LEVELS.findIndex((level) => level.rise >= rise),
  );
  const upper = TORSO_LEVELS[upperIndex];
  const lower = TORSO_LEVELS[upperIndex - 1];
  const t = clamp01((rise - lower.rise) / (upper.rise - lower.rise));
  const blend = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
  ];
  return {
    rise,
    half: blend(lower.half, upper.half),
    front: blend(lower.front, upper.front),
    back: blend(lower.back, upper.back),
  };
}

/** Traces the torso between two rises as a band, open at neither end. */
function traceTorsoBand(
  ctx: Ctx,
  scene: Scene,
  bulk: number,
  fromRise: number,
  toRise: number,
): void {
  const inside = TORSO_LEVELS.filter((level) => level.rise > fromRise && level.rise < toRise);
  const levels = [levelAt(fromRise), ...inside, levelAt(toRise)];
  const edges = levels.map((level) => torsoEdgeAt(scene, level, bulk));
  traceLoop(ctx, [...edges.map((e) => e.a), ...edges.map((e) => e.b).reverse()]);
}

function traceTorso(
  ctx: Ctx,
  scene: Scene,
  bulk = 0,
  fromLevel = 0,
  toLevel = TORSO_LEVELS.length - 1,
): void {
  const levels = TORSO_LEVELS.slice(fromLevel, toLevel + 1);
  const edges = levels.map((level) => torsoEdgeAt(scene, level, bulk));
  const top = spineAt(scene, TORSO_LEVELS[TORSO_LEVELS.length - 1].rise + 0.03);
  const points: Pt[] = [
    ...edges.map((e) => e.a),
    ...(toLevel === TORSO_LEVELS.length - 1 ? [top] : []),
    ...edges.map((e) => e.b).reverse(),
  ];
  traceLoop(ctx, points);
}

/** The height a pec's lower edge hangs to: level and square pumped, sagging deflated. */
function pecLow(breath: number): number {
  return lerp(RISE_PEC_LOW - 0.075, RISE_PEC_LOW, breath);
}

/**
 * The chest and belly head-on. Pumped: square pecs with a hard shadow under
 * each and a six-pack banded hard enough to survive the tile. Deflated: the
 * pecs sag into teardrops, the bands fade out, and a round lit paunch spills
 * over the waistband. The contrast is pushed well past life, because banding
 * that reads at review scale is gone at 32 px.
 */
function paintFrontMuscles(ctx: Ctx, scene: Scene): void {
  const b = scene.breath;
  const across = unit(perp(scene.up2));
  const pumped = b * b;
  const at = (rise: number, out: number): Pt => offsetPt(spineAt(scene, rise), across, out);
  const halfAt = (rise: number): number => {
    const index = TORSO_LEVELS.findIndex((level) => level.rise >= rise);
    const upper = TORSO_LEVELS[Math.max(1, index)];
    const lower = TORSO_LEVELS[Math.max(0, index - 1)];
    const t = clamp01((rise - lower.rise) / Math.max(DEGENERATE, upper.rise - lower.rise));
    return lerp(levelValue(lower.half, b), levelValue(upper.half, b), t);
  };

  const belly = at(RISE_NAVEL, 0);
  fillSoftEllipse(
    ctx,
    belly.x - 0.03,
    belly.y - 0.02,
    lerp(0.15, 0.09, b),
    lerp(0.13, 0.08, b),
    SKIN.light,
    lerp(0.6, 0.2, b),
  );
  fillSoftEllipse(
    ctx,
    belly.x + 0.07,
    belly.y + 0.06,
    0.12,
    0.08,
    SKIN.shadow,
    lerp(0.35, 0.15, b),
  );
  const absAlpha = 0.85 * pumped;
  if (absAlpha > 0.02) {
    groove(ctx, [at(0.33, 0), at(RISE_NAVEL, 0), at(0.1, 0)], SKIN.deep, 0.016, absAlpha);
    for (const rise of [0.29, 0.225, 0.16]) {
      const half = halfAt(rise) * 0.5;
      groove(
        ctx,
        [at(rise, -half), at(rise - 0.01, 0), at(rise, half)],
        SKIN.deep,
        0.014,
        absAlpha * 0.9,
      );
      for (const out of [-half * 0.5, half * 0.5]) {
        const block = at(rise + 0.035, out);
        fillSoftEllipse(
          ctx,
          block.x - 0.008,
          block.y - 0.006,
          0.032,
          0.022,
          SKIN.rim,
          0.55 * pumped,
        );
      }
    }
    for (const side of [-1, 1]) {
      const flank = at(0.2, side * halfAt(0.2) * 0.85);
      fillSoftEllipse(ctx, flank.x, flank.y, 0.04, 0.12, SKIN.shadow, 0.5 * pumped);
    }
  } else {
    fillSoftEllipse(ctx, belly.x, belly.y + 0.01, 0.012, 0.014, SKIN.deep, 0.7);
  }
  if (b < 1) {
    const navel = at(RISE_NAVEL - 0.01, 0);
    fillSoftEllipse(ctx, navel.x, navel.y, 0.011, 0.013, SKIN.deep, 0.8 * (1 - b));
  }
  const band = at(RISE_WAISTBAND + 0.02, 0);
  fillSoftEllipse(ctx, band.x, band.y, 0.16, 0.03, SKIN.deep, 0.5 * (1 - b) + 0.15);

  const low = pecLow(b);
  for (const side of [-1, 1]) {
    const inner = at(RISE_PEC_TOP - 0.04, side * 0.02);
    const outer = at(RISE_PEC_TOP - 0.02, side * halfAt(RISE_PEC_TOP) * 0.92);
    const bottomOuter = at(low + lerp(0.06, 0.02, b), side * halfAt(low) * lerp(0.7, 0.88, b));
    const bottom = at(low, side * halfAt(low) * lerp(0.42, 0.5, b));
    const bottomInner = at(low + lerp(0.03, 0.02, b), side * 0.025);
    const pec = [inner, outer, bottomOuter, bottom, bottomInner];
    ctx.save();
    ctx.beginPath();
    traceLoop(ctx, pec);
    ctx.clip();
    const mid = at(lerp(RISE_PEC_TOP, low, 0.45), side * halfAt(RISE_PEC_LOW) * 0.5);
    fillSoftEllipse(ctx, mid.x - 0.02, mid.y - 0.03, 0.12, 0.07, SKIN.light, 0.35 + 0.45 * pumped);
    fillSoftEllipse(ctx, bottom.x, bottom.y, 0.1, 0.04, SKIN.dark, 0.3);
    ctx.restore();
    groove(
      ctx,
      [bottomInner, bottom, bottomOuter],
      SKIN.deep,
      lerp(0.014, 0.022, b),
      lerp(0.35, 0.95, b),
    );
  }
  groove(
    ctx,
    [at(RISE_PEC_TOP - 0.03, 0), at(low + 0.03, 0)],
    SKIN.deep,
    0.014,
    0.35 + 0.5 * pumped,
  );
}

function paintSideMuscles(ctx: Ctx, scene: Scene): void {
  const b = scene.breath;
  const pumped = b * b;
  const front = torsoEdgeAt(scene, TORSO_LEVELS[5]);
  const low = pecLow(b);
  const fwd = unit({ x: front.a.x - front.centre.x, y: front.a.y - front.centre.y });
  const at = (rise: number, out: number): Pt => offsetPt(spineAt(scene, rise), fwd, out);
  const pecFront = levelValue(TORSO_LEVELS[5].front, b);
  const pecCentre = at(lerp(RISE_PEC_TOP, low, 0.5), pecFront * 0.6);
  fillSoftEllipse(
    ctx,
    pecCentre.x,
    pecCentre.y - 0.02,
    0.09,
    0.07,
    SKIN.light,
    0.35 + 0.4 * pumped,
  );
  groove(
    ctx,
    [
      at(low + 0.02, pecFront * 0.2),
      at(low - 0.005, pecFront * 0.7),
      at(low + 0.03, pecFront * 1.05),
    ],
    SKIN.deep,
    0.018,
    lerp(0.35, 0.9, b),
  );
  const bellyFront = levelValue(TORSO_LEVELS[3].front, b);
  const belly = at(RISE_NAVEL, bellyFront * 0.55);
  fillSoftEllipse(
    ctx,
    belly.x,
    belly.y - 0.03,
    lerp(0.14, 0.07, b),
    lerp(0.12, 0.08, b),
    SKIN.light,
    lerp(0.55, 0.15, b),
  );
  for (const rise of [0.29, 0.225, 0.16]) {
    const f = at(rise, bellyFront * 0.95);
    groove(ctx, [at(rise, bellyFront * 0.55), f], SKIN.deep, 0.012, 0.7 * pumped);
  }
  const band = at(RISE_WAISTBAND + 0.02, bellyFront * 0.6);
  fillSoftEllipse(ctx, band.x, band.y, 0.1, 0.03, SKIN.deep, 0.5 * (1 - b) + 0.12);
}

function torsoPart(scene: Scene): Part {
  return {
    order: 0,
    casts: false,
    trace: (ctx) => traceTorso(ctx, scene),
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceTorso(ctx, scene);
        },
        () => {
          const chest = spineAt(scene, 0.3);
          ctx.fillStyle = SKIN.base;
          ctx.fillRect(chest.x - 1, chest.y - 1, 2, 2);
          const across = unit(perp(scene.up2));
          cylinderShade(ctx, chest, across, 0.24, SKIN, 0.9);
          if (scene.view === 'front') paintFrontMuscles(ctx, scene);
          if (scene.view === 'side') paintSideMuscles(ctx, scene);
          if (scene.view === 'back') {
            // Hidden by the vest from the shoulders to the hem; only the small of the back shows.
            const small = spineAt(scene, 0.06);
            fillSoftEllipse(ctx, small.x, small.y, 0.1, 0.06, SKIN.shadow, 0.3);
          }
        },
      );
    },
  };
}

function neckPart(scene: Scene): Part {
  const base = scene.p(scene.s.neckBase);
  const chin = scene.p(scene.s.chin);
  const neck = limbOutline(base, chin, scene.fwd2, [0.072, 0.066, 0.06], [0.072, 0.066, 0.062]);
  return {
    order: 0.25,
    casts: false,
    trace: (ctx) => traceLimb(ctx, neck),
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceLimb(ctx, neck);
        },
        () => {
          ctx.fillStyle = SKIN.mid;
          ctx.fillRect(base.x - 1, base.y - 1, 2, 2);
          cylinderShade(ctx, lerpPt(base, chin, 0.5), unit(perp(scene.up2)), 0.07, SKIN, 1);
          // Shadow under the jaw so head and neck do not read as one column.
          fillSoftEllipse(ctx, chin.x, chin.y, 0.08, 0.035, SKIN.shadow, 0.7);
        },
      );
    },
  };
}

// ── Shorts ───────────────────────────────────────────────────────────────────

const SHORTS_BULK = 0.012;
/** How far down each thigh the spandex leg reaches. */
const SHORTS_LEG = 0.1;

function shortsPart(scene: Scene): Part {
  const { s, p, view } = scene;
  const profile = view === 'side';
  const cuffs = [s.leftLeg, s.rightLeg].map((chain, index) => {
    const side = index === 0 ? -1 : 1;
    const root = p(chain.root);
    const knee = p(chain.joint);
    const length = Math.max(DEGENERATE, Math.hypot(knee.x - root.x, knee.y - root.y));
    const end = lerpPt(root, knee, SHORTS_LEG / length);
    const outward = { x: scene.right2.x * side, y: scene.right2.y * side };
    const start = offsetPt(root, unit({ x: root.x - knee.x, y: root.y - knee.y }), 0.04);
    return limbOutline(
      start,
      end,
      profile ? scene.fwd2 : outward,
      (profile ? THIGH_FRONT : THIGH_OUTER).slice(0, 2).map((w) => w + SHORTS_BULK),
      (profile ? THIGH_BACK : THIGH_INNER).slice(0, 2).map((w) => w + SHORTS_BULK),
    );
  });
  // The gusset joins the two cuffs under the crotch; without it a sliver of
  // skin shows between the legs of the shorts from behind.
  const gusset = [
    cuffs[0].a,
    lerpPt(cuffs[0].a, cuffs[0].b, 0.5),
    lerpPt(cuffs[1].a, cuffs[1].b, 0.5),
    cuffs[1].a,
  ];
  const trace = (ctx: Ctx): void => {
    traceTorsoBand(ctx, scene, SHORTS_BULK, TORSO_LEVELS[0].rise, RISE_WAISTBAND);
    for (const cuff of cuffs) traceLimb(ctx, cuff);
    traceLoop(ctx, gusset);
  };
  return {
    order: 0.1,
    casts: true,
    trace,
    paint: (ctx) => {
      const band = spineAt(scene, RISE_WAISTBAND);
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          ctx.fillStyle = SPANDEX.base;
          ctx.fillRect(band.x - 1, band.y - 0.02, 2, 1);
          cylinderShade(ctx, spineAt(scene, 0), unit(perp(scene.up2)), 0.2, SPANDEX, 1);
          // Spandex is a hard, narrow sheen, not a soft glow.
          const sheen = spineAt(scene, 0.0);
          fillSoftEllipse(
            ctx,
            sheen.x - 0.06,
            sheen.y - 0.02,
            0.05,
            0.02,
            SPANDEX.rim,
            0.75,
            -0.4,
            0.3,
          );
          for (const cuff of cuffs) {
            const glint = lerpPt(cuff.a, cuff.b, 0.5);
            fillSoftEllipse(ctx, glint.x - 0.02, glint.y, 0.018, 0.035, SPANDEX.light, 0.6);
          }
          ctx.fillStyle = SPANDEX.deep;
          const top = spineAt(scene, RISE_WAISTBAND + 0.2);
          ctx.fillRect(top.x - 1, band.y - 0.2, 2, 0.2 + 0.016);
        },
      );
    },
  };
}

// ── Vest ─────────────────────────────────────────────────────────────────────

const VEST_BULK = 0.018;
/** The vest's opening at the chest, as a share of the torso's half-width: it hangs off the outer pecs. */
const VEST_OPENING = 0.42;
/**
 * Where the vest's open edge falls in profile, as a share of the way from his
 * spine to his front (negative is behind the spine).
 */
const PROFILE_VEST_EDGE_AT_HEM = -0.45;
const PROFILE_VEST_EDGE_HIGH = -0.1;
const PROFILE_VEST_EDGE_AT_SHOULDER = 0.25;
/**
 * From behind, the vest's armholes are cut in from his sides, so a band of
 * back shows either side of it: without them it reads as a tabard.
 */
const VEST_ARMHOLE_INSET = 0.7;

function vestPart(scene: Scene): Part {
  const { view } = scene;
  const swing = scene.pose.vestSwing;
  const hemLevel = TORSO_LEVELS.findIndex((level) => level.rise >= RISE_VEST_HEM);
  const levels = TORSO_LEVELS.slice(hemLevel);
  const edges = levels.map((level) => torsoEdgeAt(scene, level, VEST_BULK));
  const top = spineAt(scene, TORSO_LEVELS[TORSO_LEVELS.length - 1].rise + 0.035);
  const hemBack = scene.view === 'side' ? { x: -swing, y: 0 } : { x: 0, y: -swing * 0.2 };

  const panels: Pt[][] = [];
  if (view === 'back') {
    const armhole = (e: TorsoEdge, index: number, side: Pt): Pt =>
      levels[index].rise >= RISE_ARMHOLE ? lerpPt(e.centre, side, VEST_ARMHOLE_INSET) : side;
    const loop = [
      ...edges.map((e, index) => armhole(e, index, e.a)),
      top,
      ...edges.map((e, index) => armhole(e, index, e.b)).reverse(),
    ];
    loop[0] = offsetPt(loop[0], hemBack, 1);
    loop[loop.length - 1] = offsetPt(loop[loop.length - 1], hemBack, 1);
    panels.push(loop);
  } else if (view === 'front') {
    for (const side of [-1, 1]) {
      const outer = edges.map((e) => (side === 1 ? e.a : e.b));
      const inner = edges.map((e, index) => {
        const t = index === edges.length - 1 ? 0.55 : VEST_OPENING;
        return lerpPt(e.centre, side === 1 ? e.a : e.b, index === 0 ? 0.55 : t);
      });
      const neck = lerpPt(
        top,
        side === 1 ? edges[edges.length - 1].a : edges[edges.length - 1].b,
        0.45,
      );
      panels.push([...outer, neck, ...inner.slice(0, -1).reverse()]);
    }
  } else {
    // In profile the vest wraps his back and hangs open behind his flank: the
    // whole front of him is bare, so the chest and the paunch read as skin.
    const back = edges.map((e) => e.b);
    const frontEdge = edges.map((e, index) =>
      lerpPt(
        e.centre,
        e.a,
        index === edges.length - 1
          ? PROFILE_VEST_EDGE_AT_SHOULDER
          : lerp(PROFILE_VEST_EDGE_AT_HEM, PROFILE_VEST_EDGE_HIGH, index / edges.length),
      ),
    );
    back[0] = offsetPt(back[0], hemBack, 1);
    frontEdge[0] = offsetPt(frontEdge[0], hemBack, 0.6);
    panels.push([...back, top, ...frontEdge.reverse()]);
  }

  const trace = (ctx: Ctx): void => {
    for (const panel of panels) traceLoop(ctx, panel);
  };
  return {
    order: 0.2,
    casts: true,
    trace,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          const chest = spineAt(scene, 0.35);
          ctx.fillStyle = VEST.base;
          ctx.fillRect(chest.x - 1, chest.y - 1, 2, 2);
          cylinderShade(ctx, chest, unit(perp(scene.up2)), 0.26, VEST, 1);
          for (const panel of panels) {
            const high = lerpPt(panel[Math.floor(panel.length / 2)], panel[0], 0.3);
            fillSoftEllipse(ctx, high.x, high.y, 0.05, 0.12, VEST.light, 0.45);
          }
          if (view === 'back') {
            const seamTop = spineAt(scene, 0.5);
            const seamLow = spineAt(scene, RISE_VEST_HEM + 0.01);
            groove(ctx, [seamTop, seamLow], VEST.deep, 0.012, 0.6);
          }
        },
      );
      ctx.save();
      ctx.lineJoin = 'round';
      for (const panel of panels) {
        ctx.beginPath();
        traceLoop(ctx, panel);
        ctx.strokeStyle = VEST_TRIM_DARK;
        ctx.lineWidth = 0.03;
        ctx.save();
        ctx.clip();
        ctx.stroke();
        ctx.strokeStyle = VEST_TRIM;
        ctx.lineWidth = 0.016;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    },
  };
}

// ── Arms and hands ───────────────────────────────────────────────────────────

/** Upper-arm widths along the bone, [slumped, pumped]: the bicep peaks pumped and hangs soft deflated. */
const BICEP_SIDE: readonly (readonly [number, number])[] = [
  [0.052, 0.062],
  [0.048, 0.064],
  [0.046, 0.074],
  [0.042, 0.058],
  [0.036, 0.04],
];
const TRICEP_SIDE: readonly (readonly [number, number])[] = [
  [0.054, 0.064],
  [0.058, 0.064],
  [0.062, 0.06],
  [0.05, 0.05],
  [0.037, 0.04],
];
const DELT_OUTER: readonly (readonly [number, number])[] = [
  [0.06, 0.076],
  [0.054, 0.068],
  [0.048, 0.062],
  [0.042, 0.052],
  [0.036, 0.04],
];
const ARM_INNER: readonly (readonly [number, number])[] = [
  [0.044, 0.05],
  [0.05, 0.056],
  [0.054, 0.06],
  [0.046, 0.05],
  [0.036, 0.04],
];
const FOREARM_TOP = [0.04, 0.048, 0.042, 0.034, 0.028];
const FOREARM_UNDER = [0.04, 0.045, 0.038, 0.031, 0.027];
const DELT_RADIUS: readonly [number, number] = [0.046, 0.09];
const FIST_RADIUS = 0.042;
/** The armband sits over the bicep, this far down the upper arm. */
const ARMBAND_AT = 0.48;
const ARMBAND_HALF_LENGTH = 0.075;
/** The band is a thick cuff standing proud of the arm, so it survives an upper arm foreshortened toward the camera. */
const ARMBAND_BULK = 0.018;
const ARMBAND_SHADE_HALF = 0.12;
const ARMBAND_EDGE_WIDTH = 0.022;
const ARMBAND_EDGE_ALPHA = 0.9;

function widthsAt(table: readonly (readonly [number, number])[], breath: number): number[] {
  return table.map((pair) => lerp(pair[0], pair[1], breath));
}

function armParts(scene: Scene, side: -1 | 1, order: number, handOrder: number): Part[] {
  const { s, p, view } = scene;
  const chain = side === 1 ? s.rightArm : s.leftArm;
  const shoulder = p(chain.root);
  const elbow = p(chain.joint);
  const wrist = p(chain.end);
  const b = scene.breath;
  const profile = view === 'side';
  const outward = { x: scene.right2.x * side, y: scene.right2.y * side };
  const upperHint = profile ? scene.fwd2 : outward;
  const upper = limbOutline(
    shoulder,
    elbow,
    upperHint,
    widthsAt(profile ? BICEP_SIDE : DELT_OUTER, b),
    widthsAt(profile ? TRICEP_SIDE : ARM_INNER, b),
  );
  const fore = limbOutline(elbow, wrist, upperHint, FOREARM_TOP, FOREARM_UNDER);
  const deltR = lerp(DELT_RADIUS[0], DELT_RADIUS[1], b);
  const deltCentre = offsetPt(lerpPt(shoulder, elbow, 0.12), upper.lead, profile ? 0.004 : 0.012);
  const handShape = side === 1 ? scene.pose.rightHand : scene.pose.leftHand;
  const foreDir = unit({ x: wrist.x - elbow.x, y: wrist.y - elbow.y });
  const handCentre = offsetPt(wrist, foreDir, handShape === 'open' ? 0.05 : 0.03);

  const traceArm = (ctx: Ctx): void => {
    traceLimb(ctx, upper);
    ellipsePath(ctx, deltCentre, deltR, deltR * 0.95);
    traceLimb(ctx, fore);
  };
  const traceHand = (ctx: Ctx): void => {
    if (handShape === 'open') {
      ellipsePath(ctx, handCentre, 0.058, 0.036, Math.atan2(foreDir.y, foreDir.x));
    } else {
      ellipsePath(
        ctx,
        handCentre,
        FIST_RADIUS * 1.05,
        FIST_RADIUS * 0.95,
        Math.atan2(foreDir.y, foreDir.x),
      );
    }
  };

  const armPart: Part = {
    order,
    casts: order > 0,
    trace: traceArm,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceArm(ctx);
        },
        () => {
          ctx.fillStyle = SKIN.base;
          ctx.fillRect(shoulder.x - 1, shoulder.y - 1, 2, 2);
          cylinderShade(ctx, lerpPt(shoulder, elbow, 0.45), upper.lead, 0.08, SKIN, 1);
          const foreMid = lerpPt(elbow, wrist, 0.5);
          ctx.save();
          ctx.beginPath();
          traceLimb(ctx, fore);
          ctx.clip();
          cylinderShade(ctx, foreMid, fore.lead, 0.05, SKIN, 1);
          ctx.restore();
          fillSoftEllipse(
            ctx,
            deltCentre.x - 0.015,
            deltCentre.y - 0.02,
            deltR * 0.8,
            deltR * 0.6,
            SKIN.light,
            0.4 + 0.35 * b,
          );
          const peak = offsetPt(lerpPt(shoulder, elbow, 0.5), upper.lead, 0.025);
          fillSoftEllipse(
            ctx,
            peak.x - 0.008,
            peak.y - 0.008,
            0.03,
            0.05,
            SKIN.rim,
            0.55 * b * b,
            Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x) - Math.PI / 2,
          );
          const sag = offsetPt(lerpPt(shoulder, elbow, 0.55), upper.lead, -0.03);
          fillSoftEllipse(ctx, sag.x, sag.y + 0.015, 0.035, 0.05, SKIN.shadow, 0.45 * (1 - b));
          const deltLow = offsetPt(lerpPt(shoulder, elbow, 0.34), upper.lead, 0.0);
          groove(
            ctx,
            [offsetPt(deltLow, upper.lead, 0.05), deltLow, offsetPt(deltLow, upper.lead, -0.04)],
            SKIN.deep,
            0.012,
            0.25 + 0.5 * b,
          );
          fillSoftEllipse(ctx, elbow.x, elbow.y, 0.035, 0.03, SKIN.shadow, 0.35);
          // A band on each arm: the lance hand covers the right one head-on, and
          // the left is out of sight in profile, but one of them always shows.
          paintArmband(ctx, upper);
        },
      );
    },
  };

  const handPart: Part = {
    order: handOrder,
    casts: false,
    trace: traceHand,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceHand(ctx);
        },
        () => {
          ctx.fillStyle = SKIN.base;
          ctx.fillRect(handCentre.x - 0.2, handCentre.y - 0.2, 0.4, 0.4);
          fillSoftEllipse(
            ctx,
            handCentre.x - 0.015,
            handCentre.y - 0.02,
            0.035,
            0.03,
            SKIN.light,
            0.7,
          );
          fillSoftEllipse(
            ctx,
            handCentre.x + 0.02,
            handCentre.y + 0.025,
            0.04,
            0.03,
            SKIN.shadow,
            0.55,
          );
          if (handShape !== 'open') {
            const knuckles = offsetPt(handCentre, foreDir, 0.018);
            const acrossHand = perp(foreDir);
            groove(
              ctx,
              [offsetPt(knuckles, acrossHand, -0.028), offsetPt(knuckles, acrossHand, 0.028)],
              SKIN.deep,
              0.01,
              0.55,
            );
          }
        },
      );
    },
  };
  return [armPart, handPart];
}

function paintArmband(ctx: Ctx, upper: LimbOutline): void {
  const length = Math.hypot(upper.b.x - upper.a.x, upper.b.y - upper.a.y);
  const t0 = ARMBAND_AT - ARMBAND_HALF_LENGTH / Math.max(length, DEGENERATE);
  const t1 = ARMBAND_AT + ARMBAND_HALF_LENGTH / Math.max(length, DEGENERATE);
  const corners = [
    limbEdge(upper, t0, 1),
    limbEdge(upper, t1, 1),
    limbEdge(upper, t1, -1),
    limbEdge(upper, t0, -1),
  ];
  const band = corners.map((c, index) =>
    offsetPt(c, index < 2 ? upper.lead : { x: -upper.lead.x, y: -upper.lead.y }, ARMBAND_BULK),
  );
  ctx.save();
  ctx.beginPath();
  tracePolygon(ctx, band);
  ctx.fillStyle = ARMBAND;
  ctx.fill();
  ctx.clip();
  const mid = lerpPt(lerpPt(band[0], band[1], 0.5), lerpPt(band[2], band[3], 0.5), 0.5);
  cylinderShadeFlat(ctx, mid, upper.lead, ARMBAND_SHADE_HALF, ARMBAND_LIGHT, ARMBAND, ARMBAND);
  // Dark edges above and below the band: orange on sun-browned skin needs a
  // line to hold it apart at the tile.
  ctx.strokeStyle = rgba(ARMBAND_DARK, ARMBAND_EDGE_ALPHA);
  ctx.lineWidth = ARMBAND_EDGE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(band[0].x, band[0].y);
  ctx.lineTo(band[3].x, band[3].y);
  ctx.moveTo(band[1].x, band[1].y);
  ctx.lineTo(band[2].x, band[2].y);
  ctx.stroke();
  ctx.restore();
}

function cylinderShadeFlat(
  ctx: Ctx,
  centre: Pt,
  across: Pt,
  half: number,
  light: string,
  base: string,
  dark: string,
): void {
  const facing = across.x * LIGHT.x + across.y * LIGHT.y >= 0 ? 1 : -1;
  const g = ctx.createLinearGradient(
    centre.x + across.x * half * facing,
    centre.y + across.y * half * facing,
    centre.x - across.x * half * facing,
    centre.y - across.y * half * facing,
  );
  g.addColorStop(0, light);
  g.addColorStop(0.45, base);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fillRect(centre.x - 1, centre.y - 1, 2, 2);
}

// ── Head, helmet, beard ──────────────────────────────────────────────────────

/** Screen frame of the head: its centre, its up, and the way the face points across the screen. */
interface HeadFrame {
  readonly c: Pt;
  readonly up: Pt;
  readonly side: Pt;
  /** In profile, the face's direction; head-on, his right across the screen. */
  readonly faceSign: number;
}

function headFrame(scene: Scene): HeadFrame {
  const c = scene.p(scene.s.headCentre);
  const above = scene.p(add3(scene.s.headCentre, scale3(scene.s.headUp, 0.2)));
  const up = unit({ x: above.x - c.x, y: above.y - c.y });
  const side = { x: -up.y, y: up.x };
  const faceSign =
    scene.view === 'side' ? (side.x * scene.fwd2.x + side.y * scene.fwd2.y >= 0 ? 1 : -1) : 1;
  return { c, up, side, faceSign };
}

/** A point in head space: `u` across (toward the face in profile), `v` up, both in head radii. */
function headPoint(h: HeadFrame, u: number, v: number): Pt {
  return {
    x: h.c.x + h.side.x * u * h.faceSign * HEAD_RY + h.up.x * v * HEAD_RY,
    y: h.c.y + h.side.y * u * h.faceSign * HEAD_RY + h.up.y * v * HEAD_RY,
  };
}

function headAngle(h: HeadFrame): number {
  return Math.atan2(h.side.y, h.side.x);
}

const WIDTH_RATIO = HEAD_RX / HEAD_RY;
const DEPTH_RATIO = HEAD_DEPTH / HEAD_RY;

function traceSkull(ctx: Ctx, h: HeadFrame, view: DongView): void {
  const profile = view === 'side';
  const rx = (profile ? DEPTH_RATIO : WIDTH_RATIO) * HEAD_RY;
  ellipsePath(ctx, h.c, rx, HEAD_RY, headAngle(h));
  // From behind the jaw is hidden by the skull; drawn, its curve reads as a chin and the back of the head as a face.
  if (view === 'back') return;
  if (profile) {
    traceLoop(ctx, [
      headPoint(h, 0.72, 0.08),
      headPoint(h, 1.02, -0.02),
      headPoint(h, 1.16, -0.3),
      headPoint(h, 0.98, -0.46),
      headPoint(h, 0.78, -0.44),
      headPoint(h, 0.5, -0.2),
    ]);
    traceLoop(ctx, [
      headPoint(h, -0.35, -0.55),
      headPoint(h, 0.1, -1.08),
      headPoint(h, 0.62, -0.98),
      headPoint(h, 0.8, -0.5),
      headPoint(h, 0.2, 0),
    ]);
    return;
  }
  // The jaw holds its width down to the mouth and only then turns in to the chin.
  traceLoop(ctx, [
    headPoint(h, -0.7, -0.2),
    headPoint(h, -0.64, -0.74),
    headPoint(h, 0, -1.08),
    headPoint(h, 0.64, -0.74),
    headPoint(h, 0.7, -0.2),
    headPoint(h, 0, 0.1),
  ]);
}

function headPart(scene: Scene): Part {
  const h = headFrame(scene);
  const profile = scene.view === 'side';
  const back = scene.view === 'back';
  const trace = (ctx: Ctx): void => {
    traceSkull(ctx, h, scene.view);
    if (profile) {
      ellipsePath(ctx, headPoint(h, -0.12, -0.12), 0.2 * HEAD_RY, 0.28 * HEAD_RY, headAngle(h));
    } else {
      for (const u of [-0.74, 0.74])
        ellipsePath(ctx, headPoint(h, u, -0.1), 0.14 * HEAD_RY, 0.24 * HEAD_RY, headAngle(h));
    }
  };
  return {
    order: 0.3,
    casts: false,
    trace,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          ctx.fillStyle = SKIN.base;
          ctx.fillRect(h.c.x - 0.3, h.c.y - 0.3, 0.6, 0.6);
          cylinderShade(ctx, h.c, h.side, HEAD_RY, SKIN, 0.9);
          if (back) {
            return;
          }
          if (profile) {
            const cheek = headPoint(h, 0.3, -0.45);
            fillSoftEllipse(
              ctx,
              cheek.x,
              cheek.y,
              0.25 * HEAD_RY,
              0.25 * HEAD_RY,
              SKIN.shadow,
              0.55,
            );
            const socket = headPoint(h, 0.62, 0.02);
            fillSoftEllipse(
              ctx,
              socket.x,
              socket.y,
              0.2 * HEAD_RY,
              0.14 * HEAD_RY,
              SKIN.shadow,
              0.8,
            );
            const eye = headPoint(h, 0.68, 0.0);
            ctx.fillStyle = EYE_DARK;
            ctx.beginPath();
            ellipsePath(
              ctx,
              eye,
              0.08 * HEAD_RY,
              (0.07 - 0.06 * scene.pose.blink) * HEAD_RY + 0.002,
              headAngle(h),
            );
            ctx.fill();
            const nose = headPoint(h, 1.0, -0.2);
            fillSoftEllipse(
              ctx,
              nose.x - 0.01,
              nose.y - 0.01,
              0.1 * HEAD_RY,
              0.14 * HEAD_RY,
              SKIN.light,
              0.7,
            );
            const ear = headPoint(h, -0.12, -0.12);
            fillSoftEllipse(ctx, ear.x, ear.y, 0.1 * HEAD_RY, 0.16 * HEAD_RY, SKIN.shadow, 0.6);
            const sideburn = headPoint(h, -0.3, -0.42);
            fillSoftEllipse(
              ctx,
              sideburn.x,
              sideburn.y,
              0.16 * HEAD_RY,
              0.34 * HEAD_RY,
              WHITE.base,
              0.95,
              headAngle(h),
              0.7,
            );
            const backHair = headPoint(h, -0.78, -0.1);
            fillSoftEllipse(
              ctx,
              backHair.x,
              backHair.y,
              0.25 * HEAD_RY,
              0.55 * HEAD_RY,
              WHITE.base,
              1,
              headAngle(h),
              0.7,
            );
            const brow = headPoint(h, 0.62, 0.16);
            fillSoftEllipse(
              ctx,
              brow.x,
              brow.y,
              0.28 * HEAD_RY,
              0.1 * HEAD_RY,
              WHITE.light,
              1,
              headAngle(h) - 0.2,
              0.7,
            );
            return;
          }
          for (const u of [-0.32, 0.32]) {
            const socket = headPoint(h, u, 0.0);
            fillSoftEllipse(
              ctx,
              socket.x,
              socket.y,
              0.2 * HEAD_RY,
              0.15 * HEAD_RY,
              SKIN.shadow,
              0.85,
            );
            const eye = headPoint(h, u, -0.01);
            ctx.fillStyle = EYE_DARK;
            ctx.beginPath();
            ellipsePath(
              ctx,
              eye,
              0.085 * HEAD_RY,
              (0.075 - 0.065 * scene.pose.blink) * HEAD_RY + 0.002,
              headAngle(h),
            );
            ctx.fill();
            const cheek = headPoint(h, u * 1.6, -0.45);
            fillSoftEllipse(ctx, cheek.x, cheek.y, 0.14 * HEAD_RY, 0.3 * HEAD_RY, SKIN.shadow, 0.5);
          }
          const noseTop = headPoint(h, 0, 0.0);
          const noseTip = headPoint(h, 0, -0.42);
          groove(ctx, [noseTop, noseTip], SKIN.light, 0.022, 0.8);
          const nostrils = headPoint(h, 0.06, -0.47);
          fillSoftEllipse(
            ctx,
            nostrils.x,
            nostrils.y,
            0.2 * HEAD_RY,
            0.07 * HEAD_RY,
            SKIN.deep,
            0.7,
          );
          for (const u of [-1, 1]) {
            const brow = headPoint(h, u * 0.32, 0.16);
            fillSoftEllipse(
              ctx,
              brow.x,
              brow.y,
              0.26 * HEAD_RY,
              0.1 * HEAD_RY,
              WHITE.light,
              1,
              headAngle(h) + u * 0.25,
              0.7,
            );
          }
        },
      );
    },
  };
}

/** The beard's point hangs this far below the chin, down onto his sternum. */
const BEARD_LENGTH = 0.25;
/** Standing, the share of the head's own tilt the hanging beard follows. */
const BEARD_HEAD_FOLLOW = 0.4;

/**
 * From behind: long white hair falling from under the helmet to below the
 * nape, over the neck. It is the one thing that says "the old man with the
 * white beard" from the back; a short crop the width of the skull read as a
 * blindfold across the back of his head.
 */
function maneBehindPart(scene: Scene): Part {
  const h = headFrame(scene);
  // Full over the ears, tapering into uneven locks: a straight hem reads as a visor.
  const mane = [
    headPoint(h, -0.8, 0.45),
    headPoint(h, 0.8, 0.45),
    headPoint(h, 0.9, -0.1),
    headPoint(h, 0.72, -0.72),
    headPoint(h, 0.5, -1.22),
    headPoint(h, 0.3, -1.02),
    headPoint(h, 0.08, -1.34),
    headPoint(h, -0.14, -1.06),
    headPoint(h, -0.36, -1.26),
    headPoint(h, -0.62, -0.86),
    headPoint(h, -0.9, -0.1),
  ];
  const locks: readonly (readonly [number, number])[] = [
    [-0.5, 0.18],
    [-0.12, -0.1],
    [0.3, 0.12],
  ];
  const trace = (ctx: Ctx): void => traceLoop(ctx, mane);
  return {
    order: 0.33,
    casts: true,
    trace,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          ctx.fillStyle = MANE.base;
          ctx.fillRect(h.c.x - 0.4, h.c.y - 0.2, 0.8, 0.8);
          cylinderShade(ctx, headPoint(h, 0, -0.3), h.side, HEAD_RY * 0.9, MANE, 1);
          const sheen = headPoint(h, -0.3, 0.05);
          fillSoftEllipse(
            ctx,
            sheen.x,
            sheen.y,
            HEAD_RX * 0.35,
            HEAD_RY * 0.5,
            MANE.rim,
            0.7,
            headAngle(h) + 0.4,
          );
          const low = headPoint(h, 0.1, -1.0);
          fillSoftEllipse(ctx, low.x, low.y, HEAD_RX * 0.7, HEAD_RY * 0.3, MANE.shadow, 0.55);
          for (const [u, bend] of locks) {
            groove(
              ctx,
              [
                headPoint(h, u, 0.3),
                headPoint(h, u + bend, -0.35),
                headPoint(h, u - bend * 0.5, -1.0),
              ],
              MANE.deep,
              0.011,
              0.45,
            );
          }
          const top = headPoint(h, 0, 0.45);
          fillSoftEllipse(ctx, top.x, top.y, HEAD_RX, HEAD_RY * 0.14, STEEL.deep, 0.35);
        },
      );
    },
  };
}

function beardPart(scene: Scene): Part | null {
  if (scene.view === 'back') return maneBehindPart(scene);
  const h = headFrame(scene);
  const profile = scene.view === 'side';
  const swing = scene.pose.beardSwing;
  const beardDown = unit({ x: -h.up.x, y: -h.up.y });
  // Standing, the beard hangs by gravity straight down the screen whatever
  // his head does; once he is off his feet it lies along his body instead, or
  // on a man lying face-down it would stand straight through the floor.
  const upright = clamp01(-h.up.y);
  const hangDir = unit({
    x: lerp(beardDown.x, beardDown.x * BEARD_HEAD_FOLLOW, upright),
    y: lerp(beardDown.y, 1, upright),
  });
  const chinPt = headPoint(h, profile ? 0.55 : 0, -1.0);
  const tipBase = offsetPt(chinPt, hangDir, BEARD_LENGTH);
  const tip = { x: tipBase.x - swing * h.faceSign * (profile ? 1 : 0.3), y: tipBase.y };
  const mouthOpen = scene.pose.mouth;
  const trace = (ctx: Ctx): void => {
    if (profile) {
      const pts = [
        headPoint(h, -0.3, -0.35),
        headPoint(h, 0.35, -0.7),
        headPoint(h, 0.9, -0.62),
        headPoint(h, 0.92, -0.95),
        { x: tip.x + h.faceSign * 0.03, y: tip.y - 0.04 },
        tip,
        { x: tip.x - h.faceSign * 0.04, y: tip.y - 0.1 },
        headPoint(h, -0.2, -1.1),
      ];
      traceLoop(ctx, pts);
      const tuft = [
        headPoint(h, 0.7, -0.45),
        headPoint(h, 1.0, -0.52),
        headPoint(h, 0.95, -0.72),
        headPoint(h, 0.55, -0.62),
      ];
      traceLoop(ctx, tuft);
      return;
    }
    const pts = [
      headPoint(h, -0.72, -0.25),
      headPoint(h, -0.78, -0.75),
      { x: tip.x - 0.05, y: tip.y - 0.12 },
      tip,
      { x: tip.x + 0.05, y: tip.y - 0.12 },
      headPoint(h, 0.78, -0.75),
      headPoint(h, 0.72, -0.25),
      headPoint(h, 0.35, -0.62),
      headPoint(h, 0, -0.5),
      headPoint(h, -0.35, -0.62),
    ];
    traceLoop(ctx, pts);
    for (const u of [-1, 1]) {
      traceLoop(ctx, [
        headPoint(h, 0, -0.46),
        headPoint(h, u * 0.5, -0.52),
        headPoint(h, u * 0.66, -0.86),
        headPoint(h, u * 0.4, -0.66),
        headPoint(h, u * 0.05, -0.6),
      ]);
    }
  };
  return {
    order: 0.35,
    casts: true,
    trace,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          ctx.fillStyle = WHITE.base;
          ctx.fillRect(h.c.x - 0.4, h.c.y - 0.2, 0.8, 0.8);
          cylinderShade(ctx, lerpPt(chinPt, tip, 0.4), h.side, 0.12, WHITE, 1);
          for (const u of [-0.3, 0, 0.3]) {
            const from = headPoint(h, (profile ? 0.3 : 0) + u, -0.75);
            const to = { x: lerp(tip.x, from.x, 0.4), y: lerp(tip.y, from.y, 0.25) };
            groove(ctx, [from, lerpPt(from, to, 0.5), to], WHITE.shadow, 0.01, 0.55);
          }
          const high = headPoint(h, profile ? 0.5 : -0.2, -0.75);
          fillSoftEllipse(ctx, high.x, high.y, 0.06, 0.05, WHITE.rim, 0.8);
        },
      );
      if (mouthOpen > 0.05) {
        const mouth = headPoint(h, profile ? 0.75 : 0, -0.72);
        ctx.fillStyle = MOUTH_INNER;
        ctx.beginPath();
        ellipsePath(
          ctx,
          mouth,
          (profile ? 0.12 : 0.22) * HEAD_RY,
          0.2 * HEAD_RY * mouthOpen,
          headAngle(h),
        );
        ctx.fill();
      }
    },
  };
}

/**
 * The morion: a steel dome with a tall comb, and a brim that sweeps up into a
 * point fore and aft. In profile it is the boat-shaped crescent that says
 * "conquistador" before anything else does; head-on it is a dome with a fin,
 * its front point rising over the brow and its brim drooping at the sides.
 */
function helmetPart(scene: Scene): Part {
  const h = headFrame(scene);
  const profile = scene.view === 'side';
  const trace = (ctx: Ctx): void => {
    if (profile) {
      traceLoop(ctx, [
        headPoint(h, -0.95, 0.2),
        headPoint(h, -0.9, 0.75),
        headPoint(h, -0.3, 1.18),
        headPoint(h, 0.4, 1.16),
        headPoint(h, 0.95, 0.72),
        headPoint(h, 0.95, 0.2),
      ]);
      traceLoop(ctx, [
        headPoint(h, -0.8, 0.8),
        headPoint(h, -0.55, 1.52),
        headPoint(h, 0.1, 1.82),
        headPoint(h, 0.62, 1.48),
        headPoint(h, 0.8, 0.8),
        headPoint(h, 0, 1.05),
      ]);
      traceLoop(ctx, [
        headPoint(h, -1.6, 0.98),
        headPoint(h, -1.2, 0.35),
        headPoint(h, 0, 0.12),
        headPoint(h, 1.2, 0.35),
        headPoint(h, 1.6, 0.98),
        headPoint(h, 1.1, 0.55),
        headPoint(h, 0, 0.38),
        headPoint(h, -1.1, 0.55),
      ]);
      return;
    }
    const w = WIDTH_RATIO;
    traceLoop(ctx, [
      headPoint(h, -w * 1.02, 0.25),
      headPoint(h, -w * 0.95, 0.85),
      headPoint(h, 0, 1.2),
      headPoint(h, w * 0.95, 0.85),
      headPoint(h, w * 1.02, 0.25),
    ]);
    traceLoop(ctx, [
      headPoint(h, -0.15, 1.0),
      headPoint(h, -0.13, 1.62),
      headPoint(h, 0, 1.82),
      headPoint(h, 0.13, 1.62),
      headPoint(h, 0.15, 1.0),
    ]);
    traceLoop(ctx, [
      headPoint(h, -w * 1.95, 0.46),
      headPoint(h, -w * 1.1, 0.34),
      headPoint(h, 0, 0.82),
      headPoint(h, w * 1.1, 0.34),
      headPoint(h, w * 1.95, 0.46),
      headPoint(h, w * 1.5, 0.18),
      headPoint(h, w * 1.1, 0.12),
      headPoint(h, 0, 0.44),
      headPoint(h, -w * 1.1, 0.12),
      headPoint(h, -w * 1.5, 0.18),
    ]);
  };
  return {
    order: 0.4,
    casts: true,
    trace,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          trace(ctx);
        },
        () => {
          ctx.fillStyle = STEEL.base;
          ctx.fillRect(h.c.x - 0.4, h.c.y - 0.4, 0.8, 0.8);
          cylinderShade(ctx, headPoint(h, 0, 0.8), h.side, HEAD_RY * 1.3, STEEL, 1);
          const shine = headPoint(h, profile ? -0.3 : -0.35, 0.9);
          fillSoftEllipse(
            ctx,
            shine.x,
            shine.y,
            0.14 * HEAD_RY,
            0.28 * HEAD_RY,
            STEEL.rim,
            0.95,
            headAngle(h) + 0.5,
            0.45,
          );
          const band = headPoint(h, 0, 0.45);
          fillSoftEllipse(
            ctx,
            band.x,
            band.y,
            1.2 * HEAD_RY,
            0.12 * HEAD_RY,
            STEEL.shadow,
            0.55,
            headAngle(h),
          );
          const combLight = headPoint(h, profile ? -0.2 : -0.04, 1.45);
          fillSoftEllipse(
            ctx,
            combLight.x,
            combLight.y,
            0.2 * HEAD_RY,
            0.12 * HEAD_RY,
            STEEL.light,
            0.8,
            headAngle(h),
          );
        },
      );
      const lipA = headPoint(h, profile ? -1.2 : -WIDTH_RATIO * 1.75, profile ? 0.38 : 0.24);
      const lipB = headPoint(h, 0, profile ? 0.16 : 0.78);
      const lipC = headPoint(h, profile ? 1.2 : WIDTH_RATIO * 1.75, profile ? 0.38 : 0.24);
      groove(ctx, [lipA, lipB, lipC], STEEL.rim, profile ? 0.012 : 0.016, profile ? 0.5 : 0.8);
    },
  };
}

// ── The lance ────────────────────────────────────────────────────────────────

function lanceParts(scene: Scene, order: number): Part[] {
  const { s, view } = scene;
  const butt = scene.p(s.lanceButt);
  const d = projectPropDirection(s.lanceDir, view, s.lanceHeld);
  const along = (k: number): Pt => ({ x: butt.x + d.x * k, y: butt.y + d.y * k });
  const screenLength = Math.hypot(d.x, d.y);
  const axis = unit(d);
  const across = perp(axis);
  const gripAlong = Math.hypot(
    s.lanceGrip.x - s.lanceButt.x,
    s.lanceGrip.y - s.lanceButt.y,
    s.lanceGrip.z - s.lanceButt.z,
  );
  const tipStart = LANCE_LENGTH - LANCE_POINT_LENGTH;
  const shaftWidth = (k: number): number => {
    if (k <= gripAlong)
      return lerp(LANCE_BUTT_RADIUS, LANCE_GRIP_RADIUS, k / Math.max(gripAlong, DEGENERATE));
    return lerp(
      LANCE_GRIP_RADIUS,
      LANCE_TIP_RADIUS,
      (k - gripAlong) / Math.max(tipStart - gripAlong, DEGENERATE),
    );
  };
  const SHAFT_SAMPLES = 6;
  const traceShaft = (ctx: Ctx): void => {
    const ks = Array.from(
      { length: SHAFT_SAMPLES },
      (_unused, i) => (tipStart * i) / (SHAFT_SAMPLES - 1),
    );
    const left = ks.map((k) => offsetPt(along(k), across, shaftWidth(k)));
    const right = ks.map((k) => offsetPt(along(k), across, -shaftWidth(k)));
    tracePolygon(ctx, [...left, ...right.reverse()]);
    ellipsePath(ctx, along(0), LANCE_BUTT_RADIUS * 1.25, LANCE_BUTT_RADIUS * 1.25);
  };
  const tipBase = along(tipStart);
  const tip = along(LANCE_LENGTH);
  const tracePoint = (ctx: Ctx): void => {
    const shoulderPt = offsetPt(tipBase, axis, LANCE_POINT_LENGTH * 0.35 * screenLength);
    tracePolygon(ctx, [
      offsetPt(tipBase, across, LANCE_TIP_RADIUS),
      offsetPt(shoulderPt, across, LANCE_POINT_HALF),
      tip,
      offsetPt(shoulderPt, across, -LANCE_POINT_HALF),
      offsetPt(tipBase, across, -LANCE_TIP_RADIUS),
    ]);
  };
  // The vamplate: a steel cone opening back toward the hand. Its rim is a
  // circle round the shaft, so it is an ellipse whose narrow axis runs along
  // the shaft by how far the lance points at the camera.
  const toward = Math.abs(depthOf(s.lanceDir, view));
  const rimCentre = along(gripAlong + VAMPLATE_SET_BACK);
  const coneTip = along(gripAlong + VAMPLATE_SET_BACK + VAMPLATE_LENGTH);
  const rimAcross = VAMPLATE_RADIUS;
  const rimAlong = Math.max(0.012, VAMPLATE_RADIUS * toward);
  const traceVamplate = (ctx: Ctx): void => {
    const angle = Math.atan2(axis.y, axis.x);
    tracePolygon(ctx, [
      offsetPt(rimCentre, across, rimAcross),
      offsetPt(coneTip, across, LANCE_GRIP_RADIUS),
      offsetPt(coneTip, across, -LANCE_GRIP_RADIUS),
      offsetPt(rimCentre, across, -rimAcross),
    ]);
    ellipsePath(ctx, rimCentre, rimAlong, rimAcross, angle);
  };
  const hoistTop = along(LANCE_LENGTH - PENNON_FROM_TIP);
  const hoistLow = along(LANCE_LENGTH - PENNON_FROM_TIP - PENNON_HOIST);
  // The pennon streams behind him as he moves: straight back off an upright
  // lance, back along the shaft off one levelled at the foe. With no wind it
  // hangs from the shaft.
  const behind = unit(projectPropDirection(v3(0, 0, -1), view));
  const levelled = Math.abs(s.lanceDir.z);
  const streaming = unit({
    x: lerp(behind.x, -axis.x, levelled),
    y: lerp(behind.y, -axis.y, levelled) - PENNON_RISE * levelled,
  });
  const lift = scene.pose.pennonLift;
  const hanging = unit({ x: -axis.x * PENNON_HANG_ALONG, y: 1 });
  const fly = unit({
    x: lerp(hanging.x, streaming.x, lift),
    y: lerp(hanging.y, streaming.y, lift),
  });
  const phase = scene.pose.pennonPhase;
  const wave = (k: number): number => Math.sin(phase + k * Math.PI * 1.6) * PENNON_WAVE * k;
  const flyPerp = perp(fly);
  const flag = (k: number, from: Pt): Pt =>
    offsetPt(offsetPt(from, fly, PENNON_FLY * k), flyPerp, wave(k));
  const tracePennon = (ctx: Ctx): void => {
    const topEnd = flag(1, hoistTop);
    const lowEnd = flag(1, hoistLow);
    const notch = flag(1 - PENNON_NOTCH / PENNON_FLY, lerpPt(hoistTop, hoistLow, 0.5));
    tracePolygon(ctx, [
      hoistTop,
      flag(PENNON_MID, hoistTop),
      topEnd,
      notch,
      lowEnd,
      flag(PENNON_MID, hoistLow),
      hoistLow,
    ]);
  };

  const shaftPart: Part = {
    order,
    casts: order > 0,
    trace: (ctx) => {
      traceShaft(ctx);
      tracePoint(ctx);
      tracePennon(ctx);
    },
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceShaft(ctx);
        },
        () => {
          ctx.fillStyle = WOOD.base;
          ctx.fillRect(
            Math.min(butt.x, tip.x) - 0.2,
            Math.min(butt.y, tip.y) - 0.2,
            Math.abs(tip.x - butt.x) + 0.4,
            Math.abs(tip.y - butt.y) + 0.4,
          );
          const litFirst = across.x * LIGHT.x + across.y * LIGHT.y >= 0;
          const far = along(LANCE_LENGTH + 0.1);
          const near = along(-0.1);
          paintAlongShaft(
            ctx,
            near,
            far,
            across,
            [WOOD.light, WOOD.base, WOOD.dark, WOOD.shadow],
            litFirst,
          );
          const wrapFrom = along(gripAlong - 0.14);
          const wrapTo = along(gripAlong + 0.03);
          ctx.strokeStyle = BOOT.dark;
          ctx.lineWidth = LANCE_GRIP_RADIUS * 2.4;
          ctx.beginPath();
          ctx.moveTo(wrapFrom.x, wrapFrom.y);
          ctx.lineTo(wrapTo.x, wrapTo.y);
          ctx.stroke();
          fillSoftEllipse(
            ctx,
            along(0).x,
            along(0).y,
            LANCE_BUTT_RADIUS * 1.2,
            LANCE_BUTT_RADIUS * 1.2,
            STEEL.mid,
            1,
            0,
            0.7,
          );
        },
      );
      ctx.save();
      ctx.beginPath();
      tracePennon(ctx);
      ctx.fillStyle = PENNON_RED;
      ctx.fill();
      ctx.clip();
      const stripeA = flag(0.2, lerpPt(hoistTop, hoistLow, 0.5));
      const stripeB = flag(1.2, lerpPt(hoistTop, hoistLow, 0.5));
      ctx.strokeStyle = PENNON_GOLD;
      ctx.lineWidth = PENNON_HOIST * 0.34;
      ctx.beginPath();
      ctx.moveTo(lerpPt(hoistTop, hoistLow, 0.5).x, lerpPt(hoistTop, hoistLow, 0.5).y);
      ctx.quadraticCurveTo(stripeA.x, stripeA.y, stripeB.x, stripeB.y);
      ctx.stroke();
      const shade = flag(0.7, hoistLow);
      fillSoftEllipse(
        ctx,
        shade.x,
        shade.y,
        0.12,
        0.05,
        PENNON_RED_DARK,
        0.5,
        Math.atan2(fly.y, fly.x),
      );
      ctx.restore();
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          tracePoint(ctx);
        },
        () => {
          ctx.fillStyle = STEEL.base;
          ctx.fillRect(tip.x - 0.3, tip.y - 0.3, 0.6, 0.6);
          cylinderShade(
            ctx,
            along(LANCE_LENGTH - LANCE_POINT_LENGTH * 0.5),
            across,
            LANCE_POINT_HALF,
            STEEL,
            1,
          );
          fillSoftEllipse(
            ctx,
            tip.x - axis.x * 0.05,
            tip.y - axis.y * 0.05,
            0.015,
            0.04,
            STEEL.rim,
            0.9,
            Math.atan2(axis.y, axis.x) + Math.PI / 2,
          );
        },
      );
    },
  };

  const vamplatePart: Part = {
    order: order + 0.01,
    casts: true,
    trace: traceVamplate,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceVamplate(ctx);
        },
        () => {
          ctx.fillStyle = STEEL.base;
          ctx.fillRect(rimCentre.x - 0.3, rimCentre.y - 0.3, 0.6, 0.6);
          cylinderShade(ctx, lerpPt(rimCentre, coneTip, 0.3), across, VAMPLATE_RADIUS, STEEL, 1);
          const glint = offsetPt(
            rimCentre,
            across,
            VAMPLATE_RADIUS * 0.5 * (across.x * LIGHT.x + across.y * LIGHT.y >= 0 ? 1 : -1),
          );
          fillSoftEllipse(ctx, glint.x, glint.y, 0.02, 0.03, STEEL.rim, 0.9);
          if (toward > 0.3) {
            ctx.strokeStyle = rgba(STEEL.deep, 0.7);
            ctx.lineWidth = 0.012;
            ctx.beginPath();
            ellipsePath(
              ctx,
              rimCentre,
              rimAlong * 0.7,
              rimAcross * 0.7,
              Math.atan2(axis.y, axis.x),
            );
            ctx.stroke();
          }
        },
      );
    },
  };
  return [shaftPart, vamplatePart];
}

/** Paints bands along the shaft, lit side to shadow side, as parallel strokes. */
function paintAlongShaft(
  ctx: Ctx,
  near: Pt,
  far: Pt,
  across: Pt,
  stops: readonly string[],
  litFirst: boolean,
): void {
  const ordered = litFirst ? stops : [...stops].reverse();
  const bands = ordered.length;
  const bandWidth = (LANCE_GRIP_RADIUS * 2.4) / bands;
  ordered.forEach((color, index) => {
    const offset = LANCE_GRIP_RADIUS * 1.2 - bandWidth * (index + 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = bandWidth * 1.15;
    ctx.beginPath();
    ctx.moveTo(offsetPt(near, across, offset).x, offsetPt(near, across, offset).y);
    ctx.lineTo(offsetPt(far, across, offset).x, offsetPt(far, across, offset).y);
    ctx.stroke();
  });
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * How far past the body a hand must reach before its arm is drawn on the far
 * side of the torso head-on. Large, so the walking swing never crosses it:
 * which side an arm is drawn on must not flip mid-stride.
 */
const ARM_BEHIND_REACH = 0.26;
/** A lance whose middle is this far past his body, away from the camera, is drawn behind him. */
const LANCE_BEHIND_REACH = 0.05;

function partsFor(scene: Scene, withLance: boolean): Part[] {
  const { view, s } = scene;
  const parts: Part[] = [];
  const nearness = (v: V3): number => projectPoint(v, view).depth;
  const hipDepth = nearness(s.hip);

  if (view === 'side') {
    parts.push(...armParts(scene, -1, -3, -2.9));
    parts.push(...legParts(scene, -1, -2));
    parts.push(...legParts(scene, 1, 0.05));
  } else {
    const legs: (-1 | 1)[] = [-1, 1];
    legs.sort(
      (a, b) =>
        nearness((a === 1 ? s.rightLeg : s.leftLeg).end) -
        nearness((b === 1 ? s.rightLeg : s.leftLeg).end),
    );
    legs.forEach((side, index) => parts.push(...legParts(scene, side, -2 + index * 0.1)));
  }
  parts.push(torsoPart(scene));
  parts.push(shortsPart(scene));
  parts.push(vestPart(scene));
  parts.push(neckPart(scene));
  parts.push(headPart(scene));
  const beard = beardPart(scene);
  if (beard !== null) parts.push(beard);
  parts.push(helmetPart(scene));

  const handAhead = (chain: Chain): number => nearness(chain.end) - hipDepth;
  if (view === 'side') {
    parts.push(...armParts(scene, 1, 1, 1.2));
  } else {
    for (const side of [-1, 1] as const) {
      const chain = side === 1 ? s.rightArm : s.leftArm;
      const behind = handAhead(chain) < -ARM_BEHIND_REACH;
      const base = behind ? -3 : 1 + nearness(chain.end) * 0.01;
      parts.push(...armParts(scene, side, base, side === 1 ? (behind ? -2.95 : 1.2) : base + 0.05));
    }
  }
  const lanceMid = mix3(s.lanceButt, s.lanceTip, 0.5);
  const lanceBehind = view !== 'side' && nearness(lanceMid) - hipDepth < -LANCE_BEHIND_REACH;
  if (withLance) parts.push(...lanceParts(scene, lanceBehind ? -3.5 : 1.1));
  return parts.sort((a, b) => a.order - b.order);
}

function paintGroundShadow(ctx: Ctx, scene: Scene): void {
  const feet = [scene.s.leftHeel, scene.s.rightHeel, scene.s.leftToe, scene.s.rightToe];
  const lowest = Math.max(...feet.map((f) => f.y));
  const lift = clamp01(-lowest * 4);
  const centreX = scene.p(v3(scene.s.hip.x, 0, scene.s.hip.z)).x;
  const toppledFar = scene.pose.topple === null ? 0 : Math.abs(Math.sin(scene.pose.topple.angle));
  fillSoftEllipse(
    ctx,
    centreX,
    0,
    GROUND_SHADOW_RX * (1 + toppledFar * 1.6) * (1 - lift * 0.4),
    GROUND_SHADOW_RY,
    '#000000',
    GROUND_SHADOW_ALPHA * (1 - lift * 0.5),
    0,
    0.35,
  );
}

/**
 * Paints Dong Quixote in figure space (tile units, origin on the floor
 * between his feet). The caller sets the transform.
 *
 * The cast shadows composite `source-atop`, so they land only on what is
 * already painted — which is why the painter has to be given a surface of its
 * own: the figure cache always paints into an isolated cell.
 */
/** What a paint leaves out, for a gate that measures his body alone. */
export interface DongPaintOptions {
  /** False paints him without the lance and its pennon. */
  readonly lance?: boolean;
}

export function drawDongQuixote(
  ctx: Ctx,
  pose: DongPose,
  view: DongView,
  options: DongPaintOptions = {},
): void {
  const scene = sceneFor(pose, view);
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  try {
    paintGroundShadow(ctx, scene);
    const parts = partsFor(scene, options.lance ?? true);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(OUTLINE, OUTLINE_ALPHA);
    ctx.fillStyle = rgba(OUTLINE, OUTLINE_ALPHA);
    ctx.lineWidth = OUTLINE_WIDTH;
    for (const part of parts) {
      ctx.beginPath();
      part.trace(ctx);
      ctx.stroke();
      ctx.fill();
    }
    for (const part of parts) {
      if (part.casts) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = baseAlpha * CAST_ALPHA;
        ctx.translate(CAST_OFFSET.x, CAST_OFFSET.y);
        ctx.fillStyle = CAST_TONE;
        ctx.beginPath();
        part.trace(ctx);
        ctx.fill();
        ctx.restore();
      }
      part.paint(ctx);
    }
  } finally {
    ctx.restore();
  }
}

/** The skeleton as it is drawn in a view, for gates and anchors. */
export function projectedSkeleton(
  pose: DongPose,
  view: DongView,
): { skeleton: Skeleton; at: (v: V3) => P2 } {
  const skeleton = buildSkeleton(pose);
  return { skeleton, at: (v) => projectPoint(v, view) };
}
