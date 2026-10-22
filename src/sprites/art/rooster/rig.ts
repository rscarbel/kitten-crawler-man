/**
 * The rooster rig: proportions, the view table, the pose and the solved
 * skeleton. Knows nothing about paint or about animation.
 *
 * Coordinates are rig units with the origin on the ground between the feet and
 * +Y down the screen, so every height is negative. One rig unit is one tile at
 * the big build's size; a smaller build is the same rig drawn smaller.
 *
 * The body is a bird's and the arms are a man's, and the rig keeps the two
 * mechanisms apart. The leg is a bird leg: a hidden femur inside the body, a
 * feathered drumstick running down and back to a backward-bending ankle, and a
 * bare shank running down and forward to the toes. It is solved once, side-on,
 * in the bird's own walking plane, and the head-on views project that one
 * solve, so a stride is one motion seen from three places rather than three
 * motions that disagree. The arm is a human arm taken from Carl's rig
 * (`carl/rig.ts`): a two-bone IK reaching for a hand target, with joint angles
 * as an escape hatch for an arm that swings from the shoulder.
 *
 * Handedness: every pose is authored with the rooster's own right side at +X as
 * seen from behind. Facing the camera his right is on the viewer's left, so the
 * front view mirrors the solved skeleton; the light stays upper left because
 * the painter shades the mirrored geometry in screen space.
 */

import { type Pt, clamp01, deg } from '../carlArt';
import type { RoosterBuildSpec } from './builds';

export type { Pt };

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function add(p: Pt, dx: number, dy: number): Pt {
  return { x: p.x + dx, y: p.y + dy };
}

export function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function angleOf(a: Pt, b: Pt): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// ── Proportions ──────────────────────────────────────────────────────────────

/** Ground to the top of the comb in the resting pose, at the big build. */
const DESIGN_HEIGHT = 3;

/**
 * Cell pixels per game tile, for every build's figure: the game's own 32 px
 * tile rather than the 64 most figures paint at. The big build stands three
 * tiles with a tail fountain more than one tile long behind him and plays
 * eleven rows in three views, and at 64 his cells come to about four times
 * what the frame cache holds for one figure, so a fight could not keep its
 * own working set warm.
 */
export const ROOSTER_TILE_SCALE = 32;

/**
 * Game tiles per rig unit for a build: the rig is authored at the big build's
 * size, and a build standing up on his toes stands that much taller in it, so
 * his comb still tops out at his own height.
 */
export function tilesPerRigUnit(build: RoosterBuildSpec): number {
  return build.heightTiles / (DESIGN_HEIGHT + build.carriage.tiptoe);
}

/** Cell pixels per rig unit for a build. */
export function cellPxPerRigUnit(build: RoosterBuildSpec): number {
  return ROOSTER_TILE_SCALE * tilesPerRigUnit(build);
}

/**
 * The hip, which is where both legs root: just under the belly feathers, and
 * low enough over the feet that even a bird standing at rest folds his ankle
 * back. Standing straight up the leg's zig-zag vanishes and it reads as a stilt.
 */
const HIP_Y = -1.04;
/** The bottom of the shank above the toe pad. */
const ANKLE_HEIGHT = 0.07;
/**
 * The feathered drumstick and the bare shank. Together a little longer than
 * the hip is high, so a standing bird stands with the ankle folded back — the
 * zig-zag that is the first thing that says "bird leg" — and the IK keeps the
 * headroom a stride needs without clamping.
 */
const DRUMSTICK_LENGTH = 0.5;
const SHANK_LENGTH = 0.58;
/** The knee is buried in the body a little forward of the hip. */
const LEG_ROOT_FORWARD = 0.03;
/** Head-on, how far either side of the centreline each leg roots. */
const LEG_ROOT_HALF = 0.27;
/** Head-on, how far either side of the centreline a standing foot is planted. */
const FOOT_STAND_HALF = 0.34;

/**
 * The trunk, in the hip's own frame (x forward in profile, up negative). An
 * egg tipped nose-up: the deep breast forward and high, the short back sloping
 * down to the tail.
 */
const BODY_CENTRE = pt(-0.02, -0.42);
export const BODY_DEPTH_RADIUS = 0.6;
export const BODY_HEIGHT_RADIUS = 0.5;
/** Head-on the trunk is narrower than it is deep: a barrel, not a plate. */
export const BODY_HALF_WIDTH = 0.6;
export const BODY_TILT = deg(-16);
/** The puffed breast, a second mass bulging forward and up from the trunk. */
const BREAST_CENTRE = pt(0.3, -0.62);
export const BREAST_RADIUS = 0.4;
/**
 * In profile the breast stands further forward still, proud of the arm's
 * root: tucked behind the arm, the trunk shows as one round disc, a shield
 * strapped to his side.
 */
const PROFILE_BREAST_FORWARD = 0.06;
/**
 * And lower: a breast whose top stands above the front of the neck's root
 * rounds over in front of the throat, and its outline closes into a disc.
 */
const PROFILE_BREAST_DROP = 0.08;
/** Head-on the breast is the belly of the barrel. */
export const BREAST_HALF_WIDTH = 0.56;
/** Head-on the breast's ball sits lower on the trunk, so the body is a pear and not a box. */
const HEAD_ON_BREAST_Y = -0.5;
/** Where the tail roots: the back end of the trunk, above the hip. */
const TAIL_ROOT = pt(-0.5, -0.52);

/**
 * Where the arms root, in the hip's frame: high on the trunk at the front, where a
 * bird's wings would be. Head-on they sit at the widest part of the barrel's
 * top, so the deltoids stand outside the hackle cape.
 */
const SHOULDER_PROFILE = pt(0.05, -0.77);
const SHOULDER_HEIGHT = -0.77;
export const SHOULDER_HALF = 0.5;
/** The arm's joint hangs this far below the shoulder line, inside the deltoid. */
const SHOULDER_JOINT_DROP = 0.05;
/** Edge-on the far shoulder is drawn this far behind the near one, so its arm shows. */
const PROFILE_FAR_SHOULDER_BACK = -0.06;
/** Edge-on the far leg roots this far behind the near one. */
const PROFILE_FAR_LEG_BACK = -0.05;

/**
 * Human arm lengths, long against the bird because the arms are the joke. Their
 * total has to carry both fists over the comb in the slam's wind-up.
 */
const UPPER_ARM_LENGTH = 0.56;
const FOREARM_LENGTH = 0.5;
const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/** The neck rises from the top of the trunk to a head held high and a little forward. */
const NECK_BASE = pt(0.14, -0.92);
const NECK_BASE_HEAD_ON = pt(0, -0.95);
export const NECK_VECTOR = pt(0.12, -0.56);
/** How much of the trunk's lean the neck carries; the head stays nearer upright. */
const NECK_FOLLOW = 0.45;

/** The skull: a small bird's head, deeper than it is wide. */
export const HEAD_DEPTH_HALF = 0.17;
export const HEAD_WIDTH_HALF = 0.125;
export const HEAD_HEIGHT_HALF = 0.14;

// ── Views ────────────────────────────────────────────────────────────────────

export type RoosterView = 'front' | 'back' | 'side';

export interface ViewSpec {
  readonly profile: boolean;
  readonly showsFace: boolean;
  /** The front view reflects the authored pose, so his right is on the viewer's left. */
  readonly mirrored: boolean;
  /**
   * The head's resting turn, as the angle between his beak and the camera's
   * line of sight: 90° is a full profile, under 90° turns the face toward the
   * camera, over 90° away from it. Head-on it is never square: a bird looks
   * with one eye, and a beak pointed at the camera foreshortens to a dot and
   * the comb to a blade.
   */
  readonly headTurn: number;
  /**
   * Which way "ahead of him" reads on the screen head-on: down for the view
   * facing the camera, up for the view from behind, none in profile.
   */
  readonly depthSign: number;
  /**
   * Head-on, how far his body is turned from square to the camera, toward the
   * side his beak looks to; edge-on it is unused. A bird squared up to the
   * camera has no depth to show, and a symmetric trunk with an arm hanging at
   * each side is a man's outline: turned, his breast swells out ahead of him,
   * the fountain sweeps away behind, and his legs fold back at the ankle.
   */
  readonly yaw: number;
}

const HEAD_ON_HEAD_TURN = deg(66);
const PROFILE_HEAD_TURN = Math.PI / 2;
/**
 * From behind the head is turned a little under halfway round, as a bird
 * looking off to the side: the hooked beak tip and a wattle show past the
 * cheek and the comb shows its points, while the eye stays round the far side
 * of the skull (the head's own eye-hiding depth). Straight on from behind the
 * head is a plain ball under a red block, a fez on a neck.
 */
const AWAY_HEAD_TURN = deg(45);
const HEAD_ON_YAW = deg(50);

export const VIEWS: Readonly<Record<RoosterView, ViewSpec>> = {
  front: {
    profile: false,
    showsFace: true,
    mirrored: true,
    headTurn: HEAD_ON_HEAD_TURN,
    depthSign: 1,
    yaw: HEAD_ON_YAW,
  },
  back: {
    profile: false,
    showsFace: false,
    mirrored: false,
    headTurn: Math.PI - AWAY_HEAD_TURN,
    depthSign: -1,
    yaw: HEAD_ON_YAW,
  },
  side: {
    profile: true,
    showsFace: true,
    mirrored: false,
    headTurn: PROFILE_HEAD_TURN,
    depthSign: 0,
    yaw: 0,
  },
};

/** Head-on, the share of a length along his facing that shows across the picture. */
export function yawAhead(view: ViewSpec): number {
  return Math.sin(view.yaw);
}

/** Head-on, the share of a length across his body that still shows across the picture. */
export function yawAcross(view: ViewSpec): number {
  return Math.cos(view.yaw);
}

/**
 * Head-on, which way across the picture "ahead of him" runs once his body is
 * turned: the front view mirrors the solved skeleton, so his facing does too.
 */
export function yawFacingSign(view: ViewSpec): number {
  return view.mirrored ? -1 : 1;
}

/** Head-on, the half-width a round mass of this depth and breadth draws at once turned. */
export function yawedHalfWidth(view: ViewSpec, depthHalf: number, widthHalf: number): number {
  return Math.hypot(depthHalf * yawAhead(view), widthHalf * yawAcross(view));
}

/**
 * Head-on, a step of depth on the floor draws as this share of itself in
 * screen height, fading out toward the hip. Drawn at the floor's own scale a
 * planted foot slides the whole stride down the screen while the hips ride with
 * the sprite, and the leg between them telescopes.
 */
const HEAD_ON_FLOOR_FORESHORTENING = 0.3;
/** Head-on, how far inward of the straight hip-to-foot line the ankle joint tucks. */
const HEAD_ON_HOCK_TUCK = 0.06;

// ── Pose ─────────────────────────────────────────────────────────────────────

/** An arm posed by its joints, in radians from hanging straight down. */
export interface ArmAngles {
  /** Positive swings forward edge-on, outward head-on. */
  readonly upper: number;
  readonly fore: number;
  /** Share of its length the forearm draws at, for a forearm turned out of the picture. */
  readonly foreScale: number;
}

/** One foot, in the bird's own walking plane. */
export interface FootPose {
  /** Ahead of the hip, along the way he faces. */
  readonly forward: number;
  /** Off the floor. */
  readonly lift: number;
  /** 0 toes spread flat, 1 curled shut under the foot. */
  readonly curl: number;
  /** Head-on, how far the foot is moved outboard of its standing place. */
  readonly lateral: number;
  readonly planted: boolean;
}

/**
 * One frame of a rooster. Hands are targets in the drawn plane of the view the
 * row is authored for; feet are in the walking plane and projected per view.
 */
export interface RoosterPose {
  /** Whole-body vertical offset; negative lifts. */
  readonly bob: number;
  /** Hips shifted across the picture. */
  readonly sway: number;
  /** Edge-on, the trunk pitched forward (positive) about the hip. */
  readonly lean: number;
  /** Head-on, the trunk rolled toward his right (positive) about the hip. */
  readonly roll: number;
  /** How far the hips sink. */
  readonly crouch: number;
  /** How much further up on his toes than his build stands: the top of a bounce. */
  readonly rise: number;
  /** The breast puffed out, 0 to 1. */
  readonly chestPuff: number;
  /** Both shoulders lifted. */
  readonly shrug: number;
  /** Shoulders turned about the spine, −1 to 1: positive brings his right shoulder forward. */
  readonly twist: number;
  /** The head moved off its resting place, in the drawn plane. */
  readonly headShift: Pt;
  /** Beak tipped down (positive) or up. */
  readonly headPitch: number;
  /** The head turned further from the camera (positive) than the view's own turn. */
  readonly headTurn: number;
  /** 0 beak shut, 1 gaping. */
  readonly beakOpen: number;
  readonly blink: number;
  /** Hackles raised off the neck, 0 to 1. */
  readonly hackleLift: number;
  /** Wattles and comb trailing the head's motion, −1 to 1. */
  readonly wattleLag: number;
  /** The tail fountain lifted (positive) or lowered. */
  readonly tailLift: number;
  /** The tail swung toward +X. */
  readonly tailSwing: number;
  readonly leftHand: Pt;
  readonly rightHand: Pt;
  readonly leftArmAngles: ArmAngles | null;
  readonly rightArmAngles: ArmAngles | null;
  /** 0 open hand, 1 closed fist. */
  readonly leftFist: number;
  readonly rightFist: number;
  /** +1 bows the elbows behind or outward, −1 forward or inward. Only the sign is read. */
  readonly elbowFlare: number;
  /** Head-on, an arm on the far side of the trunk, drawn before it. */
  readonly leftArmBehind: boolean;
  readonly rightArmBehind: boolean;
  /**
   * Head-on, the head is drawn over the arms: his neck carries the head ahead
   * of his shoulders, so arms raised overhead pass behind it, not across his face.
   */
  readonly headOverArms: boolean;
  /** Upper arm drawn short, for one pointing at or away from the camera. */
  readonly leftUpperArmScale: number;
  readonly rightUpperArmScale: number;
  readonly leftFoot: FootPose;
  readonly rightFoot: FootPose;
}

export const ELBOW_OUT = 1;
export const ELBOW_IN = -1;

/** A hanging arm reaches nearly its full length; any closer and the IK clamps under the idle's sway. */
const ARM_HANG_REACH_SHARE = 0.965;
/**
 * Head-on the hands hang wide of the hips: a lifter's lats hold his arms off
 * his sides, and the gap of floor between arm and body is what keeps two huge
 * arms from merging into the barrel.
 */
const HAND_HANG_OUT = 0.2;
/** Edge-on the relaxed hand hangs a little ahead of the shoulder. */
const PROFILE_HAND_FORWARD = 0.1;
const RESTING_FIST = 0.45;
/** He stands with his breast already half puffed: a rooster at rest still shows off. */
const RESTING_PUFF = 0.3;

export const SHOULDER_Y = HIP_Y + SHOULDER_HEIGHT;
const HAND_HANG_DROP =
  SHOULDER_JOINT_DROP +
  Math.sqrt((ARM_LENGTH * ARM_HANG_REACH_SHARE) ** 2 - HAND_HANG_OUT * HAND_HANG_OUT);
export const HEAD_ON_HAND_HANG = pt(SHOULDER_HALF + HAND_HANG_OUT, SHOULDER_Y + HAND_HANG_DROP);
export const PROFILE_HAND_HANG = pt(
  SHOULDER_PROFILE.x + PROFILE_HAND_FORWARD,
  SHOULDER_Y + SHOULDER_JOINT_DROP + ARM_LENGTH * ARM_HANG_REACH_SHARE,
);

export function standingFoot(): FootPose {
  return { forward: 0, lift: 0, curl: 0, lateral: 0, planted: true };
}

/** A relaxed standing pose. Every row is written as edits to this. */
export function restingPose(view: RoosterView): RoosterPose {
  const profile = VIEWS[view].profile;
  const hang = profile ? PROFILE_HAND_HANG : HEAD_ON_HAND_HANG;
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    roll: 0,
    crouch: 0,
    rise: 0,
    chestPuff: RESTING_PUFF,
    shrug: 0,
    twist: 0,
    headShift: pt(0, 0),
    headPitch: 0,
    headTurn: 0,
    beakOpen: 0,
    blink: 0,
    hackleLift: 0,
    wattleLag: 0,
    tailLift: 0,
    tailSwing: 0,
    leftHand: profile ? hang : pt(-hang.x, hang.y),
    rightHand: hang,
    leftArmAngles: null,
    rightArmAngles: null,
    leftFist: RESTING_FIST,
    rightFist: RESTING_FIST,
    elbowFlare: ELBOW_OUT,
    leftArmBehind: false,
    rightArmBehind: false,
    headOverArms: false,
    leftUpperArmScale: 1,
    rightUpperArmScale: 1,
    leftFoot: standingFoot(),
    rightFoot: standingFoot(),
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

/** Keeps a fully extended limb off a dead straight line. Tiny: the joint's travel goes as its root. */
const JOINT_SLACK = 0.0003;

export interface BoneChain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/**
 * Places a two-segment limb with its end on `target`. `bendSign` picks the
 * joint's side: +1 puts it on the −X side of a limb pointing down.
 */
function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  bendSign: number,
): BoneChain {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const raw = Math.hypot(dx, dy);
  const dirX = raw === 0 ? 0 : dx / raw;
  const dirY = raw === 0 ? 1 : dy / raw;
  const minReach = Math.abs(upper - lower) + JOINT_SLACK;
  const maxReach = upper + lower - JOINT_SLACK;
  const reach = Math.min(Math.max(raw, minReach), maxReach);
  const end = pt(root.x + dirX * reach, root.y + dirY * reach);
  const along = (reach * reach + upper * upper - lower * lower) / (2 * reach);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const joint = pt(
    root.x + dirX * along - dirY * out * bendSign,
    root.y + dirY * along + dirX * out * bendSign,
  );
  return { root, joint, end };
}

function armFromAngles(
  shoulder: Pt,
  angles: ArmAngles,
  upperScale: number,
  armLength: number,
): BoneChain {
  const upper = rotate(pt(0, UPPER_ARM_LENGTH * armLength * upperScale), -angles.upper);
  const joint = add(shoulder, upper.x, upper.y);
  const fore = rotate(pt(0, FOREARM_LENGTH * armLength * angles.foreScale), -angles.fore);
  return { root: shoulder, joint, end: add(joint, fore.x, fore.y) };
}

/** A solved leg: where each joint is drawn, plus what the painter needs to know about the foot. */
export interface LegChain {
  readonly root: Pt;
  /** The backward-bending ankle between drumstick and shank. */
  readonly hock: Pt;
  /** The bottom of the shank, where the toes spread from. */
  readonly ankle: Pt;
  /** The toe pad under the ankle. */
  readonly pad: Pt;
  readonly curl: number;
  /** Head-on, how far ahead of the hip the foot is, for the painter's width cue. */
  readonly ahead: number;
  readonly planted: boolean;
}

export interface RoosterSkeleton {
  readonly view: RoosterView;
  readonly hip: Pt;
  /** The trunk's own rotation on screen. */
  readonly bodyAngle: number;
  readonly bodyCentre: Pt;
  readonly breastCentre: Pt;
  readonly tailRoot: Pt;
  readonly neckBase: Pt;
  readonly headCentre: Pt;
  /** The head's turn from the camera's line of sight, in radians, as drawn. */
  readonly headTurn: number;
  /** The head's roll in the picture plane. */
  readonly headRoll: number;
  readonly headPitch: number;
  readonly leftShoulder: Pt;
  readonly rightShoulder: Pt;
  readonly leftArm: BoneChain;
  readonly rightArm: BoneChain;
  /**
   * Where each hand was asked to reach, as drawn: the pose's target carried
   * with its shoulder when his body is turned.
   */
  readonly leftHandTarget: Pt;
  readonly rightHandTarget: Pt;
  readonly leftLeg: LegChain;
  readonly rightLeg: LegChain;
}

function bodyPoint(hip: Pt, offset: Pt, angle: number): Pt {
  const turned = rotate(offset, angle);
  return add(hip, turned.x, turned.y);
}

/**
 * Head-on, a point `depth` ahead of the hip at height `y` draws this much
 * lower (front) or higher (back) on the screen.
 */
function depthDrop(view: ViewSpec, depth: number, y: number, hipY: number): number {
  const heightShare = clamp01(1 - y / hipY);
  return view.depthSign * depth * HEAD_ON_FLOOR_FORESHORTENING * heightShare;
}

/**
 * Where the shank ends above the floor: the toe pad's own height, plus how far
 * he stands up on his toes. Up on his toes the toes slope from the raised ankle
 * down to the floor and only their tips bear him.
 */
function ankleHeight(rise: number): number {
  return ANKLE_HEIGHT + rise;
}

function solveLeg(view: ViewSpec, hip: Pt, side: -1 | 1, foot: FootPose, rise: number): LegChain {
  const rootForward = (view.profile ? hip.x : 0) + LEG_ROOT_FORWARD;
  const sagittalRoot = pt(rootForward, hip.y);
  const sagittalAnkle = pt(foot.forward, -foot.lift - ankleHeight(rise));
  const solved = solveTwoBone(sagittalRoot, sagittalAnkle, DRUMSTICK_LENGTH, SHANK_LENGTH, 1);

  if (view.profile) {
    const back = side < 0 ? PROFILE_FAR_LEG_BACK : 0;
    return {
      root: add(solved.root, back, 0),
      hock: add(solved.joint, back, 0),
      ankle: add(solved.end, back, 0),
      pad: pt(solved.end.x + back, -foot.lift),
      curl: foot.curl,
      ahead: foot.forward,
      planted: foot.planted,
    };
  }

  const ahead = yawAhead(view);
  const across = yawAcross(view);
  const rootX = hip.x + side * LEG_ROOT_HALF * across;
  const footX = side * (FOOT_STAND_HALF + foot.lateral) * across;
  const lateralAt = (y: number): number => {
    const share = clamp01((y - hip.y) / (-ankleHeight(rise) - hip.y));
    return rootX + (footX - rootX) * share;
  };
  const project = (p: Pt): Pt =>
    pt(lateralAt(p.y) + p.x * ahead, p.y + depthDrop(view, p.x - rootForward, p.y, hip.y) * across);
  // Head-on the ankle joint tucks in under the body and the shank splays out
  // to the foot: a bird's leg seen from the front is a bent line, and two
  // straight columns from hip to toe are a man's legs in tights.
  const hockProjected = project(solved.joint);
  const hock = pt(hockProjected.x - side * HEAD_ON_HOCK_TUCK, hockProjected.y);
  const ankle = project(solved.end);
  return {
    root: pt(rootX + rootForward * ahead, hip.y),
    hock,
    ankle,
    pad: pt(ankle.x, ankle.y + ankleHeight(rise)),
    curl: foot.curl,
    ahead: foot.forward,
    planted: foot.planted,
  };
}

function solveArm(
  shoulder: Pt,
  hand: Pt,
  angles: ArmAngles | null,
  upperScale: number,
  bendSign: number,
  armLength: number,
): BoneChain {
  if (angles !== null) return armFromAngles(shoulder, angles, upperScale, armLength);
  return solveTwoBone(
    shoulder,
    hand,
    UPPER_ARM_LENGTH * armLength * upperScale,
    FOREARM_LENGTH * armLength,
    bendSign,
  );
}

/** How far turning the body by `turn` about the hip moved this shoulder. */
function carriageCarry(hip: Pt, shoulder: Pt, turn: number): Pt {
  const offset = pt(shoulder.x - hip.x, shoulder.y - hip.y);
  const unturned = rotate(offset, -turn);
  return pt(offset.x - unturned.x, offset.y - unturned.y);
}

/** A hand target pulled in toward its shoulder for an arm `armLength` of the big build's. */
function towardShoulder(shoulder: Pt, target: Pt, armLength: number): Pt {
  return mixPt(shoulder, target, armLength);
}

function mirrorPt(p: Pt): Pt {
  return pt(-p.x, p.y);
}

function mirrorChain(chain: BoneChain): BoneChain {
  return { root: mirrorPt(chain.root), joint: mirrorPt(chain.joint), end: mirrorPt(chain.end) };
}

function mirrorLeg(leg: LegChain): LegChain {
  return {
    ...leg,
    root: mirrorPt(leg.root),
    hock: mirrorPt(leg.hock),
    ankle: mirrorPt(leg.ankle),
    pad: mirrorPt(leg.pad),
  };
}

/** How far a full twist carries each shoulder, head-on as width and edge-on fore and aft. */
const TWIST_SHOULDER_TRAVEL = 0.09;
/** Head-on, a full twist widens the leading shoulder and narrows the trailing one by this share. */
const TWIST_WIDTH_GAIN = 0.15;
/** The breast swells forward and out by this much at full puff. */
const CHEST_PUFF_GROWTH = 0.12;
/** How much of the puff carries the breast's centre forward rather than only swelling it. */
const PUFF_FORWARD_SHARE = 0.5;
/** Head-on, how far across the picture a kinked neck carries the head, as a share of the neck's rise. */
const KINK_CARRY = 0.8;
/** Edge-on, how far forward a kinked neck juts the head, as a share of the neck's rise. */
const PROFILE_KINK_JUT = 0.5;
/** Edge-on a kink also tips the beak down, this share of the roll; any more and his head hangs, tired. */
const PROFILE_KINK_PITCH = 0.15;

/**
 * Head-on, the share of the turn the shoulders follow in toward his spine. At
 * the full turn the arms hang in front of the barrel instead of off its sides,
 * and every overhead fist lands across his face.
 */
const HEAD_ON_SHOULDER_TURN_SHARE = 0.5;

/** Head-on, how far turning his body moves one shoulder across the picture. */
function headOnShoulderCarry(view: ViewSpec, side: -1 | 1): Pt {
  const across = 1 - (1 - yawAcross(view)) * HEAD_ON_SHOULDER_TURN_SHARE;
  const turnedX = side * SHOULDER_HALF * across + SHOULDER_PROFILE.x * yawAhead(view);
  return pt(turnedX - side * SHOULDER_HALF, 0);
}

/** Solves a pose into joint positions, in the drawn picture of `view`. */
export function buildRoosterSkeleton(
  pose: RoosterPose,
  view: RoosterView,
  build: RoosterBuildSpec,
): RoosterSkeleton {
  const spec = VIEWS[view];
  const carriage = build.carriage;
  const onToes = carriage.tiptoe + pose.rise;
  const hipHeight = Math.abs(HIP_Y) - pose.crouch + onToes;
  const hip = pt(pose.sway, -hipHeight + pose.bob);
  const bodyAngle = spec.profile ? pose.lean + carriage.lean : pose.roll - carriage.bodyRoll;

  const ahead = yawAhead(spec);
  const bodyCentre = bodyPoint(
    hip,
    spec.profile ? BODY_CENTRE : pt(BODY_CENTRE.x * ahead, BODY_CENTRE.y),
    bodyAngle,
  );
  const breastForward = BREAST_CENTRE.x + pose.chestPuff * CHEST_PUFF_GROWTH * PUFF_FORWARD_SHARE;
  const breastCentre = bodyPoint(
    hip,
    spec.profile
      ? pt(breastForward + PROFILE_BREAST_FORWARD, BREAST_CENTRE.y + PROFILE_BREAST_DROP)
      : pt(breastForward * ahead, HEAD_ON_BREAST_Y),
    bodyAngle,
  );
  const tailRoot = bodyPoint(
    hip,
    spec.profile ? TAIL_ROOT : pt(TAIL_ROOT.x * ahead, TAIL_ROOT.y),
    bodyAngle,
  );
  const neckBase = bodyPoint(
    hip,
    spec.profile ? NECK_BASE : pt(NECK_BASE.x * ahead, NECK_BASE_HEAD_ON.y),
    bodyAngle,
  );
  const neckLean = bodyAngle * NECK_FOLLOW;
  const neckShare = build.proportions.neckLength;
  const neckVector = spec.profile
    ? pt(NECK_VECTOR.x * neckShare, NECK_VECTOR.y * neckShare)
    : pt(NECK_VECTOR.x * ahead * neckShare, NECK_VECTOR.y * neckShare);
  const kinkSide = spec.profile ? 0 : -1;
  const neckRise = Math.abs(NECK_VECTOR.y) * neckShare;
  // Edge-on the kink cannot show as a sideways tilt; it shows as a crooked
  // neck that juts the head forward of where a straight one carries it.
  const kinkShift = spec.profile
    ? Math.sin(carriage.neckKink) * neckRise * PROFILE_KINK_JUT
    : Math.sin(carriage.neckKink) * neckRise * KINK_CARRY * kinkSide;
  const kinkDrop = (1 - Math.cos(carriage.neckKink)) * neckRise;
  const headRest = bodyPoint(neckBase, neckVector, neckLean);
  const headCentre = add(headRest, pose.headShift.x + kinkShift, pose.headShift.y + kinkDrop);

  const twistTravel = pose.twist * TWIST_SHOULDER_TRAVEL;
  let leftShoulder: Pt;
  let rightShoulder: Pt;
  let leftCarry = pt(0, 0);
  let rightCarry = pt(0, 0);
  if (spec.profile) {
    const centre = bodyPoint(hip, SHOULDER_PROFILE, bodyAngle);
    rightShoulder = add(centre, twistTravel, SHOULDER_JOINT_DROP - pose.shrug);
    leftShoulder = add(
      centre,
      PROFILE_FAR_SHOULDER_BACK - twistTravel,
      SHOULDER_JOINT_DROP - pose.shrug,
    );
  } else {
    leftShoulder = add(
      bodyPoint(
        hip,
        pt(-SHOULDER_HALF * (1 - pose.twist * TWIST_WIDTH_GAIN), SHOULDER_HEIGHT),
        bodyAngle,
      ),
      0,
      SHOULDER_JOINT_DROP - pose.shrug,
    );
    rightShoulder = add(
      bodyPoint(
        hip,
        pt(SHOULDER_HALF * (1 + pose.twist * TWIST_WIDTH_GAIN), SHOULDER_HEIGHT),
        bodyAngle,
      ),
      0,
      SHOULDER_JOINT_DROP - pose.shrug,
    );
    // Turned, both shoulders come in toward the spine and forward with him.
    // Each arm is carried whole with its shoulder, so every row's arm keeps
    // the shape it was authored with square-on.
    leftCarry = headOnShoulderCarry(spec, -1);
    rightCarry = headOnShoulderCarry(spec, 1);
    leftShoulder = add(leftShoulder, leftCarry.x, leftCarry.y);
    rightShoulder = add(rightShoulder, rightCarry.x, rightCarry.y);
  }

  const flare = pose.elbowFlare < 0 ? -1 : 1;
  const leftBend = flare;
  const rightBend = spec.profile ? flare : -flare;
  // Hand targets are written for the big build's arms on a bird standing
  // flat. Up on his toes his whole body rides higher and the hands ride with
  // it; a shorter arm reaches the same share of the way from its shoulder. So
  // every arm keeps the shape it was written with.
  const armLength = build.proportions.armLength;
  // A build that leans or lists for good carries his hands round with his
  // shoulders the same way, so a guard stays at his chin.
  const carriageTurn = bodyAngle - (spec.profile ? pose.lean : pose.roll);
  const leftLean = carriageCarry(hip, leftShoulder, carriageTurn);
  const rightLean = carriageCarry(hip, rightShoulder, carriageTurn);
  const leftHandTarget = towardShoulder(
    leftShoulder,
    add(pose.leftHand, leftCarry.x + leftLean.x, leftCarry.y + leftLean.y - onToes),
    armLength,
  );
  const rightHandTarget = towardShoulder(
    rightShoulder,
    add(pose.rightHand, rightCarry.x + rightLean.x, rightCarry.y + rightLean.y - onToes),
    armLength,
  );
  const leftArm = solveArm(
    leftShoulder,
    leftHandTarget,
    pose.leftArmAngles,
    pose.leftUpperArmScale,
    leftBend,
    armLength,
  );
  const rightArm = solveArm(
    rightShoulder,
    rightHandTarget,
    pose.rightArmAngles,
    pose.rightUpperArmScale,
    rightBend,
    armLength,
  );
  const leftLeg = solveLeg(spec, hip, -1, pose.leftFoot, onToes);
  const rightLeg = solveLeg(spec, hip, 1, pose.rightFoot, onToes);

  const headTurn = spec.headTurn + pose.headTurn;
  const headRoll = spec.profile ? 0 : -carriage.neckKink;
  const headPitch = pose.headPitch + (spec.profile ? carriage.neckKink * PROFILE_KINK_PITCH : 0);

  const solved: RoosterSkeleton = {
    view,
    hip,
    bodyAngle,
    bodyCentre,
    breastCentre,
    tailRoot,
    neckBase,
    headCentre,
    headTurn,
    headRoll,
    headPitch,
    leftShoulder,
    rightShoulder,
    leftArm,
    rightArm,
    leftHandTarget,
    rightHandTarget,
    leftLeg,
    rightLeg,
  };
  if (!spec.mirrored) return solved;
  return {
    ...solved,
    hip: mirrorPt(hip),
    bodyAngle: -bodyAngle,
    bodyCentre: mirrorPt(bodyCentre),
    breastCentre: mirrorPt(breastCentre),
    tailRoot: mirrorPt(tailRoot),
    neckBase: mirrorPt(neckBase),
    headCentre: mirrorPt(headCentre),
    headTurn: -headTurn,
    headRoll: -headRoll,
    leftShoulder: mirrorPt(leftShoulder),
    rightShoulder: mirrorPt(rightShoulder),
    leftArm: mirrorChain(leftArm),
    rightArm: mirrorChain(rightArm),
    leftHandTarget: mirrorPt(leftHandTarget),
    rightHandTarget: mirrorPt(rightHandTarget),
    leftLeg: mirrorLeg(leftLeg),
    rightLeg: mirrorLeg(rightLeg),
  };
}

/**
 * The head's rotation in the picture: its roll, plus its pitch carried toward
 * whichever way the beak points across the picture.
 */
export function headRotation(skeleton: RoosterSkeleton): number {
  return skeleton.headRoll + skeleton.headPitch * Math.sign(Math.sin(skeleton.headTurn));
}

/** A point in the head's own frame (as the head painter draws it) in figure space. */
export function headToFigure(skeleton: RoosterSkeleton, local: Pt): Pt {
  const turned = rotate(local, headRotation(skeleton));
  return add(skeleton.headCentre, turned.x, turned.y);
}

/** Where a leg can reach from its root at most, before the IK clamps it straight. */
export const LEG_MAX_REACH = DRUMSTICK_LENGTH + SHANK_LENGTH - JOINT_SLACK;

/**
 * How far a leg is asked to reach on this pose: from its root to the ankle the
 * foot wants, in the walking plane — the demand, not the solve, because the
 * solver clamps and a check on its output only ever sees the limit.
 */
export function legReachDemand(
  pose: RoosterPose,
  view: RoosterView,
  build: RoosterBuildSpec,
  side: 'left' | 'right',
): number {
  const spec = VIEWS[view];
  const onToes = build.carriage.tiptoe + pose.rise;
  const hipHeight = Math.abs(HIP_Y) - pose.crouch + onToes;
  const hipY = -hipHeight + pose.bob;
  const rootForward = (spec.profile ? pose.sway : 0) + LEG_ROOT_FORWARD;
  const foot = side === 'left' ? pose.leftFoot : pose.rightFoot;
  return Math.hypot(foot.forward - rootForward, -foot.lift - ankleHeight(onToes) - hipY);
}
