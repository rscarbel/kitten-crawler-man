/**
 * The painter library behind Deinonychus's three sprite sheets.
 *
 * Deinonychus antirrhopus is a large, heavily built dromaeosaur, drawn with the
 * feathers palaeontology actually gives it. Everything here serves the short
 * list of cues that separate it from the lizard, the bird and the dog it
 * otherwise collapses into at 32 px:
 *
 *   - a **horizontal** spine, head and tail balanced over the hips like a seesaw
 *   - a **long, deep skull** with a straight snout and a robust lower jaw, on an
 *     **S-curved** neck rising out of a deep chest
 *   - **digitigrade** legs: a long metatarsus, a high ankle pointing *backward*
 *     (the "reverse knee" that is really a heel) and a knee tucked forward
 *   - the **sickle claw** on toe II, held raised clear of the floor
 *   - **long wing-arms**: three clawed fingers and pennaceous feathers along the
 *     forearm and hand, folded back along the flank like a bird's
 *   - a **stiff** tail held straight back, ending in a feather fan
 *   - a full **feather coat**, ragged at the silhouette, never smooth scales
 *
 * The colouring is fixed: a green coat running from deep olive along the back
 * through mid green on the flanks to pale sage-cream underneath, and orange
 * pennaceous feathers on the forearms, the tail and in a hackle down the neck.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 unit is
 * one tile — with the origin at the centre of the logical tile and +Y pointing
 * down the screen. The profile view faces +X; the runtime mirrors it.
 *
 * Choreography lives in `deinonychusFigure.ts`. This module knows
 * nothing about animation beyond the pose handed to it.
 */

type Ctx = CanvasRenderingContext2D;

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
 * The feather coat, named by where it sits rather than by hue so the same list
 * serves the neck, the haunch and the tail without re-deriving anything.
 *
 * `dorsal` is a deep olive rather than a near-black: at a 32 px tile a black
 * back collapses into a silhouette hole and takes the whole top of the animal
 * with it.
 */
export const HIDE = {
  dorsal: '#34431c',
  back: '#4d6327',
  base: '#6c8a34',
  light: '#93b252',
  rim: '#c2d48c',
  belly: '#d7dbaa',
  bellyShade: '#aab485',
  shadow: '#161d0b',
} as const;

/**
 * The bare skin of the snout, the shins and the feet: scales, not feathers, and
 * a step greyer and darker than the coat so the feathered thigh reads as ending
 * somewhere.
 */
export const SCALE = {
  base: '#4c5233',
  dark: '#2c301b',
  light: '#737a50',
} as const;

/**
 * Chick down, in the coat's own pale green. Down is the coat at a younger age,
 * not a separate colour: a white halo would read as frost.
 */
export const DOWN_FLUFF = '#aabf78';

/**
 * The orange pennaceous feathers — forearms, tail and the neck hackle. Burnt at
 * the root, bright through the vane, and darker again at the tip, which is what
 * makes a row of them read as separate feathers rather than an orange paddle.
 */
export const PLUME = {
  root: '#a2420f',
  base: '#d9661b',
  vane: '#f59130',
  tip: '#6b2b0d',
} as const;

export const EYE_RING = '#6e4310';
export const EYE_IRIS = '#f2b22e';
export const EYE_PUPIL = '#120d08';
/** The outline every claw is drawn in. */
export const CLAW = '#1c1912';
/**
 * Claw keratin: a pale, cool horn grey. Pale, so the one claw that identifies a
 * dromaeosaur is the one claw that can be seen against a dark foot; cool, so it
 * is never mistaken for the sage-cream belly or the orange feathers.
 */
export const SICKLE_KERATIN = '#cbc9c5';
export const TOOTH = '#f7f5ec';
export const MOUTH_FLESH = '#5e2226';
export const GROUND_SHADOW = '#000000';

/** The ground line, in tile units below the tile's centre. */
export const GROUND_Y = 0.4;

// ── Stages ───────────────────────────────────────────────────────────────────

export type DeinonychusStage = 'juvenile' | 'adolescent' | 'adult';

export const DEINONYCHUS_STAGE_ORDER: readonly DeinonychusStage[] = [
  'juvenile',
  'adolescent',
  'adult',
];

/**
 * Every length a stage needs, in tile units before the stage's own `scale`.
 *
 * The three stages are authored as three proportion sets rather than as one set
 * under three multipliers: a juvenile dinosaur is not a small adult, it is a
 * different animal shape — oversized skull, huge eye, stubby tail, short neck.
 * A single scale factor would give a shrunken adult, which reads as a distant
 * adult rather than as a chick.
 */
export interface DeinonychusProportions {
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
  /** The longest wing feather, the outer primary. */
  readonly wingFeather: number;
  /** The longest feather of the tail's terminal fan. */
  readonly tailFan: number;
  /** How long the contour feathers stand off the silhouette. */
  readonly coatFringe: number;
  /** Downy fluff on the outline: 1 on the chick, near nothing on the adult. */
  readonly down: number;
  /** Half-width of the torso in the head-on views. */
  readonly girth: number;
  /**
   * How much interior detail this stage carries, 0–1.
   *
   * The juvenile's cells are a third of the adult's area, and every interior
   * element — the pebbling, the dorsal bars, the pale underside, the hand claws —
   * costs the same number of *pixels* on both. Carried at full strength on the
   * chick they stop being detail and become noise, and the animal reads as a
   * jumble of overlapping panels rather than as a small fluffy dinosaur.
   */
  readonly detail: number;
  /** Thigh musculature bulge; the adult's drumstick is his heaviest mass. */
  readonly thighBulk: number;
}

const JUVENILE: DeinonychusProportions = {
  scale: 0.62,
  hipHeight: 0.55,
  femur: 0.24,
  tibia: 0.26,
  metatarsus: 0.19,
  toe: 0.12,
  sickle: 0.16,
  spineLength: 0.25,
  chestRise: -0.02,
  hipDepth: 0.21,
  chestDepth: 0.23,
  bellyDepth: 0.21,
  neckLength: 0.19,
  neckThickness: 0.078,
  skullLength: 0.3,
  skullDepth: 0.17,
  jawDepth: 0.42,
  eyeRadius: 0.042,
  humerus: 0.14,
  forearm: 0.13,
  hand: 0.09,
  tail: [0.15, 0.13, 0.11, 0.08],
  tailDepth: 0.12,
  wingFeather: 0.22,
  tailFan: 0.2,
  coatFringe: 0.034,
  down: 1,
  girth: 0.26,
  thighBulk: 0.92,
  detail: 0.35,
};

const ADOLESCENT: DeinonychusProportions = {
  scale: 0.7,
  hipHeight: 0.74,
  femur: 0.31,
  tibia: 0.34,
  metatarsus: 0.28,
  toe: 0.14,
  sickle: 0.15,
  spineLength: 0.43,
  chestRise: -0.04,
  hipDepth: 0.22,
  chestDepth: 0.25,
  bellyDepth: 0.2,
  neckLength: 0.35,
  neckThickness: 0.08,
  skullLength: 0.34,
  skullDepth: 0.165,
  jawDepth: 0.42,
  eyeRadius: 0.04,
  humerus: 0.2,
  forearm: 0.19,
  hand: 0.12,
  tail: [0.25, 0.21, 0.18, 0.14],
  tailDepth: 0.14,
  wingFeather: 0.23,
  tailFan: 0.2,
  coatFringe: 0.04,
  down: 0.35,
  girth: 0.25,
  thighBulk: 0.95,
  detail: 0.7,
};

const ADULT: DeinonychusProportions = {
  scale: 0.82,
  hipHeight: 0.72,
  femur: 0.31,
  tibia: 0.34,
  metatarsus: 0.28,
  toe: 0.15,
  sickle: 0.15,
  spineLength: 0.52,
  chestRise: -0.055,
  hipDepth: 0.24,
  chestDepth: 0.29,
  bellyDepth: 0.22,
  neckLength: 0.44,
  neckThickness: 0.1,
  skullLength: 0.45,
  skullDepth: 0.19,
  jawDepth: 0.42,
  eyeRadius: 0.033,
  humerus: 0.22,
  forearm: 0.21,
  hand: 0.19,
  tail: [0.3, 0.27, 0.23, 0.2],
  tailDepth: 0.18,
  wingFeather: 0.3,
  tailFan: 0.24,
  coatFringe: 0.035,
  down: 0.05,
  girth: 0.25,
  thighBulk: 1.22,
  detail: 1,
};

export const DEINONYCHUS_STAGES: Record<DeinonychusStage, DeinonychusProportions> = {
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
export function legReach(prop: DeinonychusProportions): number {
  return prop.femur + prop.tibia;
}

/** Slack kept out of the two-bone solve so a straight leg never divides by zero. */
const LEG_JOINT_SLACK = 0.0006;

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

export interface DeinonychusPose {
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

/** The metatarsus angle a standing dinosaur holds, in radians above the ground. */
const REST_META = deg(60);
/** Rest angles for the folded wing-arm, measured from +X. */
const REST_UPPER_ARM = deg(148);
const REST_FOREARM = deg(-150);

export function restLeg(toeX: number): LegPose {
  return { toeX, lift: 0, meta: REST_META, roll: 0, sickle: 0, lateral: 0, nearness: 0.5 };
}

export function restArm(): ArmPose {
  return { upper: REST_UPPER_ARM, fore: REST_FOREARM, spread: 0, lateral: 0 };
}

/**
 * The standing pose every animation is written as edits to.
 *
 * The two feet are staggered rather than square: a dinosaur at rest stands with
 * one foot slightly ahead, and a perfectly symmetric stance reads as a museum
 * mount rather than as an animal.
 */
const REST_NEAR_TOE = 0.05;
const REST_FAR_TOE = -0.07;
const REST_TAIL_LIFT = deg(5);

export function restPose(): DeinonychusPose {
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

interface DeinonychusSkeleton {
  readonly pelvis: Pt;
  readonly chest: Pt;
  readonly headBase: Pt;
  readonly snout: Pt;
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
const SHOULDER_FORWARD = 0.07;
const SHOULDER_DROP = 0.01;
/** The skull's rest pitch below the neck's line — a dinosaur carries its head level. */
const SKULL_REST_PITCH = deg(8);

/** Neck top placement as fractions of `neckLength`, in the chest's frame. */
const NECK_TOP_FORWARD = 1.08;
const NECK_TOP_RISE = -0.8;
/** Where the extended neck puts the head on a full strike. */
const NECK_REACH_FORWARD = 0.98;
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

function buildLeg(pose: LegPose, hip: Pt, prop: DeinonychusProportions): LegJoints {
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

export function buildSkeleton(
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): DeinonychusSkeleton {
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

  const headAngle = neckAngle + SKULL_REST_PITCH + pose.headTilt;
  const snout = add(headBase, rot({ x: prop.skullLength, y: 0 }, headAngle));

  const tailRoot = add(pelvis, rot({ x: -TAIL_ROOT_BACK, y: -TAIL_ROOT_RISE }, spineAngle));
  const tail: Pt[] = [tailRoot];
  // `+ tailLift`, not `-`: with +Y down the screen, adding to an angle already
  // past π swings the tail *up*. Subtracting would invert every constant named
  // "lift" in the choreography — the pounce would drop its tail and the
  // collapse would hold its own aloft like a handle.
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
    headBase,
    snout,
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

/**
 * Where a leg's hip joint sits along the facing axis with the spine level, in
 * the same world units a `LegPose.toeX` is measured in. The choreography centres
 * each foot's stride under its own hip, or the far leg — set back for depth —
 * over-reaches at the back of every step.
 */
export function restHipX(side: 'near' | 'far'): number {
  return side === 'near' ? HIP_FORWARD : HIP_FORWARD - FAR_HIP_BACK;
}

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

function fillAndOutline(
  ctx: Ctx,
  fill: string | CanvasGradient,
  outline: string,
  width = OUTLINE_WIDTH,
): void {
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
 * tail. Offsetting a single polyline by a per-node half-width gives one
 * continuous silhouette instead.
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

// ── The coat ─────────────────────────────────────────────────────────────────

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

/**
 * The coat's colour across a form, from its dorsal edge (0) to its ventral
 * edge (1).
 *
 * The stops sit close together at each change of tone so the bands meet along
 * a line that follows the body, rather than fading into each other through a
 * wide blur that reads as airbrush.
 */
const COAT_STOPS: readonly (readonly [number, string])[] = [
  [0, HIDE.dorsal],
  [0.2, HIDE.dorsal],
  [0.3, HIDE.back],
  [0.42, HIDE.base],
  [0.62, HIDE.base],
  [0.72, HIDE.bellyShade],
  [0.8, HIDE.belly],
  [1, HIDE.belly],
];

function coatGradient(ctx: Ctx, dorsal: Pt, ventral: Pt, shade: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(dorsal.x, dorsal.y, ventral.x, ventral.y);
  for (const [stop, colour] of COAT_STOPS)
    gradient.addColorStop(stop, mix(colour, HIDE.shadow, shade));
  return gradient;
}

/** The coat's flat colour at one depth, for a part too small to carry a gradient. */
function coatAt(depth: number, shade: number): string {
  const clamped = clamp01(depth);
  for (let i = 1; i < COAT_STOPS.length; i++) {
    const [stop, colour] = COAT_STOPS[i];
    if (clamped > stop) continue;
    const [previousStop, previousColour] = COAT_STOPS[i - 1];
    const t = stop === previousStop ? 1 : (clamped - previousStop) / (stop - previousStop);
    return mix(mix(previousColour, colour, t), HIDE.shadow, shade);
  }
  return mix(HIDE.belly, HIDE.shadow, shade);
}

/**
 * Samples the same rounded curve `traceOutline` draws through `points`, over the
 * stretch whose control points are `from`..`to`.
 *
 * Feather fringes are rooted on the curve that was actually painted. Rooted on
 * the raw control polygon instead, they stand off the body at every rounded
 * corner and float in mid-air.
 */
function smoothedStretch(points: readonly Pt[], from: number, to: number): Pt[] {
  const sampled: Pt[] = [];
  const count = points.length;
  for (let i = Math.max(1, from); i <= Math.min(count - 1, to); i++) {
    const start = i === 1 ? points[0] : mid(points[i - 1], points[i]);
    const end = mid(points[i], points[(i + 1) % count]);
    for (let step = 0; step < CURVE_SAMPLES; step++) {
      sampled.push(quadAt(start, points[i], end, step / CURVE_SAMPLES));
    }
    if (i === Math.min(count - 1, to)) sampled.push(end);
  }
  return sampled;
}

const CURVE_SAMPLES = 6;

function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** The point and unit tangent `distance` along a polyline. */
function alongPolyline(points: readonly Pt[], distance: number): { point: Pt; tangent: Pt } {
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const length = dist(points[i - 1], points[i]);
    if (remaining <= length || i === points.length - 1) {
      const t = length < ZERO_LENGTH_EPSILON ? 0 : clamp01(remaining / length);
      return { point: mid(points[i - 1], points[i], t), tangent: dir(points[i - 1], points[i]) };
    }
    remaining -= length;
  }
  const only = points[0];
  return { point: only, tangent: { x: 1, y: 0 } };
}

interface FringeStyle {
  /** Tuft length at 0..1 along the stretch. */
  readonly length: (t: number) => number;
  /** Tuft fill at 0..1 along the stretch. */
  readonly fill: (t: number) => string;
  /** The tufts' outer edge; by default a darker step of their own fill. */
  readonly edge?: string;
  /** Distance between tuft roots. */
  readonly spacing: number;
  /** Which side of the stretch's own direction is outside: +1 is `perp`, -1 its opposite. */
  readonly outward: number;
  /** The direction the feathers lie back toward — the tail, nearly always. */
  readonly rear: Pt;
  /** How far they lie back, 0 standing straight out .. 1 at 45°. */
  readonly lean: number;
  readonly seed: number;
}

/**
 * Contour feathers breaking a silhouette.
 *
 * This, more than any interior texture, is what says "feathered" at tile size:
 * a smooth outline is a lizard however the inside is painted. Each tuft is
 * filled in the coat colour beneath it and stroked only along its two outer
 * edges, so its root covers the body's own outline there and the silhouette
 * line becomes a run of overlapping feather tips instead of a seam.
 */
function paintFringe(ctx: Ctx, stretch: readonly Pt[], style: FringeStyle): void {
  const total = polylineLength(stretch);
  if (total < ZERO_LENGTH_EPSILON) return;
  const count = Math.max(1, Math.round(total / style.spacing));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const { point, tangent } = alongPolyline(stretch, t * total);
    const side = perp(tangent);
    const out = { x: side.x * style.outward, y: side.y * style.outward };
    const jitter = lerp(FRINGE_JITTER_MIN, 1, hash2(style.seed, i));
    const length = style.length(t) * jitter;
    if (length <= 0) continue;
    const heading = dir({ x: 0, y: 0 }, add(out, scaled(style.rear, style.lean)));
    const half = style.spacing * FRINGE_BASE_SHARE;
    const inset = scaled(out, -OUTLINE_WIDTH * FRINGE_INSET);
    const baseA = add(add(point, inset), scaled(tangent, -half));
    const baseB = add(add(point, inset), scaled(tangent, half));
    const tip = add(point, scaled(heading, length));
    ctx.beginPath();
    ctx.moveTo(baseA.x, baseA.y);
    ctx.quadraticCurveTo(
      lerp(baseA.x, tip.x, FRINGE_SHOULDER) + out.x * length * FRINGE_BELLY,
      lerp(baseA.y, tip.y, FRINGE_SHOULDER) + out.y * length * FRINGE_BELLY,
      tip.x,
      tip.y,
    );
    ctx.quadraticCurveTo(
      lerp(baseB.x, tip.x, FRINGE_SHOULDER),
      lerp(baseB.y, tip.y, FRINGE_SHOULDER),
      baseB.x,
      baseB.y,
    );
    const fill = style.fill(t);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(baseA.x, baseA.y);
    ctx.quadraticCurveTo(
      lerp(baseA.x, tip.x, FRINGE_SHOULDER) + out.x * length * FRINGE_BELLY,
      lerp(baseA.y, tip.y, FRINGE_SHOULDER) + out.y * length * FRINGE_BELLY,
      tip.x,
      tip.y,
    );
    ctx.quadraticCurveTo(
      lerp(baseB.x, tip.x, FRINGE_SHOULDER),
      lerp(baseB.y, tip.y, FRINGE_SHOULDER),
      baseB.x,
      baseB.y,
    );
    ctx.strokeStyle = style.edge ?? mix(fill, HIDE.shadow, FRINGE_EDGE_DARKEN);
    ctx.lineWidth = OUTLINE_WIDTH * FRINGE_EDGE_SHARE;
    ctx.stroke();
  }
}

/** The shortest a tuft gets, as a share of its stretch's length, so the edge is ragged rather than combed. */
const FRINGE_JITTER_MIN = 0.55;
/** Half a tuft's root, as a share of the spacing: over a half, so neighbours overlap. */
const FRINGE_BASE_SHARE = 0.75;
/** How far inside the silhouette a root sits, in outline widths, so it covers that outline. */
const FRINGE_INSET = 1.4;
const FRINGE_SHOULDER = 0.45;
const FRINGE_BELLY = 0.18;
const FRINGE_EDGE_SHARE = 0.7;
const FRINGE_EDGE_DARKEN = 0.55;

function scaled(v: Pt, by: number): Pt {
  return { x: v.x * by, y: v.y * by };
}

/**
 * Contour-feather texture inside the current clip: staggered rows of short
 * streaks lying back along the coat's flow, each a dark line under a lit one —
 * the shadowed edge of one feather and the lit tip of the one above it.
 *
 * Streaks rather than scalloped arcs: rows of arcs read as scales, which is the
 * one thing this coat must never be mistaken for. And kept to a handful of
 * large marks, because fine marks over a whole body at this size read as dirt.
 */
function paintFeatherTexture(
  ctx: Ctx,
  origin: Pt,
  along: Pt,
  down: Pt,
  length: number,
  depth: number,
  rows: number,
  perRow: number,
  seed: number,
  detail: number,
): void {
  if (detail <= 0) return;
  const size = (length / perRow) * TEXTURE_MARK_SHARE;
  ctx.lineCap = 'round';
  ctx.lineWidth = TEXTURE_WIDTH;
  for (let row = 0; row < rows; row++) {
    const v = (row + HALF_SPAN) / rows;
    for (let column = 0; column < perRow; column++) {
      const stagger = row % 2 === 0 ? 0 : HALF_SPAN;
      const u = (column + stagger + hash2(seed + row, column) * TEXTURE_JITTER) / perRow;
      const centre = add(
        origin,
        add(scaled(along, u * length), scaled(down, (v - HALF_SPAN) * depth)),
      );
      const head = add(centre, scaled(along, size * TEXTURE_STREAK_FORE));
      const tail = add(
        centre,
        add(scaled(along, -size), scaled(down, size * TEXTURE_STREAK_DROOP)),
      );
      const bend = add(mid(head, tail), scaled(down, size * TEXTURE_STREAK_BOW));
      const lift = scaled(down, -TEXTURE_LIGHT_OFFSET * size);
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      ctx.quadraticCurveTo(bend.x, bend.y, tail.x, tail.y);
      ctx.strokeStyle = rgba(
        HIDE.shadow,
        TEXTURE_DARK_ALPHA * detail * lerp(1, TEXTURE_BELLY_FADE, v),
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(head.x + lift.x, head.y + lift.y);
      ctx.quadraticCurveTo(bend.x + lift.x, bend.y + lift.y, tail.x + lift.x, tail.y + lift.y);
      ctx.strokeStyle = rgba(HIDE.light, TEXTURE_LIGHT_ALPHA * detail * (1 - v));
      ctx.stroke();
    }
  }
}

const TEXTURE_MARK_SHARE = 0.7;
const TEXTURE_STREAK_FORE = 0.4;
const TEXTURE_STREAK_DROOP = 0.25;
const TEXTURE_STREAK_BOW = 0.1;
const TEXTURE_JITTER = 0.3;
const TEXTURE_DARK_ALPHA = 0.3;
const TEXTURE_LIGHT_ALPHA = 0.28;
const TEXTURE_LIGHT_OFFSET = 0.14;
const TEXTURE_BELLY_FADE = 0.35;
const TEXTURE_WIDTH = 0.009;

/**
 * Bare scales — the snout, the shins, the feet: a field of small pale and dark
 * dots inside whatever path is currently clipped.
 */
function paintScales(ctx: Ctx, box: InkBounds, seed: number, detail: number): void {
  for (let i = 0; i < SCALE_DOT_COUNT; i++) {
    const x = lerp(box.minX, box.maxX, hash2(seed, i * 2));
    const y = lerp(box.minY, box.maxY, hash2(seed + 1, i * 2 + 1));
    const tone = hash2(seed + 2, i) > HALF_SPAN ? SCALE.light : SCALE.dark;
    ctx.beginPath();
    ctx.arc(x, y, SCALE_DOT_RADIUS * (SCALE_DOT_MIN + hash2(seed + 3, i)), 0, TWO_PI);
    ctx.fillStyle = rgba(tone, SCALE_DOT_ALPHA * detail);
    ctx.fill();
  }
}

const SCALE_DOT_COUNT = 40;
const SCALE_DOT_RADIUS = 0.007;
const SCALE_DOT_MIN = 0.6;
const SCALE_DOT_ALPHA = 0.3;

// ── Pennaceous feathers ──────────────────────────────────────────────────────

/**
 * One orange flight feather: an asymmetric vane — narrow leading edge, broad
 * trailing one — burnt at the root, bright through the middle and dark at the
 * tip, with its shaft drawn down the leading third.
 */
function drawPennaceous(
  ctx: Ctx,
  root: Pt,
  angle: number,
  length: number,
  width: number,
  shade: number,
): void {
  if (length <= 0) return;
  const tip = add(root, rot({ x: length, y: 0 }, angle));
  const side = perp(dir(root, tip));
  const lead = width * VANE_LEAD_SHARE;
  const trail = width * (1 - VANE_LEAD_SHARE);
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.quadraticCurveTo(
    lerp(root.x, tip.x, VANE_WIDEST) - side.x * lead * 2,
    lerp(root.y, tip.y, VANE_WIDEST) - side.y * lead * 2,
    tip.x,
    tip.y,
  );
  ctx.quadraticCurveTo(
    lerp(root.x, tip.x, VANE_WIDEST) + side.x * trail * 2,
    lerp(root.y, tip.y, VANE_WIDEST) + side.y * trail * 2,
    root.x,
    root.y,
  );
  ctx.closePath();
  const gradient = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y);
  gradient.addColorStop(0, mix(PLUME.root, HIDE.shadow, shade));
  gradient.addColorStop(VANE_ROOT_END, mix(PLUME.base, HIDE.shadow, shade));
  gradient.addColorStop(VANE_BRIGHT_START, mix(PLUME.vane, HIDE.shadow, shade));
  gradient.addColorStop(VANE_TIP_START, mix(PLUME.vane, HIDE.shadow, shade));
  gradient.addColorStop(VANE_TIP_DARK, mix(PLUME.tip, HIDE.shadow, shade));
  gradient.addColorStop(1, mix(PLUME.tip, HIDE.shadow, shade));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = rgba(mix(PLUME.tip, HIDE.shadow, shade), VANE_EDGE_ALPHA);
  ctx.lineWidth = VANE_EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const shaftEnd = mid(root, tip, VANE_SHAFT_LENGTH);
  ctx.beginPath();
  ctx.moveTo(
    root.x - side.x * lead * VANE_SHAFT_OFFSET,
    root.y - side.y * lead * VANE_SHAFT_OFFSET,
  );
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.strokeStyle = rgba(mix(PLUME.root, HIDE.shadow, shade), VANE_SHAFT_ALPHA);
  ctx.lineWidth = VANE_SHAFT_WIDTH;
  ctx.stroke();
}

const VANE_LEAD_SHARE = 0.3;
const VANE_WIDEST = 0.55;
const VANE_ROOT_END = 0.18;
const VANE_BRIGHT_START = 0.4;
const VANE_TIP_START = 0.72;
const VANE_TIP_DARK = 0.9;
const VANE_EDGE_ALPHA = 0.85;
const VANE_EDGE_WIDTH = 0.006;
const VANE_SHAFT_LENGTH = 0.85;
const VANE_SHAFT_OFFSET = 0.3;
const VANE_SHAFT_ALPHA = 0.5;
const VANE_SHAFT_WIDTH = 0.004;
/** A feather's width as a share of its length. */
const FEATHER_WIDTH_SHARE = 0.26;

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
      const t = (j + HALF_SPAN) / DOWN_TUFTS_PER_SEGMENT;
      const root = mid(here, next, t);
      const wobble = hash2(seed + i * 2, j);
      const length = DOWN_LENGTH * amount * (DOWN_MIN_TUFT + wobble);
      const lean = (hash2(seed + i * 2 + 1, j) - HALF_SPAN) * DOWN_LEAN;
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
const DOWN_ALPHA = 0.5;
const DOWN_WIDTH = 0.012;
const DOWN_LENGTH = 0.028;
const DOWN_TUFTS_PER_SEGMENT = 18;

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
function bodyOutline(sk: DeinonychusSkeleton, prop: DeinonychusProportions, breathe: number): Pt[] {
  const spine = dir(sk.pelvis, sk.chest);
  const down = perp(spine);
  const hipDepth = prop.hipDepth;
  const chestDepth = prop.chestDepth * (1 + breathe * BREATH_DEPTH);
  const bellyDepth = prop.bellyDepth * (1 + breathe * BREATH_DEPTH * HALF_SPAN);

  const span = prop.spineLength;
  /** A point in the spine's own frame: `along` forward of the pelvis, `drop` below it. */
  const at = (along: number, drop: number): Pt => ({
    x: sk.pelvis.x + spine.x * along * span + down.x * drop,
    y: sk.pelvis.y + spine.y * along * span + down.y * drop,
  });

  // Index order matters: the fringe stretches below name spans of this loop.
  return [
    at(TAIL_JOIN_ALONG, -hipDepth * TAIL_JOIN_TOP),
    at(HIP_CREST_ALONG, -hipDepth),
    // The saddle between hips and shoulders. Without it the back is a plank and
    // the animal reads as a plastic toy however good the ends are.
    at(SADDLE_ALONG, -hipDepth * SADDLE_SHARE),
    at(WITHERS_ALONG, -chestDepth * WITHERS_SHARE),
    // The shoulder runs on into the neck rather than stopping at a corner; a
    // notch here would make the head look bolted onto a box.
    at(NECK_ROOT_ALONG, -chestDepth * NECK_ROOT_RISE),
    at(THROAT_ALONG, chestDepth * THROAT_DROP),
    at(BRISKET_ALONG, chestDepth),
    at(BELLY_ALONG, bellyDepth),
    at(VENT_ALONG, hipDepth * VENT_SHARE),
    at(TAIL_JOIN_ALONG, prop.tailDepth * TAIL_JOIN_UNDER),
  ];
}

const BREATH_DEPTH = 0.05;
/** The back's fringe runs over the hip crest, the saddle and the withers. */
const BODY_DORSAL_FROM = 1;
const BODY_DORSAL_TO = 3;
/** The belly's runs from the brisket back to the vent. */
const BODY_BELLY_FROM = 6;
const BODY_BELLY_TO = 8;
/** Which segments of the body outline the chick's down stands off. */
/**
 * Which segments of the body outline the chick's down stands off: the belly and
 * the rump, not the back, where a line of pale tufts reads as a lizard's frill.
 */
const BODY_OUTLINE_EXPOSED = new Set([0, 6, 7, 8]);
/** Where the body's outline meets the tail, as a share of the spine behind the hips. */
const TAIL_JOIN_ALONG = -0.3;
const TAIL_JOIN_TOP = 0.72;
const TAIL_JOIN_UNDER = 1.2;
const HIP_CREST_ALONG = -0.02;
const SADDLE_ALONG = 0.42;
/** The dip between hips and shoulders. Under 1 it saddles; at 1 the back is flat. */
const SADDLE_SHARE = 0.86;
const WITHERS_ALONG = 0.92;
const WITHERS_SHARE = 0.94;
const NECK_ROOT_ALONG = 1.14;
const NECK_ROOT_RISE = 0.45;
const THROAT_ALONG = 1.16;
const THROAT_DROP = 0.4;
const BRISKET_ALONG = 0.86;
const BELLY_ALONG = 0.4;
const VENT_ALONG = -0.06;
const VENT_SHARE = 0.62;

/** A fringe's tuft fill: the coat at a fixed depth. */
function fringeTone(depth: number, shade: number): (t: number) => string {
  const tone = coatAt(depth, shade);
  return () => tone;
}

function drawBodySide(
  ctx: Ctx,
  sk: DeinonychusSkeleton,
  prop: DeinonychusProportions,
  breathe: number,
): void {
  const outline = bodyOutline(sk, prop, breathe);
  const spine = dir(sk.pelvis, sk.chest);
  const down = perp(spine);
  const rear = scaled(spine, -1);
  const top = add(sk.pelvis, scaled(down, -prop.hipDepth * COAT_TOP_SHARE));
  const bottom = add(sk.pelvis, scaled(down, prop.chestDepth * COAT_BOTTOM_SHARE));

  paintDown(ctx, outline, prop.down, DOWN_SEED, (index) => BODY_OUTLINE_EXPOSED.has(index));
  traceOutline(ctx, outline);
  ctx.fillStyle = coatGradient(ctx, top, bottom, 0);
  ctx.fill();
  // Outlined along the back and the belly only. The front of the chest is
  // where the neck grows out of it, and a stroke there draws the body as a box
  // with the neck stood in front of it.
  strokeOpen(ctx, smoothedStretch(outline, BODY_DORSAL_FROM, BODY_DORSAL_TO));
  strokeOpen(ctx, smoothedStretch(outline, BODY_BELLY_FROM, outline.length - 1));

  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  paintFeatherTexture(
    ctx,
    add(sk.pelvis, scaled(spine, -prop.spineLength * TEXTURE_BACK_SHARE)),
    spine,
    down,
    prop.spineLength * TEXTURE_LENGTH_SHARE,
    prop.chestDepth * TEXTURE_DEPTH_SHARE,
    BODY_TEXTURE_ROWS,
    BODY_TEXTURE_COLUMNS,
    BODY_TEXTURE_SEED,
    prop.detail,
  );
  ctx.restore();

  const fringe = prop.coatFringe;
  paintFringe(ctx, smoothedStretch(outline, BODY_DORSAL_FROM, BODY_DORSAL_TO), {
    length: (t) => fringe * lerp(BACK_FRINGE_HIPS, 1, t),
    fill: fringeTone(0, 0),
    spacing: fringe * FRINGE_SPACING_SHARE,
    outward: -1,
    rear,
    lean: BACK_FRINGE_LEAN,
    seed: BACK_FRINGE_SEED,
  });
  paintFringe(ctx, smoothedStretch(outline, BODY_BELLY_FROM, BODY_BELLY_TO), {
    length: (t) => fringe * BELLY_FRINGE_SHARE * lerp(1, BELLY_FRINGE_VENT, t),
    fill: fringeTone(1, 0),
    spacing: fringe * FRINGE_SPACING_SHARE,
    outward: -1,
    rear,
    lean: BELLY_FRINGE_LEAN,
    seed: BELLY_FRINGE_SEED,
  });
}

const COAT_TOP_SHARE = 1.05;
const COAT_BOTTOM_SHARE = 1.05;
const TEXTURE_BACK_SHARE = 0.25;
const TEXTURE_LENGTH_SHARE = 1.35;
const TEXTURE_DEPTH_SHARE = 1.7;
const BODY_TEXTURE_ROWS = 4;
const BODY_TEXTURE_COLUMNS = 6;
const BODY_TEXTURE_SEED = 5;
/** Tufts over the hips are shorter than over the shoulders, where the coat is fullest. */
const BACK_FRINGE_HIPS = 0.6;
const BELLY_FRINGE_VENT = 0.5;
/** The belly fringe is shorter than the back's: long, it hangs like a skirt. */
const BELLY_FRINGE_SHARE = 0.65;
const BACK_FRINGE_LEAN = 2.2;
const BELLY_FRINGE_LEAN = 1.6;
/** Distance between tuft roots, as a share of the tuft length. */
const FRINGE_SPACING_SHARE = 1.1;
const BACK_FRINGE_SEED = 13;
const BELLY_FRINGE_SEED = 19;
const DOWN_SEED = 31;

// ── Tail ─────────────────────────────────────────────────────────────────────

function tailHalfWidths(prop: DeinonychusProportions, count: number): number[] {
  const halves: number[] = [];
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    // A dromaeosaur tail keeps some depth through its muscular base and only
    // whips down to nothing over the last third, so the taper is biased late —
    // but only slightly. A hard bias leaves a broom handle behind the hips.
    halves.push(lerp(prop.tailDepth, TAIL_TIP_DEPTH, Math.pow(t, TAIL_TAPER_BIAS)));
  }
  return halves;
}

/**
 * The tail's orange feathers: a frond down both edges of its last stretch,
 * lengthening toward the tip, and a fan at the tip itself.
 *
 * Painted before the tail so the tail covers every root and the feathers read
 * as growing out of it.
 */
function drawTailFeathersSide(
  ctx: Ctx,
  nodes: readonly Pt[],
  prop: DeinonychusProportions,
  shade: number,
): void {
  const total = polylineLength(nodes);
  const width = (length: number): number => length * FEATHER_WIDTH_SHARE;
  for (let i = 0; i < TAIL_FROND_PAIRS; i++) {
    const t = lerp(TAIL_FROND_START, 1, i / TAIL_FROND_PAIRS);
    const { point, tangent } = alongPolyline(nodes, t * total);
    const tailAngle = Math.atan2(tangent.y, tangent.x);
    const reach = lerp(TAIL_FROND_SHORT, 1, (t - TAIL_FROND_START) / (1 - TAIL_FROND_START));
    const splay = lerp(TAIL_FROND_ROOT_SPLAY, TAIL_FROND_TIP_SPLAY, t);
    const length = prop.tailFan * reach;
    drawPennaceous(
      ctx,
      point,
      tailAngle + splay,
      length,
      width(length),
      shade + TAIL_UNDERSIDE_SHADE,
    );
    drawPennaceous(ctx, point, tailAngle - splay, length, width(length), shade);
  }
  const tip = nodes[nodes.length - 1];
  const before = nodes[nodes.length - 2];
  const tipAngle = Math.atan2(tip.y - before.y, tip.x - before.x);
  const fanRoot = mid(before, tip, TAIL_FAN_ROOT_ALONG);
  for (let i = 0; i < TAIL_FAN_FEATHERS; i++) {
    const u = i / (TAIL_FAN_FEATHERS - 1);
    const angle = tipAngle + lerp(-TAIL_FAN_SPREAD, TAIL_FAN_SPREAD, u);
    const length = prop.tailFan * lerp(1, TAIL_FAN_FALLOFF, Math.abs(u - HALF_SPAN) * 2);
    drawPennaceous(ctx, fanRoot, angle, length, width(length), shade);
  }
}

const TAIL_FROND_PAIRS = 6;
/** Where along the tail the orange frond begins; the base is coat. */
const TAIL_FROND_START = 0.4;
const TAIL_FROND_SHORT = 0.45;
const TAIL_FROND_ROOT_SPLAY = deg(48);
const TAIL_FROND_TIP_SPLAY = deg(26);
/** The frond under the tail is turned a little away from the light. */
const TAIL_UNDERSIDE_SHADE = 0.15;
const TAIL_FAN_ROOT_ALONG = 0.55;
const TAIL_FAN_SPREAD = deg(22);
const TAIL_FAN_FEATHERS = 5;
const TAIL_FAN_FALLOFF = 0.7;

function drawTailSide(
  ctx: Ctx,
  sk: DeinonychusSkeleton,
  prop: DeinonychusProportions,
  shade: number,
): void {
  const nodes = sk.tail;
  drawTailFeathersSide(ctx, nodes, prop, shade);
  const outline = ribbonOutline(nodes, tailHalfWidths(prop, nodes.length));
  const middle = samplePolyline(nodes, HALF_SPAN);
  const across = perp(samplePolylineDirection(nodes, HALF_SPAN));
  const top = add(middle, scaled(across, prop.tailDepth));
  // The gradient runs on past the underside, so the tail darkens to a paler
  // green beneath but never reaches the belly's cream: a cream underside the
  // whole length of the tail splits it into two sticks.
  const bottom = add(middle, scaled(across, -prop.tailDepth * TAIL_GRADIENT_STRETCH));
  traceOutline(ctx, outline);
  fillAndOutline(ctx, coatGradient(ctx, top, bottom, shade), HIDE.shadow);

  // The ribbon's dorsal edge is its first half, root to tip. The underside
  // carries no fringe: tufts along both edges of a long rod read as a zip.
  const dorsalEdge = outline.slice(0, Math.ceil(nodes.length * TAIL_FRINGE_SHARE));
  const fringe = prop.coatFringe * TAIL_FRINGE_LENGTH;
  const rear = scaled(dir(nodes[0], nodes[nodes.length - 1]), 1);
  paintFringe(ctx, dorsalEdge, {
    length: (t) => fringe * (1 - t * TAIL_FRINGE_TAPER),
    fill: fringeTone(0, shade),
    spacing: fringe * FRINGE_SPACING_SHARE,
    outward: 1,
    rear,
    lean: TAIL_FRINGE_LEAN,
    seed: TAIL_FRINGE_SEED,
  });
}

const TAIL_TIP_DEPTH = 0.015;
const TAIL_TAPER_BIAS = 1.1;
/** How much of the tail, from the root, carries a coat fringe before the frond takes over. */
const TAIL_FRINGE_SHARE = 0.75;
const TAIL_FRINGE_LENGTH = 0.8;
const TAIL_FRINGE_TAPER = 0.5;
const TAIL_FRINGE_LEAN = 3;
const TAIL_FRINGE_SEED = 43;
const TAIL_GRADIENT_STRETCH = 2;

// ── Legs ─────────────────────────────────────────────────────────────────────

/**
 * The sickle claw's centreline, root first.
 *
 * Toe II is held hyperextended while he walks, so the claw stands up off the
 * foot and arcs forward over it like a question mark; deployed, the toe swings
 * down and the same arc points its tip at the ground. One function serves the
 * painter and the pounce's arc gate, so the gate traces the claw that is drawn.
 */
function sickleNodes(leg: LegJoints, prop: DeinonychusProportions, deployed: number): Pt[] {
  const along = dir(leg.toeBase, leg.toeTip);
  const toeAngle = Math.atan2(along.y, along.x);
  const up = scaled(perp(along), -1);
  const knuckleRoot = add(
    add(leg.toeBase, scaled(along, prop.toe * SICKLE_TOE_ROOT_ALONG)),
    scaled(up, prop.femur * TOE_ROOT_HALF_SHARE),
  );
  const toeAngleII = toeAngle + lerp(SICKLE_TOE_RAISED, SICKLE_TOE_STRUCK, clamp01(deployed));
  const knuckle = add(knuckleRoot, rot({ x: prop.toe * SICKLE_TOE_LENGTH, y: 0 }, toeAngleII));
  const clawAngle = toeAngle + lerp(SICKLE_CLAW_RAISED, SICKLE_CLAW_STRUCK, clamp01(deployed));
  const nodes: Pt[] = [knuckleRoot, knuckle];
  for (let step = 1; step <= SICKLE_STEPS; step++) {
    const t = step / SICKLE_STEPS;
    // Curling toward `perp` of its own heading, which in this profile is
    // clockwise on screen: up-and-over when raised, forward-and-down when struck.
    const local = {
      x: (prop.sickle * Math.sin(t * SICKLE_SWEEP)) / SICKLE_SWEEP,
      y: (prop.sickle * (1 - Math.cos(t * SICKLE_SWEEP))) / SICKLE_SWEEP,
    };
    nodes.push(add(knuckle, rot(local, clawAngle)));
  }
  return nodes;
}

/** Where along toe III the raised toe II leaves the foot. */
const SICKLE_TOE_ROOT_ALONG = 0.48;
const SICKLE_TOE_LENGTH = 0.32;
/** Toe II's own angle off the foot: cocked up while walking, swung down to strike. */
const SICKLE_TOE_RAISED = deg(-80);
const SICKLE_TOE_STRUCK = deg(10);
/** The claw's starting heading: straight up off the knuckle, or forward and down. */
const SICKLE_CLAW_RAISED = deg(-100);
const SICKLE_CLAW_STRUCK = deg(-14);
/** How far round the claw curls along its length, in radians. */
const SICKLE_SWEEP = deg(120);
const SICKLE_STEPS = 6;
const SICKLE_ROOT_HALF = 0.036;
const SICKLE_TIP_HALF = 0.004;
const SICKLE_SHADE_SHARE = 0.4;
const SICKLE_OUTLINE_ALPHA = 0.9;
const SICKLE_OUTLINE_WIDTH = 0.006;

function drawSickle(
  ctx: Ctx,
  leg: LegJoints,
  prop: DeinonychusProportions,
  deployed: number,
  shade: number,
): void {
  const nodes = sickleNodes(leg, prop, deployed);
  const scale = mix(SCALE.base, HIDE.shadow, shade);
  const toeHalf = prop.femur * TOE_ROOT_HALF_SHARE;
  drawLimb(ctx, nodes[0], nodes[1], toeHalf, toeHalf * SICKLE_KNUCKLE_SHARE, scale, CLAW);
  const claw = nodes.slice(1);
  const halves = claw.map((_node, index) =>
    lerp(SICKLE_ROOT_HALF, SICKLE_TIP_HALF, Math.pow(index / (claw.length - 1), SICKLE_TAPER)),
  );
  traceOutline(ctx, ribbonOutline(claw, halves));
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

const SICKLE_KNUCKLE_SHARE = 0.85;
const SICKLE_TAPER = 1.3;

/** A small ground claw on a weight-bearing toe: dark horn, so the sickle stays the bright one. */
function drawToeClaw(ctx: Ctx, root: Pt, along: Pt, length: number, shade: number): void {
  const side = perp(along);
  const tip = add(root, add(scaled(along, length), scaled(side, length * TOE_CLAW_HOOK)));
  ctx.beginPath();
  ctx.moveTo(root.x - side.x * TOE_CLAW_HALF, root.y - side.y * TOE_CLAW_HALF);
  ctx.quadraticCurveTo(
    root.x + along.x * length * TOE_CLAW_BEND,
    root.y + along.y * length * TOE_CLAW_BEND,
    tip.x,
    tip.y,
  );
  ctx.lineTo(root.x + side.x * TOE_CLAW_HALF, root.y + side.y * TOE_CLAW_HALF);
  ctx.closePath();
  ctx.fillStyle = mix(SCALE.dark, HIDE.shadow, shade);
  ctx.fill();
}

const TOE_CLAW_HALF = 0.008;
const TOE_CLAW_HOOK = 0.5;
const TOE_CLAW_BEND = 0.6;

/**
 * One leg in profile: the bare scaled shin, foot and toes first, then the
 * feathered thigh over them.
 *
 * The thigh's coat runs on past the knee as a "trouser" with a ragged hem, the
 * way a bird's does. It is what tells the eye where feathers stop and scales
 * begin, and without it the leg reads as a lizard's stuck under a bird.
 */
function drawLegSide(
  ctx: Ctx,
  leg: LegJoints,
  prop: DeinonychusProportions,
  shade: number,
  pose: LegPose,
  sickle: 'withSickle' | 'sickleLater',
): void {
  const scale = mix(SCALE.base, HIDE.shadow, shade);
  const scaleDark = mix(SCALE.dark, HIDE.shadow, shade);
  const kneeHalf = prop.femur * KNEE_HALF_SHARE;
  const shankHalf = prop.femur * SHANK_HALF_SHARE;
  const ankleHalf = prop.femur * ANKLE_HALF_SHARE;
  const toeRootHalf = prop.femur * TOE_ROOT_HALF_SHARE;
  const toeTipHalf = prop.femur * TOE_TIP_HALF_SHARE;

  drawLimb(ctx, leg.knee, leg.ankle, kneeHalf, shankHalf, scale, scaleDark);
  drawLimb(ctx, leg.ankle, leg.toeBase, shankHalf, ankleHalf, scale, scaleDark);

  const toeAlong = dir(leg.toeBase, leg.toeTip);
  // Toe IV, a little behind and shorter, so the foot reads as toes rather than
  // as a single flipper.
  const outerTip = add(
    leg.toeBase,
    rot(
      { x: prop.toe * OUTER_TOE_SHARE, y: 0 },
      Math.atan2(toeAlong.y, toeAlong.x) + OUTER_TOE_ANGLE,
    ),
  );
  drawLimb(
    ctx,
    leg.toeBase,
    outerTip,
    toeRootHalf,
    toeTipHalf,
    mix(scale, HIDE.shadow, OUTER_TOE_SHADE),
    scaleDark,
  );
  drawToeClaw(
    ctx,
    outerTip,
    dir(leg.toeBase, outerTip),
    prop.toe * GROUND_CLAW_SHARE,
    shade + OUTER_TOE_SHADE,
  );
  // The small first toe, held off the ground at the back of the foot.
  const halluxTip = add(
    leg.toeBase,
    rot({ x: -prop.toe * HALLUX_SHARE, y: 0 }, Math.atan2(toeAlong.y, toeAlong.x) + HALLUX_ANGLE),
  );
  drawLimb(ctx, leg.toeBase, halluxTip, toeRootHalf * HALLUX_GIRTH, toeTipHalf, scale, scaleDark);

  drawLimb(ctx, leg.toeBase, leg.toeTip, toeRootHalf, toeTipHalf, scale, scaleDark);
  drawToeClaw(ctx, leg.toeTip, toeAlong, prop.toe * GROUND_CLAW_SHARE, shade);

  if (sickle === 'withSickle') drawSickle(ctx, leg, prop, pose.sickle, shade);

  drawThighSide(ctx, leg, prop, shade);
}

const KNEE_HALF_SHARE = 0.19;
const SHANK_HALF_SHARE = 0.14;
const ANKLE_HALF_SHARE = 0.1;
const TOE_ROOT_HALF_SHARE = 0.07;
const TOE_TIP_HALF_SHARE = 0.03;
const OUTER_TOE_SHARE = 0.8;
const OUTER_TOE_ANGLE = deg(-8);
const OUTER_TOE_SHADE = 0.25;
const HALLUX_SHARE = 0.28;
const HALLUX_ANGLE = deg(-30);
const HALLUX_GIRTH = 0.8;
const GROUND_CLAW_SHARE = 0.3;

function drawThighSide(
  ctx: Ctx,
  leg: LegJoints,
  prop: DeinonychusProportions,
  shade: number,
): void {
  // The drumstick: a dinosaur's thigh is its single heaviest muscle mass, and a
  // thigh drawn as a parallel rod is the fastest way to make the whole animal
  // read as a lizard on stilts.
  const thighHalf = prop.femur * THIGH_HALF_SHARE * prop.thighBulk;
  const thighAxis = dir(leg.hip, leg.knee);
  const back = perp(thighAxis);
  const shinAxis = dir(leg.knee, leg.ankle);
  const shinBack = perp(shinAxis);
  const bulge = mid(leg.hip, leg.knee, THIGH_BULGE_ALONG);
  const hem = mid(leg.knee, leg.ankle, TROUSER_HEM_ALONG);
  const kneeHalf = prop.femur * KNEE_HALF_SHARE * TROUSER_KNEE_SHARE;
  const hemHalf = prop.femur * SHANK_HALF_SHARE * TROUSER_HEM_SHARE;
  const frontHip = add(leg.hip, scaled(back, -thighHalf));
  const backHip = add(leg.hip, scaled(back, thighHalf));
  const frontBulge = add(bulge, scaled(back, -thighHalf * THIGH_FRONT_BULGE));
  const backBulge = add(bulge, scaled(back, thighHalf * THIGH_BACK_BULGE));
  const frontKnee = add(leg.knee, scaled(back, -kneeHalf));
  const backKnee = add(leg.knee, scaled(back, kneeHalf));
  const frontHem = add(hem, scaled(shinBack, -hemHalf));
  const backHem = add(hem, scaled(shinBack, hemHalf));
  const shape = [frontHip, frontBulge, frontKnee, frontHem, backHem, backKnee, backBulge, backHip];

  const top = add(leg.hip, { x: 0, y: -thighHalf });
  const bottom = { x: leg.knee.x, y: leg.knee.y + kneeHalf };
  traceOutline(ctx, shape);
  ctx.fillStyle = thighGradient(ctx, top, bottom, shade);
  ctx.fill();
  // The drumstick's back turns away into shadow along a line that follows the
  // femur, which is what gives the thigh its mass against the flank.
  ctx.save();
  traceOutline(ctx, shape);
  ctx.clip();
  const shadowCentre = add(bulge, scaled(back, thighHalf * THIGH_SHADOW_OFFSET));
  ctx.beginPath();
  ctx.ellipse(
    shadowCentre.x,
    shadowCentre.y,
    dist(leg.hip, leg.knee) * THIGH_SHADOW_LENGTH,
    thighHalf * THIGH_SHADOW_WIDTH,
    Math.atan2(thighAxis.y, thighAxis.x),
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(HIDE.shadow, THIGH_SHADOW_ALPHA);
  ctx.fill();
  ctx.restore();
  // Outlined round the knee only. Above the drumstick's widest point the thigh
  // is buried in the flank, and a stroke there is a seam that turns the leg
  // into a bag hung on the body.
  const frontStart = mid(frontBulge, frontKnee);
  const backEnd = mid(backKnee, backBulge);
  // Above that, a soft edge in the coat's own darker step: enough to show the
  // drumstick swelling out of the flank, not a seam.
  ctx.beginPath();
  ctx.moveTo(frontHip.x, frontHip.y);
  ctx.quadraticCurveTo(frontBulge.x, frontBulge.y, frontStart.x, frontStart.y);
  ctx.moveTo(backEnd.x, backEnd.y);
  ctx.quadraticCurveTo(backBulge.x, backBulge.y, backHip.x, backHip.y);
  ctx.strokeStyle = mix(HIDE.base, HIDE.shadow, THIGH_SOFT_EDGE + shade);
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(frontStart.x, frontStart.y);
  ctx.quadraticCurveTo(
    frontKnee.x,
    frontKnee.y,
    mid(frontKnee, frontHem).x,
    mid(frontKnee, frontHem).y,
  );
  ctx.lineTo(frontHem.x, frontHem.y);
  ctx.moveTo(backHem.x, backHem.y);
  ctx.quadraticCurveTo(backKnee.x, backKnee.y, backEnd.x, backEnd.y);
  ctx.strokeStyle = HIDE.shadow;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const fringe = prop.coatFringe;
  paintFringe(ctx, [frontHem, backHem], {
    length: () => fringe * TROUSER_HEM_FRINGE,
    fill: () => mix(HIDE.bellyShade, HIDE.shadow, shade),
    spacing: fringe * FRINGE_SPACING_SHARE,
    outward: 1,
    rear: shinBack,
    lean: TROUSER_HEM_LEAN,
    seed: TROUSER_SEED,
  });
  paintFringe(ctx, [backBulge, backKnee], {
    length: () => fringe * TROUSER_BACK_FRINGE,
    fill: () => mix(HIDE.base, HIDE.shadow, shade),
    spacing: fringe * FRINGE_SPACING_SHARE,
    outward: 1,
    rear: shinAxis,
    lean: TROUSER_BACK_LEAN,
    seed: TROUSER_SEED + 1,
  });
}

/**
 * The thigh in the flank's own mid green, lit at the hip and turning into
 * shadow toward the knee. Paler than the flank, it reads as a patch pasted on;
 * the drumstick's form has to come from its value turning, not its colour.
 */
function thighGradient(ctx: Ctx, top: Pt, bottom: Pt, shade: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  gradient.addColorStop(0, mix(HIDE.back, HIDE.shadow, shade));
  gradient.addColorStop(
    THIGH_LIGHT_STOP,
    mix(mix(HIDE.base, HIDE.light, THIGH_LIT), HIDE.shadow, shade),
  );
  gradient.addColorStop(THIGH_SHADE_STOP, mix(HIDE.base, HIDE.shadow, shade));
  gradient.addColorStop(1, mix(HIDE.base, HIDE.shadow, shade + THIGH_UNDERSIDE_SHADE));
  return gradient;
}

const THIGH_HALF_SHARE = 0.36;
const THIGH_UNDERSIDE_SHADE = 0.3;
const THIGH_SOFT_EDGE = 0.45;
/** How much of the light green the top of the drumstick catches. */
const THIGH_LIT = 0.45;
const THIGH_SHADOW_OFFSET = 1.1;
const THIGH_SHADOW_LENGTH = 0.6;
const THIGH_SHADOW_WIDTH = 0.8;
const THIGH_SHADOW_ALPHA = 0.35;
const THIGH_BULGE_ALONG = 0.42;
const THIGH_FRONT_BULGE = 1.15;
const THIGH_BACK_BULGE = 1.32;
/** How far down the shin the feathered "trouser" reaches before the scales show. */
const TROUSER_HEM_ALONG = 0.14;
const TROUSER_KNEE_SHARE = 1.05;
const TROUSER_HEM_SHARE = 1.35;
const TROUSER_HEM_FRINGE = 1.1;
const TROUSER_BACK_FRINGE = 0.9;
const TROUSER_HEM_LEAN = 0.6;
const TROUSER_BACK_LEAN = 0.8;
const THIGH_LIGHT_STOP = 0.35;
const THIGH_SHADE_STOP = 0.75;
const TROUSER_SEED = 53;

// ── Arms ─────────────────────────────────────────────────────────────────────

interface ArmJoints {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly wrist: Pt;
  readonly foreAngle: number;
  readonly handAngle: number;
}

function armJoints(sk: DeinonychusSkeleton, arm: ArmPose, prop: DeinonychusProportions): ArmJoints {
  const shoulder = sk.shoulder;
  const elbow = add(shoulder, rot({ x: prop.humerus, y: 0 }, arm.upper));
  const foreAngle = arm.upper + arm.fore;
  const wrist = add(elbow, rot({ x: prop.forearm, y: 0 }, foreAngle));
  // The wrist folds the hand down as the wing folds and opens it as the wing
  // spreads, so a spread wing's primaries carry on along the arm's line.
  const handAngle = foreAngle + lerp(HAND_FOLD, HAND_SPREAD, arm.spread);
  return { shoulder, elbow, wrist, foreAngle, handAngle };
}

/** The wrist's fold, folded and spread. */
const HAND_FOLD = deg(64);
const HAND_SPREAD = deg(18);

/**
 * The wing: secondaries along the forearm and longer primaries along the hand,
 * all lying back toward the tail when folded and fanning out behind the arm
 * when spread.
 */
function drawWingSide(
  ctx: Ctx,
  joints: ArmJoints,
  arm: ArmPose,
  prop: DeinonychusProportions,
  shade: number,
): void {
  const trail = lerp(WING_FOLDED_TRAIL, WING_SPREAD_TRAIL, arm.spread);
  const fan = lerp(WING_FOLDED_FAN, WING_SPREAD_FAN, arm.spread);
  const reach = lerp(1, WING_SPREAD_REACH, arm.spread);
  const handTip = add(
    joints.wrist,
    rot({ x: prop.hand * PRIMARY_ROOT_REACH, y: 0 }, joints.handAngle),
  );
  for (let i = 0; i < SECONDARY_COUNT; i++) {
    const t = lerp(SECONDARY_FIRST, 1, i / (SECONDARY_COUNT - 1));
    const root = mid(joints.elbow, joints.wrist, t);
    const angle = joints.foreAngle + trail - fan * (1 - t);
    const length = prop.wingFeather * SECONDARY_SHARE * lerp(SECONDARY_INNER, 1, t) * reach;
    drawPennaceous(ctx, root, angle, length, length * FEATHER_WIDTH_SHARE, shade);
  }
  for (let i = 0; i < PRIMARY_COUNT; i++) {
    const t = i / (PRIMARY_COUNT - 1);
    const root = mid(joints.wrist, handTip, t);
    const angle = joints.foreAngle + trail + fan * t * PRIMARY_FAN_SHARE;
    const length = prop.wingFeather * lerp(PRIMARY_INNER, 1, t) * reach;
    drawPennaceous(ctx, root, angle, length, length * FEATHER_WIDTH_SHARE, shade);
  }
}

/** Feathers' angle off the forearm: lying straight back folded, swung down behind it spread. */
const WING_FOLDED_TRAIL = deg(186);
const WING_SPREAD_TRAIL = deg(140);
const WING_FOLDED_FAN = deg(8);
const WING_SPREAD_FAN = deg(46);
const WING_SPREAD_REACH = 1.2;
const SECONDARY_COUNT = 4;
const SECONDARY_FIRST = 0.15;
const SECONDARY_SHARE = 0.72;
const SECONDARY_INNER = 0.75;
const PRIMARY_COUNT = 4;
const PRIMARY_ROOT_REACH = 0.6;
const PRIMARY_INNER = 0.85;
const PRIMARY_FAN_SHARE = 0.4;

function drawArmSide(
  ctx: Ctx,
  sk: DeinonychusSkeleton,
  arm: ArmPose,
  prop: DeinonychusProportions,
  shade: number,
): void {
  const joints = armJoints(sk, arm, prop);
  drawWingSide(ctx, joints, arm, prop, shade);

  // The arm is feathered to the wrist, so its bones are outlined in the coat's
  // own darker step: a black-edged tube on the flank reads as a stick figure's.
  const coat = coatAt(ARM_COAT_DEPTH, shade);
  const coatEdge = mix(coat, HIDE.shadow, ARM_EDGE_DARKEN);
  drawLimb(ctx, joints.shoulder, joints.elbow, UPPER_ARM_HALF, ELBOW_HALF, coat, coatEdge);
  drawLimb(ctx, joints.elbow, joints.wrist, ELBOW_HALF, WRIST_HALF, coat, coatEdge);
  const dark = HIDE.shadow;

  // Three long clawed fingers, the second the longest, palm facing in.
  const scale = mix(SCALE.base, HIDE.shadow, shade);
  for (let finger = 0; finger < FINGER_COUNT; finger++) {
    const spread = (finger - (FINGER_COUNT - 1) / 2) * FINGER_SPREAD;
    const length = prop.hand * FINGER_LENGTHS[finger];
    const tip = add(joints.wrist, rot({ x: length, y: 0 }, joints.handAngle + spread));
    drawLimb(ctx, joints.wrist, tip, WRIST_HALF * FINGER_ROOT_SHARE, FINGER_TIP_HALF, scale, dark);
    if (prop.detail < HAND_CLAW_DETAIL_FLOOR) continue;
    drawFingerClaw(ctx, tip, dir(joints.wrist, tip), prop.hand * FINGER_CLAW_SHARE, shade);
  }
}

const ARM_COAT_DEPTH = 0.45;
const ARM_EDGE_DARKEN = 0.45;
const UPPER_ARM_HALF = 0.036;
const ELBOW_HALF = 0.026;
const WRIST_HALF = 0.018;
const FINGER_COUNT = 3;
const FINGER_SPREAD = deg(16);
/** Digit I is short, II the longest, III between. */
const FINGER_LENGTHS: readonly number[] = [0.62, 1, 0.84];
const FINGER_ROOT_SHARE = 0.7;
const FINGER_TIP_HALF = 0.008;
const FINGER_CLAW_SHARE = 0.42;
/** Below this detail budget the hand is fingers only — its claws are a pixel. */
const HAND_CLAW_DETAIL_FLOOR = 0.5;

/**
 * A hand claw. Pale keratin like the sickle: the same dark horn on a dark
 * finger would be a claw drawn every frame and visible in none of them.
 */
function drawFingerClaw(ctx: Ctx, root: Pt, along: Pt, length: number, shade: number): void {
  const side = perp(along);
  const tip = add(root, add(scaled(along, length), scaled(side, length * FINGER_CLAW_HOOK)));
  ctx.beginPath();
  ctx.moveTo(root.x - side.x * FINGER_CLAW_HALF, root.y - side.y * FINGER_CLAW_HALF);
  ctx.quadraticCurveTo(
    root.x + along.x * length * TOE_CLAW_BEND,
    root.y + along.y * length * TOE_CLAW_BEND,
    tip.x,
    tip.y,
  );
  ctx.lineTo(root.x + side.x * FINGER_CLAW_HALF, root.y + side.y * FINGER_CLAW_HALF);
  ctx.closePath();
  ctx.fillStyle = mix(SICKLE_KERATIN, HIDE.shadow, shade * SICKLE_SHADE_SHARE);
  ctx.fill();
  ctx.strokeStyle = rgba(CLAW, SICKLE_OUTLINE_ALPHA);
  ctx.lineWidth = SICKLE_OUTLINE_WIDTH;
  ctx.stroke();
}

const FINGER_CLAW_HOOK = 0.8;
const FINGER_CLAW_HALF = 0.015;

// ── Head ─────────────────────────────────────────────────────────────────────

/** A point in the skull's own frame, in shares of its length and depth. */
type SkullAt = (forward: number, drop: number) => Pt;

function skullFrame(
  sk: DeinonychusSkeleton,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): { angle: number; at: SkullAt } {
  // The skull itself rotates *up* a little as the jaws open. A gape where only
  // the mandible drops reads as a wedge hinging, not as a mouth opening.
  const angle = sk.headAngle - pose.gape * UPPER_JAW_LIFT;
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const down = perp(along);
  const at: SkullAt = (forward, drop) => ({
    x: sk.headBase.x + along.x * forward * prop.skullLength + down.x * drop * prop.skullDepth,
    y: sk.headBase.y + along.y * forward * prop.skullLength + down.y * drop * prop.skullDepth,
  });
  return { angle, at };
}

/**
 * The skull: long and deep, with a nearly straight top from brow to snout, a
 * blunt snout tip, a straight mouth line and a robust lower jaw hinged well
 * back under the eye.
 *
 * A Deinonychus skull is a box, not a wedge. Tapered to a point it reads as a
 * smaller dinosaur's or a crocodile's; dipped at the nose it reads as a bird's.
 */
function drawHeadSide(
  ctx: Ctx,
  sk: DeinonychusSkeleton,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): void {
  const { angle, at } = skullFrame(sk, pose, prop);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const down = perp(along);

  const upper = [
    at(SKULL_BACK_ALONG, SKULL_BACK_DROP),
    at(SKULL_OCCIPUT_ALONG, -SKULL_CROWN),
    at(SKULL_BROW_ALONG, -SKULL_BROW),
    at(SKULL_NASAL_ALONG, -SKULL_NASAL),
    at(SKULL_SNOUT_TOP_ALONG, -SKULL_SNOUT_TOP),
    at(1, -SKULL_TIP_RISE),
    at(1, SKULL_TIP_DROP),
    at(SKULL_TOOTH_BACK_ALONG, SKULL_MOUTH),
    at(SKULL_HINGE_ALONG, SKULL_HINGE),
  ];

  // Lower jaw, hinged under the eye and swung open by `gape`. Its top edge is
  // the skull's own mouth line in the same units, so at gape zero the two close
  // flush instead of leaving a gap along the mouth.
  const jawAngle = angle + pose.gape * MAX_GAPE;
  const jawAlong = { x: Math.cos(jawAngle), y: Math.sin(jawAngle) };
  const jawDown = perp(jawAlong);
  const hinge = at(SKULL_HINGE_ALONG, SKULL_HINGE);
  const jawAt = (forward: number, drop: number): Pt => {
    const fromHinge = forward - SKULL_HINGE_ALONG;
    return {
      x:
        hinge.x +
        jawAlong.x * fromHinge * prop.skullLength +
        jawDown.x * (drop - SKULL_HINGE) * prop.skullDepth,
      y:
        hinge.y +
        jawAlong.y * fromHinge * prop.skullLength +
        jawDown.y * (drop - SKULL_HINGE) * prop.skullDepth,
    };
  };
  const jawDepth = prop.jawDepth;
  const jawTipTop = jawAt(JAW_LENGTH_SHARE, SKULL_TIP_DROP + JAW_OVERBITE);
  const jaw = [
    jawAt(SKULL_BACK_ALONG, SKULL_HINGE),
    jawAt(SKULL_TOOTH_BACK_ALONG, SKULL_MOUTH),
    jawTipTop,
    jawAt(JAW_LENGTH_SHARE, SKULL_TIP_DROP + JAW_OVERBITE + jawDepth * JAW_TIP_DEPTH_SHARE),
    jawAt(JAW_CHIN_ALONG, SKULL_MOUTH + jawDepth),
    jawAt(SKULL_BACK_ALONG, SKULL_HINGE + jawDepth * JAW_BACK_DEPTH_SHARE),
  ];

  const snoutTip = at(1, SKULL_TIP_DROP);
  const toothRowBack = at(SKULL_TOOTH_BACK_ALONG, SKULL_MOUTH);
  if (pose.gape > GAPE_MOUTH_VISIBLE) {
    // The gullet, painted between the jaws before either is drawn over it.
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(snoutTip.x, snoutTip.y);
    ctx.lineTo(jawTipTop.x, jawTipTop.y);
    ctx.closePath();
    ctx.fillStyle = MOUTH_FLESH;
    ctx.fill();
  }

  traceOutline(ctx, jaw);
  ctx.fillStyle = coatGradient(
    ctx,
    jawAt(HALF_SPAN, SKULL_MOUTH - JAW_GRADIENT_LEAD),
    jawAt(HALF_SPAN, SKULL_MOUTH + jawDepth),
    0,
  );
  ctx.fill();
  strokeOpen(ctx, jaw.slice(1));
  if (pose.gape > GAPE_TEETH_VISIBLE) {
    drawTeeth(
      ctx,
      jawAt(JAW_CHIN_ALONG, SKULL_MOUTH),
      jawTipTop,
      scaled(jawDown, -1),
      TOOTH_LENGTH * LOWER_TOOTH_SHARE,
    );
  }

  traceOutline(ctx, upper);
  ctx.fillStyle = coatGradient(
    ctx,
    at(HALF_SPAN, -SKULL_BROW),
    at(HALF_SPAN, SKULL_MOUTH + HEAD_GRADIENT_TAIL),
    0,
  );
  ctx.fill();
  ctx.save();
  traceOutline(ctx, upper);
  ctx.clip();
  // The snout is bare scale and the head behind the eye is feathered: the
  // greyer, pebbled muzzle is what makes the long face read as a face.
  const snoutBand = ctx.createLinearGradient(
    at(SNOUT_SCALE_START, 0).x,
    at(SNOUT_SCALE_START, 0).y,
    at(SNOUT_SCALE_FULL, 0).x,
    at(SNOUT_SCALE_FULL, 0).y,
  );
  snoutBand.addColorStop(0, rgba(SCALE.base, 0));
  snoutBand.addColorStop(1, rgba(SCALE.base, SNOUT_SCALE_ALPHA));
  ctx.fillStyle = snoutBand;
  ctx.fillRect(
    boundsOf(upper).minX,
    boundsOf(upper).minY,
    boundsOf(upper).maxX - boundsOf(upper).minX,
    boundsOf(upper).maxY - boundsOf(upper).minY,
  );
  paintScales(
    ctx,
    boundsOf([at(SNOUT_SCALE_START, -SKULL_CROWN), at(1, SKULL_MOUTH)]),
    HEAD_SCALE_SEED,
    prop.detail,
  );
  // The antorbital fenestra: a long shallow hollow between eye and nostril,
  // the one landmark every theropod face has.
  const fenestra = at(FENESTRA_ALONG, -FENESTRA_RISE);
  ctx.beginPath();
  ctx.ellipse(
    fenestra.x,
    fenestra.y,
    prop.skullLength * FENESTRA_RX,
    prop.skullDepth * FENESTRA_RY,
    angle,
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(HIDE.shadow, FENESTRA_ALPHA * prop.detail);
  ctx.fill();
  ctx.restore();
  // Stroked from the back of the crown round to the hinge only: the back of the
  // skull runs on into the neck's coat with no seam.
  strokeOpen(ctx, upper.slice(1));

  if (pose.gape > GAPE_TEETH_VISIBLE) {
    drawTeeth(ctx, toothRowBack, snoutTip, down, TOOTH_LENGTH);
  } else if (prop.detail >= CLOSED_TEETH_DETAIL) {
    // Shut, the tips of the upper teeth still show along the lip line.
    drawTeeth(
      ctx,
      at(CLOSED_TEETH_FROM, SKULL_MOUTH),
      at(CLOSED_TEETH_TO, SKULL_TIP_DROP),
      down,
      TOOTH_LENGTH * CLOSED_TOOTH_SHARE,
    );
  }

  const nostril = at(NOSTRIL_ALONG, -NOSTRIL_RISE);
  ctx.beginPath();
  ctx.ellipse(nostril.x, nostril.y, NOSTRIL_RX, NOSTRIL_RY, angle, 0, TWO_PI);
  ctx.fillStyle = rgba(HIDE.shadow, NOSTRIL_ALPHA);
  ctx.fill();

  drawEyeSide(ctx, at(EYE_ALONG, -EYE_RISE), angle, prop.eyeRadius, pose.eyeOpen);

  // A heavy brow over the eye: the scowl that makes him read as a predator
  // rather than as a bird.
  const browA = at(EYE_ALONG - EYE_BROW_SPAN, -EYE_BROW_HEIGHT);
  const browB = at(EYE_ALONG + EYE_BROW_SPAN, -EYE_BROW_HEIGHT);
  const browPeak = at(EYE_ALONG, -EYE_BROW_PEAK);
  ctx.beginPath();
  ctx.moveTo(browA.x, browA.y);
  ctx.quadraticCurveTo(browPeak.x, browPeak.y, browB.x, browB.y);
  ctx.strokeStyle = rgba(HIDE.shadow, BROW_ALPHA);
  ctx.lineWidth = BROW_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Feathered jowls over the hinge, lying back toward the neck.
  paintFringe(
    ctx,
    [at(CHEEK_FRINGE_FROM, CHEEK_FRINGE_DROP), at(SKULL_BACK_ALONG, SKULL_HINGE + jawDepth)],
    {
      length: () => prop.coatFringe * CHEEK_FRINGE_LENGTH,
      fill: fringeTone(CHEEK_FRINGE_TONE, 0),
      spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
      outward: -1,
      rear: scaled(along, -1),
      lean: CHEEK_FRINGE_LEAN,
      seed: CHEEK_FRINGE_SEED,
    },
  );
}

/** Strokes an open run of `traceOutline`-style rounded points. */
function strokeOpen(ctx: Ctx, points: readonly Pt[]): void {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const next = mid(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, next.x, next.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = HIDE.shadow;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** How far the whole skull tips back as the jaws open. */
const UPPER_JAW_LIFT = deg(11);
/** How wide the jaws open at `gape` 1. */
const MAX_GAPE = deg(38);
const SKULL_BACK_ALONG = -0.06;
const SKULL_BACK_DROP = 0.05;
const SKULL_OCCIPUT_ALONG = 0.02;
const SKULL_CROWN = 0.62;
const SKULL_BROW_ALONG = 0.22;
const SKULL_BROW = 0.7;
const SKULL_NASAL_ALONG = 0.52;
const SKULL_NASAL = 0.6;
const SKULL_SNOUT_TOP_ALONG = 0.86;
const SKULL_SNOUT_TOP = 0.5;
const SKULL_TIP_RISE = 0.34;
const SKULL_TIP_DROP = 0.14;
const SKULL_TOOTH_BACK_ALONG = 0.4;
/** The mouth line, almost straight from tip to hinge. */
const SKULL_MOUTH = 0.2;
const SKULL_HINGE_ALONG = 0.06;
const SKULL_HINGE = 0.3;
/** The upper jaw overhangs the lower — a dinosaur's teeth are not a straight bite. */
const JAW_OVERBITE = 0.04;
const JAW_LENGTH_SHARE = 0.92;
const JAW_TIP_DEPTH_SHARE = 0.5;
const JAW_CHIN_ALONG = 0.5;
const JAW_BACK_DEPTH_SHARE = 1.1;
const JAW_GRADIENT_LEAD = 0.5;
const HEAD_GRADIENT_TAIL = 0.15;
const SNOUT_SCALE_START = 0.36;
const SNOUT_SCALE_FULL = 0.62;
const SNOUT_SCALE_ALPHA = 0.55;
const HEAD_SCALE_SEED = 17;
const FENESTRA_ALONG = 0.5;
const FENESTRA_RISE = 0.22;
const FENESTRA_RX = 0.13;
const FENESTRA_RY = 0.13;
const FENESTRA_ALPHA = 0.22;
const GAPE_MOUTH_VISIBLE = 0.06;
const GAPE_TEETH_VISIBLE = 0.1;
const TOOTH_LENGTH = 0.026;
const LOWER_TOOTH_SHARE = 0.8;
const CLOSED_TEETH_DETAIL = 0.7;
const CLOSED_TEETH_FROM = 0.45;
const CLOSED_TEETH_TO = 0.95;
const CLOSED_TOOTH_SHARE = 0.55;
const NOSTRIL_ALONG = 0.9;
const NOSTRIL_RISE = 0.22;
const NOSTRIL_RX = 0.012;
const NOSTRIL_RY = 0.008;
const NOSTRIL_ALPHA = 0.8;
const EYE_ALONG = 0.22;
const EYE_RISE = 0.36;
const EYE_BROW_SPAN = 0.1;
const EYE_BROW_HEIGHT = 0.6;
const EYE_BROW_PEAK = 0.72;
const BROW_ALPHA = 0.85;
const BROW_WIDTH = 0.014;
const CHEEK_FRINGE_FROM = 0.16;
const CHEEK_FRINGE_DROP = 0.42;
const CHEEK_FRINGE_LENGTH = 0.8;
const CHEEK_FRINGE_TONE = 0.75;
const CHEEK_FRINGE_LEAN = 1.4;
const CHEEK_FRINGE_SEED = 71;

const TEETH_PER_JAW = 5;

/** Serrated teeth: each a slightly recurved fang, backward-raking. */
function drawTeeth(ctx: Ctx, from: Pt, to: Pt, down: Pt, length: number): void {
  ctx.fillStyle = TOOTH;
  const side = perp(down);
  for (let i = 0; i < TEETH_PER_JAW; i++) {
    const t = (i + HALF_SPAN) / TEETH_PER_JAW;
    const root = mid(from, to, t);
    const own = length * lerp(TOOTH_SHORT, 1, t);
    const half = own * TOOTH_HALF_SHARE;
    const tip = add(root, add(scaled(down, own), scaled(side, -own * TOOTH_RAKE)));
    ctx.beginPath();
    ctx.moveTo(root.x - side.x * half, root.y - side.y * half);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(root.x + side.x * half, root.y + side.y * half);
    ctx.closePath();
    ctx.fill();
  }
}

const TOOTH_HALF_SHARE = 0.45;
const TOOTH_SHORT = 0.7;
const TOOTH_RAKE = 0.25;

function drawEyeSide(ctx: Ctx, centre: Pt, angle: number, radius: number, open: number): void {
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, radius, radius * lerp(BLINK_FLOOR, 1, open), angle, 0, TWO_PI);
  ctx.fillStyle = EYE_IRIS;
  ctx.fill();
  ctx.strokeStyle = EYE_RING;
  ctx.lineWidth = EYE_RING_WIDTH;
  ctx.stroke();
  if (open < EYE_PUPIL_VISIBLE) return;
  // Floored in absolute tile units, not just as a share of the iris. The adult's
  // eye is small enough that a proportional pupil lands under a pixel and bakes
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

const BLINK_FLOOR = 0.08;
const EYE_RING_WIDTH = 0.005;
const EYE_PUPIL_VISIBLE = 0.25;
const PUPIL_WIDTH_SHARE = 0.4;
const PUPIL_HEIGHT_SHARE = 0.62;
/** One sheet pixel at the smallest stage, so the pupil never bakes away. */
const MIN_PUPIL_HALF_WIDTH = 0.012;

// ── Neck ─────────────────────────────────────────────────────────────────────

/**
 * The neck's S as a cubic: out of the chest forward and up along the back's
 * own line, rising, and arriving at the skull from below so the head is
 * carried level on top of it.
 *
 * A single quadratic can only bend one way, and a one-way bend is a swan's C or
 * a goose's pipe; the S is two bends, which is a cubic.
 */
function neckCurve(
  sk: DeinonychusSkeleton,
  prop: DeinonychusProportions,
): readonly [Pt, Pt, Pt, Pt] {
  const spine = dir(sk.pelvis, sk.chest);
  const rise = scaled(perp(spine), -1);
  const headAlong = { x: Math.cos(sk.headAngle), y: Math.sin(sk.headAngle) };
  const headUp = scaled(perp(headAlong), -1);
  const root = sk.chest;
  const leave = add(
    root,
    add(
      scaled(spine, prop.neckLength * NECK_LEAVE_FORWARD),
      scaled(rise, prop.neckLength * NECK_LEAVE_RISE),
    ),
  );
  const arrive = add(
    sk.headBase,
    add(
      scaled(headAlong, -prop.neckLength * NECK_ARRIVE_BACK),
      scaled(headUp, -prop.neckLength * NECK_ARRIVE_BELOW),
    ),
  );
  return [root, leave, arrive, sk.headBase];
}

const NECK_LEAVE_FORWARD = 0.75;
const NECK_LEAVE_RISE = -0.05;
const NECK_ARRIVE_BACK = 0.2;
const NECK_ARRIVE_BELOW = 0.7;

function cubicAt(c: readonly [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

function cubicTangent(c: readonly [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const raw = {
    x:
      3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
    y:
      3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y),
  };
  const length = Math.hypot(raw.x, raw.y);
  if (length < ZERO_LENGTH_EPSILON) return { x: 1, y: 0 };
  return { x: raw.x / length, y: raw.y / length };
}

function drawNeckSide(ctx: Ctx, sk: DeinonychusSkeleton, prop: DeinonychusProportions): void {
  const curve = neckCurve(sk, prop);
  const front: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= NECK_SAMPLES; i++) {
    const t = i / NECK_SAMPLES;
    const point = cubicAt(curve, t);
    // `perp` of a tangent running up the neck points forward, toward the throat.
    const throatward = perp(cubicTangent(curve, t));
    const half =
      prop.neckThickness *
      (t < NECK_WAIST_AT
        ? lerp(NECK_ROOT_SHARE, 1, easeInOut(t / NECK_WAIST_AT))
        : lerp(1, NECK_TOP_SHARE, (t - NECK_WAIST_AT) / (1 - NECK_WAIST_AT)));
    front.push(add(point, scaled(throatward, half)));
    back.push(add(point, scaled(throatward, -half)));
  }
  const outline = [...front, ...[...back].reverse()];
  const middle = cubicAt(curve, HALF_SPAN);
  const across = perp(cubicTangent(curve, HALF_SPAN));
  traceOutline(ctx, outline);
  ctx.fillStyle = coatGradient(
    ctx,
    add(middle, scaled(across, -prop.neckThickness * NECK_GRADIENT_REACH)),
    add(middle, scaled(across, prop.neckThickness * NECK_GRADIENT_REACH)),
    0,
  );
  ctx.fill();
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  const tangent = cubicTangent(curve, HALF_SPAN);
  paintFeatherTexture(
    ctx,
    cubicAt(curve, NECK_TEXTURE_FROM),
    tangent,
    perp(tangent),
    prop.neckLength * NECK_TEXTURE_LENGTH,
    prop.neckThickness * 2,
    NECK_TEXTURE_ROWS,
    NECK_TEXTURE_COLUMNS,
    NECK_TEXTURE_SEED,
    prop.detail,
  );
  ctx.restore();
  // The root is buried in the chest and the top under the skull, so only the
  // two long edges are outlined.
  strokeOpen(ctx, front.slice(NECK_ROOT_UNSTROKED));
  strokeOpen(ctx, back.slice(NECK_ROOT_UNSTROKED));

  // The hackle: the long orange-tipped plumage down the back of the neck,
  // lying back toward the shoulders.
  paintFringe(ctx, [...back].reverse().slice(0, back.length - NECK_ROOT_UNSTROKED), {
    length: (t) => prop.coatFringe * lerp(HACKLE_TOP, HACKLE_ROOT, t),
    fill: (t) => (t >= HACKLE_ORANGE_FROM ? PLUME.base : coatAt(0, 0)),
    edge: PLUME.tip,
    spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
    outward: 1,
    rear: scaled(cubicTangent(curve, HALF_SPAN), -1),
    lean: HACKLE_LEAN,
    seed: HACKLE_SEED,
  });
  // And the throat's own ruff, short and pale.
  paintFringe(ctx, front.slice(NECK_ROOT_UNSTROKED, front.length - 1), {
    length: () => prop.coatFringe * THROAT_FRINGE,
    fill: fringeTone(1, 0),
    spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
    outward: 1,
    rear: scaled(cubicTangent(curve, HALF_SPAN), -1),
    lean: THROAT_FRINGE_LEAN,
    seed: THROAT_FRINGE_SEED,
  });
}

const NECK_SAMPLES = 10;
const NECK_WAIST_AT = 0.45;
/** The neck's root is as deep as the shoulders it grows out of. */
const NECK_ROOT_SHARE = 1.7;
const NECK_TOP_SHARE = 1.05;
const NECK_GRADIENT_REACH = 1.1;
const NECK_TEXTURE_FROM = 0.15;
const NECK_TEXTURE_LENGTH = 0.9;
const NECK_TEXTURE_ROWS = 2;
const NECK_TEXTURE_COLUMNS = 3;
const NECK_TEXTURE_SEED = 41;
/** Samples at the root left unstroked, where the neck sinks into the chest. */
const NECK_ROOT_UNSTROKED = 3;
const HACKLE_TOP = 0.6;
const HACKLE_ROOT = 1.5;
/**
 * How far down the neck, from the head, the hackle turns orange. The top of the
 * neck stays coat-coloured: orange right behind the skull reads as a crest.
 */
const HACKLE_ORANGE_FROM = 0.35;
const HACKLE_LEAN = 2.6;
const HACKLE_SEED = 89;
const THROAT_FRINGE = 0.7;
const THROAT_FRINGE_LEAN = 1.3;
const THROAT_FRINGE_SEED = 97;

function quadAt(a: Pt, b: Pt, c: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
  };
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

// ── The whole profile ────────────────────────────────────────────────────────

/** How much darker a far-side limb is painted, so depth reads at tile size. */
const FAR_SIDE_SHADE = 0.42;

export function drawDeinonychusSide(
  ctx: Ctx,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): void {
  const sk = buildSkeleton(pose, prop);

  drawGroundShadow(
    ctx,
    sk.pelvis.x + SHADOW_FORWARD * prop.spineLength,
    SHADOW_RX_SHARE * (prop.spineLength + prop.tail[0]) * pose.shadow,
    SHADOW_RY * pose.shadow,
  );

  drawLegSide(ctx, sk.farLeg, prop, FAR_SIDE_SHADE, pose.farLeg, 'withSickle');
  drawArmSide(ctx, sk, pose.farArm, prop, FAR_SIDE_SHADE);
  // Down on the tail too. Confined to the torso it stops dead at the hips, and a
  // fuzzy edge with a hard end is worse than none.
  paintDown(ctx, sk.tail, prop.down, DOWN_SEED + 2, undefined, false);
  drawTailSide(ctx, sk, prop, 0);
  drawBodySide(ctx, sk, prop, pose.breathe);
  drawLegSide(ctx, sk.nearLeg, prop, 0, pose.nearLeg, 'sickleLater');
  // The near wing lies over the flank and the front of the thigh, which is
  // where a bird's folded wing sits, but *under* the neck and skull: painted
  // over them, its spread primaries cover his own face at the peak of the rake.
  // A wing opened for a flap or a leap beats out beside the neck, so it goes
  // over the neck; the skull stays on top of it either way.
  const wingOverNeck = pose.nearArm.spread > SPREAD_WING_OVER_NECK;
  if (!wingOverNeck) drawArmSide(ctx, sk, pose.nearArm, prop, 0);
  drawNeckSide(ctx, sk, prop);
  if (wingOverNeck) drawArmSide(ctx, sk, pose.nearArm, prop, 0);
  drawHeadSide(ctx, sk, pose, prop);
  // The near foot's claw goes on last: on a feet-first leap the foot swings up
  // in front of the folded wing, and the claw that leads the strike must not
  // vanish behind it.
  drawSickle(ctx, sk.nearLeg, prop, pose.nearLeg.sickle, 0);
}

const SHADOW_FORWARD = 0.15;
/** How far open the near wing has to be before it is painted over the neck. */
const SPREAD_WING_OVER_NECK = 0.5;
const SHADOW_RX_SHARE = 0.4;
const SHADOW_RY = 0.06;

// ── Head-on and away views ───────────────────────────────────────────────────

/**
 * The two axial views are the same animal seen from either end, so they are one
 * painter under a sign rather than two that drift apart.
 *
 * The hard part is that a horizontal-spined dinosaur seen head-on is *not* an
 * upright figure. Its body recedes away from the camera, so depth and height
 * both map onto screen-Y: the chest sits nearer the viewer than the hips and is
 * therefore drawn *lower* on screen, and the tail rises away behind the hips.
 * Built as a vertical torso with a head stacked on top instead, the same
 * creature would read as a dinosaur in profile and as a small green humanoid
 * head-on, i.e. it would change species every time the player turns ninety
 * degrees.
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
 * How the body stacks in the axial views.
 *
 * The camera looks down on the floor, so whatever is further from it sits
 * higher on screen. Head-on that puts the hips *above* the chest and the tail
 * rising behind the back; from behind it puts the chest above the hips and the
 * tail running down toward the camera between the legs. That depth ordering is
 * what makes the body read as a horizontal animal pointed at the viewer rather
 * than as an upright torso.
 *
 * The head is the one exception: it stays on top of the chest whichever way he
 * faces. Hung below a receding body, as a strict projection would have it, it
 * cannot be found at 32 px and the muzzle punches through the floor on the bite.
 */
const AXIAL_CHEST_DEPTH_DROP = 0.16;
/**
 * How far above the chest the head sits, as a share of the neck. Low: the neck
 * runs toward the camera, so nearly all of it is foreshortened away, and a head
 * held high on a visible column is what turns him into a small humanoid.
 */
const AXIAL_HEAD_ABOVE = 0.78;
/**
 * From behind the head is the far end of the neck and sits down among the
 * shoulders; held as high as head-on it stands on a visible column.
 */
const AXIAL_HEAD_ABOVE_AWAY = 0.85;
/**
 * A floor on that height, in skull lengths: the chick's neck is so short that
 * its head would otherwise sit straight on the body and read as a frog's.
 */
const AXIAL_HEAD_MIN_ABOVE = 0.75;
/**
 * How much of the hip height the axial views show. The camera looks down on
 * the floor, so a leg seen end-on loses some length; drawn at full height the
 * two legs read as a pair of stilts under a box.
 */
const AXIAL_LEG_FORESHORTEN = 0.74;
/** How far the foreshortened tail runs across the screen, as a share of its length. */
const AXIAL_TAIL_ACROSS = 0.06;
/** From behind the tail leaves the centre of the hips and swings only a little off it. */
const AXIAL_TAIL_ACROSS_AWAY = 0.1;
const AXIAL_TAIL_ROOT_DROP = 0.15;
/**
 * And how far it runs up the screen (receding, head-on) or down it (toward the
 * camera, from behind).
 */
const AXIAL_TAIL_ALONG = 0.26;
/** From behind it comes almost straight at the camera, so far less of it shows. */
const AXIAL_TAIL_ALONG_AWAY = 0.36;
/**
 * How far a foot's place along the stride moves it up or down the screen. A
 * foot reaching toward the camera lands lower, one pushing off behind lands
 * higher, which is the only way a stride can show end-on.
 */
const AXIAL_STRIDE_DEPTH = 0.15;

function axialLayout(
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
  view: AxialView,
): AxialLayout {
  const pelvis = {
    x: pose.sway,
    y: GROUND_Y - prop.hipHeight * AXIAL_LEG_FORESHORTEN + pose.rise,
  };
  const chest = {
    x: pelvis.x + pose.sway * AXIAL_SWAY_LEAN,
    y: pelvis.y + prop.chestRise + view.depth * AXIAL_CHEST_DEPTH_DROP * prop.spineLength,
  };
  const headCentre = {
    x: chest.x + pose.headTurn * prop.girth * AXIAL_HEAD_TURN,
    y:
      chest.y -
      Math.max(
        (view.showsFace ? AXIAL_HEAD_ABOVE : AXIAL_HEAD_ABOVE_AWAY) * prop.neckLength,
        prop.skullLength * AXIAL_HEAD_MIN_ABOVE,
      ) +
      pose.headLift,
  };
  const tailLength = prop.tail.reduce((total, segment) => total + segment, 0);
  // From behind the root sits low on the rump, so the tail grows out of the
  // body's lower edge instead of being pasted across the middle of the back.
  const tailRoot = {
    x: pelvis.x,
    y: pelvis.y + (view.depth < 0 ? prop.hipDepth * AXIAL_TAIL_ROOT_DROP : 0),
  };
  // Biased to one side and swung through the stride. Run dead down the
  // centreline it bisects the rump and reads as a crack in the sprite.
  const swung = rot(
    {
      x: tailLength * (view.depth > 0 ? AXIAL_TAIL_ACROSS : AXIAL_TAIL_ACROSS_AWAY),
      y: -view.depth * tailLength * (view.depth > 0 ? AXIAL_TAIL_ALONG : AXIAL_TAIL_ALONG_AWAY),
    },
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

/** Which pass of an axial leg to paint: the limb itself, or only its sickle claw. */
type AxialLegPart = 'leg' | 'sickle';

/**
 * Head-on, a leg hangs almost under the midline — a dinosaur's track is narrow,
 * one foot nearly in front of the other — and its thigh is wrapped inside the
 * body. What shows is the feathered shin and the long bare metatarsus angling
 * in to the foot. The knee hinges away from the camera, so the stride shows as
 * depth instead: a foot reaching toward the camera lands lower and reads larger.
 */
function drawLegAxial(
  ctx: Ctx,
  pose: LegPose,
  hip: Pt,
  side: number,
  prop: DeinonychusProportions,
  shade: number,
  view: AxialView,
  part: AxialLegPart,
): void {
  const scale = mix(SCALE.base, HIDE.shadow, shade);
  const scaleDark = mix(SCALE.dark, HIDE.shadow, shade);
  // Clamped, because a pounce reaches its feet out far past any stride and the
  // depth it would buy pushes them through the bottom of the cell.
  const nearer = Math.max(-AXIAL_NEARER_CAP, Math.min(AXIAL_NEARER_CAP, view.depth * pose.toeX));
  const width = lerp(AXIAL_FAR_WIDTH, 1, pose.nearness) * (1 + nearer * AXIAL_STRIDE_SCALE);
  const kneeHalf = prop.femur * KNEE_HALF_SHARE * width;
  const shankHalf = prop.femur * SHANK_HALF_SHARE * width;
  const ankleHalf = prop.femur * ANKLE_HALF_SHARE * width;
  const toeTipHalf = prop.femur * TOE_TIP_HALF_SHARE * width;

  const toe = {
    x: hip.x + pose.lateral,
    y: GROUND_Y - pose.lift + nearer * AXIAL_STRIDE_DEPTH,
  };
  const ankle = {
    x: lerp(hip.x, toe.x, ANKLE_LATERAL_SHARE),
    y: toe.y - prop.metatarsus * Math.sin(pose.meta),
  };
  // The knee sits a little outboard of the ankle, so the shank angles in toward
  // the midline the way a bird's does rather than standing as a vertical post.
  const knee = {
    x: ankle.x + side * prop.femur * AXIAL_KNEE_OUTBOARD,
    y: lerp(hip.y, ankle.y, AXIAL_KNEE_ALONG),
  };

  if (part === 'leg') {
    drawLimb(ctx, knee, ankle, kneeHalf, shankHalf, scale, scaleDark);
    // The metatarsus is drawn narrower than the shank on purpose: head-on the
    // only thing that says "there is a third segment here" is the step in width.
    drawLimb(ctx, ankle, toe, shankHalf * AXIAL_META_PINCH, ankleHalf, scale, scaleDark);

    // The toes point along the facing, which is toward the camera head-on (down
    // the screen) and away from it from behind (up, and mostly hidden).
    const toeReach = prop.toe * width * (view.depth > 0 ? AXIAL_TOE_DROP : -AXIAL_TOE_HIDE);
    for (const spread of AXIAL_TOE_SPREADS) {
      const tip = {
        x: toe.x + spread * prop.toe * AXIAL_TOE_SPREAD * width,
        y: toe.y + toeReach,
      };
      drawLimb(ctx, toe, tip, ankleHalf * AXIAL_TOE_GIRTH, toeTipHalf, scale, scaleDark);
      if (view.depth < 0) continue;
      drawToeClaw(ctx, tip, dir(toe, tip), prop.toe * GROUND_CLAW_SHARE * width, shade);
    }

    // The feathered "trouser" over hip, knee and the top of the shin, with its
    // ragged hem hanging over the bare scales.
    const hem = mid(knee, ankle, TROUSER_HEM_ALONG);
    const thighHalf = prop.femur * THIGH_HALF_SHARE * prop.thighBulk * width * AXIAL_THIGH_SHARE;
    const trouser = limbPath(hip, hem, thighHalf, shankHalf * TROUSER_HEM_SHARE);
    traceOutline(ctx, trouser);
    fillAndOutline(ctx, mix(HIDE.base, HIDE.shadow, shade + AXIAL_TROUSER_SHADE), HIDE.shadow);
    paintFringe(
      ctx,
      [
        add(hem, { x: -shankHalf * TROUSER_HEM_SHARE, y: 0 }),
        add(hem, { x: shankHalf * TROUSER_HEM_SHARE, y: 0 }),
      ],
      {
        length: () => prop.coatFringe * TROUSER_HEM_FRINGE,
        fill: () => mix(HIDE.bellyShade, HIDE.shadow, shade),
        spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
        outward: 1,
        rear: { x: 0, y: 1 },
        lean: 0,
        seed: TROUSER_SEED + side,
      },
    );
  }
  if (part !== 'sickle') return;
  // The killing claw has to survive the turn: hooked up off the floor on the
  // inner toe, where a player who has learned to read it in profile can still
  // find it head-on.
  const root = {
    x: toe.x - side * AXIAL_SICKLE_INSET,
    y: toe.y - prop.metatarsus * AXIAL_SICKLE_RISE,
  };
  drawAxialSickle(ctx, root, side, prop.sickle * AXIAL_SICKLE_SHARE * width, pose.sickle, shade);
}

/**
 * The sickle seen end-on: a hook rising off the inner toe and curling over
 * toward the midline. Deployed it drops toward the floor; that swing is mostly
 * depth axially, so it is shown as the hook flattening rather than turning.
 */
function drawAxialSickle(
  ctx: Ctx,
  root: Pt,
  side: number,
  length: number,
  deployed: number,
  shade: number,
): void {
  const start =
    -Math.PI / 2 + side * lerp(AXIAL_SICKLE_RAISED, AXIAL_SICKLE_STRUCK, clamp01(deployed));
  const nodes: Pt[] = [];
  const halves: number[] = [];
  for (let step = 0; step <= SICKLE_STEPS; step++) {
    const t = step / SICKLE_STEPS;
    const heading = start + side * AXIAL_SICKLE_CURL * t;
    const previous = nodes.length === 0 ? root : nodes[nodes.length - 1];
    nodes.push(step === 0 ? root : add(previous, rot({ x: length / SICKLE_STEPS, y: 0 }, heading)));
    halves.push(lerp(SICKLE_ROOT_HALF, SICKLE_TIP_HALF, Math.pow(t, SICKLE_TAPER)));
  }
  traceOutline(ctx, ribbonOutline(nodes, halves));
  ctx.fillStyle = mix(SICKLE_KERATIN, HIDE.shadow, shade * SICKLE_SHADE_SHARE);
  ctx.fill();
  ctx.strokeStyle = rgba(CLAW, SICKLE_OUTLINE_ALPHA);
  ctx.lineWidth = SICKLE_OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

const ANKLE_LATERAL_SHARE = 0.88;
const AXIAL_KNEE_OUTBOARD = 0.24;
const AXIAL_KNEE_ALONG = 0.45;
const AXIAL_FAR_WIDTH = 0.8;
const AXIAL_META_PINCH = 0.72;
const AXIAL_TOE_SPREADS: readonly number[] = [-1, 0, 1];
const AXIAL_TOE_SPREAD = 0.55;
const AXIAL_TOE_GIRTH = 0.75;
const AXIAL_TOE_DROP = 0.3;
const AXIAL_TOE_HIDE = 0.12;
const AXIAL_THIGH_SHARE = 0.75;
const AXIAL_TROUSER_SHADE = 0.15;
const AXIAL_SICKLE_INSET = 0.02;
const AXIAL_SICKLE_RISE = 0.05;
/** The raised claw's first lean outward from straight up; struck, it leans further and drops. */
const AXIAL_SICKLE_RAISED = deg(-10);
const AXIAL_SICKLE_STRUCK = deg(40);
/** How far the claw curls outward and over along its length. */
const AXIAL_SICKLE_CURL = deg(110);
/**
 * Head-on the claw is mostly foreshortened, so it is drawn a little longer than
 * in profile to keep the same on-screen reading.
 */
const AXIAL_SICKLE_SHARE = 1.1;
/** How much bigger a foot reads per tile it reaches toward the camera. */
const AXIAL_STRIDE_SCALE = 0.55;
const AXIAL_NEARER_CAP = 0.3;

/**
 * A wing-arm, folded against the flank.
 *
 * Head-on the arm is nearly end-on, so the bones are drawn short and the
 * feathers carry the read. Folded, the feathers lie flat along the side of the
 * body with their tips back — up the screen — and slightly out; fanned sideways or
 * hanging below the arm instead they read as hands or pom-poms. Spread on a
 * strike or a flap they sweep up and out — a symmetric horizontal pair reads as
 * a T-pose.
 */
function drawArmAxial(
  ctx: Ctx,
  shoulder: Pt,
  arm: ArmPose,
  prop: DeinonychusProportions,
  side: number,
  shade: number,
  view: AxialView,
): void {
  const spread = arm.spread;
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
  // that bone is almost end-on, so its own direction carries no information.
  const foldedAngle = -Math.PI / 2 + side * AXIAL_FAN_FOLD_OUT;
  const spreadAngle = -Math.PI / 2 + side * AXIAL_FAN_FLARE;
  const fanAngle = lerp(foldedAngle, spreadAngle, spread);
  const fanSpread = lerp(AXIAL_FAN_FOLDED_SPREAD, AXIAL_FAN_SPREAD, spread);
  const length = prop.wingFeather * lerp(AXIAL_FAN_FOLDED, 1, spread);
  for (let i = 0; i < AXIAL_WING_FEATHERS; i++) {
    const t = i / (AXIAL_WING_FEATHERS - 1);
    const root = mid(elbow, wrist, t);
    const angle = fanAngle + lerp(-fanSpread, fanSpread, t) * side;
    const own = length * lerp(SECONDARY_INNER, 1, t);
    drawPennaceous(ctx, root, angle, own, own * FEATHER_WIDTH_SHARE, shade);
  }
  const coat = coatAt(ARM_COAT_DEPTH, shade);
  drawLimb(ctx, shoulder, elbow, UPPER_ARM_HALF, ELBOW_HALF, coat, HIDE.shadow);
  drawLimb(ctx, elbow, wrist, ELBOW_HALF, WRIST_HALF, coat, HIDE.shadow);
  // From behind the hands are hidden in front of the chest.
  if (!view.showsFace) return;
  const scale = mix(SCALE.base, HIDE.shadow, shade);
  for (let finger = 0; finger < FINGER_COUNT; finger++) {
    const fingerAngle =
      Math.PI / 2 - side * (finger - 1) * AXIAL_FINGER_SPREAD - side * AXIAL_HAND_IN;
    const fingerLength = prop.hand * FINGER_LENGTHS[finger] * AXIAL_HAND_FORESHORTEN;
    const tip = add(wrist, rot({ x: fingerLength, y: 0 }, fingerAngle));
    drawLimb(ctx, wrist, tip, WRIST_HALF * FINGER_ROOT_SHARE, FINGER_TIP_HALF, scale, HIDE.shadow);
    if (prop.detail < HAND_CLAW_DETAIL_FLOOR) continue;
    drawFingerClaw(ctx, tip, dir(wrist, tip), prop.hand * FINGER_CLAW_SHARE, shade);
  }
}

const AXIAL_ARM_TUCK = 0.12;
const AXIAL_ARM_FLARE = 0.5;
const AXIAL_ARM_DROP = 0.45;
const AXIAL_ARM_RAISE = -0.1;
const AXIAL_FORE_TUCK = 0.05;
const AXIAL_FORE_FLARE = 0.4;
const AXIAL_FORE_DROP = 0.3;
const AXIAL_FORE_RAISE = -0.4;
const AXIAL_FAN_SPREAD = deg(32);
const AXIAL_FAN_FOLDED_SPREAD = deg(9);
/**
 * How far off straight up the folded feathers lean, outward. They lie back
 * along the flank, and back is away from the camera, which is up the screen.
 */
const AXIAL_FAN_FOLD_OUT = deg(4);
const AXIAL_FAN_FLARE = deg(24);
const AXIAL_FAN_FOLDED = 0.8;
const AXIAL_WING_FEATHERS = 5;
const AXIAL_FINGER_SPREAD = deg(18);
const AXIAL_HAND_IN = deg(14);
const AXIAL_HAND_FORESHORTEN = 0.6;

/**
 * The tail, foreshortened. Head-on it rises behind the hips to one side, so the
 * orange fan shows past the body; from behind it leaves the centre of the hips,
 * thick at the root, and tapers down the screen toward the camera.
 */
function tailAxialOutline(
  layout: AxialLayout,
  prop: DeinonychusProportions,
  view: AxialView,
): Pt[] {
  const rootHalf = prop.tailDepth * (view.depth > 0 ? AXIAL_TAIL_GIRTH : AXIAL_TAIL_NEAR_GIRTH);
  const nodes = [layout.tailRoot, mid(layout.tailRoot, layout.tailTip), layout.tailTip];
  return ribbonOutline(nodes, [rootHalf, rootHalf * AXIAL_TAIL_MID_SHARE, TAIL_TIP_DEPTH]);
}

function drawTailAxial(
  ctx: Ctx,
  layout: AxialLayout,
  prop: DeinonychusProportions,
  view: AxialView,
): void {
  drawTailFanAxial(ctx, layout, prop);
  const outline = tailAxialOutline(layout, prop, view);
  traceOutline(ctx, outline);
  fillAndOutline(ctx, coatAt(AXIAL_TAIL_TONE, 0), HIDE.shadow);
}

function drawTailFanAxial(ctx: Ctx, layout: AxialLayout, prop: DeinonychusProportions): void {
  const angle = Math.atan2(
    layout.tailTip.y - layout.tailRoot.y,
    layout.tailTip.x - layout.tailRoot.x,
  );
  const width = (length: number): number => length * FEATHER_WIDTH_SHARE;
  for (let i = 0; i < AXIAL_TAIL_FROND; i++) {
    const t = lerp(AXIAL_TAIL_FROND_START, 1, i / AXIAL_TAIL_FROND);
    const root = mid(layout.tailRoot, layout.tailTip, t);
    const length = prop.tailFan * AXIAL_TAIL_FAN_SHARE * lerp(TAIL_FROND_SHORT, 1, t);
    const splay = lerp(TAIL_FROND_ROOT_SPLAY, TAIL_FROND_TIP_SPLAY, t);
    drawPennaceous(ctx, root, angle + splay, length, width(length), TAIL_UNDERSIDE_SHADE);
    drawPennaceous(ctx, root, angle - splay, length, width(length), 0);
  }
  const fanRoot = mid(layout.tailRoot, layout.tailTip, AXIAL_TAIL_FAN_ROOT);
  for (let i = 0; i < TAIL_FAN_FEATHERS; i++) {
    const u = i / (TAIL_FAN_FEATHERS - 1);
    const length =
      prop.tailFan * AXIAL_TAIL_FAN_SHARE * lerp(1, TAIL_FAN_FALLOFF, Math.abs(u - HALF_SPAN) * 2);
    drawPennaceous(
      ctx,
      fanRoot,
      angle + lerp(-TAIL_FAN_SPREAD, TAIL_FAN_SPREAD, u),
      length,
      width(length),
      0,
    );
  }
}

const AXIAL_TAIL_GIRTH = 1.1;
/** From behind the root faces the camera, so it is the widest the tail ever reads. */
const AXIAL_TAIL_NEAR_GIRTH = 1.25;
const AXIAL_TAIL_MID_SHARE = 0.6;
const AXIAL_TAIL_FAN_ROOT = 0.85;
const AXIAL_TAIL_FAN_SHARE = 0.8;
const AXIAL_TAIL_FROND = 3;
/**
 * Foreshortened, the frond keeps to the last stretch of the tail: rooted as far
 * up as in profile it hides the green tail under an orange tuft.
 */
const AXIAL_TAIL_FROND_START = 0.72;
const AXIAL_TAIL_TONE = 0.35;

/** A smooth oval: enough points that the midpoint-quadratic walk rounds it fully. */
function axialMass(centre: Pt, halfWidth: number, halfHeight: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < AXIAL_MASS_STEPS; i++) {
    const angle = (i / AXIAL_MASS_STEPS) * TWO_PI;
    points.push({
      x: centre.x + Math.cos(angle) * halfWidth,
      y: centre.y + Math.sin(angle) * halfHeight,
    });
  }
  return points;
}

const AXIAL_MASS_STEPS = 16;

/** An arc of an oval, from `from` to `to` radians, for a fringe to root on. */
function ovalArc(
  centre: Pt,
  halfWidth: number,
  halfHeight: number,
  from: number,
  to: number,
): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= AXIAL_ARC_STEPS; i++) {
    const angle = lerp(from, to, i / AXIAL_ARC_STEPS);
    points.push({
      x: centre.x + Math.cos(angle) * halfWidth,
      y: centre.y + Math.sin(angle) * halfHeight,
    });
  }
  return points;
}

const AXIAL_ARC_STEPS = 10;

/**
 * Fills several overlapping shapes as one silhouette with one outline.
 *
 * Every shape is stroked at double width first and only then are all of them
 * filled, so the fills cover each other's inner strokes and the only line left
 * is the outside edge of the union. Outlined one at a time they read as
 * separate plates bolted together — a mech, not an animal.
 */
function paintUnion(
  ctx: Ctx,
  shapes: readonly (readonly Pt[])[],
  fill: string | CanvasGradient,
  outline: string,
): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = OUTLINE_WIDTH * 2;
  for (const shape of shapes) {
    traceOutline(ctx, shape);
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  for (const shape of shapes) {
    traceOutline(ctx, shape);
    ctx.fill();
  }
}

/** Clips to the union of several shapes and runs `paint` inside it. */
function insideUnion(ctx: Ctx, shapes: readonly (readonly Pt[])[], paint: () => void): void {
  ctx.save();
  ctx.beginPath();
  for (const shape of shapes) {
    if (shape.length === 0) continue;
    ctx.moveTo(shape[0].x, shape[0].y);
    for (const point of shape) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }
  ctx.clip();
  paint();
  ctx.restore();
}

/**
 * The head, seen along the skull.
 *
 * Head-on the long snout is foreshortened toward the camera: a deep, blunt
 * muzzle coming down out of a skull that is wider behind it, the eyes set on
 * the sides of that skull so only their outer edges show at the silhouette,
 * two nostrils at the tip and the mouth line running back along each side.
 * Drawn as a block with the eyes on its front face, the same head reads as a
 * robot's.
 *
 * From behind, the snout is hidden by the skull, and what shows is the rounded,
 * feathered back of the head.
 */
function drawAxialHead(
  ctx: Ctx,
  centre: Pt,
  prop: DeinonychusProportions,
  pose: DeinonychusPose,
  view: AxialView,
): void {
  const scale = view.showsFace ? AXIAL_HEAD_NEAR_SCALE : AXIAL_HEAD_FAR_SCALE;
  const length = prop.skullLength * scale;
  const craniumHalfW = length * AXIAL_CRANIUM_WIDTH;
  const craniumHalfH = length * AXIAL_CRANIUM_HEIGHT;
  const cranium = axialMass(centre, craniumHalfW, craniumHalfH);
  const top = { x: centre.x, y: centre.y - craniumHalfH };
  const bottom = { x: centre.x, y: centre.y + craniumHalfH };

  if (!view.showsFace) {
    traceOutline(ctx, cranium);
    fillAndOutline(ctx, coatGradient(ctx, top, bottom, 0), HIDE.shadow);
    // The olive dorsal stripe running up the back of the head and on down the
    // neck. Drawing eyes here is the classic away-view mistake.
    ctx.save();
    traceOutline(ctx, cranium);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      centre.y + craniumHalfH * HALF_SPAN,
      craniumHalfW * BACK_STRIPE_WIDTH,
      craniumHalfH * 2,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(HIDE.dorsal, BACK_STRIPE_ALPHA);
    ctx.fill();
    ctx.restore();
    paintFringe(ctx, ovalArc(centre, craniumHalfW, craniumHalfH, AXIAL_NAPE_FROM, AXIAL_NAPE_TO), {
      length: () => prop.coatFringe * AXIAL_NAPE_FRINGE,
      fill: () => PLUME.base,
      edge: PLUME.tip,
      spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
      outward: -1,
      rear: { x: 0, y: 1 },
      lean: AXIAL_NAPE_LEAN,
      seed: HACKLE_SEED,
    });
    return;
  }

  const snoutTop = centre.y - craniumHalfH * AXIAL_SNOUT_ROOT;
  const snoutTip = centre.y + length * AXIAL_SNOUT_LENGTH;
  const rootHalf = length * AXIAL_SNOUT_ROOT_WIDTH;
  const tipHalf = length * AXIAL_SNOUT_TIP_WIDTH;
  const muzzle = [
    { x: centre.x - rootHalf, y: snoutTop },
    { x: centre.x + rootHalf, y: snoutTop },
    { x: centre.x + tipHalf, y: snoutTip - tipHalf },
    { x: centre.x + tipHalf * AXIAL_SNOUT_ROUND, y: snoutTip },
    { x: centre.x - tipHalf * AXIAL_SNOUT_ROUND, y: snoutTip },
    { x: centre.x - tipHalf, y: snoutTip - tipHalf },
  ];

  // The lower jaw drops below the muzzle as he gapes, with the gullet between.
  const jawDrop = length * AXIAL_JAW_DROP * pose.gape;
  if (pose.gape > GAPE_MOUTH_VISIBLE) {
    const jaw = muzzle.map((point) => ({
      x: lerp(centre.x, point.x, AXIAL_JAW_NARROW),
      y: point.y + jawDrop,
    }));
    traceOutline(ctx, jaw);
    fillAndOutline(ctx, HIDE.bellyShade, HIDE.shadow);
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      snoutTip - tipHalf + jawDrop * HALF_SPAN,
      tipHalf * AXIAL_GULLET_WIDTH,
      jawDrop * HALF_SPAN,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = MOUTH_FLESH;
    ctx.fill();
    if (pose.gape > GAPE_TEETH_VISIBLE) {
      drawTeeth(
        ctx,
        { x: centre.x - tipHalf * AXIAL_TOOTH_SPAN, y: snoutTip - tipHalf },
        { x: centre.x + tipHalf * AXIAL_TOOTH_SPAN, y: snoutTip - tipHalf },
        { x: 0, y: 1 },
        TOOTH_LENGTH * AXIAL_TOOTH_SHARE * scale,
      );
    }
  }

  // The muzzle casts a soft shadow on the chest under it; without one it sinks
  // into the body behind it, which is the same green.
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    snoutTip + tipHalf * AXIAL_CHIN_SHADOW_DROP,
    rootHalf,
    tipHalf * AXIAL_CHIN_SHADOW_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(HIDE.shadow, AXIAL_CHIN_SHADOW_ALPHA);
  ctx.fill();
  paintUnion(
    ctx,
    [cranium, muzzle],
    coatGradient(ctx, top, { x: centre.x, y: snoutTip + tipHalf }, 0),
    HIDE.shadow,
  );
  insideUnion(ctx, [cranium, muzzle], () => {
    // The bare, scaled muzzle, and the top of it catching the light: it is what
    // makes the snout read as a form coming toward the camera rather than a
    // flat stripe.
    traceOutline(ctx, muzzle);
    ctx.fillStyle = rgba(SCALE.base, SNOUT_SCALE_ALPHA);
    ctx.fill();
    paintScales(ctx, boundsOf(muzzle), HEAD_SCALE_SEED, prop.detail);
    ctx.beginPath();
    ctx.ellipse(
      centre.x,
      lerp(snoutTop, snoutTip, AXIAL_SNOUT_LIGHT_ALONG),
      rootHalf * AXIAL_SNOUT_LIGHT_WIDTH,
      (snoutTip - snoutTop) * AXIAL_SNOUT_LIGHT_LENGTH,
      0,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(SCALE.light, AXIAL_SNOUT_LIGHT_ALPHA);
    ctx.fill();
  });

  // The mouth line runs back from the tip along each side of the muzzle.
  ctx.strokeStyle = rgba(HIDE.shadow, BROW_ALPHA);
  ctx.lineWidth = BROW_WIDTH * AXIAL_MOUTH_LINE_SHARE;
  ctx.lineCap = 'round';
  for (const side of AXIAL_SIDES) {
    ctx.beginPath();
    ctx.moveTo(centre.x + side * tipHalf * AXIAL_SNOUT_ROUND, snoutTip - tipHalf * HALF_SPAN);
    ctx.lineTo(centre.x + side * rootHalf * AXIAL_MOUTH_BACK, centre.y + craniumHalfH * HALF_SPAN);
    ctx.stroke();
  }

  for (const side of AXIAL_SIDES) {
    ctx.beginPath();
    ctx.arc(
      centre.x + side * tipHalf * AXIAL_NOSTRIL_SPAN,
      snoutTip - tipHalf * AXIAL_NOSTRIL_RISE,
      NOSTRIL_RX * scale,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(HIDE.shadow, NOSTRIL_ALPHA);
    ctx.fill();
  }

  // The eyes are on the sides of the skull, so head-on only their outer halves
  // show, sitting on the silhouette under a heavy brow.
  const eyeRadius = prop.eyeRadius * AXIAL_EYE_SHARE * scale;
  for (const side of AXIAL_SIDES) {
    const eye = {
      x: centre.x + side * craniumHalfW * AXIAL_EYE_SPAN,
      y: centre.y - craniumHalfH * AXIAL_EYE_RISE,
    };
    drawEyeAxial(ctx, eye, eyeRadius, pose.eyeOpen);
    ctx.beginPath();
    ctx.moveTo(eye.x - side * eyeRadius * AXIAL_BROW_INNER, eye.y - eyeRadius * AXIAL_BROW_LIFT);
    ctx.lineTo(eye.x + side * eyeRadius, eye.y - eyeRadius * AXIAL_BROW_OUTER_LIFT);
    ctx.strokeStyle = rgba(HIDE.shadow, BROW_ALPHA);
    ctx.lineWidth = BROW_WIDTH;
    ctx.stroke();
  }
}

/** A side-set eye seen from in front: narrower than it is tall, with the pupil. */
function drawEyeAxial(ctx: Ctx, centre: Pt, radius: number, open: number): void {
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    radius * AXIAL_EYE_FORESHORTEN,
    radius * lerp(BLINK_FLOOR, 1, open),
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = EYE_IRIS;
  ctx.fill();
  ctx.strokeStyle = EYE_RING;
  ctx.lineWidth = EYE_RING_WIDTH;
  ctx.stroke();
  if (open < EYE_PUPIL_VISIBLE) return;
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    MIN_PUPIL_HALF_WIDTH,
    Math.max(MIN_PUPIL_HALF_WIDTH, radius * PUPIL_HEIGHT_SHARE) * open,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = EYE_PUPIL;
  ctx.fill();
}

const AXIAL_SIDES: readonly number[] = [-1, 1];
const AXIAL_CRANIUM_WIDTH = 0.29;
const AXIAL_CRANIUM_HEIGHT = 0.3;
/** Where the muzzle leaves the cranium, as a share of its half-height above centre. */
const AXIAL_SNOUT_ROOT = 0.15;
const AXIAL_SNOUT_LENGTH = 0.6;
const AXIAL_SNOUT_ROOT_WIDTH = 0.22;
const AXIAL_SNOUT_TIP_WIDTH = 0.11;
const AXIAL_SNOUT_ROUND = 0.6;
const AXIAL_SNOUT_LIGHT_ALONG = 0.45;
const AXIAL_SNOUT_LIGHT_WIDTH = 0.45;
const AXIAL_SNOUT_LIGHT_LENGTH = 0.35;
const AXIAL_SNOUT_LIGHT_ALPHA = 0.45;
const AXIAL_CHIN_SHADOW_DROP = 0.6;
const AXIAL_CHIN_SHADOW_HEIGHT = 1.2;
const AXIAL_CHIN_SHADOW_ALPHA = 0.35;
const AXIAL_MOUTH_LINE_SHARE = 0.8;
const AXIAL_MOUTH_BACK = 1.25;
const AXIAL_NOSTRIL_SPAN = 0.5;
const AXIAL_NOSTRIL_RISE = 0.9;
const AXIAL_JAW_DROP = 0.3;
const AXIAL_JAW_NARROW = 0.85;
const AXIAL_GULLET_WIDTH = 0.9;
const AXIAL_TOOTH_SHARE = 0.7;
const AXIAL_TOOTH_SPAN = 0.9;
const AXIAL_EYE_SPAN = 0.95;
const AXIAL_EYE_RISE = -0.05;
const AXIAL_EYE_SHARE = 1.05;
const AXIAL_EYE_FORESHORTEN = 0.6;
const AXIAL_BROW_INNER = 0.6;
const AXIAL_BROW_LIFT = 1.0;
const AXIAL_BROW_OUTER_LIFT = 1.4;
const BACK_STRIPE_WIDTH = 0.38;
const BACK_STRIPE_ALPHA = 0.7;
/** The orange hackle shows round the back of the head, over the nape. */
const AXIAL_NAPE_FROM = deg(20);
const AXIAL_NAPE_TO = deg(160);
const AXIAL_NAPE_FRINGE = 1.1;
const AXIAL_NAPE_LEAN = 0.4;
/** The head is nearest the camera head-on and furthest from behind. */
const AXIAL_HEAD_NEAR_SCALE = 1.2;
const AXIAL_HEAD_FAR_SCALE = 1.1;

function drawDeinonychusAxial(
  ctx: Ctx,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
  view: AxialView,
): void {
  const layout = axialLayout(pose, prop, view);
  const { pelvis, chest, girth } = layout;

  drawGroundShadow(ctx, pelvis.x, girth * AXIAL_SHADOW_RX * pose.shadow, SHADOW_RY * pose.shadow);

  // One rounded mass from hips to chest, with the haunches swelling out of it
  // at the hips and the neck running on out of the shoulders — filled as a
  // single silhouette so no seam between them is drawn.
  const bodyCentre = mid(pelvis, chest);
  const bodyHalfW = girth * AXIAL_BODY_WIDTH;
  const bodyHalfH = Math.abs(pelvis.y - chest.y) * HALF_SPAN + prop.hipDepth * AXIAL_BODY_DEPTH;
  const body = axialMass(bodyCentre, bodyHalfW, bodyHalfH);
  const haunch = (side: number): Pt[] =>
    axialMass(
      {
        x: pelvis.x + side * girth * AXIAL_HAUNCH_SPAN,
        y: pelvis.y + prop.hipDepth * AXIAL_HAUNCH_DROP,
      },
      girth * AXIAL_HAUNCH_WIDTH,
      prop.hipDepth * AXIAL_HAUNCH_HEIGHT,
    );
  const neckRoot = {
    x: chest.x,
    y: chest.y - view.depth * prop.chestDepth * AXIAL_NECK_ROOT_RISE,
  };
  const neck = limbPath(
    neckRoot,
    layout.headCentre,
    prop.neckThickness * AXIAL_NECK_ROOT_HALF,
    prop.neckThickness * AXIAL_NECK_TOP_HALF,
  );
  const silhouette = [body, haunch(-1), haunch(1), neck];

  const hipY = pelvis.y + prop.hipDepth * AXIAL_LEG_ROOT_DROP;
  const leftHip = { x: pelvis.x - girth * AXIAL_HIP_SPAN, y: hipY };
  const rightHip = { x: pelvis.x + girth * AXIAL_HIP_SPAN, y: hipY };

  // Each leg stays on its own hip and only the paint order follows which one is
  // nearer the camera. Handing the nearer *pose* to one fixed hip instead swaps
  // the legs from side to side every time a foot leaves the floor.
  const paintLegs = (part: AxialLegPart): void => {
    const near = (): void => {
      drawLegAxial(ctx, pose.nearLeg, rightHip, 1, prop, 0, view, part);
    };
    const far = (): void => {
      drawLegAxial(ctx, pose.farLeg, leftHip, -1, prop, AXIAL_FAR_SHADE, view, part);
    };
    if (pose.nearLeg.nearness >= pose.farLeg.nearness) {
      far();
      near();
    } else {
      near();
      far();
    }
  };

  const bodyTop = { x: bodyCentre.x, y: bodyCentre.y - bodyHalfH };
  const bodyBottom = { x: bodyCentre.x, y: bodyCentre.y + bodyHalfH };
  const paintBody = (): void => {
    // Only round the lower half: a ring of down all the way round a head-on
    // body is a mane, and it turns the chick into an owl.
    paintDown(ctx, body, prop.down, DOWN_SEED, (index) => index < AXIAL_MASS_STEPS / 2);
    // Head-on the top of the back recedes up the screen and the pale chest
    // faces the camera at the bottom; from behind the whole mass is back, and
    // the dorsal stripe runs down its middle.
    const fill = view.showsFace
      ? HIDE.base
      : coatGradient(
          ctx,
          bodyTop,
          { x: bodyCentre.x, y: bodyBottom.y + bodyHalfH * AXIAL_BACK_STRETCH },
          0,
        );
    paintUnion(ctx, silhouette, fill, HIDE.shadow);
    insideUnion(ctx, silhouette, () => {
      // Soft form shading rather than drawn seams: the flanks turn away into
      // shadow on the side away from the light.
      for (const side of AXIAL_SIDES) {
        ctx.beginPath();
        ctx.ellipse(
          bodyCentre.x + side * girth * AXIAL_FLANK_SHADE_SPAN,
          bodyCentre.y + bodyHalfH * AXIAL_FLANK_SHADE_DROP,
          girth * AXIAL_FLANK_SHADE_WIDTH,
          bodyHalfH * AXIAL_FLANK_SHADE_HEIGHT,
          0,
          0,
          TWO_PI,
        );
        ctx.fillStyle = rgba(
          HIDE.shadow,
          side > 0 ? AXIAL_FLANK_SHADE_ALPHA : AXIAL_FLANK_SHADE_ALPHA * AXIAL_LIT_FLANK_SHARE,
        );
        ctx.fill();
      }
      if (view.showsFace) {
        // Head-on the pale underside is a narrow bib down the chest and throat
        // between green flanks. Banded across the whole width instead, the
        // body reads as a frog's belly.
        ctx.beginPath();
        ctx.ellipse(
          chest.x,
          chest.y + prop.chestDepth * AXIAL_BIB_DROP,
          girth * AXIAL_BIB_WIDTH,
          prop.chestDepth * AXIAL_BIB_HEIGHT,
          0,
          0,
          TWO_PI,
        );
        ctx.fillStyle = HIDE.belly;
        ctx.fill();
        // The pale throat runs on up the neck to the jaw, which is what shows
        // there is a neck between the head and the chest at all.
        traceOutline(
          ctx,
          limbPath(
            chest,
            layout.headCentre,
            prop.neckThickness * AXIAL_THROAT_ROOT,
            prop.neckThickness * AXIAL_THROAT_TOP,
          ),
        );
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(
          bodyCentre.x,
          bodyTop.y,
          girth * AXIAL_BODY_WIDTH,
          bodyHalfH * AXIAL_BACK_SHOW,
          0,
          0,
          TWO_PI,
        );
        ctx.fillStyle = rgba(HIDE.dorsal, AXIAL_STRIPE_ALPHA);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(
          bodyCentre.x,
          bodyCentre.y,
          girth * AXIAL_STRIPE_WIDTH,
          bodyHalfH * AXIAL_STRIPE_HEIGHT,
          0,
          0,
          TWO_PI,
        );
        ctx.fillStyle = rgba(HIDE.dorsal, AXIAL_STRIPE_ALPHA);
        ctx.fill();
      }
      paintFeatherTexture(
        ctx,
        { x: bodyCentre.x, y: bodyCentre.y + bodyHalfH },
        { x: 0, y: -1 },
        { x: 1, y: 0 },
        bodyHalfH * 2,
        bodyHalfW * 2,
        AXIAL_TEXTURE_ROWS,
        AXIAL_TEXTURE_COLUMNS,
        BODY_TEXTURE_SEED,
        prop.detail,
      );
    });
    // The coat's ragged edge down both flanks.
    for (const side of AXIAL_SIDES) {
      const from = side > 0 ? -AXIAL_FLANK_ARC : Math.PI - AXIAL_FLANK_ARC;
      const to = side > 0 ? AXIAL_FLANK_ARC : Math.PI + AXIAL_FLANK_ARC;
      paintFringe(ctx, ovalArc(bodyCentre, bodyHalfW, bodyHalfH, from, to), {
        length: () => prop.coatFringe * AXIAL_FLANK_FRINGE,
        fill: fringeTone(AXIAL_FLANK_FRINGE_TONE, 0),
        spacing: prop.coatFringe * FRINGE_SPACING_SHARE,
        outward: side > 0 ? -1 : -1,
        rear: { x: 0, y: -view.depth },
        lean: AXIAL_FLANK_LEAN,
        seed: BACK_FRINGE_SEED + side,
      });
    }
  };

  const paintArms = (): void => {
    const shoulderY = chest.y + prop.chestDepth * AXIAL_SHOULDER_DROP;
    drawArmAxial(
      ctx,
      { x: chest.x - girth * AXIAL_SHOULDER_SPAN, y: shoulderY },
      pose.farArm,
      prop,
      -1,
      AXIAL_FAR_SHADE,
      view,
    );
    drawArmAxial(
      ctx,
      { x: chest.x + girth * AXIAL_SHOULDER_SPAN, y: shoulderY },
      pose.nearArm,
      prop,
      1,
      0,
      view,
    );
  };

  // Far to near, and which end is near reverses between the views. Head-on the
  // tail is behind everything and the head in front; from behind the head is
  // furthest away, sitting down among the shoulders, and the tail is nearest.
  if (view.depth > 0) {
    drawTailAxial(ctx, layout, prop, view);
    paintLegs('leg');
    paintBody();
    paintArms();
    paintLegs('sickle');
    drawAxialHead(ctx, layout.headCentre, prop, pose, view);
    return;
  }
  paintLegs('leg');
  drawAxialHead(ctx, layout.headCentre, prop, pose, view);
  paintBody();
  paintArms();
  // From behind the tail is the nearest thing to the camera: its own tapering
  // shaft over the rump, ending in the fan, not a tuft lost in the body.
  drawTailAxial(ctx, layout, prop, view);
  // The sickle claws go on over the body in both views. From behind the tail
  // hangs toward the camera over the feet, head-on a leaping foot is tucked up
  // under the chest, and the one claw that names the animal is the thing they
  // would otherwise cover.
  paintLegs('sickle');
}

const AXIAL_SHADOW_RX = 1.5;
/** Hip joints sit close in under the body: a dinosaur's track is nearly a single line. */
const AXIAL_HIP_SPAN = 0.5;
const AXIAL_LEG_ROOT_DROP = 0.2;
const AXIAL_BODY_WIDTH = 1.05;
const AXIAL_BODY_DEPTH = 0.6;
const AXIAL_HAUNCH_SPAN = 0.55;
const AXIAL_HAUNCH_DROP = 0.25;
const AXIAL_HAUNCH_WIDTH = 0.5;
const AXIAL_HAUNCH_HEIGHT = 0.75;
const AXIAL_NECK_ROOT_RISE = 0.2;
const AXIAL_NECK_ROOT_HALF = 2.2;
const AXIAL_NECK_TOP_HALF = 1.3;
const AXIAL_SHOULDER_SPAN = 0.62;
const AXIAL_SHOULDER_DROP = 0.1;
const AXIAL_FAR_SHADE = 0.26;
const AXIAL_FLANK_SHADE_SPAN = 1.05;
const AXIAL_FLANK_SHADE_DROP = 0.1;
const AXIAL_FLANK_SHADE_WIDTH = 0.45;
const AXIAL_FLANK_SHADE_HEIGHT = 1.1;
const AXIAL_FLANK_SHADE_ALPHA = 0.3;
/** The lit flank keeps only this share of the shade the far one takes. */
const AXIAL_LIT_FLANK_SHARE = 0.4;
/** From behind the coat's gradient is stretched so the belly never shows. */
const AXIAL_BACK_STRETCH = 1.6;
const AXIAL_STRIPE_WIDTH = 0.32;
const AXIAL_BIB_DROP = 0.25;
const AXIAL_THROAT_ROOT = 0.8;
const AXIAL_THROAT_TOP = 0.45;
const AXIAL_BIB_WIDTH = 0.42;
const AXIAL_BIB_HEIGHT = 0.75;
/** Head-on, how much of the body's height the receding back shows above the chest. */
const AXIAL_BACK_SHOW = 0.45;
const AXIAL_STRIPE_HEIGHT = 1.05;
const AXIAL_STRIPE_ALPHA = 0.6;
const AXIAL_TEXTURE_ROWS = 4;
const AXIAL_TEXTURE_COLUMNS = 4;
/** How far round each flank, either side of its widest point, the fringe runs. */
const AXIAL_FLANK_ARC = deg(55);
const AXIAL_FLANK_FRINGE = 0.9;
const AXIAL_FLANK_FRINGE_TONE = 0.45;
const AXIAL_FLANK_LEAN = 0.6;

export function drawDeinonychusFront(
  ctx: Ctx,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): void {
  drawDeinonychusAxial(ctx, pose, prop, FRONT_VIEW);
}

export function drawDeinonychusBack(
  ctx: Ctx,
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): void {
  drawDeinonychusAxial(ctx, pose, prop, BACK_VIEW);
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
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
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
export function measureHead(pose: DeinonychusPose, prop: DeinonychusProportions): Pt {
  const sk = buildSkeleton(pose, prop);
  return mid(sk.headBase, sk.snout);
}

/** The near hand's longest claw tip, for the slash row's arc trace. */
export function measureHandClaw(pose: DeinonychusPose, prop: DeinonychusProportions): Pt {
  const joints = armJoints(buildSkeleton(pose, prop), pose.nearArm, prop);
  return add(joints.wrist, rot({ x: prop.hand * (1 + FINGER_CLAW_SHARE), y: 0 }, joints.handAngle));
}

/** The near foot's sickle-claw tip, for the pounce row's arc trace. */
export function measureFootSickle(pose: DeinonychusPose, prop: DeinonychusProportions): Pt {
  const nodes = sickleNodes(buildSkeleton(pose, prop).nearLeg, prop, pose.nearLeg.sickle);
  return nodes[nodes.length - 1];
}

/** The profile eye's centre, in the same frame the painter draws it in. */
export function measureEyeSide(pose: DeinonychusPose, prop: DeinonychusProportions): Pt {
  return skullFrame(buildSkeleton(pose, prop), pose, prop).at(EYE_ALONG, -EYE_RISE);
}

/** The head-on eyes: their midpoint and the gap between them. */
export function measureEyesFront(
  pose: DeinonychusPose,
  prop: DeinonychusProportions,
): { readonly centre: Pt; readonly spacing: number } {
  const centre = axialLayout(pose, prop, FRONT_VIEW).headCentre;
  const halfW = prop.skullLength * AXIAL_CRANIUM_WIDTH * AXIAL_HEAD_NEAR_SCALE;
  const halfH = prop.skullLength * AXIAL_CRANIUM_HEIGHT * AXIAL_HEAD_NEAR_SCALE;
  return {
    centre: { x: centre.x, y: centre.y - halfH * AXIAL_EYE_RISE },
    spacing: halfW * AXIAL_EYE_SPAN * 2,
  };
}

/**
 * The highest point of the profile head — the top of the brow — traced through
 * the same skull frame `drawHeadSide` paints in, so a redraw of the skull moves
 * it too.
 */
export function measureHeadTopSide(pose: DeinonychusPose, prop: DeinonychusProportions): number {
  const { at } = skullFrame(buildSkeleton(pose, prop), pose, prop);
  return Math.min(
    at(SKULL_OCCIPUT_ALONG, -SKULL_CROWN).y,
    at(SKULL_BROW_ALONG, -SKULL_BROW).y,
    at(EYE_ALONG, -EYE_BROW_PEAK).y,
  );
}

const HALF_SPAN = 0.5;
