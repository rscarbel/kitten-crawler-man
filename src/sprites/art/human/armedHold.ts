/**
 * How the human crawler holds a weapon out in his hand while he stands,
 * guards, walks and runs — every armed set's stance and stride rows are the bare-handed rows'
 * legs and body with the arms that hold the weapon re-posed here.
 *
 * - A light one-hander is carried low in his right fist, point forward and
 *   down, the arm swinging less than a free arm would; on guard it is held
 *   out before him, point up.
 * - A heavy one-hander rides on his right shoulder, the fist folded up in
 *   front of it; on guard it is held up and ready over the shoulder.
 * - A two-handed haft is held across his body in both fists, the butt at his
 *   right hip and the head out past his left side; he stands, walks and runs
 *   with it there.
 *
 * The free arm keeps the bare-handed row's own swing, so the phase of every
 * arm against the legs is the reference walk's.
 *
 * Every grip is posed in the authored frame — his right toward +X, +Y down —
 * with the fist placed relative to the shoulder it hangs from, so the hold
 * rides on whatever the body under it is doing.
 */

import { pt } from '../biped/geometry';
import { FOREARM_LENGTH, UPPER_ARM_LENGTH } from '../biped/proportions';
import {
  type ArmAngles,
  type BodySide,
  buildSkeleton,
  type BipedPose,
  FULL_UPPER_ARM,
  type HaftDepth,
  HAFT_AWAY_FROM_CAMERA,
  HAFT_IN_PLANE,
  HAFT_TOWARD_CAMERA,
  setArmAngles,
  VIEWS,
} from '../biped/rig';
import { deg, lerp, type Pt } from '../bipedArt';
import type { CardinalView } from '../../facingView';
import type { Vec3 } from '../../held/heldPaint';
import { closeFistsOnHaft } from './actionsGather';
import { anglesThrough } from './gaitShared';
import { KNUCKLES_TO_CAMERA, PALM_TO_CAMERA, rolled, towards } from './handTurn';
import {
  guardBack,
  guardDropBetween,
  guardFront,
  guardSide,
  idleBack,
  idleFront,
  idleSide,
} from './idles';
import {
  runFacingCycle,
  runSide,
  runStart,
  runStop,
  walkFacing,
  walkSide,
  walkStart,
  walkStop,
} from './locomotion';
import type { ArmedMotionSet } from './motionSets';

// ── Arms posed from a fist's place ───────────────────────────────────────────

/**
 * Which way an arm placed by its fist bends: `down` puts the elbow on the
 * clockwise side of the line from shoulder to fist as the authored frame is
 * drawn (below a fist held out ahead in profile, inside a fist hanging at his
 * right head-on), `up` the other side.
 */
export type ElbowBend = 'down' | 'up';

const BEND_SIGN: Readonly<Record<ElbowBend, number>> = { down: -1, up: 1 };

/** A straight arm is never asked for its whole length: a locked elbow is a hyper-extended one. */
const ARM_REACH_CAP = 0.985;

/**
 * One arm placed by its fist: the wrist's offset from the shoulder joint it
 * hangs from, the share of each segment drawn (under 1 where it turns toward
 * or away from the camera) and which way the elbow bends.
 */
export interface FistPlace {
  readonly wrist: Pt;
  readonly upperScale?: number;
  readonly foreScale?: number;
  readonly bend: ElbowBend;
}

/** The joint angles that put an arm's wrist where `place` says, from its shoulder joint. */
export function armAnglesFor(place: FistPlace): ArmAngles {
  const upperScale = place.upperScale ?? FULL_UPPER_ARM;
  const foreScale = place.foreScale ?? 1;
  const upper = UPPER_ARM_LENGTH * upperScale;
  const fore = FOREARM_LENGTH * foreScale;
  const distance = Math.hypot(place.wrist.x, place.wrist.y);
  const shortest = Math.abs(upper - fore);
  const span = Math.max(shortest, Math.min(distance, (upper + fore) * ARM_REACH_CAP));
  const toward = Math.atan2(place.wrist.x, place.wrist.y);
  const cosAtShoulder = (upper * upper + span * span - fore * fore) / (2 * upper * span);
  const turn = Math.acos(Math.max(-1, Math.min(1, cosAtShoulder)));
  const upperAngle = toward + BEND_SIGN[place.bend] * turn;
  const elbow = pt(Math.sin(upperAngle) * upper, Math.cos(upperAngle) * upper);
  const wrist = pt(Math.sin(toward) * span, Math.cos(toward) * span);
  return {
    upper: upperAngle,
    fore: Math.atan2(wrist.x - elbow.x, wrist.y - elbow.y),
    foreScale,
  };
}

/** Poses `side`'s arm by `angles`, keeping the pose's hand target on the wrist drawn. */
export function setArm(
  pose: BipedPose,
  view: CardinalView,
  side: BodySide,
  angles: ArmAngles,
  upperScale: number,
): void {
  setArmAngles(pose, side, angles, upperScale);
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const wrist = side === 'right' ? skeleton.rightArm.end : skeleton.leftArm.end;
  if (side === 'right') pose.rightHand = wrist;
  else pose.leftHand = wrist;
}

/** A pose's arm as joint angles, solving one it places by the hand, and the share of its upper arm drawn. */
export function armOf(
  pose: BipedPose,
  view: CardinalView,
  side: BodySide,
): { readonly angles: ArmAngles; readonly upperScale: number } {
  const set = side === 'right' ? pose.rightArmAngles : pose.leftArmAngles;
  const upperScale =
    (side === 'right' ? pose.rightUpperArmScale : pose.leftUpperArmScale) ?? FULL_UPPER_ARM;
  if (set !== null) return { angles: set, upperScale };
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const chain = side === 'right' ? skeleton.rightArm : skeleton.leftArm;
  return { angles: anglesThrough(chain.root, chain.joint, chain.end), upperScale };
}

// ── Holds ────────────────────────────────────────────────────────────────────

/**
 * A one-handed item in his right fist: where the fist is, which way the item
 * points on screen (radians, authored), how much of it lies in the picture,
 * which way it runs out of it, how the palm faces, and — on a guard — where
 * the free fist is raised to.
 */
export interface OneHandHold {
  readonly kind: 'oneHand';
  readonly fist: FistPlace;
  readonly haftAngle: number;
  readonly haftShare?: number;
  readonly haftDepth?: HaftDepth;
  readonly palm: Vec3;
  readonly free?: FistPlace;
}

/**
 * A haft in both fists: where the butt fist grips relative to the middle of
 * his shoulders, which way the haft runs from it, how many hands' widths up
 * it the other fist grips, and how each palm faces.
 */
export interface TwoHandHold {
  readonly kind: 'twoHand';
  readonly butt: Pt;
  readonly haftAngle: number;
  readonly spacing: number;
  readonly buttHand: BodySide;
  readonly depth: HaftDepth;
  readonly palms: Readonly<Record<BodySide, Vec3>>;
  readonly elbowFlare: number;
}

export type Hold = OneHandHold | TwoHandHold;

/**
 * The carrying fist's knuckles to the camera, turned a little in toward the
 * thigh: the flat of a blade shows, and the fingers close over the handle's
 * near side.
 */
const PROFILE_CARRY_PALM = towards(-0.3, 0, -0.95);
/** Head-on the knuckles are to the camera and turned a little outward, over the item. */
const FACING_CARRY_PALM = towards(0.3, 0, -0.95);

/**
 * A light one-hander carried low: the fist a little ahead of his hip, the
 * elbow soft, the point forward and down — clear of the leg in profile, out
 * past the hip head-on, where the blade shows against the floor rather than
 * against his trouser seat.
 */
const LIGHT_CARRY: Readonly<Record<CardinalView, OneHandHold>> = {
  side: {
    kind: 'oneHand',
    fist: { wrist: pt(0.14, 0.56), bend: 'down' },
    haftAngle: deg(22),
    palm: PROFILE_CARRY_PALM,
  },
  front: {
    kind: 'oneHand',
    fist: { wrist: pt(0.13, 0.56), bend: 'up' },
    haftAngle: deg(42),
    palm: FACING_CARRY_PALM,
  },
  back: {
    kind: 'oneHand',
    fist: { wrist: pt(0.13, 0.56), bend: 'up' },
    haftAngle: deg(42),
    palm: FACING_CARRY_PALM,
  },
};

/**
 * On guard with a light one-hander: the fist out before his chest, the point
 * up and forward, his free fist raised at his chest behind it. Head-on the
 * point stands up beside his head, off his face.
 */
const LIGHT_GUARD: Readonly<Record<CardinalView, OneHandHold>> = {
  side: {
    kind: 'oneHand',
    fist: { wrist: pt(0.36, 0.3), bend: 'down' },
    haftAngle: deg(-58),
    palm: KNUCKLES_TO_CAMERA,
    free: { wrist: pt(0.2, 0.34), bend: 'down' },
  },
  front: {
    kind: 'oneHand',
    fist: { wrist: pt(-0.02, 0.1), upperScale: 0.55, bend: 'up' },
    haftAngle: deg(-74),
    palm: FACING_CARRY_PALM,
    free: { wrist: pt(0.08, 0.3), upperScale: 0.7, bend: 'down' },
  },
  back: {
    kind: 'oneHand',
    fist: { wrist: pt(-0.02, 0.1), upperScale: 0.55, bend: 'up' },
    haftAngle: deg(-74),
    palm: FACING_CARRY_PALM,
    free: { wrist: pt(0.08, 0.3), upperScale: 0.7, bend: 'down' },
  },
};

/**
 * A heavy one-hander on his shoulder: the fist folded up just in front of
 * the shoulder, the haft back over it, the head behind him. Head-on the head
 * stands up past the shoulder, off his face, and runs back out of the
 * picture; from behind it comes toward the camera.
 */
const HEAVY_CARRY: Readonly<Record<CardinalView, OneHandHold>> = {
  side: {
    kind: 'oneHand',
    fist: { wrist: pt(0.12, 0.12), bend: 'down' },
    haftAngle: deg(-152),
    palm: KNUCKLES_TO_CAMERA,
  },
  front: {
    kind: 'oneHand',
    fist: { wrist: pt(0.07, 0.1), upperScale: 0.75, bend: 'up' },
    haftAngle: deg(-72),
    haftShare: 0.8,
    haftDepth: HAFT_AWAY_FROM_CAMERA,
    palm: FACING_CARRY_PALM,
  },
  back: {
    kind: 'oneHand',
    fist: { wrist: pt(0.07, 0.1), upperScale: 0.75, bend: 'up' },
    haftAngle: deg(-78),
    haftShare: 0.8,
    haftDepth: HAFT_TOWARD_CAMERA,
    palm: FACING_CARRY_PALM,
  },
};

/**
 * On guard with a heavy one-hander: lifted off the shoulder and cocked back
 * level with it, the head behind him ready to come round, the free fist out
 * ahead; head-on it is held up past his shoulder.
 */
const HEAVY_GUARD: Readonly<Record<CardinalView, OneHandHold>> = {
  side: {
    kind: 'oneHand',
    fist: { wrist: pt(0.2, 0.05), bend: 'down' },
    haftAngle: deg(-170),
    palm: KNUCKLES_TO_CAMERA,
    free: { wrist: pt(0.34, 0.3), bend: 'down' },
  },
  front: {
    kind: 'oneHand',
    fist: { wrist: pt(0.12, 0.14), upperScale: 0.7, bend: 'up' },
    haftAngle: deg(-92),
    palm: FACING_CARRY_PALM,
    free: { wrist: pt(0.06, 0.32), upperScale: 0.6, bend: 'down' },
  },
  back: {
    kind: 'oneHand',
    fist: { wrist: pt(0.12, 0.14), upperScale: 0.7, bend: 'up' },
    haftAngle: deg(-92),
    palm: FACING_CARRY_PALM,
    free: { wrist: pt(0.06, 0.32), upperScale: 0.6, bend: 'down' },
  },
};

/**
 * Edge-on the far fist's palm is toward the camera and the near fist's
 * knuckles are; head-on and from behind the palms face each other across
 * the haft.
 */
const TWO_HAND_PALMS: Readonly<Record<CardinalView, Readonly<Record<BodySide, Vec3>>>> = {
  side: { left: PALM_TO_CAMERA, right: KNUCKLES_TO_CAMERA },
  front: { left: towards(0.7, 0, -0.7), right: towards(-0.7, 0, -0.7) },
  back: { left: towards(0.7, 0, -0.7), right: towards(-0.7, 0, -0.7) },
};

/** How many hands' widths apart the two fists sit on a haft carried across him. */
const ACROSS_GRIP_SPACING = 2.6;
/** Edge-on both elbows fold forward, in front of the chest. */
const SIDE_TWO_HAND_ELBOW_FLARE = -0.35;
/**
 * Head-on the elbows are held a little out from the ribs: tucked in, the
 * forearms cross over his chest; flared wide, they lie level across his belly
 * and read as arms folded.
 */
const FACING_TWO_HAND_ELBOW_FLARE = 0.4;
/**
 * Head-on the butt fist is low at his right hip and the other well up the
 * haft by his left hip, so the haft shows between them.
 */
const FACING_ACROSS_GRIP_SPACING = 2;

/**
 * A two-handed haft across his body: the butt in his right fist at the hip,
 * the haft rising forward past his left side to the head. Edge-on it is held
 * forward and up, the head ahead of him at chest height; head-on and from
 * behind it crosses his front from his right hip to past his left shoulder.
 */
const TWO_HAND_CARRY: Readonly<Record<CardinalView, TwoHandHold>> = {
  side: {
    kind: 'twoHand',
    butt: pt(0.02, 0.58),
    haftAngle: deg(-22),
    spacing: ACROSS_GRIP_SPACING,
    buttHand: 'right',
    depth: HAFT_IN_PLANE,
    palms: TWO_HAND_PALMS.side,
    elbowFlare: SIDE_TWO_HAND_ELBOW_FLARE,
  },
  front: {
    kind: 'twoHand',
    butt: pt(0.3, 0.6),
    haftAngle: deg(-141),
    spacing: FACING_ACROSS_GRIP_SPACING,
    buttHand: 'right',
    depth: HAFT_IN_PLANE,
    palms: TWO_HAND_PALMS.front,
    elbowFlare: FACING_TWO_HAND_ELBOW_FLARE,
  },
  back: {
    kind: 'twoHand',
    butt: pt(0.3, 0.6),
    haftAngle: deg(-141),
    spacing: FACING_ACROSS_GRIP_SPACING,
    buttHand: 'right',
    depth: HAFT_IN_PLANE,
    palms: TWO_HAND_PALMS.back,
    elbowFlare: FACING_TWO_HAND_ELBOW_FLARE,
  },
};

/** How each set carries its weapon while he stands and moves, per view. */
export const CARRY_HOLDS: Readonly<Record<ArmedMotionSet, Readonly<Record<CardinalView, Hold>>>> = {
  oneHandLight: LIGHT_CARRY,
  oneHandHeavy: HEAVY_CARRY,
  twoHand: TWO_HAND_CARRY,
};

/** How each set with a guard of its own holds its weapon on guard, per view. */
const GUARD_HOLDS: Readonly<
  Record<Exclude<ArmedMotionSet, 'twoHand'>, Readonly<Record<CardinalView, OneHandHold>>>
> = {
  oneHandLight: LIGHT_GUARD,
  oneHandHeavy: HEAVY_GUARD,
};

/** The sets that stand on guard with a hold of their own; a two-hander's guard is its stance. */
export type GuardingSet = keyof typeof GUARD_HOLDS;

export function guardsOwnWay(set: ArmedMotionSet): set is GuardingSet {
  return set !== 'twoHand';
}

// ── Laying a hold on a pose ──────────────────────────────────────────────────

/** A clenched fist round a handle. */
const GRIPPING_FIST = 1;

/**
 * How far the held arm still swings with the stride, as a share of the free
 * arm's own swing: a weapon in hand damps the swing, the heavier the more.
 */
export interface SwingShares {
  readonly walk: number;
  readonly run: number;
}

/** How much of the forearm's swing a one-handed item turns with, edge-on. */
const PROFILE_ITEM_FOLLOW = 0.25;
/** Head-on less, or the swing carries it in across his trouser seat. */
const FACING_ITEM_FOLLOW = 0.2;

const SWING_SHARES: Readonly<Record<ArmedMotionSet, SwingShares>> = {
  oneHandLight: { walk: 0.4, run: 0.3 },
  oneHandHeavy: { walk: 0.12, run: 0.18 },
  twoHand: { walk: 0.2, run: 0.9 },
};

/**
 * How much a haft carried in both fists rocks with the stride, per radian of
 * a free arm's swing at the shoulder. Head-on the shoulder's swing is small,
 * and without the rock the arms holding the haft are dead still over legs
 * that are not; edge-on the haft's head would trail along the floor.
 */
const FACING_TWO_HAND_ROCK = 1.2;
const PROFILE_TWO_HAND_ROCK = 0.6;

/** The bare-handed arms he stands with in each view, which every swing is measured from. */
const STANDING_ARMS: Readonly<Record<CardinalView, Readonly<Record<BodySide, ArmAngles>>>> = {
  side: {
    right: armOf(idleSide(0), 'side', 'right').angles,
    left: armOf(idleSide(0), 'side', 'left').angles,
  },
  front: {
    right: armOf(idleFront(0), 'front', 'right').angles,
    left: armOf(idleFront(0), 'front', 'left').angles,
  },
  back: {
    right: armOf(idleBack(0), 'back', 'right').angles,
    left: armOf(idleBack(0), 'back', 'left').angles,
  },
};

/** How far a bare-handed pose's arm has swung away from how it hangs standing. */
function swingOf(pose: BipedPose, view: CardinalView, side: BodySide): ArmAngles {
  const now = armOf(pose, view, side).angles;
  const rest = STANDING_ARMS[view][side];
  return { upper: now.upper - rest.upper, fore: now.fore - rest.fore, foreScale: 1 };
}

const NO_SWING: ArmAngles = { upper: 0, fore: 0, foreScale: 1 };

/**
 * Lays `hold` on `pose`: the gripping fist (or fists) re-posed, the item's
 * turn set on each, and — for a one-handed hold — the held arm still
 * swinging by `swingShare` of the stride the bare-handed arm was swinging
 * through, the item turning with the forearm.
 */
export function withHold(
  pose: BipedPose,
  view: CardinalView,
  hold: Hold,
  swingShare: number,
): BipedPose {
  const held = { ...pose };
  const swing = swingShare === 0 ? NO_SWING : swingOf(pose, view, 'right');
  if (hold.kind === 'twoHand') {
    // The haft dips toward level with each step and comes back, never rising
    // past where it is carried: rising carries its head up across his face.
    const towardLevel = Math.cos(hold.haftAngle) >= 0 ? 1 : -1;
    const rock = VIEWS[view].profile ? PROFILE_TWO_HAND_ROCK : FACING_TWO_HAND_ROCK;
    const dip = towardLevel * Math.abs(swing.upper * rock * swingShare);
    holdTwoHanded(held, view, hold, dip);
    return held;
  }
  const base = armAnglesFor(hold.fist);
  const angles: ArmAngles = {
    upper: base.upper + swing.upper * swingShare,
    fore: base.fore + swing.fore * swingShare,
    foreScale: base.foreScale,
    ...(VIEWS[view].profile ? {} : { wristFollow: FACING_WEAPON_WRIST_FOLLOW }),
  };
  setArm(held, view, 'right', angles, hold.fist.upperScale ?? FULL_UPPER_ARM);
  if (hold.free !== undefined) {
    setArm(held, view, 'left', armAnglesFor(hold.free), hold.free.upperScale ?? FULL_UPPER_ARM);
  }
  const follow = VIEWS[view].profile ? PROFILE_ITEM_FOLLOW : FACING_ITEM_FOLLOW;
  gripOneHanded(held, hold, (angles.fore - base.fore) * follow);
  return held;
}

/**
 * Head-on, how much of the forearm's direction the weapon fist takes. A fist
 * on a handle holds its wrist nearly straight, knuckles running on up the
 * forearm; at the wrist's default hold an elbow bent under a raised weapon
 * cocks the hand back off the forearm, which reads as the palm turned out to
 * the camera. Edge-on the default hold already lies along the swing.
 */
const FACING_WEAPON_WRIST_FOLLOW = 0.9;

/** Closes his right fist on a one-handed item, turned as `hold` says and swung on by `turn`. */
function gripOneHanded(pose: BipedPose, hold: OneHandHold, turn: number): void {
  pose.rightHandShape = 'grip';
  pose.rightFist = GRIPPING_FIST;
  pose.rightHandOrientation = {
    palmNormal: hold.palm,
    haftDepth: hold.haftDepth ?? HAFT_IN_PLANE,
    haftAngle: hold.haftAngle - turn,
    ...(hold.haftShare === undefined ? {} : { haftShare: hold.haftShare }),
  };
}

/** Closes both fists on a haft held where `hold` says, rocked by `rock` radians. */
function holdTwoHanded(pose: BipedPose, view: CardinalView, hold: TwoHandHold, rock: number): void {
  const shoulders = buildSkeleton(pose, VIEWS[view]).shoulderCentre;
  pose.elbowFlare = hold.elbowFlare;
  // Both arms reach for the haft at their whole length: a stride's arm drawn
  // short where it swings at the camera would fall short of its grip.
  pose.leftUpperArmScale = FULL_UPPER_ARM;
  pose.rightUpperArmScale = FULL_UPPER_ARM;
  // Which side of him the arms are drawn on holds for the whole row: a
  // stride's swing that moves an arm across his body would pop the haft
  // from in front of him to behind.
  const behind = VIEWS[view].showsBack;
  pose.leftArmBehind = behind;
  pose.rightArmBehind = behind;
  pose.leftHandDepth = undefined;
  pose.rightHandDepth = undefined;
  pose.leftFist = GRIPPING_FIST;
  pose.rightFist = GRIPPING_FIST;
  closeFistsOnHaft(
    pose,
    view,
    {
      butt: pt(shoulders.x + hold.butt.x, shoulders.y + hold.butt.y),
      haftAngle: hold.haftAngle + rock,
      spacing: hold.spacing,
      buttHand: hold.buttHand,
      depth: hold.depth,
      palms: hold.palms,
    },
    ARMED_GRIP_PASSES,
  );
}

/** A weapon's haft is held out near the arms' full reach, where the grip correction converges slowly. */
const ARMED_GRIP_PASSES = 8;

/** One hold `t` of the way to another, joint by joint; two-handed holds blend their haft. */
function blendHolds(from: Hold, to: Hold, t: number): Hold {
  if (from.kind === 'twoHand' || to.kind === 'twoHand') return t < HALF_SHARE ? from : to;
  return {
    kind: 'oneHand',
    fist: blendFist(from.fist, to.fist, t),
    haftAngle: lerp(from.haftAngle, to.haftAngle, t),
    haftShare: lerp(from.haftShare ?? 1, to.haftShare ?? 1, t),
    haftDepth: t < HALF_SHARE ? (from.haftDepth ?? HAFT_IN_PLANE) : (to.haftDepth ?? HAFT_IN_PLANE),
    palm: rolled(from.palm, to.palm, t),
  };
}

const HALF_SHARE = 0.5;

function blendFist(from: FistPlace, to: FistPlace, t: number): FistPlace {
  return {
    wrist: pt(lerp(from.wrist.x, to.wrist.x, t), lerp(from.wrist.y, to.wrist.y, t)),
    upperScale: lerp(from.upperScale ?? FULL_UPPER_ARM, to.upperScale ?? FULL_UPPER_ARM, t),
    foreScale: lerp(from.foreScale ?? 1, to.foreScale ?? 1, t),
    bend: t < HALF_SHARE ? from.bend : to.bend,
  };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

function idlePose(view: CardinalView, phase: number, lid: number): BipedPose {
  if (view === 'side') return idleSide(phase, lid);
  return view === 'back' ? idleBack(phase, lid) : idleFront(phase, lid);
}

function guardPose(view: CardinalView, phase: number): BipedPose {
  if (view === 'side') return guardSide(phase);
  return view === 'back' ? guardBack(phase) : guardFront(phase);
}

function guardHold(set: GuardingSet, view: CardinalView): OneHandHold {
  return GUARD_HOLDS[set][view];
}

/** Standing with the weapon carried, breathing as the bare-handed idle breathes. */
export function armedIdle(
  set: ArmedMotionSet,
  view: CardinalView,
  phase: number,
  lid: number,
): BipedPose {
  return withHold(idlePose(view, phase, lid), view, CARRY_HOLDS[set][view], 0);
}

/** On guard with the weapon ready, bouncing as the bare-handed guard bounces. */
export function armedGuard(set: GuardingSet, view: CardinalView, phase: number): BipedPose {
  return withHold(guardPose(view, phase), view, guardHold(set, view), 0);
}

/** `t` of the way from the guard down to the carry, the feet stepping as the bare-handed drop steps them. */
export function armedGuardDrop(set: GuardingSet, view: CardinalView, t: number): BipedPose {
  const body = guardDropBetween(guardPose(view, 0), idlePose(view, 0, 0), t, view);
  const guard = guardHold(set, view);
  const carry = CARRY_HOLDS[set][view];
  const hold = blendHolds(guard, carry, t);
  const pose = withHold(body, view, hold, 0);
  if (guard.free !== undefined && hold.kind === 'oneHand') {
    const free = armAnglesFor(guard.free);
    const standing = armOf(idlePose(view, 0, 0), view, 'left');
    setArm(
      pose,
      view,
      'left',
      {
        upper: lerp(free.upper, standing.angles.upper, t),
        fore: lerp(free.fore, standing.angles.fore, t),
        foreScale: lerp(free.foreScale, standing.angles.foreScale, t),
      },
      lerp(guard.free.upperScale ?? FULL_UPPER_ARM, standing.upperScale, t),
    );
  }
  return pose;
}

function walkPose(view: CardinalView, phase: number): BipedPose {
  if (view === 'side') return walkSide(phase);
  return walkFacing(phase, view === 'back');
}

function runPose(view: CardinalView, phase: number): BipedPose {
  if (view === 'side') return runSide(phase);
  return runFacingCycle(phase, view === 'back');
}

export function armedWalk(set: ArmedMotionSet, view: CardinalView, phase: number): BipedPose {
  return withHold(walkPose(view, phase), view, CARRY_HOLDS[set][view], SWING_SHARES[set].walk);
}

export function armedRun(set: ArmedMotionSet, view: CardinalView, phase: number): BipedPose {
  return withHold(runPose(view, phase), view, CARRY_HOLDS[set][view], SWING_SHARES[set].run);
}

export function armedWalkStart(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  return withHold(walkStart(frame, view), view, CARRY_HOLDS[set][view], SWING_SHARES[set].walk);
}

export function armedWalkStop(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  return withHold(walkStop(frame, view), view, CARRY_HOLDS[set][view], SWING_SHARES[set].walk);
}

export function armedRunStart(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  return withHold(runStart(frame, view), view, CARRY_HOLDS[set][view], SWING_SHARES[set].run);
}

export function armedRunStop(set: ArmedMotionSet, view: CardinalView, frame: number): BipedPose {
  return withHold(runStop(frame, view), view, CARRY_HOLDS[set][view], SWING_SHARES[set].run);
}

/** The run pose with `set`'s carry laid on, for blows thrown on the move. */
export function armedRunUnder(set: ArmedMotionSet, view: CardinalView, pose: BipedPose): BipedPose {
  return withHold(pose, view, CARRY_HOLDS[set][view], SWING_SHARES[set].run);
}
