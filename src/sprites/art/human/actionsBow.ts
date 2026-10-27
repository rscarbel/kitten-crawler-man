/**
 * The bow on the biped rig: the shot in all three views, and the bow carried
 * in the off hand on any other row.
 *
 * The bow is a held prop (`biped/props/longbow.ts`), gripped in his left fist
 * — the bow hand — and drawn by the right. The shot's frames, in order: the
 * bow comes up from the carry while the drawing hand puts an arrow to the
 * string beside the riser; a four-frame draw back to the anchor at the corner
 * of the jaw; the aim held; the loose, on {@link BOW_RELEASE_FRAME}, where the
 * string snaps straight, the arrow is gone and the drawing hand flicks open
 * back along the jaw; then the bow is lowered and the drawing arm hangs again.
 *
 * Every pose here is authored with his right side at +X, as every row on the
 * rig is, and the stave's lean is set from the hand the painter solves, so
 * the bow stands the way it should whatever the wrist ends up doing.
 */

import { handGrip } from '../biped/limbs';
import { mixPt, offset, pt } from '../biped/geometry';
import { LONGBOW_BRACE_HEIGHT, LONGBOW_LIMB_LENGTH, LONGBOW_NOCKED } from '../biped/props/longbow';
import {
  type BodySide,
  buildSkeleton,
  type BipedPose,
  FULL_UPPER_ARM,
  restingPose,
  setArmAngles,
  VIEWS,
} from '../biped/rig';
import { type CardinalView } from '../../facingView';
import { deg, lerp, type Pt } from '../bipedArt';
import { armAnglesFor, armOf, type FistPlace, setArm } from './armedHold';
import { anglesThrough, frameValue, upperArmShareThrough } from './gaitShared';
import { PALM_TO_CAMERA, towards, turnHand } from './handTurn';
import type { Vec3 } from '../../held/heldPaint';
import { BOW_RELEASE_FRAME } from './timing';

// ── Holding the bow ──────────────────────────────────────────────────────────

/**
 * The bow hand's knuckles face the target, as a slingshot's fork hand's do:
 * edge-on the far hand shows its palm, head-on the back of the hand shows,
 * from behind the palm.
 */
const BOW_HAND_PALM: Readonly<Record<CardinalView, Vec3>> = {
  side: PALM_TO_CAMERA,
  front: towards(0.3, 0, -0.95),
  back: towards(0.3, 0, 0.95),
};

const UP = -Math.PI / 2;
const FULL_FIST = 1;
const RELAXED_FIST = 0.25;

/** How the stave stands while it is carried: the upper limb tipped forward, clear of the floor. */
const CARRY_LEAN: Readonly<Record<CardinalView, number>> = {
  side: deg(10),
  front: deg(-8),
  back: deg(8),
};

/** Where the string is, for a bow held but not drawn: none means braced, straight between the tips. */
interface StringHold {
  readonly tether?: Pt;
  readonly nocked: boolean;
}

/**
 * How far above the floor the lower tip stays: a bow carried low, or falling
 * with him, lies along the floor rather than through it.
 */
const TIP_FLOOR_CLEARANCE = 0.04;
/** The farthest a tip lies from the grip, braced. */
const TIP_REACH = LONGBOW_LIMB_LENGTH;

/**
 * `staveAngle` brought down toward level, about the grip at `grip`, as far as
 * keeps the lower tip off the floor (figure space: the ground is y = 0, up is
 * negative). The stave keeps its lean's side.
 */
function clearOfFloor(staveAngle: number, grip: Pt): number {
  const rise = -Math.sin(staveAngle);
  const room = Math.max(0, Math.min(1, (-grip.y - TIP_FLOOR_CLEARANCE) / TIP_REACH));
  if (Math.abs(rise) <= room) return staveAngle;
  const forward = Math.cos(staveAngle) >= 0 ? 1 : -1;
  return Math.atan2(-Math.sign(rise) * room, forward * Math.sqrt(1 - room * room));
}

/**
 * Closes the left fist on the bow with its stave at `staveAngle` on screen —
 * or, `relative`, turned that far from the fist's own haft — and the string
 * as `string` says.
 */
function gripBow(
  pose: BipedPose,
  view: CardinalView,
  staveAngle: number,
  string: StringHold,
  relative = false,
): void {
  pose.leftHandShape = 'grip';
  pose.leftFist = FULL_FIST;
  const grip = handGrip(buildSkeleton(pose, VIEWS[view]).leftArm);
  const onScreen = relative ? staveAngle + grip.haftAngle : staveAngle;
  pose.heldProps = [
    {
      kind: 'longbow',
      hand: 'left',
      angle: clearOfFloor(onScreen, grip.centre) - grip.haftAngle,
      ...(string.tether === undefined ? {} : { tether: string.tether }),
      ...(string.nocked ? { variant: LONGBOW_NOCKED } : {}),
    },
  ];
  turnHand(pose, 'left', BOW_HAND_PALM[view]);
}

/**
 * Where the bow fist is carried, from its shoulder joint, in the authored
 * frame (his right toward +X): edge-on a little ahead of the hip, so the
 * stave stands in front of his far leg rather than hidden behind him; head-on
 * and from behind out past the thigh, so the stave shows beside the leg.
 */
const CARRY_FIST: Readonly<Record<CardinalView, FistPlace>> = {
  side: { wrist: pt(0.32, 0.47), bend: 'down' },
  front: { wrist: pt(-0.17, 0.6), bend: 'up' },
  back: { wrist: pt(-0.17, 0.6), bend: 'up' },
};
/**
 * How much of the free arm's stride swing the bow arm keeps, and how much of
 * the forearm's turn the stave follows: a bow is long and carried steady, so
 * the hand swings a little and the stave tilts less.
 */
const CARRY_SWING_SHARE = 0.2;

/**
 * Where the bow fist goes as he flinches: out ahead of him and low, clear of
 * a body rocking back over the carry, and well below any aim.
 */
/**
 * How the stave leans as he flinches: edge-on tipped well forward, the bow
 * let down and away, so the hand coming up to his face does not read as the
 * draw; head-on as it is carried.
 */
export const FLINCH_BOW_LEAN: Readonly<Record<CardinalView, number>> = {
  side: deg(30),
  front: deg(-8),
  back: deg(8),
};
export const FLINCH_BOW_FIST: Readonly<Record<CardinalView, FistPlace>> = {
  side: { wrist: pt(0.5, 0.5), bend: 'down' },
  front: { wrist: pt(-0.26, 0.5), bend: 'down' },
  back: { wrist: pt(-0.26, 0.5), bend: 'down' },
};
const CARRY_STAVE_FOLLOW = 0.3;

/** How a carry differs from walking with the bow: see {@link carryBow}. */
export interface BowCarry {
  /** Share of the stride's swing the bow arm keeps; 0 holds it still while the rest of him moves. */
  readonly swingShare?: number;
  /** Where the bow fist is held from its shoulder, in place of the walking carry's. */
  readonly fist?: FistPlace;
  /** How far the stave leans off upright, in place of the walking carry's. */
  readonly lean?: number;
  /**
   * Head-on, the stave turned edge-on to the camera rather than showing its
   * curve: in a snap of the body the curve and the string read as two bows.
   */
  readonly edgeOn?: boolean;
}

/**
 * `pose` with the bow carried braced in his left fist. The fist is placed at
 * the carry and swung by a share of how far `pose`'s own left arm has swung
 * from where it hangs in `rest`, so the bow hand keeps the stride's rhythm.
 */
export function carryBow(
  pose: BipedPose,
  view: CardinalView,
  rest: BipedPose,
  hold: BowCarry = {},
): BipedPose {
  const swingShare = hold.swingShare ?? CARRY_SWING_SHARE;
  const lean = hold.lean ?? CARRY_LEAN[view];
  const carried = { ...pose };
  const base = armAnglesFor(hold.fist ?? CARRY_FIST[view]);
  const now = armOf(pose, view, 'left').angles;
  const still = armOf(rest, view, 'left').angles;
  const swingUpper = (now.upper - still.upper) * swingShare;
  const swingFore = (now.fore - still.fore) * swingShare;
  setArm(
    carried,
    view,
    'left',
    { upper: base.upper + swingUpper, fore: base.fore + swingFore, foreScale: base.foreScale },
    FULL_UPPER_ARM,
  );
  carried.leftArmBehind = rest.leftArmBehind;
  carried.leftHandDepth = rest.leftHandDepth;
  const staveAngle = UP + lean - swingFore * CARRY_STAVE_FOLLOW;
  const tether = hold.edgeOn === true ? undefined : braceToward(carried, view, staveAngle);
  gripBow(carried, view, staveAngle, { nocked: false, tether });
  return carried;
}

/**
 * Head-on, where the braced string of a bow carried at his side lies: off the
 * riser toward his middle, so the bow hangs with its belly to his leg and its
 * curve and string show rather than a straight stave edge-on. Edge-on the
 * string keeps its own side, toward his back.
 */
function braceToward(pose: BipedPose, view: CardinalView, staveAngle: number): Pt | undefined {
  if (VIEWS[view].profile) return undefined;
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const grip = handGrip(skeleton.leftArm).centre;
  const inward = Math.sign(skeleton.hip.x - grip.x) || 1;
  const across = { x: -Math.sin(staveAngle), y: Math.cos(staveAngle) };
  const toward = Math.sign(across.x) === inward ? 1 : -1;
  return {
    x: grip.x + across.x * toward * LONGBOW_BRACE_HEIGHT,
    y: grip.y + across.y * toward * LONGBOW_BRACE_HEIGHT,
  };
}

/**
 * `pose` with the bow still in his left fist as the rig's own arm takes it,
 * the stave turned with the fist from how it is carried: for a fall, where
 * the bow goes down with the hand and comes to lie along the floor.
 */
export function bowGoingDown(pose: BipedPose, view: CardinalView, rest: BipedPose): BipedPose {
  const falling = { ...pose, leftHandShape: 'grip' as const, leftFist: FULL_FIST };
  const restGrip = handGrip(buildSkeleton(carryBow(rest, view, rest), VIEWS[view]).leftArm);
  const carriedTurn = UP + CARRY_LEAN[view] - restGrip.haftAngle;
  gripBow(falling, view, carriedTurn, { nocked: false }, true);
  return falling;
}

// ── The shot ─────────────────────────────────────────────────────────────────

/** A frame's share of each motion, keyed by frame; the release starts from the anchor it was let go at. */
const RAISE_BY_FRAME: readonly number[] = [0.45, 0.8, 1, 1, 1, 1, 1, 1, 1, 0.72, 0.38, 0.12];
/**
 * How far the string is drawn: 0 braced at the riser, 1 at the anchor. The
 * arrow is set already a third drawn — taken off a barely drawn string it
 * stands its whole length out past the bow and reads as a spear — and eases
 * into the anchor against the stave's rising weight.
 */
const DRAW_BY_FRAME: readonly number[] = [0.3, 0.45, 0.66, 0.88, 1, 1, 1, 1, 1, 1, 1, 1];
/** How far the drawing hand flicks back past the anchor as the string leaves the fingers, 1 on the loose. */
const SNAP_BY_FRAME: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 1, 0.75, 0.45, 0.2, 0];
/** How far the drawing arm has come back down to hang at his side after the loose. */
const LOWER_BY_FRAME: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0.15, 0.5, 0.82, 1];
/** How far the bow hand kicks toward the target as the limbs spring forward, 1 on the loose. */
const KICK_BY_FRAME: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 1, 0.3, 0, 0, 0];

/** Squint and brow draw down as he sights down the arrow. */
const AIM_BROW = 0.9;
const AIM_SQUINT = 0.3;
const LOOSE_BROW = 0.6;
/** The elbow travels half as far as the wrist when the string leaves the fingers. */
const SNAP_ELBOW_SHARE = 0.5;

/** An arm placed by where its elbow and wrist are, in figure space; see `actionsSling.ts`. */
interface ArmPlace {
  readonly elbow: Pt;
  readonly wrist: Pt;
}

/**
 * Where everything sits in one view. The bow arm is a wrist target edge-on,
 * where it lies in the picture, or the whole arm placed head-on, where it
 * points at or away from the camera and only foreshortening shows it.
 */
interface BowStance {
  readonly view: CardinalView;
  readonly bowArm:
    | { readonly kind: 'wrist'; readonly aim: Pt; readonly low: Pt }
    | { readonly kind: 'arm'; readonly aim: ArmPlace; readonly low: ArmPlace };
  /** The drawing arm at full draw: the fist on the corner of the jaw, the elbow up and back. */
  readonly anchor: ArmPlace;
  /** The drawing arm at the string by the riser, from the bow hand's wrist. */
  readonly nock: ArmPlace;
  /** Where the drawing wrist flicks to on the loose, from the anchor. */
  readonly snap: Pt;
  /** Which way the bow hand jumps on the loose: toward the target. */
  readonly kick: Pt;
  /** The stave's angle on screen while it is aimed; raised from the carry's. */
  readonly staveAim: number;
  readonly leftFoot: Pt;
  readonly rightFoot: Pt;
  readonly lean: number;
  readonly crouch: number;
  readonly twist: number;
  readonly headTurn: number;
  readonly headTilt: number;
  readonly chinLift: number;
  readonly elbowFlare: number;
  /** Shooting away from the camera both hands are ahead of the face, on the far side of the body. */
  readonly armsBehind: boolean;
  /** Head-on legs are straight columns; edge-on they break at the knee. */
  readonly foreshorten: number;
}

/**
 * Profile, facing +X: side-on to the target, left foot forward, the bow arm
 * straight out at the shoulder with the stave canted a touch off upright. At
 * full draw the drawing elbow rides level with the shoulder and back behind
 * it, the silhouette that says "full draw" from across the room, and the
 * string runs from the tips to the jaw in a long, shallow V.
 */
const SIDE_STANCE: BowStance = {
  view: 'side',
  bowArm: { kind: 'wrist', aim: pt(0.66, -1.58), low: pt(0.5, -1.18) },
  anchor: { elbow: pt(-0.24, -1.58), wrist: pt(0.04, -1.68) },
  nock: { elbow: pt(-0.42, 0.17), wrist: pt(-0.17, -0.03) },
  snap: pt(-0.08, -0.02),
  kick: pt(0.025, -0.01),
  staveAim: UP + deg(8),
  leftFoot: pt(0.2, 0),
  rightFoot: pt(-0.17, 0),
  lean: deg(-3),
  crouch: 0.05,
  twist: 0,
  headTurn: 0.25,
  headTilt: deg(5),
  chinLift: 0,
  elbowFlare: 0.4,
  armsBehind: false,
  foreshorten: 0,
};

/**
 * Head-on, aiming at the camera: the bow arm points at the viewer, so the
 * fist and the riser stand in front of his left shoulder, the stave upright
 * and canted. The drawing elbow is out at shoulder height on his right, the
 * fist at his right jaw, and the string runs from the tips across to it.
 */
const FRONT_STANCE: BowStance = {
  view: 'front',
  bowArm: {
    kind: 'arm',
    aim: { elbow: pt(-0.46, -1.44), wrist: pt(-0.4, -1.6) },
    low: { elbow: pt(-0.42, -1.2), wrist: pt(-0.3, -1.3) },
  },
  anchor: { elbow: pt(0.56, -1.66), wrist: pt(0.16, -1.64) },
  nock: { elbow: pt(0.34, 0.12), wrist: pt(0.1, -0.06) },
  snap: pt(0.08, -0.02),
  kick: pt(0, 0.03),
  staveAim: UP - deg(20),
  leftFoot: pt(-0.17, 0),
  rightFoot: pt(0.17, 0),
  lean: 0,
  crouch: 0.04,
  twist: -0.35,
  headTurn: 0.1,
  headTilt: 0,
  chinLift: -0.15,
  elbowFlare: 0,
  armsBehind: false,
  foreshorten: 1,
};

/**
 * From behind, aiming away: the bow arm reaches away on the far side of his
 * head, so the upper limb stands up past his left ear and the lower limb
 * below his shoulder; what reads is the drawing elbow out at shoulder height
 * and the string from the tips to the fist behind his right cheek.
 */
const BACK_STANCE: BowStance = {
  ...FRONT_STANCE,
  view: 'back',
  bowArm: {
    kind: 'arm',
    aim: { elbow: pt(-0.46, -1.5), wrist: pt(-0.42, -1.62) },
    low: { elbow: pt(-0.42, -1.2), wrist: pt(-0.3, -1.3) },
  },
  anchor: { elbow: pt(0.56, -1.62), wrist: pt(0.16, -1.68) },
  kick: pt(0, -0.03),
  staveAim: UP + deg(22),
  twist: 0,
  headTurn: -0.1,
  armsBehind: true,
};

const STANCES: Readonly<Record<CardinalView, BowStance>> = {
  side: SIDE_STANCE,
  front: FRONT_STANCE,
  back: BACK_STANCE,
};

function placeArmThrough(pose: BipedPose, side: BodySide, shoulder: Pt, place: ArmPlace): void {
  const angles = anglesThrough(shoulder, place.elbow, place.wrist);
  setArmAngles(pose, side, angles, upperArmShareThrough(shoulder, place.elbow));
}

function mixPlace(a: ArmPlace, b: ArmPlace, t: number): ArmPlace {
  return { elbow: mixPt(a.elbow, b.elbow, t), wrist: mixPt(a.wrist, b.wrist, t) };
}

function shiftPlace(place: ArmPlace, by: Pt): ArmPlace {
  return { elbow: offset(place.elbow, by.x, by.y), wrist: offset(place.wrist, by.x, by.y) };
}

/** The drawing arm hanging at his side as it does standing, as an elbow and wrist. */
function hangingArm(view: CardinalView): ArmPlace {
  const skeleton = buildSkeleton(restingPose(), VIEWS[view]);
  return { elbow: skeleton.rightArm.joint, wrist: skeleton.rightArm.end };
}

function bowShotPose(stance: BowStance, frame: number): BipedPose {
  const pose = restingPose();
  const raise = frameValue(RAISE_BY_FRAME, frame);
  const draw = frameValue(DRAW_BY_FRAME, frame);
  const snap = frameValue(SNAP_BY_FRAME, frame);
  const lower = frameValue(LOWER_BY_FRAME, frame);
  const kick = frameValue(KICK_BY_FRAME, frame);
  const loosed = frame >= BOW_RELEASE_FRAME;

  pose.crouch = stance.crouch;
  pose.lean = stance.lean;
  pose.twist = stance.twist;
  pose.leftFoot = stance.leftFoot;
  pose.rightFoot = stance.rightFoot;
  pose.leftForeshorten = stance.foreshorten;
  pose.rightForeshorten = stance.foreshorten;
  pose.headTurn = stance.headTurn * raise;
  pose.headTilt = stance.headTilt * raise;
  pose.chinLift = stance.chinLift * raise;
  pose.elbowFlare = stance.elbowFlare;
  pose.leftArmBehind = stance.armsBehind;
  pose.rightArmBehind = stance.armsBehind;
  pose.brow = loosed ? LOOSE_BROW : AIM_BROW * raise;
  pose.blink = loosed ? 0 : AIM_SQUINT * draw;

  const shoulders = buildSkeleton(pose, VIEWS[stance.view]);
  const kickBy = pt(stance.kick.x * kick, stance.kick.y * kick);
  let bowWrist: Pt;
  if (stance.bowArm.kind === 'wrist') {
    bowWrist = mixPt(stance.bowArm.low, stance.bowArm.aim, raise);
    pose.leftHand = offset(bowWrist, kickBy.x, kickBy.y);
  } else {
    const bowArm = shiftPlace(mixPlace(stance.bowArm.low, stance.bowArm.aim, raise), kickBy);
    bowWrist = bowArm.wrist;
    placeArmThrough(pose, 'left', shoulders.leftArm.root, bowArm);
  }

  // The string is taken beside the riser wherever the bow is, so the nock
  // follows the bow up as it is raised.
  const atString = shiftPlace(stance.nock, bowWrist);
  const drawn = mixPlace(atString, stance.anchor, draw);
  const snapBy = pt(stance.snap.x * snap, stance.snap.y * snap);
  const flicked = {
    elbow: offset(drawn.elbow, snapBy.x * SNAP_ELBOW_SHARE, snapBy.y * SNAP_ELBOW_SHARE),
    wrist: offset(drawn.wrist, snapBy.x, snapBy.y),
  };
  const drawingArm = mixPlace(flicked, hangingArm(stance.view), lower);
  placeArmThrough(pose, 'right', shoulders.rightArm.root, drawingArm);
  pose.rightHandShape = loosed ? 'open' : 'grip';
  pose.rightFist = loosed ? RELAXED_FIST : FULL_FIST;

  const skeleton = buildSkeleton(pose, VIEWS[stance.view]);
  const carried = UP + CARRY_LEAN[stance.view];
  const staveAngle = lerp(carried, stance.staveAim, raise);
  if (loosed) {
    gripBow(pose, stance.view, staveAngle, { nocked: false });
  } else {
    gripBow(pose, stance.view, staveAngle, {
      tether: handGrip(skeleton.rightArm).centre,
      nocked: true,
    });
  }
  return pose;
}

/** The bow shot facing the camera, `frame` of the row's `BOW_SHOT_FRAMES`. */
export function bowShotFront(frame: number): BipedPose {
  return bowShotPose(STANCES.front, frame);
}

/** The bow shot in profile, facing +X. */
export function bowShotSide(frame: number): BipedPose {
  return bowShotPose(STANCES.side, frame);
}

/** The bow shot facing away from the camera. */
export function bowShotBack(frame: number): BipedPose {
  return bowShotPose(STANCES.back, frame);
}
