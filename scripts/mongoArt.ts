/**
 * The painter library behind Mongo's three sprite sheets.
 *
 * Mongo is a Mongoliensis — a dromaeosaur, i.e. a Jurassic-Park raptor with the
 * feathers palaeontology actually gives it. Everything here serves the short
 * list of cues that separate a dromaeosaur from the lizard, the ostrich and the
 * dog it otherwise collapses into at 32 px:
 *
 *   - a **horizontal** spine, head and tail balanced over the hips like a seesaw
 *   - **digitigrade** legs: a long metatarsus, a high ankle pointing *backward*
 *     (the "reverse knee" that is really a heel) and a knee tucked forward
 *   - the **sickle claw** on toe II, carried retracted clear of the floor
 *   - an **S-curved** neck holding a long low skull level
 *   - **wing-arms**: forearms carrying pennaceous feathers, folded with the
 *     palms facing each other ("prayer hands" — a dromaeosaur wrist cannot
 *     pronate, so a palm-down hand is anatomically impossible)
 *   - a **stiff** tail that sways as one rod from its base and never whips
 *
 * The colour brief is fixed: a steel/royal blue body with broken navy dorsal
 * bars, a pale blue-cream underside, and pink display feathers in exactly three
 * places — head crest, forearms, tail fan. Those three pink zones are an
 * invariant the bake gates police in every frame of every row.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen. The profile view faces +X; the runtime mirrors it.
 *
 * Choreography lives in `scripts/generate-mongo-sprites.ts`. This module knows
 * nothing about animation beyond the pose handed to it.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Small math ───────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smooth 0→1 ease used for every limb swing and body transition. */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** Maps a value from one range onto a clamped 0→1 progress. */
export function ramp(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

/** A single hump: 0 at both ends, 1 in the middle. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
export function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

export function hash2(a: number, b: number): number {
  const MIX_A = 127.1;
  const MIX_B = 311.7;
  return hash1(a * MIX_A + b * MIX_B);
}

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export function pt(x: number, y: number): Pt {
  return { x, y };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Rotates `p` about the origin by `angle`, screen-clockwise for +angle. */
function rot(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function mid(a: Pt, b: Pt, t = 0.5): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** The unit vector from `a` to `b`; a zero-length pair returns +X. */
function dir(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < ZERO_LENGTH_EPSILON) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

const ZERO_LENGTH_EPSILON = 1e-9;

/** The unit vector 90° clockwise on screen from `v`. */
function perp(v: Pt): Pt {
  return { x: -v.y, y: v.x };
}

// ── Colour ───────────────────────────────────────────────────────────────────

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.slice(1);
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

/** Blend two hex colours; t=0 returns `a`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `#${channel(lerp(ca.r, cb.r, t))}${channel(lerp(ca.g, cb.g, t))}${channel(lerp(ca.b, cb.b, t))}`;
}

/** Decimal places kept on an alpha; see below for why the rounding is needed. */
const ALPHA_PRECISION = 4;

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  // A computed alpha can come out vanishingly small, and `String(5e-17)` is
  // exponent notation that node-canvas cannot parse — it drops the whole colour
  // and the shape bakes as an opaque smear. Rounding kills the exponent form.
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  return `rgba(${c.r},${c.g},${c.b},${safe})`;
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * The brief's palette, named by where it sits rather than by hue so the same
 * list serves the head, the haunch and the limbs without re-deriving anything.
 *
 * `dorsal` is a deep navy rather than a true black: at a 32 px tile a true black
 * back collapses into a silhouette hole and takes the whole top of the animal
 * with it.
 */
export const HIDE = {
  dorsal: '#1b2c55',
  back: '#2f4f92',
  base: '#3a63a8',
  light: '#5b8ad4',
  rim: '#a8c6f2',
  belly: '#c3d3e2',
  bellyShade: '#93a9c0',
  shadow: '#111a2e',
} as const;

/** The three pink display zones. Roots run deeper magenta than the vanes. */
/**
 * Chick down.
 *
 * Cool white rather than pink: the display feathers are an invariant of exactly
 * three zones and a pink halo round the whole animal is a fourth — and cool
 * rather than cream so the bake gate that counts keratin pixels cannot mistake a
 * fluffy juvenile for a well-clawed one.
 */
export const DOWN_FLUFF = '#e9eef4';

export const PLUME = {
  root: '#b8377a',
  base: '#e0619f',
  vane: '#f58bbd',
  tip: '#ffc0dc',
} as const;

export const EYE_RING = '#c9942b';
export const EYE_IRIS = '#f5c542';
export const EYE_PUPIL = '#120d08';
export const CLAW = '#241d24';
/** The sickle's own colour. Pale keratin, so the one claw that identifies a
 * dromaeosaur is the one claw that can be seen. */
export const SICKLE_KERATIN = '#cec0a4';
export const CLAW_LIGHT = '#5a4d58';
export const TOOTH = '#f2ede0';
export const MOUTH_FLESH = '#7d2f45';
export const GROUND_SHADOW = '#000000';

/** The ground line, in tile units below the tile's centre. */
export const GROUND_Y = 0.4;

// ── Stages ───────────────────────────────────────────────────────────────────

export type MongoStage = 'juvenile' | 'adolescent' | 'adult';

export const MONGO_STAGE_ORDER: readonly MongoStage[] = ['juvenile', 'adolescent', 'adult'];

/**
 * Every length a stage needs, in tile units before the stage's own `scale`.
 *
 * The three stages are authored as three proportion sets rather than as one set
 * under three multipliers: a juvenile raptor is not a small adult, it is a
 * different animal shape — oversized skull, huge eye, stubby tail, short neck.
 * A single scale factor would give a shrunken adult, which reads as a distant
 * adult rather than as a chick.
 */
export interface MongoProportions {
  /** Applied about the ground line at bake time, so his feet stay on his tile. */
  readonly scale: number;
  readonly hipHeight: number;
  readonly femur: number;
  readonly tibia: number;
  readonly metatarsus: number;
  readonly toe: number;
  /**
   * Sickle-claw length on toe II, carried retracted.
   *
   * Proportionally *larger* on the younger stages, so that after each stage's
   * own scale it still lands on enough pixels to be seen. That is also how young
   * animals are actually built — a chick's claws are large for its body — but
   * the reason it is written down is legibility: shrunk with everything else the
   * one shape that identifies a dromaeosaur becomes two pixels.
   */
  readonly sickle: number;
  readonly spineLength: number;
  /** Where the chest sits relative to the hips; negative lifts the shoulders. */
  readonly chestRise: number;
  readonly hipDepth: number;
  readonly chestDepth: number;
  readonly bellyDepth: number;
  readonly neckLength: number;
  readonly neckThickness: number;
  readonly skullLength: number;
  readonly skullDepth: number;
  /** Lower-jaw depth, as a share of `skullDepth` so the two cannot drift apart. */
  readonly jawDepth: number;
  readonly eyeRadius: number;
  readonly humerus: number;
  readonly forearm: number;
  readonly hand: number;
  /** Tail segment lengths, root first. Four rods, not a whip. */
  readonly tail: readonly number[];
  readonly tailDepth: number;
  readonly crestLength: number;
  readonly wingFeather: number;
  readonly tailFan: number;
  /** Downy fluff on the outline: 1 on the chick, near nothing on the adult. */
  readonly down: number;
  /** Half-width of the torso in the head-on views. */
  readonly girth: number;
  /** Broken navy bars along the back. */
  readonly stripes: number;
  /**
   * How much interior detail this stage carries, 0–1.
   *
   * The juvenile's cells are a third of the adult's area, and every interior
   * element — the pebbling, the dorsal bars, the pale underside, the hand claws —
   * costs the same number of *pixels* on both. Carried at full strength on the
   * chick they stop being detail and become noise, and the animal reads as a
   * jumble of overlapping panels rather than as a small fluffy raptor.
   */
  readonly detail: number;
  /** Thigh musculature bulge; the adult's drumstick is his heaviest mass. */
  readonly thighBulk: number;
}

const JUVENILE: MongoProportions = {
  scale: 0.62,
  hipHeight: 0.5,
  femur: 0.24,
  tibia: 0.26,
  metatarsus: 0.19,
  toe: 0.12,
  sickle: 0.13,
  spineLength: 0.25,
  chestRise: -0.02,
  hipDepth: 0.21,
  chestDepth: 0.22,
  bellyDepth: 0.21,
  neckLength: 0.19,
  neckThickness: 0.068,
  skullLength: 0.31,
  skullDepth: 0.175,
  jawDepth: 0.42,
  eyeRadius: 0.042,
  humerus: 0.13,
  forearm: 0.12,
  hand: 0.07,
  tail: [0.1, 0.085, 0.07, 0.05],
  tailDepth: 0.1,
  crestLength: 0.16,
  wingFeather: 0.17,
  tailFan: 0.16,
  down: 1,
  girth: 0.26,
  stripes: 3,
  thighBulk: 0.92,
  detail: 0.35,
};

const ADOLESCENT: MongoProportions = {
  scale: 0.7,
  hipHeight: 0.7,
  femur: 0.31,
  tibia: 0.34,
  metatarsus: 0.28,
  toe: 0.14,
  sickle: 0.115,
  spineLength: 0.43,
  chestRise: -0.04,
  hipDepth: 0.22,
  chestDepth: 0.21,
  bellyDepth: 0.19,
  neckLength: 0.3,
  neckThickness: 0.066,
  skullLength: 0.29,
  skullDepth: 0.175,
  jawDepth: 0.4,
  eyeRadius: 0.044,
  humerus: 0.17,
  forearm: 0.16,
  hand: 0.085,
  tail: [0.28, 0.24, 0.2, 0.16],
  tailDepth: 0.098,
  crestLength: 0.13,
  wingFeather: 0.22,
  tailFan: 0.19,
  down: 0.35,
  girth: 0.25,
  stripes: 5,
  thighBulk: 0.9,
  detail: 0.7,
};

const ADULT: MongoProportions = {
  scale: 0.82,
  hipHeight: 0.66,
  femur: 0.31,
  tibia: 0.34,
  metatarsus: 0.28,
  toe: 0.15,
  sickle: 0.11,
  spineLength: 0.5,
  chestRise: -0.055,
  hipDepth: 0.23,
  chestDepth: 0.24,
  bellyDepth: 0.19,
  neckLength: 0.37,
  neckThickness: 0.062,
  skullLength: 0.34,
  skullDepth: 0.155,
  jawDepth: 0.4,
  eyeRadius: 0.033,
  humerus: 0.19,
  forearm: 0.18,
  hand: 0.095,
  tail: [0.34, 0.3, 0.27, 0.24],
  tailDepth: 0.095,
  crestLength: 0.22,
  wingFeather: 0.26,
  tailFan: 0.21,
  down: 0.05,
  girth: 0.245,
  stripes: 5,
  thighBulk: 1.22,
  detail: 1,
};

export const MONGO_STAGES: Record<MongoStage, MongoProportions> = {
  juvenile: JUVENILE,
  adolescent: ADOLESCENT,
  adult: ADULT,
};

/**
 * The combined reach of one leg's thigh and shank.
 *
 * The choreography has to keep hip→ankle inside this on every frame: one
 * clamped frame locks the leg straight and the next tuck snaps it back, which
 * reads as a hop rather than as a walk.
 */
export function legReach(prop: MongoProportions): number {
  return prop.femur + prop.tibia;
}

/** Slack kept out of the two-bone solve so a straight leg never divides by zero. */
export const LEG_JOINT_SLACK = 0.0006;

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface LegPose {
  /**
   * Toe-tip contact point, in tile units along the facing axis, measured in the
   * *world* rather than off the pelvis — a planted foot has to stay planted
   * while the body surges over it.
   */
  readonly toeX: number;
  /** Height of the toe tip above the ground line. Zero is planted. */
  readonly lift: number;
  /** Metatarsus angle above the ground, radians. The high backward-leaning heel. */
  readonly meta: number;
  /** 0 = toe pads flat, 1 = rolled onto the tips at toe-off. */
  readonly roll: number;
  /**
   * Sickle-claw deployment, 0 retracted .. 1 swung down into a strike.
   *
   * Deliberately separate from `roll`: the toes roll forward at every toe-off
   * of every walk, and a sickle claw driven off that would flick out and stab
   * the floor twice per stride.
   */
  readonly sickle: number;
  /** Sideways offset used by the head-on views only. */
  readonly lateral: number;
  /** Widths only, 0..1: how near the camera this leg reads head-on. */
  readonly nearness: number;
}

export interface ArmPose {
  /** Shoulder→elbow angle from +X, radians. Rest points down and back. */
  readonly upper: number;
  /** Elbow→wrist angle, relative to the upper arm. */
  readonly fore: number;
  /** How far the primaries fan off the forearm: 0 folded, 1 spread wide. */
  readonly spread: number;
  /** Sideways offset used by the head-on views only. */
  readonly lateral: number;
}

export interface MongoPose {
  /** Whole-body travel along the facing axis — a lunge or a leap. */
  readonly surge: number;
  /** Whole-body vertical travel; negative lifts him off the ground. */
  readonly rise: number;
  /** Pelvis pitch. Positive tips the hips down and the shoulders up. */
  readonly pitch: number;
  /** Lateral body offset, head-on views only. */
  readonly sway: number;
  /** Spine flex: positive arches the back up over the hips. */
  readonly arch: number;
  /** Neck rotation about the chest. Positive coils the head back. */
  readonly neckCurl: number;
  /** 0 = the resting S, 1 = fully extended forward on a strike. */
  readonly neckReach: number;
  /**
   * Vertical correction applied to the head, on top of everything the body does.
   *
   * This is what buys avian head stabilisation: a walking bird's body bobs while
   * its head holds a fixed height, the neck absorbing the difference. Setting
   * this to the negative of the body's bob makes the head *exactly* level by
   * construction rather than approximately level by tuning, and head
   * stabilisation sells "real animal" harder than any other single trait in the
   * walk.
   */
  readonly headLift: number;
  /** Head yaw across the body, head-on views only, -1..1. */
  readonly headTurn: number;
  /** Head pitch relative to the neck. */
  readonly headTilt: number;
  /** Jaw opening, 0 shut .. 1 gaping. */
  readonly gape: number;
  /** Eye openness, 0 shut .. 1 wide. */
  readonly eyeOpen: number;
  /** Tail base angle above horizontal — positive lifts it. The rod swings as one. */
  readonly tailLift: number;
  /** Tail lateral swing, head-on views only. */
  readonly tailSway: number;
  /** Residual per-segment curve. Tiny: a dromaeosaur tail is rod-straightened. */
  readonly tailCurve: number;
  /** Rib expansion, -1..1. */
  readonly breathe: number;
  readonly nearLeg: LegPose;
  readonly farLeg: LegPose;
  readonly nearArm: ArmPose;
  readonly farArm: ArmPose;
  /** Contact-shadow scale; shrinks as he leaves the ground. */
  readonly shadow: number;
  /** Cycle phase, for deterministic per-frame noise. */
  readonly time: number;
}

/** The metatarsus angle a standing raptor holds, in radians above the ground. */
const REST_META = deg(66);
/** Rest angles for the folded wing-arm, measured from +X. */
const REST_UPPER_ARM = deg(160);
const REST_FOREARM = deg(-178);

export function restLeg(toeX: number): LegPose {
  return { toeX, lift: 0, meta: REST_META, roll: 0, sickle: 0, lateral: 0, nearness: 0.5 };
}

export function restArm(): ArmPose {
  return { upper: REST_UPPER_ARM, fore: REST_FOREARM, spread: 0, lateral: 0 };
}

/**
 * The standing pose every animation is written as edits to.
 *
 * The two feet are staggered rather than square: a raptor at rest stands with
 * one foot slightly ahead, and a perfectly symmetric stance reads as a museum
 * mount rather than as an animal.
 */
const REST_NEAR_TOE = 0.05;
const REST_FAR_TOE = -0.07;
const REST_TAIL_LIFT = deg(5);

export function restPose(): MongoPose {
  return {
    surge: 0,
    rise: 0,
    pitch: 0,
    sway: 0,
    arch: 0,
    neckCurl: 0,
    neckReach: 0,
    headLift: 0,
    headTurn: 0,
    headTilt: 0,
    gape: 0,
    eyeOpen: 1,
    tailLift: REST_TAIL_LIFT,
    tailSway: 0,
    tailCurve: 0,
    breathe: 0,
    nearLeg: restLeg(REST_NEAR_TOE),
    farLeg: restLeg(REST_FAR_TOE),
    nearArm: restArm(),
    farArm: restArm(),
    shadow: 1,
    time: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface LegJoints {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  readonly toeBase: Pt;
  readonly toeTip: Pt;
}

export interface MongoSkeleton {
  readonly pelvis: Pt;
  readonly chest: Pt;
  readonly neckMid: Pt;
  readonly headBase: Pt;
  readonly snout: Pt;
  readonly jawTip: Pt;
  readonly tailRoot: Pt;
  /** Tail joints, root first, tip last. */
  readonly tail: readonly Pt[];
  readonly nearLeg: LegJoints;
  readonly farLeg: LegJoints;
  readonly shoulder: Pt;
  readonly headAngle: number;
  readonly spineAngle: number;
}

/** How far back along the spine the tail roots out of the hips. */
const TAIL_ROOT_BACK = 0.1;
/** Where the shoulder joint sits relative to the chest node. */
const SHOULDER_FORWARD = -0.02;
const SHOULDER_DROP = 0.02;
/** The skull's rest pitch below the neck's line — a raptor carries its head level. */
const SKULL_REST_PITCH = deg(14);

/** Neck node placement as fractions of `neckLength`, in the chest's frame. */
const NECK_MID_BACK = -0.28;
const NECK_MID_RISE = -0.55;
const NECK_TOP_FORWARD = 0.7;
const NECK_TOP_RISE = -0.86;
/** Where the extended neck puts the head on a full strike. */
const NECK_REACH_FORWARD = 1.12;
const NECK_REACH_RISE = -0.34;

/**
 * Two-bone IK. `bend` picks the solution: +1 puts the middle joint on the
 * clockwise-on-screen side of root→end, which for a leg facing +X is *forward*.
 */
function solveTwoBone(root: Pt, end: Pt, upper: number, lower: number, bend: number): Pt {
  const span = Math.min(dist(root, end), upper + lower - LEG_JOINT_SLACK);
  const along =
    (span * span + upper * upper - lower * lower) / (2 * Math.max(span, LEG_JOINT_SLACK));
  const offSquared = upper * upper - along * along;
  const off = offSquared > 0 ? Math.sqrt(offSquared) : 0;
  const forward = dir(root, end);
  const side = perp(forward);
  return {
    x: root.x + forward.x * along + side.x * off * bend,
    y: root.y + forward.y * along + side.y * off * bend,
  };
}

function buildLeg(pose: LegPose, hip: Pt, prop: MongoProportions): LegJoints {
  const toeTip = { x: pose.toeX, y: GROUND_Y - pose.lift };
  // The toes roll forward onto their tips at push-off, which pivots the whole
  // foot about the tip rather than lifting it — that roll is what stops the
  // stance foot reading as a block sliding along the floor.
  //
  // The sign matters more than it looks: rolling onto the tips lifts the *heel*,
  // so the foot's base swings up. Inverted, it drives the heel through the floor
  // and — because the ankle hangs off the base — asks the leg to span far more
  // than the thigh and shank together can reach.
  const toeAngle = lerp(0, deg(46), pose.roll);
  const toeBase = add(toeTip, rot({ x: -prop.toe, y: 0 }, toeAngle));
  const ankle = add(toeBase, {
    x: -prop.metatarsus * Math.cos(pose.meta),
    y: -prop.metatarsus * Math.sin(pose.meta),
  });
  const knee = solveTwoBone(hip, ankle, prop.femur, prop.tibia, KNEE_FORWARD);
  return { hip, knee, ankle, toeBase, toeTip };
}

/** Screen side the knee solves onto in the +X-facing profile. */
const KNEE_FORWARD = -1;

export function buildSkeleton(pose: MongoPose, prop: MongoProportions): MongoSkeleton {
  const pelvis = {
    x: pose.surge,
    y: GROUND_Y - prop.hipHeight + pose.rise,
  };
  const spineAngle = pose.pitch;
  const chest = add(
    pelvis,
    rot(
      { x: prop.spineLength, y: prop.chestRise - pose.arch * prop.spineLength * ARCH_RISE },
      spineAngle,
    ),
  );
  const shoulder = add(chest, rot({ x: SHOULDER_FORWARD, y: SHOULDER_DROP }, spineAngle));

  const neckAngle = spineAngle + pose.neckCurl;
  const restTop = {
    x: prop.neckLength * NECK_TOP_FORWARD,
    y: prop.neckLength * NECK_TOP_RISE,
  };
  const reachTop = {
    x: prop.neckLength * NECK_REACH_FORWARD,
    y: prop.neckLength * NECK_REACH_RISE,
  };
  const topLocal = {
    x: lerp(restTop.x, reachTop.x, pose.neckReach),
    y: lerp(restTop.y, reachTop.y, pose.neckReach),
  };
  const rotatedTop = rot(topLocal, neckAngle);
  const headBase = { x: chest.x + rotatedTop.x, y: chest.y + rotatedTop.y + pose.headLift };
  const rotatedMid = rot(
    {
      x: lerp(prop.neckLength * NECK_MID_BACK, topLocal.x * NECK_REACH_MID_SHARE, pose.neckReach),
      y: prop.neckLength * NECK_MID_RISE,
    },
    neckAngle,
  );
  const neckMid = {
    x: chest.x + rotatedMid.x,
    y: chest.y + rotatedMid.y + pose.headLift * NECK_MID_LIFT_SHARE,
  };

  const headAngle = neckAngle + SKULL_REST_PITCH + pose.headTilt;
  const snout = add(headBase, rot({ x: prop.skullLength, y: 0 }, headAngle));
  const jawTip = add(
    headBase,
    rot({ x: prop.skullLength * JAW_LENGTH_SHARE, y: 0 }, headAngle + pose.gape * MAX_GAPE),
  );

  const tailRoot = add(pelvis, rot({ x: -TAIL_ROOT_BACK, y: -TAIL_ROOT_RISE }, spineAngle));
  const tail: Pt[] = [tailRoot];
  // `+ tailLift`, not `-`: with +Y down the screen, adding to an angle already
  // past π swings the tail *up*. Subtracting inverted every constant named
  // "lift" in the choreography — the pounce dropped its tail and the collapse
  // held its own aloft like a handle.
  let tailAngle = spineAngle + Math.PI + pose.tailLift;
  let node = tailRoot;
  prop.tail.forEach((segment, index) => {
    tailAngle += index === 0 ? 0 : pose.tailCurve;
    node = add(node, rot({ x: segment, y: 0 }, tailAngle));
    tail.push(node);
  });

  const hipCentre = add(pelvis, rot({ x: HIP_FORWARD, y: HIP_DROP }, spineAngle));
  const nearHip = { x: hipCentre.x, y: hipCentre.y };
  const farHip = { x: hipCentre.x - FAR_HIP_BACK, y: hipCentre.y };

  return {
    pelvis,
    chest,
    neckMid,
    headBase,
    snout,
    jawTip,
    tailRoot,
    tail,
    nearLeg: buildLeg(pose.nearLeg, nearHip, prop),
    farLeg: buildLeg(pose.farLeg, farHip, prop),
    shoulder,
    headAngle,
    spineAngle,
  };
}

/** How much of the spine's length a full arch lifts the shoulders by. */
const ARCH_RISE = 0.09;
/** Where the neck's middle control point goes once the neck is fully extended. */
const NECK_REACH_MID_SHARE = 0.42;
/** How much of the head's own correction the neck's middle takes, so the S bends rather than kinks. */
const NECK_MID_LIFT_SHARE = 0.45;
/** The lower jaw runs slightly short of the upper — the teeth overbite. */
const JAW_LENGTH_SHARE = 0.86;
/** How wide the jaws open at `gape` 1. */
const MAX_GAPE = deg(62);
/** How far the whole skull tips back as the jaws open. */
const UPPER_JAW_LIFT = deg(11);
const TAIL_ROOT_RISE = 0.05;
const HIP_FORWARD = 0.02;
const HIP_DROP = 0.03;
/**
 * How far behind the near hip the far one sits in profile.
 *
 * Zero puts the two legs exactly on top of each other and the animal reads as
 * one-legged whenever the stride passes through zero.
 */
const FAR_HIP_BACK = 0.12;

// ── Painting primitives ──────────────────────────────────────────────────────

function traceOutline(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // A closed loop of straight segments reads as a polygon at this size; the
  // midpoint-quadratic walk rounds every corner without needing hand-placed
  // control points on a shape whose vertices move every frame.
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

const OUTLINE_WIDTH = 0.011;

/**
 * The colour of an *interior* edge — where two of his own parts overlap.
 *
 * Softened toward the hide on the low-detail stages. The silhouette's outline
 * has to stay hard at every size, but the neck-over-shoulder, thigh-over-flank
 * and arm-over-ribs seams do not: drawn at full contrast on a sheet a third the
 * area they stop reading as one animal's overlapping parts and start reading as
 * a suit of plates.
 */
function innerEdge(prop: MongoProportions, shade = 0): string {
  return mix(mix(HIDE.dorsal, HIDE.base, 1 - prop.detail), HIDE.shadow, shade);
}

function fillAndOutline(ctx: Ctx, fill: string, outline: string, width = OUTLINE_WIDTH): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** A tapered limb segment: a quad from `a` at `halfA` to `b` at `halfB`. */
function limbPath(a: Pt, b: Pt, halfA: number, halfB: number): Pt[] {
  const along = dir(a, b);
  const side = perp(along);
  return [
    { x: a.x + side.x * halfA, y: a.y + side.y * halfA },
    { x: b.x + side.x * halfB, y: b.y + side.y * halfB },
    { x: b.x - side.x * halfB, y: b.y - side.y * halfB },
    { x: a.x - side.x * halfA, y: a.y - side.y * halfA },
  ];
}

function drawLimb(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  halfA: number,
  halfB: number,
  fill: string,
  outline: string,
): void {
  traceOutline(ctx, limbPath(a, b, halfA, halfB));
  fillAndOutline(ctx, fill, outline);
}

/**
 * The outline of a tapered ribbon through a chain of nodes.
 *
 * Limbs built as one quad per segment show a stroked seam at every joint, and a
 * tail drawn that way reads as a string of sausages rather than as one animal's
 * tail — which is what the first bake of this sprite did. Offsetting a single
 * polyline by a per-node half-width gives one continuous silhouette instead.
 */
function ribbonOutline(nodes: readonly Pt[], halfAt: readonly number[]): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const before = nodes[Math.max(0, i - 1)];
    const after = nodes[Math.min(nodes.length - 1, i + 1)];
    const side = perp(dir(before, after));
    const half = halfAt[i];
    left.push({ x: nodes[i].x + side.x * half, y: nodes[i].y + side.y * half });
    right.unshift({ x: nodes[i].x - side.x * half, y: nodes[i].y - side.y * half });
  }
  return [...left, ...right];
}

const SHADOW_ALPHA = 0.32;
const SHADOW_STEPS = 3;

export function drawGroundShadow(ctx: Ctx, cx: number, rx: number, ry: number): void {
  if (rx <= 0 || ry <= 0) return;
  for (let step = 0; step < SHADOW_STEPS; step++) {
    const t = step / SHADOW_STEPS;
    ctx.beginPath();
    ctx.ellipse(cx, GROUND_Y + SHADOW_DROP, rx * (1 - t * 0.3), ry * (1 - t * 0.3), 0, 0, TWO_PI);
    ctx.fillStyle = rgba(GROUND_SHADOW, SHADOW_ALPHA / SHADOW_STEPS);
    ctx.fill();
  }
}

const SHADOW_DROP = 0.03;

// ── Hide texture ─────────────────────────────────────────────────────────────

const SPECKLE_COUNT = 70;
const SPECKLE_RADIUS = 0.008;
const SPECKLE_ALPHA = 0.12;

/**
 * Pebbled scale texture, painted as a field of tiny dots inside whatever path is
 * currently clipped. Flat colour at this size reads as plastic; the speckle is
 * the difference between a toy and a hide.
 */
function paintPebbling(ctx: Ctx, box: InkBounds, seed: number, detail = 1): void {
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    const x = lerp(box.minX, box.maxX, hash2(seed, i * 2));
    const y = lerp(box.minY, box.maxY, hash2(seed + 1, i * 2 + 1));
    const shade = hash2(seed + 2, i) > 0.5 ? HIDE.light : HIDE.dorsal;
    ctx.beginPath();
    ctx.arc(x, y, SPECKLE_RADIUS * (0.6 + hash2(seed + 3, i)), 0, TWO_PI);
    ctx.fillStyle = rgba(shade, SPECKLE_ALPHA * detail);
    ctx.fill();
  }
}

interface InkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boundsOf(points: readonly Pt[]): InkBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

const STRIPE_ALPHA = 0.45;
const STRIPE_HALF_WIDTH = 0.016;
const STRIPE_DROP_SHARE = 0.32;
const STRIPE_BREAK_CHANCE = 0.42;

/**
 * Broken navy bars down the back — tiger striping, not zebra: each bar is a
 * short stroke hanging off the dorsal line, and roughly two in five are split
 * into two stubs so the pattern never reads as a ladder.
 */
function paintDorsalBars(
  ctx: Ctx,
  spine: readonly Pt[],
  depthAt: (t: number) => number,
  count: number,
  seed: number,
  detail = 1,
): void {
  ctx.strokeStyle = rgba(HIDE.dorsal, STRIPE_ALPHA * detail);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const anchor = samplePolyline(spine, t);
    const along = samplePolylineDirection(spine, t);
    const down = perp(along);
    const depth = depthAt(t) * STRIPE_DROP_SHARE * lerp(0.7, 1.15, hash2(seed, i));
    const broken = hash2(seed + 9, i) < STRIPE_BREAK_CHANCE;
    ctx.lineWidth = STRIPE_HALF_WIDTH * 2 * lerp(0.75, 1.2, hash2(seed + 4, i));
    if (broken) {
      const gap = depth * 0.28;
      drawBar(ctx, anchor, down, depth * 0.1, depth * 0.45);
      drawBar(ctx, anchor, down, depth * 0.45 + gap, depth);
      continue;
    }
    drawBar(ctx, anchor, down, depth * 0.05, depth);
  }
}

function drawBar(ctx: Ctx, anchor: Pt, down: Pt, from: number, to: number): void {
  ctx.beginPath();
  ctx.moveTo(anchor.x + down.x * from, anchor.y + down.y * from);
  ctx.lineTo(anchor.x + down.x * to, anchor.y + down.y * to);
  ctx.stroke();
}

function samplePolyline(points: readonly Pt[], t: number): Pt {
  const span = (points.length - 1) * clamp01(t);
  const index = Math.min(points.length - 2, Math.floor(span));
  return mid(points[index], points[index + 1], span - index);
}

function samplePolylineDirection(points: readonly Pt[], t: number): Pt {
  const span = (points.length - 1) * clamp01(t);
  const index = Math.min(points.length - 2, Math.floor(span));
  return dir(points[index], points[index + 1]);
}

// ── Feathers ─────────────────────────────────────────────────────────────────

/**
 * One pennaceous feather: a lens with a visible rachis, rooted deeper magenta
 * and paling toward the tip.
 */
function drawFeather(ctx: Ctx, root: Pt, angle: number, length: number, width: number): void {
  const tip = add(root, rot({ x: length, y: 0 }, angle));
  const side = perp(dir(root, tip));
  const belly = width * 0.5;
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(
    root.x + (tip.x - root.x) * 0.45 + side.x * belly,
    root.y + (tip.y - root.y) * 0.45 + side.y * belly,
    tip.x,
    tip.y,
  );
  ctx.quadraticCurveTo(
    root.x + (tip.x - root.x) * 0.45 - side.x * belly,
    root.y + (tip.y - root.y) * 0.45 - side.y * belly,
    root.x,
    root.y,
  );
  ctx.closePath();
  ctx.fillStyle = PLUME.vane;
  ctx.fill();
  ctx.strokeStyle = rgba(PLUME.root, FEATHER_EDGE_ALPHA);
  ctx.lineWidth = FEATHER_EDGE_WIDTH;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = rgba(PLUME.root, RACHIS_ALPHA);
  ctx.lineWidth = RACHIS_WIDTH;
  ctx.stroke();
}

const FEATHER_EDGE_ALPHA = 0.75;
const FEATHER_EDGE_WIDTH = 0.007;
const RACHIS_ALPHA = 0.55;
const RACHIS_WIDTH = 0.005;
const FEATHER_WIDTH_SHARE = 0.24;

/**
 * A fan of feathers rooted along a line, sweeping from `fromAngle` to
 * `toAngle`. Used for the forearm's primaries and the tail's fan alike.
 */
function drawFeatherFan(
  ctx: Ctx,
  rootA: Pt,
  rootB: Pt,
  fromAngle: number,
  toAngle: number,
  length: number,
  count: number,
  lengthFalloff = 1,
): void {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const root = mid(rootA, rootB, t);
    const angle = lerp(fromAngle, toAngle, t);
    const own = length * lerp(1, lengthFalloff, Math.abs(t - 0.5) * 2);
    drawFeather(ctx, root, angle, own, own * FEATHER_WIDTH_SHARE);
  }
}

/**
 * Downy fluff on the juvenile's outline — short pale strokes standing off the
 * silhouette. It is drawn *outside* the body path on purpose: down reads as a
 * halo, and painted inside it just muddies the hide colour.
 */
/**
 * Downy fluff standing off an outline.
 *
 * Two rules learned the hard way. Tufts, never a continuous stroke: a stroked
 * halo is a closed loop with visible ends where it stops, which at tile size
 * reads as a selection marquee. And only on the segments that are genuinely on
 * the *outside* of the finished figure — the body's own outline runs behind the
 * neck, the skull and the legs, and tufts sprouting along those stretches land
 * in the middle of the sprite and read as stitching.
 */
function paintDown(
  ctx: Ctx,
  outline: readonly Pt[],
  amount: number,
  seed: number,
  exposed?: (index: number) => boolean,
  closed = true,
): void {
  if (amount <= 0) return;
  ctx.lineCap = 'round';
  // An *open* chain — the tail is one — must not wrap. Treated as a loop it
  // grows a closing segment from the tail's tip back to the hips and sprouts
  // tufts the whole way, which paints a dashed diagonal straight across the
  // middle of the animal.
  const last = closed ? outline.length : outline.length - 1;
  for (let i = 0; i < last; i++) {
    if (exposed !== undefined && !exposed(i)) continue;
    const here = outline[i];
    const next = outline[(i + 1) % outline.length];
    const away = perp(dir(next, here));
    for (let j = 0; j < DOWN_TUFTS_PER_SEGMENT; j++) {
      const t = (j + 0.5) / DOWN_TUFTS_PER_SEGMENT;
      const root = mid(here, next, t);
      const wobble = hash2(seed + i * 2, j);
      const length = DOWN_LENGTH * amount * (DOWN_MIN_TUFT + wobble);
      const lean = (hash2(seed + i * 2 + 1, j) - 0.5) * DOWN_LEAN;
      const tip = add(root, rot({ x: away.x * length, y: away.y * length }, lean));
      ctx.strokeStyle = rgba(DOWN_FLUFF, DOWN_ALPHA * amount * (DOWN_MIN_ALPHA + wobble));
      ctx.lineWidth = DOWN_WIDTH * (DOWN_MIN_TUFT + wobble);
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
  }
}

const DOWN_MIN_TUFT = 0.45;
const DOWN_MIN_ALPHA = 0.35;
const DOWN_LEAN = 0.5;

const DOWN_ALPHA = 0.34;
const DOWN_WIDTH = 0.009;
const DOWN_LENGTH = 0.034;
const DOWN_TUFTS_PER_SEGMENT = 22;

// ── Side view ────────────────────────────────────────────────────────────────

/**
 * The body outline, walked as a closed loop: dorsal line from the tail base
 * forward over the hips and shoulders, down the front of the chest, along the
 * belly and back to the tail base.
 *
 * Built as one path rather than as stacked ovals because the single thing that
 * sells "horizontal-spined dinosaur" is an unbroken back line from hips to
 * shoulders, and stacked masses always show their seams at this size.
 */
function bodyOutline(sk: MongoSkeleton, prop: MongoProportions, breathe: number): Pt[] {
  const spine = dir(sk.pelvis, sk.chest);
  const down = perp(spine);
  const hipDepth = prop.hipDepth;
  const chestDepth = prop.chestDepth * (1 + breathe * BREATH_DEPTH);
  const bellyDepth = prop.bellyDepth * (1 + breathe * BREATH_DEPTH * 0.5);

  const span = prop.spineLength;
  /** A point in the spine's own frame: `along` forward of the pelvis, `drop` below it. */
  const at = (along: number, drop: number): Pt => ({
    x: sk.pelvis.x + spine.x * along * span + down.x * drop,
    y: sk.pelvis.y + spine.y * along * span + down.y * drop,
  });

  // Index order matters: `BODY_OUTLINE_EXPOSED` names the stretches of this loop
  // that are on the finished figure's own silhouette.
  return [
    at(TAIL_JOIN_ALONG, -hipDepth * TAIL_JOIN_TOP),
    at(HIP_CREST_ALONG, -hipDepth),
    // The saddle between hips and shoulders. Without it the back is a plank and
    // the animal reads as a plastic toy however good the ends are.
    at(SADDLE_ALONG, -hipDepth * SADDLE_SHARE),
    at(WITHERS_ALONG, -chestDepth * WITHERS_SHARE),
    // The shoulder runs on into the neck rather than stopping at a corner; a
    // notch here is what made the first bake look like a head bolted to a box.
    at(NECK_ROOT_ALONG, -chestDepth * NECK_ROOT_RISE),
    at(THROAT_ALONG, chestDepth * THROAT_DROP),
    at(BRISKET_ALONG, chestDepth),
    at(BELLY_ALONG, bellyDepth),
    at(VENT_ALONG, hipDepth * VENT_SHARE),
    at(TAIL_JOIN_ALONG, prop.tailDepth * TAIL_JOIN_UNDER),
  ];
}

const BREATH_DEPTH = 0.05;
/**
 * Which segments of the body outline are on the outside of the finished figure.
 *
 * The back and the rump are; the front and the underside run behind the neck,
 * the skull and the legs, which are all painted after the body.
 */
const BODY_OUTLINE_EXPOSED = new Set([0, 1, 2, 8]);
/** Where the body's outline meets the tail, as a share of the spine behind the hips. */
const TAIL_JOIN_ALONG = -0.3;
const TAIL_JOIN_TOP = 0.5;
const TAIL_JOIN_UNDER = 1.2;
const HIP_CREST_ALONG = -0.02;
const SADDLE_ALONG = 0.42;
/** The dip between hips and shoulders. Under 1 it saddles; at 1 the back is flat. */
const SADDLE_SHARE = 0.84;
const WITHERS_ALONG = 0.94;
const WITHERS_SHARE = 0.96;
const NECK_ROOT_ALONG = 1.16;
const NECK_ROOT_RISE = 0.5;
const THROAT_ALONG = 1.14;
const THROAT_DROP = 0.42;
const BRISKET_ALONG = 0.9;
const BELLY_ALONG = 0.42;
const VENT_ALONG = -0.06;
const VENT_SHARE = 0.86;

/** Depth of the body at a given fraction along the spine, for the dorsal bars. */
function bodyDepthAt(prop: MongoProportions, t: number): number {
  return lerp(prop.hipDepth, prop.chestDepth, t) * 2;
}

function drawTailSide(ctx: Ctx, sk: MongoSkeleton, prop: MongoProportions, shade: number): void {
  const nodes = sk.tail;
  const halfAt = nodes.map((_node, index) => {
    const t = index / (nodes.length - 1);
    // A dromaeosaur tail keeps some depth through its muscular base and only
    // whips down to nothing over the last third, so the taper is biased late —
    // but only slightly. A hard bias leaves a broom handle behind the hips.
    return lerp(prop.tailDepth, TAIL_TIP_DEPTH, Math.pow(t, TAIL_TAPER_BIAS));
  });
  const outline = ribbonOutline(nodes, halfAt);
  traceOutline(ctx, outline);
  fillAndOutline(ctx, mix(HIDE.base, HIDE.shadow, shade), mix(HIDE.dorsal, HIDE.shadow, shade));

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  paintPebbling(ctx, boundsOf(outline), TAIL_SPECKLE_SEED, prop.detail);
  // Two bars at the tail base and no further. Carried down the whole tail they
  // turn the silhouette into a centipede — a long rod ruled into equal segments
  // is the one pattern that unmistakably says "many legs".
  const base = [nodes[0], nodes[1]];
  paintDorsalBars(
    ctx,
    base,
    () => prop.tailDepth * 2,
    TAIL_BASE_BARS,
    TAIL_STRIPE_SEED,
    prop.detail,
  );
  ctx.restore();

  const tip = nodes[nodes.length - 1];
  const before = nodes[nodes.length - 2];
  const tailAngle = Math.atan2(tip.y - before.y, tip.x - before.x);
  // The fan is rooted a little short of the tip so the last of the rod still
  // reads as tail rather than as a feather stalk.
  drawFeatherFan(
    ctx,
    mid(before, tip, FAN_ROOT_ALONG),
    tip,
    tailAngle - TAIL_FAN_SPREAD,
    tailAngle + TAIL_FAN_SPREAD,
    prop.tailFan,
    TAIL_FAN_FEATHERS,
    TAIL_FAN_FALLOFF,
  );
}

const TAIL_TIP_DEPTH = 0.015;
const TAIL_TAPER_BIAS = 1.9;
const TAIL_SPECKLE_SEED = 61;
const TAIL_STRIPE_SEED = 77;
const TAIL_BASE_BARS = 2;
const FAN_ROOT_ALONG = 0.35;
const TAIL_FAN_SPREAD = deg(26);
const TAIL_FAN_FEATHERS = 5;
const TAIL_FAN_FALLOFF = 0.62;

function drawLegSide(
  ctx: Ctx,
  leg: LegJoints,
  prop: MongoProportions,
  shade: number,
  pose: LegPose,
): void {
  const hide = mix(HIDE.base, HIDE.shadow, shade);
  const dark = innerEdge(prop, shade);
  const kneeHalf = prop.femur * KNEE_HALF_SHARE;
  const shankHalf = prop.femur * SHANK_HALF_SHARE;
  const ankleHalf = prop.femur * ANKLE_HALF_SHARE;
  const toeTipHalf = prop.femur * TOE_TIP_HALF_SHARE;
  // The drumstick: a raptor's thigh is its single heaviest muscle mass, and a
  // thigh drawn as a parallel rod is the fastest way to make the whole animal
  // read as a lizard on stilts.
  const thighHalf = prop.femur * THIGH_HALF_SHARE * prop.thighBulk;
  const thighMid = mid(leg.hip, leg.knee, THIGH_BULGE_ALONG);
  const bulgeSide = perp(dir(leg.hip, leg.knee));
  traceOutline(ctx, [
    add(leg.hip, { x: bulgeSide.x * thighHalf, y: bulgeSide.y * thighHalf }),
    add(thighMid, {
      x: bulgeSide.x * thighHalf * THIGH_BULGE,
      y: bulgeSide.y * thighHalf * THIGH_BULGE,
    }),
    add(leg.knee, { x: bulgeSide.x * kneeHalf, y: bulgeSide.y * kneeHalf }),
    add(leg.knee, { x: -bulgeSide.x * kneeHalf, y: -bulgeSide.y * kneeHalf }),
    add(thighMid, {
      x: -bulgeSide.x * thighHalf * THIGH_BACK_BULGE,
      y: -bulgeSide.y * thighHalf * THIGH_BACK_BULGE,
    }),
    add(leg.hip, { x: -bulgeSide.x * thighHalf, y: -bulgeSide.y * thighHalf }),
  ]);
  fillAndOutline(ctx, hide, dark);

  drawLimb(ctx, leg.knee, leg.ankle, kneeHalf, shankHalf, hide, dark);
  drawLimb(ctx, leg.ankle, leg.toeBase, shankHalf, ankleHalf, mix(hide, HIDE.dorsal, 0.2), dark);

  const toeAlong = dir(leg.toeBase, leg.toeTip);
  const toeSide = perp(toeAlong);
  drawLimb(ctx, leg.toeBase, leg.toeTip, ankleHalf, toeTipHalf, hide, dark);
  // Toe III trails behind the weight-bearing toe, which is what stops the foot
  // reading as a single flipper.
  const trailTip = add(
    leg.toeBase,
    rot({ x: -prop.toe * TRAILING_TOE_SHARE, y: 0 }, TRAILING_TOE_ANGLE),
  );
  drawLimb(
    ctx,
    leg.toeBase,
    trailTip,
    ankleHalf * TRAILING_TOE_GIRTH,
    toeTipHalf,
    mix(hide, HIDE.shadow, 0.25),
    dark,
  );

  // The claw on the ground-bearing toes.
  drawClaw(ctx, leg.toeTip, toeAlong, toeSide, prop.sickle * GROUND_CLAW_SHARE, shade);

  // The sickle claw: held retracted, clear of the floor. A hook visible on the
  // inner toe in every non-pounce frame is the single most diagnostic thing a
  // dromaeosaur silhouette has.
  // Rooted forward of the ankle and clear of the metatarsus. Tucked in against
  // the leg it is a near-black shape on a dark leg, which is no shape at all —
  // the claw only does its job when it breaks the outline.
  const sickleRoot = add(leg.toeBase, {
    x: toeAlong.x * prop.toe * SICKLE_ROOT_ALONG - toeSide.x * prop.femur * SICKLE_ROOT_UP,
    y: toeAlong.y * prop.toe * SICKLE_ROOT_ALONG - toeSide.y * prop.femur * SICKLE_ROOT_UP,
  });
  drawSickle(ctx, sickleRoot, Math.atan2(toeAlong.y, toeAlong.x), prop.sickle, pose.sickle, shade);
}

const THIGH_HALF_SHARE = 0.34;
const THIGH_BULGE_ALONG = 0.42;
const THIGH_BULGE = 1.18;
const THIGH_BACK_BULGE = 1.34;
const KNEE_HALF_SHARE = 0.15;
const SHANK_HALF_SHARE = 0.115;
const ANKLE_HALF_SHARE = 0.088;
const TOE_TIP_HALF_SHARE = 0.036;
const TRAILING_TOE_SHARE = 0.34;
const TRAILING_TOE_GIRTH = 0.7;
const TRAILING_TOE_ANGLE = deg(-24);
const GROUND_CLAW_SHARE = 0.55;
const SICKLE_ROOT_ALONG = 0.82;
const SICKLE_ROOT_UP = 0.05;

function drawClaw(ctx: Ctx, root: Pt, along: Pt, side: Pt, length: number, shade: number): void {
  const tip = add(root, {
    x: along.x * length + side.x * length * 0.5,
    y: along.y * length + side.y * length * 0.5,
  });
  ctx.beginPath();
  ctx.moveTo(root.x - side.x * CLAW_HALF, root.y - side.y * CLAW_HALF);
  ctx.quadraticCurveTo(
    root.x + along.x * length * 0.6,
    root.y + along.y * length * 0.6,
    tip.x,
    tip.y,
  );
  ctx.lineTo(root.x + side.x * CLAW_HALF, root.y + side.y * CLAW_HALF);
  ctx.closePath();
  ctx.fillStyle = mix(CLAW, HIDE.shadow, shade);
  ctx.fill();
}

const CLAW_HALF = 0.008;

/**
 * A hand claw. Pale keratin like the sickle, because the same near-black on the
 * same dark limb produced the same result: a claw drawn every frame and visible
 * in none of them, which at the rake's peak left the arm ending in a bare hook.
 */
function drawFingerClaw(
  ctx: Ctx,
  root: Pt,
  along: Pt,
  side: Pt,
  length: number,
  shade: number,
): void {
  const tip = add(root, {
    x: along.x * length + side.x * length * FINGER_CLAW_HOOK,
    y: along.y * length + side.y * length * FINGER_CLAW_HOOK,
  });
  ctx.beginPath();
  ctx.moveTo(root.x - side.x * CLAW_HALF, root.y - side.y * CLAW_HALF);
  ctx.quadraticCurveTo(
    root.x + along.x * length * 0.6,
    root.y + along.y * length * 0.6,
    tip.x,
    tip.y,
  );
  ctx.lineTo(root.x + side.x * CLAW_HALF, root.y + side.y * CLAW_HALF);
  ctx.closePath();
  // The same shade share the sickle uses: a hand claw depth-shaded like the limb
  // it hangs off comes out olive, and at tile size that is a smudge of dirt.
  ctx.fillStyle = mix(SICKLE_KERATIN, HIDE.shadow, shade * SICKLE_SHADE_SHARE);
  ctx.fill();
  ctx.strokeStyle = rgba(CLAW, SICKLE_OUTLINE_ALPHA);
  ctx.lineWidth = SICKLE_OUTLINE_WIDTH;
  ctx.stroke();
}

const FINGER_CLAW_HOOK = 0.75;
/** Below this detail budget the hand is fingers only — its claws are a pixel. */
const HAND_CLAW_DETAIL_FLOOR = 0.5;

/**
 * The killing claw — a deep hook, drawn with the concave edge trailing and a
 * pale keratin highlight down its spine so it stays legible against a dark leg.
 */
function drawSickle(
  ctx: Ctx,
  root: Pt,
  toeAngle: number,
  length: number,
  deployed: number,
  shade: number,
): void {
  // Retracted it points up and back; deployed on a pounce it swings down and
  // forward into the strike.
  const angle = toeAngle + lerp(RETRACTED_SICKLE_ANGLE, DEPLOYED_SICKLE_ANGLE, clamp01(deployed));
  // Built as a tapered ribbon along a curved centreline rather than as two
  // quadratics that meet at both ends: those two curves very nearly retraced
  // each other, and the claw baked as a hairline nobody could see.
  const nodes: Pt[] = [];
  const halves: number[] = [];
  for (let step = 0; step <= SICKLE_STEPS; step++) {
    const t = step / SICKLE_STEPS;
    const local = {
      x: length * t,
      y: -length * SICKLE_CURVE * Math.sin(t * Math.PI * SICKLE_ARC_SHARE),
    };
    nodes.push(add(root, rot(local, angle)));
    halves.push(lerp(SICKLE_HALF, SICKLE_TIP_HALF, t * t));
  }
  traceOutline(ctx, ribbonOutline(nodes, halves));
  // Depth-shaded far less than the limb it sits on. Keratin is the one part of
  // him that is genuinely bright, and shading the far foot's claw the way the
  // far leg is shaded takes the identifying cue off half of every frame.
  ctx.fillStyle = mix(SICKLE_KERATIN, HIDE.shadow, shade * SICKLE_SHADE_SHARE);
  ctx.fill();
  ctx.strokeStyle = rgba(CLAW, SICKLE_OUTLINE_ALPHA);
  ctx.lineWidth = SICKLE_OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

const SICKLE_SHADE_SHARE = 0.4;

const SICKLE_STEPS = 5;
/** How much of a half-sine the hook sweeps; under 1 it stays hooked, not curled. */
const SICKLE_ARC_SHARE = 0.62;
const SICKLE_TIP_HALF = 0.002;

const RETRACTED_SICKLE_ANGLE = deg(-44);
const DEPLOYED_SICKLE_ANGLE = deg(-16);
const SICKLE_CURVE = 0.9;
const SICKLE_HALF = 0.018;
const SICKLE_OUTLINE_ALPHA = 0.9;
const SICKLE_OUTLINE_WIDTH = 0.009;

function drawArmSide(
  ctx: Ctx,
  sk: MongoSkeleton,
  arm: ArmPose,
  prop: MongoProportions,
  shade: number,
): void {
  const shoulder = sk.shoulder;
  const elbow = add(shoulder, rot({ x: prop.humerus, y: 0 }, arm.upper));
  const wrist = add(elbow, rot({ x: prop.forearm, y: 0 }, arm.upper + arm.fore));
  const foreAngle = arm.upper + arm.fore;

  // Primaries first, so the arm itself sits over their roots and the wing reads
  // as feathers growing out of a forearm rather than as a fan taped to it.
  //
  // They trail well off the forearm's own line rather than doubling back along
  // it: aimed down the arm, a folded wing's feathers hide underneath their own
  // bones and the only pink that survives is a sliver at the elbow.
  const sweep = lerp(FOLDED_PRIMARY_SWEEP, SPREAD_PRIMARY_SWEEP, arm.spread);
  const trail = foreAngle + PRIMARY_TRAIL;
  drawFeatherFan(
    ctx,
    elbow,
    wrist,
    trail - sweep,
    trail + sweep * PRIMARY_SWEEP_BIAS,
    prop.wingFeather * lerp(1, SPREAD_PRIMARY_LENGTH, arm.spread),
    PRIMARY_COUNT,
    PRIMARY_FALLOFF,
  );

  const hide = mix(HIDE.base, HIDE.shadow, shade);
  const dark = innerEdge(prop, shade);
  drawLimb(ctx, shoulder, elbow, UPPER_ARM_HALF, ELBOW_HALF, hide, dark);
  drawLimb(ctx, elbow, wrist, ELBOW_HALF, WRIST_HALF, hide, dark);

  // The hand: three long clawed fingers, held with the palm facing inward.
  const handAngle = foreAngle + HAND_DROOP;
  for (let finger = 0; finger < FINGER_COUNT; finger++) {
    const spread = (finger - (FINGER_COUNT - 1) / 2) * FINGER_SPREAD;
    const length = prop.hand * lerp(1, FINGER_FALLOFF, Math.abs(finger - 1));
    const tip = add(wrist, rot({ x: length, y: 0 }, handAngle + spread));
    drawLimb(ctx, wrist, tip, WRIST_HALF * 0.8, FINGER_TIP_HALF, hide, dark);
    if (prop.detail < HAND_CLAW_DETAIL_FLOOR) continue;
    const along = dir(wrist, tip);
    drawFingerClaw(ctx, tip, along, perp(along), prop.sickle * FINGER_CLAW_SHARE, shade);
  }
}

const UPPER_ARM_HALF = 0.032;
const ELBOW_HALF = 0.024;
const WRIST_HALF = 0.017;
const FOLDED_PRIMARY_SWEEP = deg(30);
/** How far off the forearm's own line the primaries trail. */
const PRIMARY_TRAIL = deg(-142);
const SPREAD_PRIMARY_SWEEP = deg(64);
const PRIMARY_SWEEP_BIAS = 0.55;
const SPREAD_PRIMARY_LENGTH = 1.7;
const PRIMARY_COUNT = 6;
const PRIMARY_FALLOFF = 0.68;
const HAND_DROOP = deg(24);
const FINGER_COUNT = 3;
const FINGER_SPREAD = deg(21);
const FINGER_FALLOFF = 0.72;
const FINGER_TIP_HALF = 0.009;
const FINGER_CLAW_SHARE = 0.95;

/**
 * The skull: a long low wedge with a pronounced antorbital notch, a lower jaw
 * hinged at the back, teeth that only show when the mouth is open, and the
 * yellow slit-pupilled eye set high and forward.
 */
function drawHeadSide(ctx: Ctx, sk: MongoSkeleton, pose: MongoPose, prop: MongoProportions): void {
  // The skull itself rotates *up* a little as the jaws open. A gape where only
  // the mandible drops reads as a wedge hinging, not as a mouth opening.
  const angle = sk.headAngle - pose.gape * UPPER_JAW_LIFT;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const down = perp(along);
  const depth = prop.skullDepth;
  const len = prop.skullLength;

  const at = (forward: number, drop: number): Pt => ({
    x: sk.headBase.x + along.x * forward * len + down.x * drop * depth,
    y: sk.headBase.y + along.y * forward * len + down.y * drop * depth,
  });

  // The crest first, so the skull is painted over its roots and the feathers
  // read as growing out of the head rather than as a hat on top of it.
  drawCrestSide(ctx, prop, angle, at);

  // Upper skull: occiput, brow ridge, the antorbital dip that every theropod
  // skull has, then a long low snout. The dip is what stops the profile reading
  // as a crocodile's smooth wedge.
  const toothRowBack = at(SKULL_TOOTH_BACK_ALONG, SKULL_TOOTH_BACK);
  const snoutTip = at(1, SKULL_TIP_DROP);
  const upper = [
    at(0, -SKULL_CROWN),
    at(SKULL_BROW_ALONG, -SKULL_BROW),
    at(SKULL_NOTCH_ALONG, -SKULL_NOTCH),
    at(SKULL_NASAL_ALONG, -SKULL_NASAL),
    at(1, -SKULL_TIP_RISE),
    snoutTip,
    toothRowBack,
    at(0, SKULL_HINGE),
  ];

  // Lower jaw, hinged at the head base and swung open by `gape`. Its top edge
  // is authored on the skull's own tooth row in the same depth units, so at
  // gape zero the two close flush instead of leaving a gap along the mouth.
  const jawAngle = angle + pose.gape * MAX_GAPE;
  const jawAlong = { x: Math.cos(jawAngle), y: Math.sin(jawAngle) };
  const jawDown = perp(jawAlong);
  const jawAt = (forward: number, drop: number): Pt => ({
    x: sk.headBase.x + jawAlong.x * forward * len + jawDown.x * drop * depth,
    y: sk.headBase.y + jawAlong.y * forward * len + jawDown.y * drop * depth,
  });
  const jawDepth = prop.jawDepth;
  const jawTipTop = jawAt(JAW_LENGTH_SHARE, SKULL_TIP_DROP + JAW_OVERBITE);
  const jaw = [
    jawAt(0, SKULL_HINGE),
    jawAt(SKULL_TOOTH_BACK_ALONG, SKULL_TOOTH_BACK),
    jawTipTop,
    jawAt(JAW_LENGTH_SHARE, SKULL_TIP_DROP + JAW_OVERBITE + jawDepth * JAW_TIP_DEPTH_SHARE),
    jawAt(JAW_CHIN_ALONG, SKULL_TOOTH_BACK + jawDepth),
    jawAt(0, SKULL_HINGE + jawDepth * JAW_BACK_DEPTH_SHARE),
  ];

  if (pose.gape > GAPE_MOUTH_VISIBLE) {
    // The gullet, painted between the jaws before either is drawn over it.
    ctx.beginPath();
    ctx.moveTo(at(0, SKULL_HINGE).x, at(0, SKULL_HINGE).y);
    ctx.lineTo(snoutTip.x, snoutTip.y);
    ctx.lineTo(jawTipTop.x, jawTipTop.y);
    ctx.closePath();
    ctx.fillStyle = MOUTH_FLESH;
    ctx.fill();
  }

  traceOutline(ctx, jaw);
  fillAndOutline(ctx, mix(HIDE.base, HIDE.belly, JAW_PALE), HIDE.dorsal);
  if (pose.gape > GAPE_TEETH_VISIBLE) {
    drawTeeth(
      ctx,
      jawAt(JAW_CHIN_ALONG, SKULL_TOOTH_BACK),
      jawTipTop,
      { x: -jawDown.x, y: -jawDown.y },
      TOOTH_LENGTH * LOWER_TOOTH_SHARE,
    );
  }

  traceOutline(ctx, upper);
  fillAndOutline(ctx, HIDE.base, HIDE.dorsal);
  ctx.save();
  traceOutline(ctx, upper);
  ctx.clip();
  paintPebbling(ctx, boundsOf(upper), HEAD_SPECKLE_SEED, prop.detail);
  ctx.restore();

  if (pose.gape > GAPE_TEETH_VISIBLE) {
    drawTeeth(ctx, toothRowBack, snoutTip, down, TOOTH_LENGTH);
  }

  const nostril = at(NOSTRIL_ALONG, -NOSTRIL_DROP);
  ctx.beginPath();
  ctx.ellipse(nostril.x, nostril.y, NOSTRIL_RX, NOSTRIL_RY, angle, 0, TWO_PI);
  ctx.fillStyle = rgba(HIDE.dorsal, NOSTRIL_ALPHA);
  ctx.fill();

  drawEyeSide(ctx, at(EYE_ALONG, -EYE_DROP), angle, prop.eyeRadius, pose.eyeOpen);

  // A heavy brow over the eye: the scowl that makes him read as a predator
  // rather than as a bird.
  const browA = at(EYE_ALONG - EYE_BROW_SPAN, -SKULL_BROW * EYE_BROW_HEIGHT);
  const browB = at(EYE_ALONG + EYE_BROW_SPAN, -SKULL_BROW * EYE_BROW_HEIGHT);
  const browPeak = at(EYE_ALONG, -SKULL_BROW * EYE_BROW_PEAK);
  ctx.beginPath();
  ctx.moveTo(browA.x, browA.y);
  ctx.quadraticCurveTo(browPeak.x, browPeak.y, browB.x, browB.y);
  ctx.strokeStyle = rgba(HIDE.dorsal, BROW_ALPHA);
  ctx.lineWidth = BROW_WIDTH;
  ctx.stroke();
}

const SKULL_CROWN = 0.7;
const SKULL_BROW_ALONG = 0.24;
const SKULL_BROW = 0.8;
const SKULL_NOTCH_ALONG = 0.52;
const SKULL_NOTCH = 0.66;
const SKULL_NASAL_ALONG = 0.76;
const SKULL_NASAL = 0.58;
const SKULL_TIP_RISE = 0.36;
const SKULL_TIP_DROP = 0.16;
const SKULL_TOOTH_BACK_ALONG = 0.46;
const SKULL_TOOTH_BACK = 0.3;
const SKULL_HINGE = 0.44;
/** The upper jaw overhangs the lower — a raptor's teeth are not a straight bite. */
const JAW_OVERBITE = 0.03;
const JAW_TIP_DEPTH_SHARE = 0.42;
const JAW_CHIN_ALONG = 0.3;
const JAW_BACK_DEPTH_SHARE = 0.8;
const JAW_PALE = 0.07;
const GAPE_MOUTH_VISIBLE = 0.06;
const GAPE_TEETH_VISIBLE = 0.1;
const TOOTH_LENGTH = 0.026;
const LOWER_TOOTH_SHARE = 0.8;
const NOSTRIL_ALONG = 0.82;
const NOSTRIL_DROP = 0.3;
const NOSTRIL_RX = 0.012;
const NOSTRIL_RY = 0.008;
const NOSTRIL_ALPHA = 0.8;
const EYE_ALONG = 0.24;
const EYE_DROP = 0.5;
const EYE_BROW_SPAN = 0.12;
const EYE_BROW_HEIGHT = 0.94;
const EYE_BROW_PEAK = 1.04;
const BROW_ALPHA = 0.8;
const BROW_WIDTH = 0.012;
const HEAD_SPECKLE_SEED = 17;

const TEETH_PER_JAW = 4;

function drawTeeth(ctx: Ctx, from: Pt, to: Pt, down: Pt, length: number): void {
  ctx.fillStyle = TOOTH;
  for (let i = 0; i < TEETH_PER_JAW; i++) {
    const t = (i + 0.5) / TEETH_PER_JAW;
    const root = mid(from, to, t);
    const own = length * lerp(0.7, 1.15, t);
    const half = own * TOOTH_HALF_SHARE;
    const side = perp(down);
    ctx.beginPath();
    ctx.moveTo(root.x - side.x * half, root.y - side.y * half);
    ctx.lineTo(root.x + down.x * own, root.y + down.y * own);
    ctx.lineTo(root.x + side.x * half, root.y + side.y * half);
    ctx.closePath();
    ctx.fill();
  }
}

const TOOTH_HALF_SHARE = 0.5;

function drawEyeSide(ctx: Ctx, centre: Pt, angle: number, radius: number, open: number): void {
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radius, radius * lerp(0.08, 1, open), angle, 0, TWO_PI);
  ctx.fillStyle = EYE_IRIS;
  ctx.fill();
  ctx.strokeStyle = EYE_RING;
  ctx.lineWidth = EYE_RING_WIDTH;
  ctx.stroke();
  if (open < EYE_PUPIL_VISIBLE) return;
  // A vertical slit, not a round pupil: the single cheapest cue that this is a
  // reptile-descended predator rather than a pigeon.
  // Floored in absolute tile units, not just as a share of the iris. The adult's
  // eye is small enough that a proportional slit lands under a pixel and bakes
  // away entirely, leaving a hollow gold ring that reads as a goggle.
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    Math.max(MIN_PUPIL_HALF_WIDTH, radius * PUPIL_WIDTH_SHARE),
    Math.max(MIN_PUPIL_HALF_WIDTH, radius * PUPIL_HEIGHT_SHARE) * open,
    angle,
    0,
    TWO_PI,
  );
  ctx.fillStyle = EYE_PUPIL;
  ctx.fill();
}

const EYE_RING_WIDTH = 0.004;
const EYE_PUPIL_VISIBLE = 0.25;
const PUPIL_WIDTH_SHARE = 0.34;
const PUPIL_HEIGHT_SHARE = 0.66;
/** One sheet pixel at the smallest stage, so the slit never bakes away. */
const MIN_PUPIL_HALF_WIDTH = 0.012;

/**
 * The pink head crest: a fan of feathers rooted along the top of the skull.
 *
 * Every feather sweeps *backward*. A crest that stands straight up is a mohawk,
 * and a mohawk on a dinosaur reads as a cockatoo — the backward sweep is what
 * keeps the profile pointing the way he is moving.
 */
function drawCrestSide(
  ctx: Ctx,
  prop: MongoProportions,
  angle: number,
  at: (forward: number, drop: number) => Pt,
): void {
  drawFeatherFan(
    ctx,
    at(CREST_BACK_ALONG, -SKULL_CROWN),
    at(CREST_FRONT_ALONG, -SKULL_BROW),
    angle + CREST_BACK_SWEEP,
    angle + CREST_FRONT_SWEEP,
    prop.crestLength,
    CREST_FEATHERS,
    CREST_FALLOFF,
  );
}

const CREST_BACK_ALONG = -0.06;
const CREST_FRONT_ALONG = 0.3;
const CREST_BACK_SWEEP = deg(-166);
const CREST_FRONT_SWEEP = deg(-124);
const CREST_FEATHERS = 4;
const CREST_FALLOFF = 0.66;

/** How much darker a far-side limb is painted, so depth reads at tile size. */
const FAR_SIDE_SHADE = 0.42;

export function drawMongoSide(ctx: Ctx, pose: MongoPose, prop: MongoProportions): void {
  const sk = buildSkeleton(pose, prop);

  drawGroundShadow(
    ctx,
    sk.pelvis.x + SHADOW_FORWARD * prop.spineLength,
    SHADOW_RX_SHARE * (prop.spineLength + prop.tail[0]) * pose.shadow,
    SHADOW_RY * pose.shadow,
  );

  drawLegSide(ctx, sk.farLeg, prop, FAR_SIDE_SHADE, pose.farLeg);
  drawArmSide(ctx, sk, pose.farArm, prop, FAR_SIDE_SHADE);
  // Down on the tail too. Confined to the torso it stops dead at the hips, and a
  // fuzzy edge with a hard end is worse than none.
  paintDown(ctx, sk.tail, prop.down, DOWN_SEED + 2, undefined, false);
  drawTailSide(ctx, sk, prop, 0);

  const outline = bodyOutline(sk, prop, pose.breathe);
  paintDown(ctx, outline, prop.down, DOWN_SEED, (index) => BODY_OUTLINE_EXPOSED.has(index));
  traceOutline(ctx, outline);
  fillAndOutline(ctx, HIDE.base, HIDE.dorsal);

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  paintPebbling(ctx, boundsOf(outline), BODY_SPECKLE_SEED, prop.detail);
  // The pale underside, laid along the belly in the spine's own frame. Anchored
  // on the outline's bounding box instead it drifts up into the flank, because
  // that box is set by the neck root rather than by anything on the underside.
  const spineDir = dir(sk.pelvis, sk.chest);
  const spineDown = perp(spineDir);
  const bellyCentre = add(mid(sk.pelvis, sk.chest, BELLY_CENTRE_ALONG), {
    x: spineDown.x * prop.bellyDepth * BELLY_CENTRE_DROP,
    y: spineDown.y * prop.bellyDepth * BELLY_CENTRE_DROP,
  });
  ctx.beginPath();
  ctx.ellipse(
    bellyCentre.x,
    bellyCentre.y,
    prop.spineLength * BELLY_RX_SHARE,
    prop.bellyDepth * BELLY_RY_SHARE,
    Math.atan2(spineDir.y, spineDir.x),
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(HIDE.belly, BELLY_ALPHA * prop.detail);
  ctx.fill();
  ctx.restore();

  const spine = [sk.tailRoot, sk.pelvis, mid(sk.pelvis, sk.chest), sk.chest];
  const dorsalLine = spine.map((node) => {
    const down = perp(dir(sk.pelvis, sk.chest));
    return add(node, {
      x: -down.x * prop.hipDepth * DORSAL_LIFT,
      y: -down.y * prop.hipDepth * DORSAL_LIFT,
    });
  });
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  paintDorsalBars(
    ctx,
    dorsalLine,
    (t) => bodyDepthAt(prop, t),
    prop.stripes,
    STRIPE_SEED,
    prop.detail,
  );
  ctx.restore();

  // The near arm goes *under* the neck and skull. Painted over them, its spread
  // primaries cover his own face at the peak of the rake, and the attack reads
  // as an effect going off in front of him rather than as a claw strike.
  drawArmSide(ctx, sk, pose.nearArm, prop, 0);
  drawNeckSide(ctx, sk, prop);
  drawHeadSide(ctx, sk, pose, prop);
  drawLegSide(ctx, sk.nearLeg, prop, 0, pose.nearLeg);
}

const SHADOW_FORWARD = 0.15;
const SHADOW_RX_SHARE = 0.4;
const SHADOW_RY = 0.06;
const DOWN_SEED = 31;
const BODY_SPECKLE_SEED = 5;
const STRIPE_SEED = 23;
const BELLY_CENTRE_ALONG = 0.46;
const BELLY_CENTRE_DROP = 0.92;
const BELLY_RX_SHARE = 0.78;
const BELLY_RY_SHARE = 0.55;
const BELLY_ALPHA = 0.2;
const DORSAL_LIFT = 0.86;

function drawNeckSide(ctx: Ctx, sk: MongoSkeleton, prop: MongoProportions): void {
  // The neck is drawn as one filled ribbon through the three neck nodes rather
  // than as two limb segments: an S-curve made of straight rods has a visible
  // corner at the bend, and that corner is exactly what makes a neck read as a
  // pipe rather than as a spine.
  const nodes = [sk.chest, sk.neckMid, sk.headBase];
  const thickAt = [
    prop.neckThickness * NECK_ROOT_SHARE,
    prop.neckThickness,
    prop.neckThickness * NECK_TOP_SHARE,
  ];
  const left: Pt[] = [];
  const right: Pt[] = [];
  const SAMPLES = 8;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const point = quadAt(nodes[0], nodes[1], nodes[2], t);
    const tangent = quadTangent(nodes[0], nodes[1], nodes[2], t);
    const side = perp(tangent);
    const half =
      t < 0.5 ? lerp(thickAt[0], thickAt[1], t * 2) : lerp(thickAt[1], thickAt[2], (t - 0.5) * 2);
    left.push({ x: point.x + side.x * half, y: point.y + side.y * half });
    right.unshift({ x: point.x - side.x * half, y: point.y - side.y * half });
  }
  traceOutline(ctx, [...left, ...right]);
  fillAndOutline(ctx, HIDE.base, innerEdge(prop));

  ctx.save();
  traceOutline(ctx, [...left, ...right]);
  ctx.clip();
  paintPebbling(ctx, boundsOf([...left, ...right]), NECK_SPECKLE_SEED, prop.detail);
  ctx.restore();
}

const NECK_ROOT_SHARE = 1.5;
const NECK_TOP_SHARE = 0.5;
const NECK_SPECKLE_SEED = 41;

function quadAt(a: Pt, b: Pt, c: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
  };
}

function quadTangent(a: Pt, b: Pt, c: Pt, t: number): Pt {
  const raw = {
    x: 2 * (1 - t) * (b.x - a.x) + 2 * t * (c.x - b.x),
    y: 2 * (1 - t) * (b.y - a.y) + 2 * t * (c.y - b.y),
  };
  const length = Math.hypot(raw.x, raw.y);
  if (length < ZERO_LENGTH_EPSILON) return { x: 1, y: 0 };
  return { x: raw.x / length, y: raw.y / length };
}

// ── Head-on and away views ───────────────────────────────────────────────────

/**
 * The two axial views are the same animal seen from either end, so they are one
 * painter under a sign rather than two that drift apart.
 *
 * The hard part is that a horizontal-spined dinosaur seen head-on is *not* an
 * upright figure. Its body recedes away from the camera, so depth and height
 * both map onto screen-Y: the chest sits nearer the viewer than the hips and is
 * therefore drawn *lower* on screen, the head hangs further forward and lower
 * still, and the tail rises away behind the hips. Built as a vertical torso
 * with a head stacked on top — which is what the first bake did — the same
 * creature reads as a raptor in profile and as a small blue humanoid head-on,
 * i.e. it changes species every time the player turns ninety degrees.
 */
interface AxialView {
  /** +1 when the animal's front is toward the camera, -1 when it is away. */
  readonly depth: number;
  readonly showsFace: boolean;
}

const FRONT_VIEW: AxialView = { depth: 1, showsFace: true };
const BACK_VIEW: AxialView = { depth: -1, showsFace: false };

interface AxialLayout {
  readonly pelvis: Pt;
  readonly chest: Pt;
  readonly headCentre: Pt;
  readonly tailTip: Pt;
  readonly tailRoot: Pt;
  readonly girth: number;
}

/**
 * How the body stacks in the axial views, as shares of the parts involved.
 *
 * The head goes on *top*, with the body below it and the tail swept out to one
 * side — which is the convention every other horizontal animal in this game is
 * already drawn to (see the rat's `walk` row). A projection-correct layout, with
 * the head hanging below a receding body, was tried first and measured worse in
 * every way that matters: the head could not be located at 32 px, the two axial
 * views came out a third shorter than the profile, and the muzzle punched
 * through the floor on the bite. Consistency with the rest of the bestiary beats
 * a correct projection nobody can read.
 */
const AXIAL_CHEST_RISE = 0.34;
const AXIAL_HEAD_ABOVE = 0.9;
/** How much of the tail's true length survives the foreshortening. */
const AXIAL_TAIL_FORESHORTEN = 0.56;
/** And how far it rises above the hips as it sweeps out to the side. */
const AXIAL_TAIL_RISE = 0.42;
const AXIAL_TAIL_ROOT_BACK = -0.05;

function axialLayout(pose: MongoPose, prop: MongoProportions, view: AxialView): AxialLayout {
  const pelvis = { x: pose.sway, y: GROUND_Y - prop.hipHeight + pose.rise };
  const chest = {
    x: pelvis.x + pose.sway * AXIAL_SWAY_LEAN,
    y: pelvis.y + prop.chestRise - AXIAL_CHEST_RISE * prop.spineLength,
  };
  const headCentre = {
    x: chest.x + pose.headTurn * prop.girth * AXIAL_HEAD_TURN,
    y: chest.y - AXIAL_HEAD_ABOVE * prop.neckLength + pose.headLift,
  };
  const tailLength = prop.tail.reduce((total, segment) => total + segment, 0);
  const tailRoot = {
    x: pelvis.x,
    y: pelvis.y + AXIAL_TAIL_ROOT_BACK * prop.spineLength,
  };
  // Swept out to one side, and always to the same side: run down the centreline
  // it bisects the rump and reads as a crack in the sprite, and from behind —
  // where it points at the camera — as something considerably worse.
  const swung = rot(
    { x: tailLength * AXIAL_TAIL_FORESHORTEN, y: -view.depth * tailLength * AXIAL_TAIL_RISE },
    pose.tailSway,
  );
  return {
    pelvis,
    chest,
    headCentre,
    tailRoot,
    tailTip: add(tailRoot, swung),
    girth: prop.girth * (1 + pose.breathe * BREATH_DEPTH),
  };
}

const AXIAL_SWAY_LEAN = 0.4;
const AXIAL_HEAD_TURN = 0.55;

/**
 * Head-on, a leg is a column: the knee hinges away from the camera and has no
 * angle in the image plane at all. What changes is *width* — a leg nearer the
 * camera reads wider, never bent. What must still read is the digitigrade
 * stack, so the ankle is placed high and the foot is a short toe fan under it
 * rather than a slipper on the floor.
 */
function drawLegAxial(
  ctx: Ctx,
  pose: LegPose,
  hip: Pt,
  prop: MongoProportions,
  shade: number,
): void {
  const hide = mix(HIDE.base, HIDE.shadow, shade);
  const dark = innerEdge(prop, shade);
  const kneeHalf = prop.femur * KNEE_HALF_SHARE;
  const shankHalf = prop.femur * SHANK_HALF_SHARE;
  const ankleHalf = prop.femur * ANKLE_HALF_SHARE;
  const toeTipHalf = prop.femur * TOE_TIP_HALF_SHARE;
  const near = lerp(AXIAL_FAR_WIDTH, 1, pose.nearness);

  const toe = { x: hip.x + pose.lateral, y: GROUND_Y - pose.lift };
  const ankle = {
    x: lerp(hip.x, toe.x, ANKLE_LATERAL_SHARE),
    y: toe.y - prop.metatarsus * Math.sin(pose.meta),
  };
  const knee = {
    x: lerp(hip.x, ankle.x, KNEE_LATERAL_SHARE),
    y: lerp(hip.y, ankle.y, AXIAL_KNEE_ALONG),
  };

  drawLimb(
    ctx,
    hip,
    knee,
    prop.femur * THIGH_HALF_SHARE * prop.thighBulk * near,
    kneeHalf * near * AXIAL_KNEE_WIDTH,
    hide,
    dark,
  );
  drawLimb(ctx, knee, ankle, kneeHalf * near * AXIAL_KNEE_WIDTH, shankHalf * near, hide, dark);
  // The metatarsus is drawn narrower than the shank on purpose: head-on the only
  // thing that says "there is a third segment here" is the step in width.
  drawLimb(ctx, ankle, toe, shankHalf * near * AXIAL_META_PINCH, ankleHalf * near, dark, dark);

  for (const side of [-1, 0, 1]) {
    const tip = {
      x: toe.x + side * prop.toe * AXIAL_TOE_SPREAD,
      y: toe.y + prop.toe * AXIAL_TOE_DROP,
    };
    drawLimb(ctx, toe, tip, ankleHalf * near * TRAILING_TOE_GIRTH, toeTipHalf, hide, dark);
    const along = dir(toe, tip);
    drawClaw(ctx, tip, along, perp(along), prop.sickle * GROUND_CLAW_SHARE, shade);
  }
  // The killing claw has to survive the turn: hooked up off the floor on the
  // inner toe, where a player who has learned to read it in profile can still
  // find it head-on.
  const sickleRoot = {
    x: toe.x - AXIAL_SICKLE_INSET,
    y: toe.y - prop.metatarsus * AXIAL_SICKLE_RISE,
  };
  // Head-on the claw is foreshortened and stands up the screen. Passed the same
  // toe direction the profile uses it swings out sideways instead, which reads
  // as a pale shoe rather than as a claw.
  //
  // The deployment swing is cancelled rather than applied: axially that swing is
  // almost entirely depth — it rotates toward the camera, not across it — so
  // letting it turn the drawn shape only foreshortens the claw into nothing on
  // exactly the frames where it is being driven into something.
  const axialToeAngle =
    AXIAL_SICKLE_STAND - lerp(RETRACTED_SICKLE_ANGLE, DEPLOYED_SICKLE_ANGLE, clamp01(pose.sickle));
  drawSickle(ctx, sickleRoot, axialToeAngle, prop.sickle * AXIAL_SICKLE_SHARE, pose.sickle, shade);
}

const ANKLE_LATERAL_SHARE = 0.88;
const KNEE_LATERAL_SHARE = 0.55;
const AXIAL_KNEE_ALONG = 0.52;
const AXIAL_FAR_WIDTH = 0.76;
const AXIAL_KNEE_WIDTH = 1.1;
const AXIAL_META_PINCH = 0.72;
const AXIAL_TOE_SPREAD = 0.8;
const AXIAL_TOE_DROP = 0.1;
const AXIAL_SICKLE_INSET = 0.024;
const AXIAL_SICKLE_RISE = 0.03;
const AXIAL_SICKLE_STAND = deg(-72);
/**
 * The killing claw's size head-on, against its profile length.
 *
 * Slightly *over* one: pointed at the camera it is foreshortened to almost
 * nothing, and drawn to that it disappears — which loses the one silhouette
 * element that identifies him, in half of his facings.
 */
const AXIAL_SICKLE_SHARE = 1.2;

function drawArmAxial(
  ctx: Ctx,
  shoulder: Pt,
  arm: ArmPose,
  prop: MongoProportions,
  side: number,
  shade: number,
): void {
  const hide = mix(HIDE.base, HIDE.shadow, shade);
  const dark = innerEdge(prop, shade);
  const spread = arm.spread;
  // Head-on the arm is nearly end-on: almost all of its travel is depth, so the
  // bones are drawn short and the feathers carry the read.
  const elbow = {
    x:
      shoulder.x +
      side * prop.humerus * lerp(AXIAL_ARM_TUCK, AXIAL_ARM_FLARE, spread) +
      arm.lateral,
    y: shoulder.y + prop.humerus * lerp(AXIAL_ARM_DROP, AXIAL_ARM_RAISE, spread),
  };
  const wrist = {
    x: elbow.x + side * prop.forearm * lerp(AXIAL_FORE_TUCK, AXIAL_FORE_FLARE, spread),
    y: elbow.y + prop.forearm * lerp(AXIAL_FORE_DROP, AXIAL_FORE_RAISE, spread),
  };
  // Authored as an absolute screen angle rather than off the forearm: head-on
  // that bone is almost end-on, so its own direction carries no information and
  // a fan hung off it points wherever the foreshortening happens to leave it.
  // Folded, the primaries lie back along the flank — which head-on is *up* the
  // screen, because back is away from the camera.
  const fanAngle = -Math.PI / 2 + side * lerp(AXIAL_FAN_TUCK, AXIAL_FAN_FLARE, spread);
  drawFeatherFan(
    ctx,
    elbow,
    wrist,
    fanAngle - AXIAL_FAN_SPREAD * side,
    fanAngle + AXIAL_FAN_SPREAD * side,
    prop.wingFeather * lerp(AXIAL_FAN_FOLDED, 1, spread),
    PRIMARY_COUNT,
    PRIMARY_FALLOFF,
  );
  drawLimb(ctx, shoulder, elbow, UPPER_ARM_HALF, ELBOW_HALF, hide, dark);
  drawLimb(ctx, elbow, wrist, ELBOW_HALF, WRIST_HALF, hide, dark);
}

const AXIAL_ARM_TUCK = 0.45;
const AXIAL_ARM_FLARE = 1;
const AXIAL_ARM_DROP = 0.8;
const AXIAL_ARM_RAISE = -0.1;
const AXIAL_FORE_TUCK = 0.3;
const AXIAL_FORE_FLARE = 0.85;
const AXIAL_FORE_DROP = 0.7;
const AXIAL_FORE_RAISE = -0.4;
const AXIAL_FAN_SPREAD = deg(32);
const AXIAL_FAN_TUCK = deg(26);
/** Spread wings sweep up and out, not straight out: a symmetric horizontal pair
 * reads as a T-pose however well the rest of the frame moves. */
const AXIAL_FAN_FLARE = deg(56);
const AXIAL_FAN_FOLDED = 0.62;

/**
 * The tail, foreshortened. It leaves the hips along the centreline and swings to
 * one side: run dead straight down the middle of the rump it bisects the animal
 * and reads as a crack in the sprite.
 */
function drawTailAxial(
  ctx: Ctx,
  layout: AxialLayout,
  prop: MongoProportions,
  view: AxialView,
): void {
  const depthScale = view.depth > 0 ? AXIAL_TAIL_FAR_SCALE : AXIAL_TAIL_NEAR_SCALE;
  drawLimb(
    ctx,
    layout.tailRoot,
    layout.tailTip,
    prop.tailDepth * AXIAL_TAIL_GIRTH * depthScale,
    TAIL_TIP_DEPTH * depthScale * 2,
    HIDE.base,
    HIDE.dorsal,
  );
  const angle = Math.atan2(
    layout.tailTip.y - layout.tailRoot.y,
    layout.tailTip.x - layout.tailRoot.x,
  );
  drawFeatherFan(
    ctx,
    mid(layout.tailRoot, layout.tailTip, FAN_ROOT_ALONG + 0.3),
    layout.tailTip,
    angle - TAIL_FAN_SPREAD,
    angle + TAIL_FAN_SPREAD,
    prop.tailFan * AXIAL_TAIL_FAN_SHARE * depthScale,
    TAIL_FAN_FEATHERS,
    TAIL_FAN_FALLOFF,
  );
}

const AXIAL_TAIL_GIRTH = 1.1;
const AXIAL_TAIL_FAN_SHARE = 0.72;
/** The tail is further away head-on and nearer from behind, so it changes size. */
const AXIAL_TAIL_FAR_SCALE = 0.95;
const AXIAL_TAIL_NEAR_SCALE = 1.0;

/** An oval body mass, foreshortened: wide across, shallow up and down. */
function axialMass(centre: Pt, halfWidth: number, halfHeight: number): Pt[] {
  const points: Pt[] = [];
  const STEPS = 10;
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * TWO_PI;
    points.push({
      x: centre.x + Math.cos(angle) * halfWidth,
      y: centre.y + Math.sin(angle) * halfHeight,
    });
  }
  return points;
}

function drawAxialHead(
  ctx: Ctx,
  centre: Pt,
  prop: MongoProportions,
  pose: MongoPose,
  view: AxialView,
): void {
  const scale = view.showsFace ? AXIAL_HEAD_NEAR_SCALE : AXIAL_HEAD_FAR_SCALE;
  // Sized off the skull's *length* rather than its depth. Depth is what the
  // profile shows and it is deliberately shallow on a dromaeosaur, so a head-on
  // skull derived from it comes out a fifth of the torso's width — a pea on a
  // barrel. Head-on the head is the nearest thing on the animal and has to read
  // as roughly three quarters of the body's width.
  const halfW = prop.skullLength * AXIAL_SKULL_WIDTH * scale;
  const halfH = prop.skullLength * AXIAL_SKULL_HEIGHT * scale;
  const snoutDrop = prop.skullLength * AXIAL_SNOUT_DROP * scale;

  const skull = [
    { x: centre.x - halfW, y: centre.y - halfH * SKULL_TEMPLE },
    { x: centre.x, y: centre.y - halfH },
    { x: centre.x + halfW, y: centre.y - halfH * SKULL_TEMPLE },
    { x: centre.x + halfW * AXIAL_CHEEK, y: centre.y + halfH * AXIAL_CHEEK_DROP },
    // The keel: a narrow muzzle dropping well clear of the cheeks. Without it
    // the head-on skull is a dome with two eyes on it, which is an owl.
    { x: centre.x + halfW * AXIAL_MUZZLE_WIDTH, y: centre.y + snoutDrop * AXIAL_MUZZLE_SHOULDER },
    { x: centre.x + halfW * AXIAL_SNOUT_WIDTH, y: centre.y + snoutDrop },
    { x: centre.x - halfW * AXIAL_SNOUT_WIDTH, y: centre.y + snoutDrop },
    { x: centre.x - halfW * AXIAL_MUZZLE_WIDTH, y: centre.y + snoutDrop * AXIAL_MUZZLE_SHOULDER },
    { x: centre.x - halfW * AXIAL_CHEEK, y: centre.y + halfH * AXIAL_CHEEK_DROP },
  ];
  traceOutline(ctx, skull);
  fillAndOutline(ctx, HIDE.base, HIDE.dorsal);

  ctx.save();
  traceOutline(ctx, skull);
  ctx.clip();
  paintPebbling(ctx, boundsOf(skull), HEAD_SPECKLE_SEED, prop.detail);
  ctx.restore();

  // The crest, painted *after* the skull rather than before it. Axially the
  // crest sweeps away from the camera, so rooted under the head it is entirely
  // hidden behind it — and the pink head zone is an invariant of this design,
  // gated in every frame of every row. A short fringe standing off the top of
  // the skull is what survives the turn.
  drawFeatherFan(
    ctx,
    { x: centre.x - halfW * CREST_AXIAL_SPAN, y: centre.y - halfH * CREST_AXIAL_ROOT },
    { x: centre.x + halfW * CREST_AXIAL_SPAN, y: centre.y - halfH * CREST_AXIAL_ROOT },
    -Math.PI / 2 - CREST_AXIAL_SWEEP,
    -Math.PI / 2 + CREST_AXIAL_SWEEP,
    prop.crestLength * CREST_AXIAL_SHARE * scale,
    CREST_FEATHERS,
    CREST_FALLOFF,
  );

  if (!view.showsFace) {
    // From behind, two navy bars run down the back of the skull and the eyes are
    // hidden. Drawing eyes here is the classic away-view mistake.
    ctx.strokeStyle = rgba(HIDE.dorsal, STRIPE_ALPHA);
    ctx.lineWidth = STRIPE_HALF_WIDTH * 2;
    ctx.lineCap = 'round';
    for (const offset of [-halfW * BACK_SKULL_BAR_SPAN, halfW * BACK_SKULL_BAR_SPAN]) {
      ctx.beginPath();
      ctx.moveTo(centre.x + offset, centre.y - halfH * SKULL_TEMPLE);
      ctx.lineTo(
        centre.x + offset * BACK_SKULL_BAR_TAPER,
        centre.y + snoutDrop * BACK_SKULL_BAR_DROP,
      );
      ctx.stroke();
    }
    return;
  }

  for (const side of [-1, 1]) {
    drawEyeSide(
      ctx,
      { x: centre.x + side * halfW * AXIAL_EYE_SPAN, y: centre.y - halfH * AXIAL_EYE_RISE },
      0,
      prop.eyeRadius * AXIAL_EYE_SHARE * scale,
      pose.eyeOpen,
    );
  }

  const jawY = centre.y + snoutDrop;
  if (pose.gape > GAPE_MOUTH_VISIBLE) {
    ctx.beginPath();
    // Bounded by the skull. Scaled off the snout drop alone it grew wider than
    // the head is tall and hung down over the chest like a necktie.
    ctx.ellipse(
      centre.x,
      jawY - halfH * AXIAL_GAPE_RISE,
      halfW * AXIAL_MUZZLE_WIDTH,
      Math.min(halfH * AXIAL_GAPE_MAX, snoutDrop * pose.gape * AXIAL_GAPE_SHARE),
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = MOUTH_FLESH;
    ctx.fill();
    if (pose.gape > GAPE_TEETH_VISIBLE) {
      drawTeeth(
        ctx,
        { x: centre.x - halfW * AXIAL_MUZZLE_WIDTH * AXIAL_TOOTH_SPAN, y: jawY },
        { x: centre.x + halfW * AXIAL_MUZZLE_WIDTH * AXIAL_TOOTH_SPAN, y: jawY },
        { x: 0, y: 1 },
        TOOTH_LENGTH * AXIAL_TOOTH_SHARE * scale,
      );
    }
  }
  ctx.beginPath();
  ctx.moveTo(centre.x - halfW * AXIAL_SNOUT_WIDTH, jawY);
  ctx.lineTo(centre.x + halfW * AXIAL_SNOUT_WIDTH, jawY);
  ctx.strokeStyle = rgba(HIDE.dorsal, BROW_ALPHA);
  ctx.lineWidth = BROW_WIDTH * 0.8;
  ctx.stroke();
}

const AXIAL_SKULL_WIDTH = 0.52;
const AXIAL_SKULL_HEIGHT = 0.56;
const AXIAL_SNOUT_DROP = 0.52;
const SKULL_TEMPLE = 0.78;
const AXIAL_CHEEK = 0.92;
const AXIAL_CHEEK_DROP = 0.44;
const AXIAL_SNOUT_WIDTH = 0.26;
const AXIAL_MUZZLE_WIDTH = 0.6;
const AXIAL_MUZZLE_SHOULDER = 0.34;
const AXIAL_EYE_SPAN = 0.82;
const AXIAL_EYE_RISE = 0.2;
const AXIAL_EYE_SHARE = 0.95;
const AXIAL_GAPE_SHARE = 0.55;
const AXIAL_GAPE_MAX = 0.34;
const AXIAL_GAPE_RISE = 0.18;
const AXIAL_TOOTH_SHARE = 0.7;
const AXIAL_TOOTH_SPAN = 1.0;
const CREST_AXIAL_SPAN = 0.42;
const CREST_AXIAL_ROOT = 1.0;
const CREST_AXIAL_SWEEP = deg(40);
const CREST_AXIAL_SHARE = 0.72;
const BACK_SKULL_BAR_SPAN = 0.42;
const BACK_SKULL_BAR_TAPER = 0.7;
const BACK_SKULL_BAR_DROP = 0.9;
/** The head is nearest the camera head-on and furthest from behind. */
const AXIAL_HEAD_NEAR_SCALE = 1.0;
const AXIAL_HEAD_FAR_SCALE = 0.78;

function drawMongoAxial(ctx: Ctx, pose: MongoPose, prop: MongoProportions, view: AxialView): void {
  const layout = axialLayout(pose, prop, view);
  const { pelvis, chest, girth } = layout;

  drawGroundShadow(ctx, pelvis.x, girth * AXIAL_SHADOW_RX * pose.shadow, SHADOW_RY * pose.shadow);

  // One elongated mass running from the hips down to the shoulders, not two
  // ovals stacked on top of each other. Seen end-on a horizontal-spined animal
  // is still *long* — the length is simply pointing at the camera — and two
  // separate circles with a gap between them read as a head on a body, i.e. as
  // a small upright humanoid, which is exactly what the first bake produced.
  const spine = [
    { x: chest.x, y: chest.y - prop.spineLength * AXIAL_BRISKET_OVERHANG },
    chest,
    pelvis,
    { x: pelvis.x, y: pelvis.y + prop.spineLength * AXIAL_RUMP_OVERHANG },
  ];
  const spineHalf = [
    girth * AXIAL_BRISKET_WIDTH,
    girth,
    girth * AXIAL_HIP_WIDTH,
    girth * AXIAL_RUMP_WIDTH,
  ];
  const body = ribbonOutline(spine, spineHalf);
  const hipMass = axialMass(pelvis, girth * AXIAL_HIP_WIDTH, prop.hipDepth * AXIAL_HIP_SQUASH);
  const nearLeg = pose.nearLeg.nearness >= pose.farLeg.nearness ? pose.nearLeg : pose.farLeg;
  const farLeg = nearLeg === pose.nearLeg ? pose.farLeg : pose.nearLeg;
  const legRootY = pelvis.y;

  // The haunches, painted over the body mass at the hips so the drumsticks read
  // as muscle standing proud of the flank rather than as part of the outline.
  const paintHips = (): void => {
    traceOutline(ctx, hipMass);
    fillAndOutline(ctx, mix(HIDE.base, HIDE.shadow, AXIAL_HIP_SHADE), HIDE.dorsal);
  };

  const paintLegs = (): void => {
    drawLegAxial(
      ctx,
      farLeg,
      { x: pelvis.x - girth * AXIAL_HIP_SPAN, y: legRootY },
      prop,
      AXIAL_FAR_SHADE,
    );
    drawLegAxial(ctx, nearLeg, { x: pelvis.x + girth * AXIAL_HIP_SPAN, y: legRootY }, prop, 0);
  };

  const paintTorsoAndArms = (): void => {
    paintDown(ctx, body, prop.down, DOWN_SEED);
    drawArmAxial(
      ctx,
      { x: chest.x - girth * AXIAL_SHOULDER_SPAN, y: chest.y },
      pose.farArm,
      prop,
      -1,
      AXIAL_FAR_SHADE,
    );
    drawArmAxial(
      ctx,
      { x: chest.x + girth * AXIAL_SHOULDER_SPAN, y: chest.y },
      pose.nearArm,
      prop,
      1,
      0,
    );
    traceOutline(ctx, body);
    fillAndOutline(ctx, HIDE.base, HIDE.dorsal);
    ctx.save();
    traceOutline(ctx, body);
    ctx.clip();
    const box = boundsOf(body);
    paintPebbling(ctx, box, BODY_SPECKLE_SEED, prop.detail);
    if (view.showsFace) {
      // Toward the camera it is the pale throat and chest that face us.
      ctx.beginPath();
      ctx.ellipse(
        chest.x,
        chest.y + prop.chestDepth * AXIAL_BELLY_DROP,
        girth * AXIAL_BELLY_RX,
        prop.chestDepth * AXIAL_BELLY_RY,
        0,
        0,
        TWO_PI,
      );
      ctx.fillStyle = rgba(HIDE.belly, BELLY_ALPHA * prop.detail);
      ctx.fill();
    } else {
      // Away it is the striped back, so the bars run down the spine line.
      const spine = [
        { x: chest.x, y: box.minY },
        { x: chest.x, y: box.maxY },
      ];
      paintDorsalBars(
        ctx,
        spine,
        () => girth * AXIAL_BAR_SPAN,
        prop.stripes,
        STRIPE_SEED,
        prop.detail,
      );
    }
    ctx.restore();
  };

  const paintNeckAndHead = (): void => {
    // The neck runs from the chest toward the head, which head-on means toward
    // the camera and therefore down the screen.
    drawLimb(
      ctx,
      chest,
      layout.headCentre,
      prop.neckThickness * NECK_ROOT_SHARE,
      prop.neckThickness * NECK_TOP_SHARE,
      HIDE.base,
      HIDE.dorsal,
    );
    drawAxialHead(ctx, layout.headCentre, prop, pose, view);
  };

  // Far-to-near, and which end is near reverses between the two views: head-on
  // the tail is behind everything and the head in front of it; from behind it is
  // the other way round. One fixed order for both is how the first bake ended up
  // stacking the rump on the shoulders like a snowman.
  // The only thing depth actually reorders is the tail: it is behind everything
  // when he faces the camera and in front of everything when he faces away.
  if (view.depth > 0) drawTailAxial(ctx, layout, prop, view);
  paintTorsoAndArms();
  paintHips();
  paintLegs();
  paintNeckAndHead();
  if (view.depth < 0) drawTailAxial(ctx, layout, prop, view);
}

const AXIAL_SHADOW_RX = 1.8;
const AXIAL_HIP_SPAN = 0.78;
const AXIAL_HIP_WIDTH = 1.12;
const AXIAL_HIP_SQUASH = 0.52;
const AXIAL_HIP_SHADE = 0.07;
const AXIAL_RUMP_OVERHANG = 0.26;
const AXIAL_BRISKET_OVERHANG = 0.2;
const AXIAL_RUMP_WIDTH = 0.68;
const AXIAL_BRISKET_WIDTH = 0.72;
const AXIAL_SHOULDER_SPAN = 0.9;
const AXIAL_FAR_SHADE = 0.26;
const AXIAL_BELLY_DROP = 0.34;
const AXIAL_BELLY_RX = 0.5;
const AXIAL_BELLY_RY = 0.46;
const AXIAL_BAR_SPAN = 1.05;

export function drawMongoFront(ctx: Ctx, pose: MongoPose, prop: MongoProportions): void {
  drawMongoAxial(ctx, pose, prop, FRONT_VIEW);
}

export function drawMongoBack(ctx: Ctx, pose: MongoPose, prop: MongoProportions): void {
  drawMongoAxial(ctx, pose, prop, BACK_VIEW);
}

// ── Measurement helpers for the bake gates ───────────────────────────────────

export interface LegMeasure {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  readonly toeTip: Pt;
  readonly hipToAnkle: number;
}

export function measureLegs(
  pose: MongoPose,
  prop: MongoProportions,
): Record<'near' | 'far', LegMeasure> {
  const sk = buildSkeleton(pose, prop);
  const of = (leg: LegJoints): LegMeasure => ({
    hip: leg.hip,
    knee: leg.knee,
    ankle: leg.ankle,
    toeTip: leg.toeTip,
    hipToAnkle: dist(leg.hip, leg.ankle),
  });
  return { near: of(sk.nearLeg), far: of(sk.farLeg) };
}

/**
 * The head's centroid, which the head-stabilisation gate watches across a walk
 * cycle. Avian head stabilisation is the single trait that sells "this is a
 * real animal" more than anything else in the walk.
 */
export function measureHead(pose: MongoPose, prop: MongoProportions): Pt {
  const sk = buildSkeleton(pose, prop);
  return mid(sk.headBase, sk.snout);
}

/** The hand-claw tip, for the slash row's arc trace. */
export function measureHandClaw(pose: MongoPose, prop: MongoProportions): Pt {
  const sk = buildSkeleton(pose, prop);
  const arm = pose.nearArm;
  const elbow = add(sk.shoulder, rot({ x: prop.humerus, y: 0 }, arm.upper));
  const wrist = add(elbow, rot({ x: prop.forearm, y: 0 }, arm.upper + arm.fore));
  return add(
    wrist,
    rot(
      { x: prop.hand + prop.sickle * FINGER_CLAW_SHARE, y: 0 },
      arm.upper + arm.fore + HAND_DROOP,
    ),
  );
}

/** The near foot's sickle-claw tip, for the pounce row's arc trace. */
export function measureFootSickle(pose: MongoPose, prop: MongoProportions): Pt {
  const sk = buildSkeleton(pose, prop);
  const leg = sk.nearLeg;
  const along = dir(leg.toeBase, leg.toeTip);
  const side = perp(along);
  const root = add(leg.toeBase, {
    x: along.x * SICKLE_ROOT_ALONG - side.x * SICKLE_ROOT_UP,
    y: along.y * SICKLE_ROOT_ALONG - side.y * SICKLE_ROOT_UP,
  });
  const angle =
    Math.atan2(along.y, along.x) +
    lerp(RETRACTED_SICKLE_ANGLE, DEPLOYED_SICKLE_ANGLE, clamp01(pose.nearLeg.sickle));
  return add(root, rot({ x: prop.sickle, y: 0 }, angle));
}
