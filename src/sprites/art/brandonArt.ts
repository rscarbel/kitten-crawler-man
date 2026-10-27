/**
 * Brandon's painter: the Cloak & Dagger's host, a tall seventy-year-old with
 * white hair swept back and a long white beard, in a dark waistcoat over linen
 * shirt sleeves, dark trousers and polished black shoes.
 *
 * The rig is solved in three dimensions and projected into each of the three
 * views, so one pose describes him from the front, from behind and in profile.
 * `x` is his own right, `y` runs down (heights are negative), `z` is the way
 * he faces; the origin is on the floor between his feet, in tile units. The
 * front view reflects him (his right hand is on the viewer's left) because it
 * is a projection of the same body seen from the other side, not a mirrored
 * picture, so his akimbo hand never changes sides when he turns round.
 *
 * His signature is the breath: `BrandonPose.breath` runs from 1, chest
 * puffed out, to 0, where the chest sags into the belly, the shoulders narrow and
 * drop and the arms go soft. It is carried by the silhouette first — the V of
 * the torso head-on, the chest and the paunch in profile — because interior
 * banding alone does not survive the 32 px tile.
 *
 * Knows nothing about animation; `brandonFigure.ts` choreographs him.
 */

import { type Pt, clamp01, easeInOut, lerp, mix, rgba } from './bipedArt';
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
 * Sole to the crown of the skull, in his figure units (a tile of the human rig
 * at its own size). The human rig is 2.03 units drawn at 0.72 of a tile, about
 * 1.46 of these; Brandon stands a head taller, so he is visibly the bigger man
 * beside the crawler.
 */
export const FIGURE_HEIGHT = 1.78;
/**
 * A tall, lean-limbed old man is more heads tall than the biped figure's 5.5: size is read
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

// ── Views ────────────────────────────────────────────────────────────────────

export type BrandonView = 'front' | 'side' | 'back';

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

export function projectPoint(p: V3, view: BrandonView): P2 {
  switch (view) {
    case 'side':
      return { x: p.z + p.x * PROFILE_LATERAL_SKEW, y: p.y, depth: p.x };
    case 'front':
      return { x: -p.x, y: p.y + p.z * floorShareAt(-p.y), depth: p.z };
    case 'back':
      return { x: p.x, y: p.y - p.z * floorShareAt(-p.y), depth: -p.z };
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
  | {
      readonly kind: 'reach';
      readonly hand: V3;
      /** Which way the elbow breaks, for a reach the default back-and-out bend would fold wrongly. */
      readonly pole?: V3;
    }
  | { readonly kind: 'angles'; readonly angles: ArmAngles };

/** `blade` is a flat hand seen edge-on, the fingers together, as in a salute. */
export type HandShape = 'fist' | 'grip' | 'open' | 'blade';

export interface FootPose {
  /** The ankle joint. */
  readonly ankle: V3;
  /** Toe up is positive. */
  readonly pitch: number;
  readonly planted: boolean;
}

export interface BrandonPose {
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
  /** 0 shut, 1 a shout. */
  mouth: number;
  /** 0 open, 1 shut. */
  blink: number;
  /** The beard's point trailing behind (+), in tile units. */
  beardSwing: number;
}

/** He stands tall with his feet a little apart and his hands at his sides. */
export function restingPose(): BrandonPose {
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
    rightArm: { kind: 'reach', hand: RESTING_RIGHT_HAND },
    leftHand: 'fist',
    rightHand: 'fist',
    mouth: 0,
    blink: 0,
    beardSwing: 0,
  };
}

/** Half the distance between his ankles standing. */
export const STANCE_HALF = 0.1;
/** His right hand hanging loose at his side, a little forward of the seam of his shorts. */
export const RESTING_RIGHT_HAND: V3 = v3(0.29, -0.9, 0.06);

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

export function buildSkeleton(pose: BrandonPose): Skeleton {
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
          pose.leftArm.pole ?? v3(-ELBOW_POLE.x, ELBOW_POLE.y, ELBOW_POLE.z),
        );
  const rightArm =
    pose.rightArm.kind === 'angles'
      ? armFromAngles(rightShoulder, 1, pose.rightArm.angles)
      : solveTwoBone(
          rightShoulder,
          pose.rightArm.hand,
          UPPER_ARM_LENGTH,
          FOREARM_LENGTH,
          pose.rightArm.pole ?? ELBOW_POLE,
        );
  const leftFootPts = footPoints(pose.leftFoot);
  const rightFootPts = footPoints(pose.rightFoot);

  return {
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
    breath,
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
/** His hair: a warmer white than the beard, so a head of it never reads as grey steel. */
const HAIR: Ramp = {
  deep: '#5a5048',
  shadow: '#8a8076',
  dark: '#aca298',
  mid: '#cbc3b8',
  base: '#e2dbd0',
  light: '#f2ece2',
  rim: '#fffaf2',
};
/** The waistcoat's back: satin a shade lighter than its front, the traditional back of a dress waistcoat. */
const SATIN_BACK: Ramp = {
  deep: '#110e14',
  shadow: '#1b1620',
  dark: '#262029',
  mid: '#312a36',
  base: '#3e3545',
  light: '#5c5166',
  rim: '#7d7288',
};
/** The shirt under the waistcoat: warm beige linen, a clear step darker than the white of his beard. */
const SHIRT: Ramp = {
  deep: '#55463c',
  shadow: '#83725f',
  dark: '#a49379',
  mid: '#bfae92',
  base: '#d3c3a6',
  light: '#e5d8bf',
  rim: '#f6eedc',
};
/** The waistcoat: a near-black charcoal with a warm cast, dark enough to frame the linen. */
const WAISTCOAT: Ramp = {
  deep: '#0d0a0e',
  shadow: '#171219',
  dark: '#211a23',
  mid: '#2c232e',
  base: '#382d3a',
  light: '#54465a',
  rim: '#77677c',
};
/** His trousers: a charcoal a shade cooler and lighter than the waistcoat, so the hem of it still reads. */
const TROUSERS: Ramp = {
  deep: '#0e0f13',
  shadow: '#17181e',
  dark: '#202229',
  mid: '#2a2c35',
  base: '#353845',
  light: '#4f5363',
  rim: '#6f7486',
};
/** Polished black shoes. */
const SHOE: Ramp = {
  deep: '#060506',
  shadow: '#0e0c0f',
  dark: '#17141a',
  mid: '#211d24',
  base: '#2b2630',
  light: '#4a4352',
  rim: '#8a8296',
};
/** Brass buttons down the waistcoat's front. */
const BUTTON = '#d2a24a';
const BUTTON_DARK = '#7a5a20';
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
  readonly view: BrandonView;
  readonly s: Skeleton;
  readonly pose: BrandonPose;
  readonly p: (v: V3) => P2;
  /** Screen direction of his own forward, for the anterior side of a limb. */
  readonly fwd2: Pt;
  /** Screen direction of his own right. */
  readonly right2: Pt;
  readonly up2: Pt;
  readonly breath: number;
}

function sceneFor(pose: BrandonPose, view: BrandonView): Scene {
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

// ── Legs and shoes ───────────────────────────────────────────────────────────

const THIGH_FRONT = [0.084, 0.086, 0.078, 0.064, 0.05];
const THIGH_BACK = [0.08, 0.08, 0.07, 0.058, 0.047];
const THIGH_OUTER = [0.086, 0.08, 0.07, 0.058, 0.046];
const THIGH_INNER = [0.07, 0.066, 0.058, 0.05, 0.043];
const SHIN_FRONT = [0.046, 0.042, 0.037, 0.033, 0.031];
const SHIN_CALF = [0.048, 0.064, 0.058, 0.043, 0.033];
const SHIN_OUTER = [0.047, 0.058, 0.052, 0.04, 0.033];
const SHIN_INNER = [0.044, 0.052, 0.047, 0.038, 0.031];
/** Trouser legs hang a little clear of the leg inside them. */
const TROUSER_BULK = 0.014;
/** The pressed crease down the front of each trouser leg. */
const TROUSER_CREASE_WIDTH = 0.012;
const TROUSER_CREASE_ALPHA = 0.5;

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
  const loose = (widths: readonly number[]): number[] => widths.map((w) => w + TROUSER_BULK);
  const thigh = limbOutline(
    hip,
    knee,
    thighHint,
    loose(profile ? THIGH_FRONT : THIGH_OUTER),
    loose(profile ? THIGH_BACK : THIGH_INNER),
  );
  const shinHint = profile ? scene.fwd2 : outward;
  const shin = limbOutline(
    knee,
    ankle,
    shinHint,
    loose(profile ? SHIN_FRONT : SHIN_OUTER),
    loose(profile ? SHIN_CALF : SHIN_INNER),
  );

  const traceShoe = (ctx: Ctx): void => {
    if (profile) {
      const along = unit({ x: toe.x - heel.x, y: toe.y - heel.y });
      const upFoot = perp(along);
      const lift = upFoot.y < 0 ? upFoot : { x: -upFoot.x, y: -upFoot.y };
      const instep = offsetPt(lerpPt(heel, toe, 0.45), lift, 0.075);
      const toeTop = offsetPt(lerpPt(heel, toe, 0.86), lift, 0.045);
      const heelTop = offsetPt(heel, lift, 0.075);
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
    // Head-on the shoe is seen toe-on: a rounded block widening to the sole.
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
              Math.max(...widths) + TROUSER_BULK,
              TROUSERS,
              1,
            );
            groove(
              ctx,
              [offsetPt(limb.a, limb.lead, 0.01), offsetPt(limb.b, limb.lead, 0.01)],
              TROUSERS.light,
              TROUSER_CREASE_WIDTH,
              TROUSER_CREASE_ALPHA,
            );
          },
        );
      };
      leg(thigh, profile ? THIGH_FRONT : THIGH_OUTER);
      leg(shin, profile ? SHIN_CALF : SHIN_OUTER);
    },
  };

  const shoePart: Part = {
    order: order + 0.01,
    casts: false,
    trace: traceShoe,
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceShoe(ctx);
        },
        () => {
          ctx.fillStyle = SHOE.base;
          ctx.fillRect(ankle.x - 1, ankle.y - 1, 2, 2);
          cylinderShade(ctx, lerpPt(ankle, toe, 0.5), shin.lead, 0.07, SHOE, 1);
          ctx.fillStyle = SHOE.deep;
          const soleY = Math.max(heel.y, toe.y);
          ctx.fillRect(
            Math.min(heel.x, toe.x) - 0.1,
            soleY - 0.022,
            Math.abs(toe.x - heel.x) + 0.2,
            0.05,
          );
          fillSoftEllipse(
            ctx,
            toe.x - (profile ? 0.05 : 0),
            toe.y - 0.05,
            0.04,
            0.025,
            SHOE.rim,
            0.7,
          );
        },
      );
    },
  };
  return [legPart, shoePart];
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
 * Head-on, pumped he is a V: shoulders flared wider than anything below them.
 * Slumped the shoulders fold in and the waist widens — a pear. In profile the
 * waistcoat holds his shape, so front and back barely move with the breath:
 * a buttoned waistcoat over a paunch that came and went would read as a lump.
 */
const TORSO_LEVELS: readonly TorsoLevel[] = [
  { rise: -0.08, half: [0.13, 0.122], front: [0.08, 0.075], back: [0.1, 0.1] },
  { rise: 0.02, half: [0.165, 0.142], front: [0.105, 0.097], back: [0.12, 0.12] },
  { rise: 0.12, half: [0.205, 0.13], front: [0.125, 0.115], back: [0.096, 0.095] },
  { rise: 0.21, half: [0.21, 0.128], front: [0.13, 0.12], back: [0.086, 0.085] },
  { rise: 0.3, half: [0.185, 0.168], front: [0.135, 0.13], back: [0.091, 0.092] },
  { rise: 0.4, half: [0.15, 0.232], front: [0.145, 0.15], back: [0.1, 0.105] },
  { rise: 0.48, half: [0.148, 0.268], front: [0.13, 0.138], back: [0.105, 0.11] },
  { rise: 0.555, half: [0.095, 0.125], front: [0.05, 0.05], back: [0.064, 0.066] },
];

/** The heights (above the hip) that the torso's landmarks are painted at. */
const RISE_WAISTBAND = 0.075;
/** The waistcoat's hem sits just over the waistband, its two front points dipping onto it. */
const RISE_WAISTCOAT_HEM = 0.11;
const RISE_ARMHOLE = 0.4;
/** The shirt's belly crease, and how far it falls from the flank to the middle. */
const SHIRT_FOLD_RISE = 0.09;
const SHIRT_FOLD_DROP = 0.03;

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

/**
 * Linen folds where the shirt shows below the waistcoat: a crease pulled
 * round the belly from each side, deepening as the breath goes out of him
 * and the belly pushes the cloth.
 */
function paintShirtFolds(ctx: Ctx, scene: Scene): void {
  const across = unit(perp(scene.up2));
  const slump = 1 - scene.breath;
  for (const side of [-1, 1]) {
    groove(
      ctx,
      [
        offsetPt(spineAt(scene, SHIRT_FOLD_RISE + SHIRT_FOLD_DROP), across, side * 0.12),
        offsetPt(spineAt(scene, SHIRT_FOLD_RISE), across, side * 0.05),
      ],
      SHIRT.shadow,
      0.014,
      0.35 + 0.4 * slump,
    );
  }
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
          ctx.fillStyle = SHIRT.base;
          ctx.fillRect(chest.x - 1, chest.y - 1, 2, 2);
          const across = unit(perp(scene.up2));
          cylinderShade(ctx, chest, across, 0.24, SHIRT, 0.9);
          paintShirtFolds(ctx, scene);
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

// ── Trouser seat ────────────────────────────────────────────────────────────

const SEAT_BULK = 0.014;
/** How far down each thigh the seat's panel reaches before the trouser legs take over. */
const SEAT_LEG = 0.1;

/**
 * The trousers from the waistband to the top of the thighs: the legs are
 * cloth below this, and this joins them under the waistcoat's hem so no
 * skin or gap shows at the crotch.
 */
function seatPart(scene: Scene): Part {
  const { s, p, view } = scene;
  const profile = view === 'side';
  const tops = [s.leftLeg, s.rightLeg].map((chain, index) => {
    const side = index === 0 ? -1 : 1;
    const root = p(chain.root);
    const knee = p(chain.joint);
    const length = Math.max(DEGENERATE, Math.hypot(knee.x - root.x, knee.y - root.y));
    const end = lerpPt(root, knee, SEAT_LEG / length);
    const outward = { x: scene.right2.x * side, y: scene.right2.y * side };
    const start = offsetPt(root, unit({ x: root.x - knee.x, y: root.y - knee.y }), 0.04);
    return limbOutline(
      start,
      end,
      profile ? scene.fwd2 : outward,
      (profile ? THIGH_FRONT : THIGH_OUTER).slice(0, 2).map((w) => w + SEAT_BULK),
      (profile ? THIGH_BACK : THIGH_INNER).slice(0, 2).map((w) => w + SEAT_BULK),
    );
  });
  const gusset = [
    tops[0].a,
    lerpPt(tops[0].a, tops[0].b, 0.5),
    lerpPt(tops[1].a, tops[1].b, 0.5),
    tops[1].a,
  ];
  const trace = (ctx: Ctx): void => {
    traceTorsoBand(ctx, scene, SEAT_BULK, TORSO_LEVELS[0].rise, RISE_WAISTBAND);
    for (const top of tops) traceLimb(ctx, top);
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
          ctx.fillStyle = TROUSERS.base;
          ctx.fillRect(band.x - 1, band.y - 0.02, 2, 1);
          cylinderShade(ctx, spineAt(scene, 0), unit(perp(scene.up2)), 0.2, TROUSERS, 1);
        },
      );
    },
  };
}

// ── Waistcoat ───────────────────────────────────────────────────────────────

const WAISTCOAT_BULK = 0.018;
/**
 * The V of the neckline head-on, as a share of the torso's half-width from
 * the middle: closed up to {@link RISE_V_BOTTOM}, opening to this at the top.
 */
const WAISTCOAT_V_TOP = 0.66;
const RISE_V_BOTTOM = 0.3;
/** The armholes are cut in from his sides, so the shirt shows round each shoulder. */
const WAISTCOAT_ARMHOLE_INSET = 0.72;
/** How far below the hem the two front points hang. */
const WAISTCOAT_POINT_DROP = 0.045;
/** In profile the neckline falls back from his front by this share of the chest's depth. */
const PROFILE_NECKLINE_BACK = 0.55;
/** Buttons down the closed front, as rises above the hip. */
const BUTTON_RISES: readonly number[] = [0.15, 0.22, 0.29];
const BUTTON_RADIUS = 0.017;

function waistcoatPart(scene: Scene): Part {
  const { view } = scene;
  const hemLevel = TORSO_LEVELS.findIndex((level) => level.rise >= RISE_WAISTCOAT_HEM);
  const levels = [levelAt(RISE_WAISTCOAT_HEM), ...TORSO_LEVELS.slice(hemLevel)];
  const edges = levels.map((level) => torsoEdgeAt(scene, level, WAISTCOAT_BULK));
  const topEdge = edges[edges.length - 1];
  const topRise = levels[levels.length - 1].rise;
  const top = spineAt(scene, TORSO_LEVELS[TORSO_LEVELS.length - 1].rise + 0.035);
  const armhole = (index: number, side: Pt): Pt =>
    levels[index].rise >= RISE_ARMHOLE
      ? lerpPt(edges[index].centre, side, WAISTCOAT_ARMHOLE_INSET)
      : side;

  const panels: Pt[][] = [];
  if (view === 'back') {
    panels.push([
      ...edges.map((e, index) => armhole(index, e.a)),
      top,
      ...edges.map((e, index) => armhole(index, e.b)).reverse(),
    ]);
  } else if (view === 'front') {
    const down = { x: -scene.up2.x, y: -scene.up2.y };
    for (const side of [-1, 1]) {
      const outer = edges.map((e, index) => armhole(index, side === 1 ? e.a : e.b));
      const inner = edges.map((e, index) => {
        const intoV = clamp01((levels[index].rise - RISE_V_BOTTOM) / (topRise - RISE_V_BOTTOM));
        return lerpPt(e.centre, side === 1 ? e.a : e.b, WAISTCOAT_V_TOP * intoV);
      });
      const point = offsetPt(lerpPt(edges[0].centre, outer[0], 0.45), down, WAISTCOAT_POINT_DROP);
      const shoulder = lerpPt(top, side === 1 ? topEdge.a : topEdge.b, WAISTCOAT_V_TOP + 0.15);
      panels.push([point, ...outer, shoulder, ...inner.slice(1).reverse(), inner[0]]);
    }
  } else {
    const back = edges.map((e) => e.b);
    const front = edges.map((e, index) =>
      index === edges.length - 1 ? lerpPt(e.a, e.centre, PROFILE_NECKLINE_BACK) : e.a,
    );
    panels.push([...back, top, ...front.reverse()]);
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
          const cloth = view === 'back' ? SATIN_BACK : WAISTCOAT;
          ctx.fillStyle = cloth.base;
          ctx.fillRect(chest.x - 1, chest.y - 1, 2, 2);
          cylinderShade(ctx, chest, unit(perp(scene.up2)), 0.26, cloth, 1);
          if (view === 'back') {
            const seamTop = spineAt(scene, 0.5);
            const seamLow = spineAt(scene, RISE_WAISTCOAT_HEM + 0.01);
            groove(ctx, [seamTop, seamLow], WAISTCOAT.deep, 0.012, 0.6);
          }
        },
      );
      ctx.save();
      ctx.lineJoin = 'round';
      for (const panel of panels) {
        ctx.beginPath();
        traceLoop(ctx, panel);
        ctx.strokeStyle = WAISTCOAT.light;
        ctx.lineWidth = 0.018;
        ctx.save();
        ctx.clip();
        ctx.stroke();
        ctx.restore();
      }
      if (view !== 'back') {
        const forward = view === 'front' ? { x: 0, y: 0 } : unit(scene.fwd2);
        for (const rise of BUTTON_RISES) {
          const level = levelAt(rise);
          const edge = torsoEdgeAt(scene, level, WAISTCOAT_BULK);
          const at =
            view === 'front' ? edge.centre : offsetPt(edge.a, forward, -BUTTON_RADIUS * 1.2);
          ctx.fillStyle = BUTTON_DARK;
          ctx.beginPath();
          ellipsePath(ctx, at, BUTTON_RADIUS, BUTTON_RADIUS);
          ctx.fill();
          ctx.fillStyle = BUTTON;
          ctx.beginPath();
          ellipsePath(
            ctx,
            { x: at.x - BUTTON_RADIUS * 0.25, y: at.y - BUTTON_RADIUS * 0.25 },
            BUTTON_RADIUS * 0.6,
            BUTTON_RADIUS * 0.6,
          );
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };
}

// ── Collar ───────────────────────────────────────────────────────────────────

/** The shirt collar stands this far up the neck from its base, and this far proud of it. */
const COLLAR_HEIGHT = 0.06;
const COLLAR_BULK = 0.012;
const NECK_HALF_WIDTH = 0.072;

/**
 * The shirt's collar round the base of his neck: from behind it is what
 * closes the gap between the waistcoat and his hair, so only the nape shows.
 */
function collarPart(scene: Scene): Part {
  const base = scene.p(scene.s.neckBase);
  const chin = scene.p(scene.s.chin);
  const length = Math.max(DEGENERATE, Math.hypot(chin.x - base.x, chin.y - base.y));
  const top = lerpPt(base, chin, COLLAR_HEIGHT / length);
  const halfWidth = NECK_HALF_WIDTH + COLLAR_BULK;
  const collar = limbOutline(base, top, scene.fwd2, [halfWidth, halfWidth], [halfWidth, halfWidth]);
  return {
    order: 0.26,
    casts: true,
    trace: (ctx) => traceLimb(ctx, collar),
    paint: (ctx) => {
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          traceLimb(ctx, collar);
        },
        () => {
          ctx.fillStyle = SHIRT.base;
          ctx.fillRect(base.x - 0.3, base.y - 0.3, 0.6, 0.6);
          cylinderShade(ctx, lerpPt(base, top, 0.5), unit(perp(scene.up2)), halfWidth, SHIRT, 1);
          const across = unit(perp(scene.up2));
          groove(
            ctx,
            [offsetPt(top, across, -halfWidth), offsetPt(top, across, halfWidth)],
            SHIRT.shadow,
            0.012,
            0.6,
          );
        },
      );
    },
  };
}

// ── Arms and hands ───────────────────────────────────────────────────────────

/** Upper-arm widths along the bone, [slumped, pumped]: the bicep peaks pumped and hangs soft deflated. */
const BICEP_SIDE: readonly (readonly [number, number])[] = [
  [0.044, 0.054],
  [0.04, 0.056],
  [0.038, 0.066],
  [0.034, 0.05],
  [0.028, 0.032],
];
const TRICEP_SIDE: readonly (readonly [number, number])[] = [
  [0.046, 0.056],
  [0.05, 0.056],
  [0.054, 0.052],
  [0.042, 0.042],
  [0.029, 0.032],
];
const DELT_OUTER: readonly (readonly [number, number])[] = [
  [0.046, 0.056],
  [0.042, 0.05],
  [0.038, 0.046],
  [0.034, 0.04],
  [0.028, 0.032],
];
const ARM_INNER: readonly (readonly [number, number])[] = [
  [0.036, 0.042],
  [0.042, 0.048],
  [0.046, 0.052],
  [0.038, 0.042],
  [0.028, 0.032],
];
const FOREARM_TOP = [0.04, 0.048, 0.042, 0.034, 0.028];
const FOREARM_UNDER = [0.04, 0.045, 0.038, 0.031, 0.027];
/** The sleeve's shoulder seam: rounded by the shoulder under it, never puffed. */
const DELT_RADIUS: readonly [number, number] = [0.04, 0.05];
const FIST_RADIUS = 0.042;
/** How far past the wrist a hand's centre sits, closed and flat. */
const FIST_HAND_REACH = 0.03;
const FLAT_HAND_REACH = 0.05;
const FLAT_HAND_HALF_LENGTH = 0.058;
const OPEN_HAND_HALF_BREADTH = 0.036;
const BLADE_HAND_HALF_BREADTH = 0.02;
/** The line where the fingers start, as a share of the flat hand's half-length past its centre. */
const FINGER_LINE_ALONG = 0.15;
const FINGER_LINE_WIDTH = 0.01;
const FINGER_LINE_ALPHA = 0.7;
/**
 * Sleeve creases as shares of the way from the elbow: negative up toward the
 * shoulder, positive down toward the wrist.
 */
const SLEEVE_CREASES: readonly number[] = [-0.18, 0.16];
/** The cuff covers this share of the forearm at the wrist. */
const SLEEVE_CUFF_SHARE = 0.16;
const SLEEVE_CUFF_WIDTH = 0.05;
/** A dark seam where the cuff ends, so the hand never melts into the linen. */
const CUFF_EDGE_WIDTH = 0.016;
/** The hand's own edge, drawn wherever it lies over his body or his face. */
const HAND_EDGE_WIDTH = 0.014;

function widthsAt(table: readonly (readonly [number, number])[], breath: number): number[] {
  return table.map((pair) => lerp(pair[0], pair[1], breath));
}

function isFlatHand(shape: HandShape): boolean {
  return shape === 'open' || shape === 'blade';
}

/**
 * Where a hand is painted, on screen: it runs on from the wrist along the
 * forearm as drawn, its centre a little past the wrist and, for a flat hand,
 * its fingertips a hand's length on. Shared by the painter and the gates, so
 * a check on where the hand lands measures the hand that is drawn.
 */
export function handOnScreen(
  wrist: Pt,
  elbow: Pt,
  shape: HandShape,
): { foreDir: Pt; centre: Pt; tip: Pt } {
  const foreDir = unit({ x: wrist.x - elbow.x, y: wrist.y - elbow.y });
  const flat = isFlatHand(shape);
  const centre = offsetPt(wrist, foreDir, flat ? FLAT_HAND_REACH : FIST_HAND_REACH);
  const tip = offsetPt(centre, foreDir, flat ? FLAT_HAND_HALF_LENGTH : FIST_RADIUS);
  return { foreDir, centre, tip };
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
  const { foreDir, centre: handCentre } = handOnScreen(wrist, elbow, handShape);
  const flat = isFlatHand(handShape);

  const traceArm = (ctx: Ctx): void => {
    traceLimb(ctx, upper);
    ellipsePath(ctx, deltCentre, deltR, deltR * 0.95);
    traceLimb(ctx, fore);
  };
  const traceHand = (ctx: Ctx): void => {
    if (flat) {
      const breadth = handShape === 'blade' ? BLADE_HAND_HALF_BREADTH : OPEN_HAND_HALF_BREADTH;
      ellipsePath(
        ctx,
        handCentre,
        FLAT_HAND_HALF_LENGTH,
        breadth,
        Math.atan2(foreDir.y, foreDir.x),
      );
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
          ctx.fillStyle = SHIRT.base;
          ctx.fillRect(shoulder.x - 1, shoulder.y - 1, 2, 2);
          cylinderShade(ctx, lerpPt(shoulder, elbow, 0.45), upper.lead, 0.08, SHIRT, 1);
          const foreMid = lerpPt(elbow, wrist, 0.5);
          ctx.save();
          ctx.beginPath();
          traceLimb(ctx, fore);
          ctx.clip();
          cylinderShade(ctx, foreMid, fore.lead, 0.05, SHIRT, 1);
          ctx.restore();
          fillSoftEllipse(
            ctx,
            deltCentre.x - 0.015,
            deltCentre.y - 0.02,
            deltR * 0.8,
            deltR * 0.6,
            SHIRT.light,
            0.55,
          );
          // Linen bunches at the elbow; the creases are what make a sleeve read as cloth.
          for (const along of SLEEVE_CREASES) {
            const crease = lerpPt(elbow, along < 0 ? shoulder : wrist, Math.abs(along));
            groove(
              ctx,
              [offsetPt(crease, upper.lead, 0.035), offsetPt(crease, upper.lead, -0.03)],
              SHIRT.shadow,
              0.011,
              0.55,
            );
          }
          const cuffFrom = lerpPt(elbow, wrist, 1 - SLEEVE_CUFF_SHARE);
          groove(ctx, [cuffFrom, wrist], SHIRT.light, SLEEVE_CUFF_WIDTH, 0.7);
          groove(
            ctx,
            [offsetPt(wrist, fore.lead, 0.045), offsetPt(wrist, fore.lead, -0.045)],
            SHIRT.shadow,
            CUFF_EDGE_WIDTH,
            1,
          );
          groove(
            ctx,
            [offsetPt(cuffFrom, fore.lead, 0.04), offsetPt(cuffFrom, fore.lead, -0.04)],
            SHIRT.dark,
            0.01,
            0.8,
          );
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
          // Lit a step lighter than the face's base, since a hand at the tile
          // is a few pixels and its shadow side would otherwise swallow it
          // into a terracotta blot.
          ctx.fillStyle = SKIN.base;
          ctx.fillRect(handCentre.x - 0.2, handCentre.y - 0.2, 0.4, 0.4);
          fillSoftEllipse(
            ctx,
            handCentre.x - 0.015,
            handCentre.y - 0.02,
            0.045,
            0.035,
            SKIN.light,
            0.85,
          );
          fillSoftEllipse(
            ctx,
            handCentre.x + 0.02,
            handCentre.y + 0.025,
            0.035,
            0.025,
            SKIN.mid,
            0.4,
          );
          if (flat) {
            const knuckles = offsetPt(
              handCentre,
              foreDir,
              FLAT_HAND_HALF_LENGTH * FINGER_LINE_ALONG,
            );
            const acrossHand = perp(foreDir);
            groove(
              ctx,
              [
                offsetPt(knuckles, acrossHand, -OPEN_HAND_HALF_BREADTH),
                offsetPt(knuckles, acrossHand, OPEN_HAND_HALF_BREADTH),
              ],
              SKIN.shadow,
              FINGER_LINE_WIDTH,
              FINGER_LINE_ALPHA,
            );
          }
          if (!flat) {
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
      ctx.save();
      ctx.beginPath();
      traceHand(ctx);
      ctx.strokeStyle = SKIN.dark;
      ctx.lineWidth = HAND_EDGE_WIDTH;
      ctx.stroke();
      ctx.restore();
    },
  };
  return [armPart, handPart];
}

// ── Head, hair, beard ──────────────────────────────────────────────────────

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

function traceSkull(ctx: Ctx, h: HeadFrame, view: BrandonView): void {
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
/** The beard's rounded point: half its width at the very tip, and how far the rounding rises. */
const BEARD_TIP_HALF = 0.025;
const BEARD_TIP_ROUND = 0.025;
/** The dark of the closed mouth, in head radii, sitting under the moustache. */
const MOUTH_SHADOW_HALF_WIDTH = 0.16;
const MOUTH_SHADOW_HALF_HEIGHT = 0.05;
/** Standing, the share of the head's own tilt the hanging beard follows. */
const BEARD_HEAD_FOLLOW = 0.4;

/** Two faint strand lines from the crown, as head-space `u` where each starts and how far down it runs. */
const MANE_STRANDS: readonly (readonly [number, number])[] = [
  [-0.25, -0.75],
  [0.3, -0.85],
];
const MANE_STRAND_WIDTH = 0.012;
const MANE_STRAND_ALPHA = 0.5;
/** Points round the crown, every other one standing proud as a tuft. */
const MANE_CROWN_STEPS = 11;
/** The inner shade along the hair's edge, against the silhouette stroke. */
const MANE_EDGE_SHADE_WIDTH = 0.03;
const MANE_EDGE_SHADE_ALPHA = 0.35;
/** His ears from behind: skin nubs either side of the hair, in head radii. */
const EAR_BEHIND_U = 0.74;
const EAR_BEHIND_V = -0.15;
const EAR_BEHIND_RX = 0.13;
const EAR_BEHIND_RY = 0.22;
const MANE_TUFT_LOFT = 1.15;

/**
 * From behind: white hair combed back and down from the crown in one flat
 * warm tone, its edge broken into tufts and draped over his collar, with his
 * ears showing either side. Two faint strand lines are all the detail it
 * carries: any more, at the tile, and the back of his head reads as a barred
 * helmet.
 */
function maneBehindPart(scene: Scene): Part {
  const h = headFrame(scene);
  const crown = Array.from({ length: MANE_CROWN_STEPS }, (_, step) => {
    const angle = lerp(Math.PI * 0.94, Math.PI * 0.06, step / (MANE_CROWN_STEPS - 1));
    const loft = step % 2 === 1 ? MANE_TUFT_LOFT : HAIR_LOFT;
    return headPoint(h, WIDTH_RATIO * loft * Math.cos(angle), loft * Math.sin(angle));
  });
  const mane = [
    ...crown,
    headPoint(h, 0.7, 0.1),
    headPoint(h, 0.5, -0.02),
    headPoint(h, 0.5, -0.6),
    headPoint(h, 0.44, -1.05),
    headPoint(h, 0.28, -1.2),
    headPoint(h, 0.1, -1.08),
    headPoint(h, -0.08, -1.26),
    headPoint(h, -0.26, -1.06),
    headPoint(h, -0.42, -1.18),
    headPoint(h, -0.5, -0.6),
    headPoint(h, -0.5, -0.02),
    headPoint(h, -0.7, 0.1),
  ];
  // The edges of his beard show past his jaw on either side, below the ears.
  const ears = [-1, 1].map((side) => headPoint(h, side * EAR_BEHIND_U, EAR_BEHIND_V));
  const traceEar = (ctx: Ctx, ear: Pt): void =>
    ellipsePath(ctx, ear, EAR_BEHIND_RX * HEAD_RY, EAR_BEHIND_RY * HEAD_RY, headAngle(h));
  const trace = (ctx: Ctx): void => {
    for (const ear of ears) traceEar(ctx, ear);
    traceLoop(ctx, mane);
  };
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
          ctx.fillStyle = HAIR.base;
          ctx.fillRect(h.c.x - 0.4, h.c.y - 0.4, 0.8, 0.8);
          for (const [u, end] of MANE_STRANDS) {
            groove(
              ctx,
              [headPoint(h, u * 0.5, 0.95), headPoint(h, u, 0.2), headPoint(h, u * 0.9, end)],
              HAIR.mid,
              MANE_STRAND_WIDTH,
              MANE_STRAND_ALPHA,
            );
          }
          // Shade the hair down toward its edge, so the dark silhouette stroke
          // round it reads as the hair's own shadow rather than a helmet rim.
          ctx.save();
          ctx.beginPath();
          traceLoop(ctx, mane);
          ctx.strokeStyle = HAIR.dark;
          ctx.globalAlpha = MANE_EDGE_SHADE_ALPHA;
          ctx.lineWidth = MANE_EDGE_SHADE_WIDTH;
          ctx.stroke();
          ctx.restore();
        },
      );
      for (const ear of ears) {
        ctx.fillStyle = SKIN.mid;
        ctx.beginPath();
        traceEar(ctx, ear);
        ctx.fill();
      }
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
        headPoint(h, -0.05, -0.5),
        headPoint(h, 0.35, -0.7),
        headPoint(h, 0.9, -0.62),
        headPoint(h, 0.92, -0.95),
        { x: tip.x + h.faceSign * 0.03, y: tip.y - 0.04 },
        tip,
        { x: tip.x - h.faceSign * 0.04, y: tip.y - 0.1 },
        headPoint(h, 0.02, -1.1),
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
    // Head-on: the beard starts below the cheeks, leaving skin either side
    // above it, runs down from a ragged jawline to a rounded point on his
    // chest, and leaves the lower lip clear under a moustache that droops at
    // both corners.
    traceLoop(ctx, [
      headPoint(h, -0.6, -0.42),
      headPoint(h, -0.7, -0.78),
      { x: tip.x - BEARD_TIP_HALF * 2.4, y: tip.y - BEARD_TIP_ROUND * 3 },
      { x: tip.x - BEARD_TIP_HALF, y: tip.y - BEARD_TIP_ROUND },
      tip,
      { x: tip.x + BEARD_TIP_HALF, y: tip.y - BEARD_TIP_ROUND },
      { x: tip.x + BEARD_TIP_HALF * 2.4, y: tip.y - BEARD_TIP_ROUND * 3 },
      headPoint(h, 0.7, -0.78),
      headPoint(h, 0.6, -0.42),
      headPoint(h, 0.52, -0.66),
      headPoint(h, 0.3, -0.9),
      headPoint(h, 0.12, -0.86),
      headPoint(h, 0, -0.92),
      headPoint(h, -0.12, -0.86),
      headPoint(h, -0.3, -0.9),
      headPoint(h, -0.52, -0.66),
    ]);
    for (const u of [-1, 1]) {
      traceLoop(ctx, [
        headPoint(h, 0, -0.5),
        headPoint(h, u * 0.42, -0.56),
        headPoint(h, u * 0.6, -0.8),
        headPoint(h, u * 0.54, -0.98),
        headPoint(h, u * 0.4, -0.72),
        headPoint(h, u * 0.04, -0.66),
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
      if (!profile) {
        // The mouth's shadow under the moustache, open or shut.
        const lip = headPoint(h, 0, -0.75);
        ctx.fillStyle = MOUTH_INNER;
        ctx.beginPath();
        ellipsePath(
          ctx,
          lip,
          MOUTH_SHADOW_HALF_WIDTH * HEAD_RY,
          MOUTH_SHADOW_HALF_HEIGHT * HEAD_RY,
          headAngle(h),
        );
        ctx.fill();
      }
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

/** The hair stands this far proud of the skull, in head radii, so the crown has volume. */
const HAIR_LOFT = 1.08;
/** Points sampled round the crown's outer edge. */
const HAIR_ARC_STEPS = 9;
/** Swept-back comb lines across the crown, as head-space `u` where each starts at the hairline. */
const HAIR_COMB_LINES: readonly number[] = [-0.4, -0.1, 0.2, 0.45];

/** Points round the skull's outline at `loft` head radii, from angle `from` to `to` (radians, 0 = face side). */
function crownArc(h: HeadFrame, widthRatio: number, from: number, to: number): Pt[] {
  return Array.from({ length: HAIR_ARC_STEPS }, (_, step) => {
    const angle = lerp(from, to, step / (HAIR_ARC_STEPS - 1));
    return headPoint(h, widthRatio * HAIR_LOFT * Math.cos(angle), HAIR_LOFT * Math.sin(angle));
  });
}

/**
 * White hair, swept straight back off a high forehead: an old man's full
 * head of it, combed for work. Head-on it frames the face and runs down past
 * the ears into the beard; in profile it lifts off the brow and falls behind
 * the ear into the hair at his nape. From behind, the mane covers the crown.
 */
function hairPart(scene: Scene): Part | null {
  if (scene.view === 'back') return null;
  const h = headFrame(scene);
  const profile = scene.view === 'side';
  const outline = profile
    ? [
        headPoint(h, -0.62, -1.02),
        headPoint(h, -0.86, -1.12),
        headPoint(h, -1.02, -0.62),
        ...crownArc(h, DEPTH_RATIO, Math.PI * 1.08, Math.PI * 0.36),
        headPoint(h, 0.5, 0.66),
        headPoint(h, 0.28, 0.5),
        headPoint(h, 0.1, 0.42),
        headPoint(h, -0.08, 0.24),
        headPoint(h, -0.34, 0.12),
        headPoint(h, -0.46, -0.36),
        headPoint(h, -0.44, -0.84),
      ]
    : [
        ...crownArc(h, WIDTH_RATIO, Math.PI * 0.95, Math.PI * 0.05),
        headPoint(h, WIDTH_RATIO * 0.95, 0.22),
        headPoint(h, WIDTH_RATIO * 0.7, 0.66),
        headPoint(h, 0.3, 0.7),
        headPoint(h, 0, 0.64),
        headPoint(h, -0.3, 0.7),
        headPoint(h, -WIDTH_RATIO * 0.7, 0.66),
        headPoint(h, -WIDTH_RATIO * 0.95, 0.22),
      ];
  const trace = (ctx: Ctx): void => traceLoop(ctx, outline);
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
          ctx.fillStyle = HAIR.base;
          ctx.fillRect(h.c.x - 0.4, h.c.y - 0.4, 0.8, 0.8);
          cylinderShade(ctx, headPoint(h, 0, 0.6), h.side, HEAD_RY * 1.1, HAIR, 1);
          const shine = headPoint(h, profile ? 0.1 : -0.3, 0.85);
          fillSoftEllipse(
            ctx,
            shine.x,
            shine.y,
            0.3 * HEAD_RY,
            0.16 * HEAD_RY,
            HAIR.rim,
            0.9,
            headAngle(h),
            0.5,
          );
          HAIR_COMB_LINES.forEach((u, index) => {
            const comb = profile
              ? [
                  headPoint(h, 0.42 - index * 0.08, 0.66 - index * 0.14),
                  headPoint(h, -0.4, 0.62 - index * 0.2),
                  headPoint(h, -0.84, -0.1 - index * 0.25),
                ]
              : [headPoint(h, u, 0.68), headPoint(h, u * 1.15, 1.02)];
            groove(ctx, comb, HAIR.dark, 0.009, 0.55);
          });
        },
      );
    },
  };
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * How far past the body a hand must reach before its arm is drawn on the far
 * side of the torso head-on. Large, so the walking swing never crosses it:
 * which side an arm is drawn on must not flip mid-stride.
 */
const ARM_BEHIND_REACH = 0.26;
/** Over the waistcoat and collar, under the neck, head and hair. */
const ARM_UNDER_HEAD_ORDER = 0.21;
/** A hand paints just over its own arm. */
const ARM_HAND_ORDER_STEP = 0.05;

function partsFor(scene: Scene): Part[] {
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
  parts.push(seatPart(scene));
  parts.push(waistcoatPart(scene));
  parts.push(neckPart(scene));
  parts.push(collarPart(scene));
  parts.push(headPart(scene));
  const beard = beardPart(scene);
  if (beard !== null) parts.push(beard);
  const hair = hairPart(scene);
  if (hair !== null) parts.push(hair);

  const handAhead = (chain: Chain): number => nearness(chain.end) - hipDepth;
  if (view === 'side') {
    parts.push(...armParts(scene, 1, 1, 1.2));
  } else {
    for (const side of [-1, 1] as const) {
      const chain = side === 1 ? s.rightArm : s.leftArm;
      const behind = handAhead(chain) < -ARM_BEHIND_REACH;
      // From behind, a hand raised to his brow is on the far side of his head:
      // the arm paints over his back but under his head and hair, so the hand
      // shows only where it passes the side of his head.
      const raisedPastHead = view === 'back' && chain.end.y < chain.root.y;
      const base = behind
        ? -3
        : raisedPastHead
          ? ARM_UNDER_HEAD_ORDER
          : 1 + nearness(chain.end) * 0.01;
      parts.push(...armParts(scene, side, base, base + ARM_HAND_ORDER_STEP));
    }
  }
  return parts.sort((a, b) => a.order - b.order);
}

function paintGroundShadow(ctx: Ctx, scene: Scene): void {
  const feet = [scene.s.leftHeel, scene.s.rightHeel, scene.s.leftToe, scene.s.rightToe];
  const lowest = Math.max(...feet.map((f) => f.y));
  const lift = clamp01(-lowest * 4);
  const centreX = scene.p(v3(scene.s.hip.x, 0, scene.s.hip.z)).x;
  fillSoftEllipse(
    ctx,
    centreX,
    0,
    GROUND_SHADOW_RX * (1 - lift * 0.4),
    GROUND_SHADOW_RY,
    '#000000',
    GROUND_SHADOW_ALPHA * (1 - lift * 0.5),
    0,
    0.35,
  );
}

/**
 * Paints Brandon in figure space (tile units, origin on the floor
 * between his feet). The caller sets the transform.
 *
 * The cast shadows composite `source-atop`, so they land only on what is
 * already painted — which is why the painter has to be given a surface of its
 * own: the figure cache always paints into an isolated cell.
 */
export function drawBrandon(ctx: Ctx, pose: BrandonPose, view: BrandonView): void {
  const scene = sceneFor(pose, view);
  const baseAlpha = ctx.globalAlpha;
  ctx.save();
  try {
    paintGroundShadow(ctx, scene);
    const parts = partsFor(scene);
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
  pose: BrandonPose,
  view: BrandonView,
): { skeleton: Skeleton; at: (v: V3) => P2 } {
  const skeleton = buildSkeleton(pose);
  return { skeleton, at: (v) => projectPoint(v, view) };
}
