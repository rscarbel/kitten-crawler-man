/**
 * Carl's sideways strikes, thrown in profile from an orthodox guard: the jab,
 * the cross, the lead hook, the punt, the roundhouse, the knee and the shoulder
 * barge, plus the jab and the punt thrown on the run.
 *
 * Profile rows face +X with his left side away from the camera, so the left
 * hand and foot are the lead (the far limbs) and the right ones the rear (the
 * near limbs). Every standing strike starts on the settled guard and hands
 * back to it: anticipation is a frame or two, the blow lands on the row's
 * impact frame, and the recovery — slower than the strike — carries the
 * personality.
 *
 * Each row is keyed frame by frame. A strike is eight samples long, and what
 * a reader of the picture judges is exactly those eight poses, so the keys are
 * the poses themselves rather than a curve that happens to pass through them.
 */

import { HUMAN_SWING_FRAMES } from '../../../core/crawlerFormulas';
import { PLAYER_SPEED } from '../../../core/constants';
import { mixPt, offset, pt } from '../carl/geometry';
import { HEAD_RY } from '../carl/proportions';
import {
  type ArmAngles,
  type BoneChain,
  buildSkeleton,
  type CarlPose,
  FULL_UPPER_ARM,
  LEG_MAX_REACH,
  setArmAngles,
  type Skeleton,
  VIEWS,
} from '../carl/rig';
import { deg, type Pt } from '../carlArt';
import {
  ankleOverPivot,
  armLength,
  armReaching,
  type FrameTable,
  frameValue,
  HALF_CYCLE,
  profileFootTarget,
  RIGHT_ARM,
  runPhaseAt,
  soleOffsets,
} from './gaitShared';
import { guardSide } from './idles';
import { RUN_GROUND_PER_CYCLE_PX, RUN_TOE_OFF_PHASE, runSide } from './locomotion';
import { kickingLeg } from './travelling';
import { RUN_FRAMES } from './timing';

// ── Keyed tracks ─────────────────────────────────────────────────────────────

/**
 * How far a loose part trails a moving body, from the frame-to-frame change
 * of what drives it: hair and a jacket hem lag the torso by a frame, so they
 * point back along the way it just moved.
 */
function trail(track: FrameTable, frame: number, gain: number): number {
  return gain * (frameValue(track, frame - 1) - frameValue(track, frame));
}

// ── The guard every strike starts and ends on ────────────────────────────────

/**
 * The bottom of the guard's bounce. A fighter sinks onto his legs before he
 * throws, and at the bottom of the bounce both knees keep the bend they need
 * to drive from — at the top the rear leg is all but straight.
 */
const GUARD_SETTLED_PHASE = 0.5;

function settledGuard(): CarlPose {
  return guardSide(GUARD_SETTLED_PHASE);
}

const GUARD = settledGuard();
const GUARD_SKELETON = buildSkeleton(GUARD, VIEWS.side);
const GUARD_LEAD_WRIST = GUARD_SKELETON.leftArm.end;
const GUARD_REAR_WRIST = GUARD_SKELETON.rightArm.end;

/** A guard arm as joint angles, recovered from where the guard puts its hand. */
function guardAngles(arm: BoneChain): ArmAngles {
  const upper = Math.atan2(arm.joint.x - arm.root.x, arm.joint.y - arm.root.y);
  const fore = Math.atan2(arm.end.x - arm.joint.x, arm.end.y - arm.joint.y);
  return { upper, fore, foreScale: 1 };
}

const LEAD_GUARD_ANGLES = guardAngles(GUARD_SKELETON.leftArm);
const REAR_GUARD_ANGLES = guardAngles(GUARD_SKELETON.rightArm);

/** Where the ankle of a foot pinned at a floor target sits, at a pitch. */
function ankleOfTarget(target: Pt, pitch: number): Pt {
  const lift = profileFootTarget(pt(0, 0), pitch);
  return pt(target.x - lift.x, target.y - lift.y);
}

/** The floor point under each guard toe: a heel that lifts pivots about it. */
const GUARD_LEAD_TOE_X =
  ankleOfTarget(GUARD.leftFoot, GUARD.leftFootPitch).x + soleOffsets(GUARD.leftFootPitch).toe.x;
const GUARD_REAR_TOE_X =
  ankleOfTarget(GUARD.rightFoot, GUARD.rightFootPitch).x + soleOffsets(GUARD.rightFootPitch).toe.x;

/**
 * The guard as the strikes start from it: its rear heel rolled up about the
 * toe, so the toe stays on the floor where the heel pivots of every strike
 * keep it, rather than pitched about the foot's middle and sunk below it.
 */
function guardPose(): CarlPose {
  const pose = { ...GUARD };
  setFoot(pose, 'rear', onToes(GUARD_REAR_TOE_X, GUARD.rightFootPitch), GUARD.rightFootPitch);
  return pose;
}

// ── Limb placement ───────────────────────────────────────────────────────────

type Side = 'lead' | 'rear';

function skeletonOf(pose: CarlPose): Skeleton {
  return buildSkeleton(pose, VIEWS.side);
}

/**
 * A straight punch: the fist `share` of the arm's length from its shoulder,
 * `dip` radians below level. Solved against the pose's own shoulder, so the
 * lean and the shoulder turn carry the fist, and a share under one keeps the
 * elbow short of locking — a punch lands fully extended, never hyper-extended.
 */
function punchTarget(pose: CarlPose, side: Side, dip: number, share: number, upperScale = 1): Pt {
  const skeleton = skeletonOf(pose);
  const shoulder = side === 'lead' ? skeleton.leftArm.root : skeleton.rightArm.root;
  const reach = armLength(upperScale) * share;
  return offset(shoulder, Math.cos(dip) * reach, Math.sin(dip) * reach);
}

/**
 * Where the hand covering his face sits, in head radii from the head's
 * centre: in front of the jaw, so the chin tucks in behind the fist.
 */
const COVER_AHEAD_IN_HEAD_RADII = 0.9;
const COVER_BELOW_IN_HEAD_RADII = 0.75;
const COVER_AHEAD = HEAD_RY * COVER_AHEAD_IN_HEAD_RADII;
const COVER_BELOW = HEAD_RY * COVER_BELOW_IN_HEAD_RADII;

function coverTarget(pose: CarlPose): Pt {
  const head = skeletonOf(pose).headCentre;
  return offset(head, COVER_AHEAD, COVER_BELOW);
}

/** Places a hand on a target by the arm's joint angles, solved against the pose's own shoulder. */
function placeHand(pose: CarlPose, side: Side, target: Pt, upperScale = 1): void {
  const skeleton = skeletonOf(pose);
  // The hand target is kept in step with the angles that win over it, so
  // anything reading the pose's hand reads where the fist is drawn.
  if (side === 'lead') {
    setArmAngles(pose, 'left', armReaching(skeleton.leftArm.root, target, upperScale), upperScale);
    pose.leftHand = target;
  } else {
    setArmAngles(
      pose,
      'right',
      armReaching(skeleton.rightArm.root, target, upperScale),
      upperScale,
    );
    pose.rightHand = target;
  }
}

function guardWrist(side: Side): Pt {
  return side === 'lead' ? GUARD_LEAD_WRIST : GUARD_REAR_WRIST;
}

/**
 * Swings an arm, loose and nearly straight, `weight` of the way from `start`
 * (its guard, unless given) to `fromDown` radians forward of hanging (negative is back): a balancing
 * arm flung against a kick. Blended by joint angle rather than by hand
 * position, so the arm sweeps round its shoulder instead of folding up on the
 * straight line between the two hand positions.
 */
function swingArm(
  pose: CarlPose,
  side: Side,
  fromDown: number,
  weight: number,
  start: ArmAngles = side === 'lead' ? LEAD_GUARD_ANGLES : REAR_GUARD_ANGLES,
): void {
  const swung: ArmAngles = { upper: fromDown, fore: fromDown + SWUNG_ELBOW_BEND, foreScale: 1 };
  const angles: ArmAngles = {
    upper: start.upper + (swung.upper - start.upper) * weight,
    fore: start.fore + (swung.fore - start.fore) * weight,
    foreScale: 1,
  };
  setArmAngles(pose, side === 'lead' ? 'left' : 'right', angles);
}

/** A flung arm is loose, not locked: the elbow keeps a little bend. */
const SWUNG_ELBOW_BEND = deg(18);

/**
 * A straight punch `drive` of the way from its guard to full extension (below
 * zero it cocks back). The shoulder behind it reaches too: edge-on the rig
 * keeps both shoulders over the spine, buried inside the chest's outline, so
 * the upper arm is drawn longer by `shoulderDrive` of itself at full drive —
 * the extra length lies inside the chest, and what shows past it is a whole
 * arm leaving a shoulder turned into the blow.
 */
function throwStraight(
  pose: CarlPose,
  side: Side,
  dip: number,
  extension: number,
  drive: number,
  shoulderDrive: number,
): void {
  const upperScale = 1 + shoulderDrive * Math.max(0, drive);
  const target = punchTarget(pose, side, dip, extension, upperScale);
  placeHand(pose, side, mixPt(guardWrist(side), target, drive), upperScale);
}

/** A hand `weight` of the way from its guard to `target`; past 1 it overshoots, below 0 it cocks back. */
function handToward(pose: CarlPose, side: Side, target: Pt, weight: number): void {
  placeHand(pose, side, mixPt(guardWrist(side), target, weight));
}

/**
 * A kicking leg: the ankle `share` of the leg's full reach from its hip,
 * `dip` radians below level. Under one keeps the knee soft of locking and the
 * IK clear of clamping.
 */
function kickTarget(pose: CarlPose, side: Side, dip: number, share: number, pitch: number): Pt {
  const skeleton = skeletonOf(pose);
  const hip = side === 'lead' ? skeleton.leftLeg.root : skeleton.rightLeg.root;
  const reach = LEG_MAX_REACH * share;
  const ankle = offset(hip, Math.cos(dip) * reach, Math.sin(dip) * reach);
  return profileFootTarget(ankle, pitch);
}

/** A foot rolled up onto its toes by `pitch`, the toe staying where it stands on the floor. */
function onToes(toeX: number, pitch: number): Pt {
  return profileFootTarget(ankleOverPivot(toeX, 'toe', pitch), pitch);
}

function setFoot(pose: CarlPose, side: Side, target: Pt, pitch: number): void {
  if (side === 'lead') {
    pose.leftFoot = target;
    pose.leftFootPitch = pitch;
  } else {
    pose.rightFoot = target;
    pose.rightFootPitch = pitch;
  }
}

/** Rolls a guard foot onto its toes about its own toe, which stays planted. */
function pivotFoot(pose: CarlPose, side: Side, pitch: number): void {
  const toeX = side === 'lead' ? GUARD_LEAD_TOE_X : GUARD_REAR_TOE_X;
  setFoot(pose, side, onToes(toeX, pitch), pitch);
}

// ── The body's share of a blow ───────────────────────────────────────────────

/**
 * What the trunk does through a strike, as offsets from the guard. The
 * kinetic chain runs up from the floor, so each track peaks a frame after the
 * one below it: the hips (`sway`, `twist`) before the shoulders (`lean`)
 * before the fist.
 */
interface TrunkTracks {
  readonly crouch: FrameTable;
  readonly lean: FrameTable;
  readonly twist: FrameTable;
  readonly sway: FrameTable;
  readonly headTilt: FrameTable;
}

/**
 * How far the hair tips trail a change of lean (tiles per radian), and the
 * jacket hem a shift of the hips (tiles per unit of `sway`).
 */
const HAIR_TRAIL = 0.12;
const HEM_TRAIL = 0.08;

function applyTrunk(pose: CarlPose, frame: number, trunk: TrunkTracks): void {
  pose.crouch = GUARD.crouch + frameValue(trunk.crouch, frame);
  pose.lean = GUARD.lean + frameValue(trunk.lean, frame);
  pose.twist = GUARD.twist + frameValue(trunk.twist, frame);
  pose.sway = GUARD.sway + frameValue(trunk.sway, frame);
  pose.headTilt = GUARD.headTilt + frameValue(trunk.headTilt, frame);
  pose.hairTuftLag = pt(trail(trunk.lean, frame, HAIR_TRAIL), 0);
  pose.jacketHemLag = pt(trail(trunk.sway, frame, HEM_TRAIL), 0);
}

/** A strike's face: the brow sets and the mouth opens on the effort. */
function applyEffort(pose: CarlPose, frame: number, effort: FrameTable): void {
  const amount = frameValue(effort, frame);
  pose.brow = GUARD.brow + (1 - GUARD.brow) * amount;
  pose.mouth = EFFORT_MOUTH * amount;
}

const EFFORT_MOUTH = 0.5;
/** A clenched striking fist. */
const STRIKING_FIST = 1;

// ── Jab ──────────────────────────────────────────────────────────────────────

/**
 * The jab: the lead hand snapped straight out and back. Fast and light — the
 * body stays upright over its feet, the hips barely turn, the rear hand never
 * leaves the chin, and the fist is back at the guard before the recovery of
 * any other blow has begun. Everything the cross does with the body the jab
 * leaves out, which is what tells the two apart at a glance.
 */
const JAB_TRUNK: TrunkTracks = {
  crouch: [0, 0.02, 0.03, 0.03, 0.03, 0.03, 0.02, 0.01],
  lean: [0, 0, deg(3), deg(5), deg(6), deg(5), deg(2), 0],
  twist: [0, 0, -0.1, -0.2, -0.25, -0.2, -0.08, 0],
  sway: [0, 0, 0.08, 0.14, 0.16, 0.14, 0.06, 0],
  headTilt: [0, 0, deg(1), deg(2), deg(2), deg(2), deg(1), 0],
};
/** The lead fist from its guard to full extension: out in two frames, and snapped straight back. */
const JAB_DRIVE: FrameTable = [0, -0.05, 0.55, 0.92, 1, 0.45, 0.1, 0];
const JAB_EFFORT: FrameTable = [0, 0.2, 0.5, 0.8, 1, 0.6, 0.3, 0.1];
/** Thrown level at the head: the straightest line a punch can take. */
const JAB_DIP = deg(2);
const JAB_EXTENSION = 0.97;
/** The lead foot slides in the smallest of half steps, lifted just clear of the floor while it travels. */
const JAB_LEAD_STEP: FrameTable = [0, 0.02, 0.05, 0.07, 0.07, 0.06, 0.03, 0.01];
const JAB_LEAD_LIFT: FrameTable = [0, 0.02, 0.02, 0, 0, 0, 0.02, 0.01];

/**
 * A jab reaches with the shoulder, turned forward until it is the front of his
 * outline (see {@link throwStraight}). Buried a third of an arm inside the
 * chest, the lead shoulder needs the most of any blow.
 */
const JAB_SHOULDER_DRIVE = 0.6;

/** Carries the lead foot `step` ahead of its guard position and `lift` off the floor. */
function stepLead(pose: CarlPose, step: number, lift: number): void {
  setFoot(pose, 'lead', offset(GUARD.leftFoot, step, -lift), GUARD.leftFootPitch);
}

export function jabSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, JAB_TRUNK);
  applyEffort(pose, frame, JAB_EFFORT);
  stepLead(pose, frameValue(JAB_LEAD_STEP, frame), frameValue(JAB_LEAD_LIFT, frame));
  throwStraight(
    pose,
    'lead',
    JAB_DIP,
    JAB_EXTENSION,
    frameValue(JAB_DRIVE, frame),
    JAB_SHOULDER_DRIVE,
  );
  pose.leftFist = STRIKING_FIST;
  return pose;
}

// ── Cross ────────────────────────────────────────────────────────────────────

/**
 * The cross: the rear hand thrown the length of the body. The rear heel
 * pivots up and the rear leg straightens behind him, the hips turn square,
 * the weight rides forward over the bent lead knee and the rear shoulder
 * drives through, so on the blow the whole man is one line from the rear
 * heel to the fist. The lead hand comes back to cover the chin the fist has
 * just exposed.
 */
const CROSS_TRUNK: TrunkTracks = {
  crouch: [0, 0.04, 0.12, 0.2, 0.24, 0.24, 0.14, 0.04],
  lean: [0, -deg(4), deg(6), deg(18), deg(26), deg(26), deg(12), deg(3)],
  twist: [0, -0.35, 0.3, 0.9, 1.2, 1.2, 0.6, 0.12],
  sway: [0, -0.15, 0.25, 0.7, 0.95, 0.95, 0.45, 0.08],
  headTilt: [0, 0, deg(4), deg(8), deg(10), deg(10), deg(5), deg(1)],
};
/** The rear heel lifts and turns as the hip drives, a frame ahead of the shoulder. */
const CROSS_HEEL: FrameTable = [0, 0, deg(35), deg(60), deg(72), deg(72), deg(40), deg(15)];
/** A visible cock of the rear fist first, then the whole arm's length. */
const CROSS_DRIVE: FrameTable = [0, -0.25, 0.2, 0.7, 1, 0.98, 0.5, 0.12];
const CROSS_COVER: FrameTable = [0, 0.3, 0.7, 1, 1, 1, 0.7, 0.3];
const CROSS_EFFORT: FrameTable = [0, 0.3, 0.6, 0.9, 1, 1, 0.6, 0.25];
/**
 * Thrown a little down through a man-high target: the lean and the level
 * change bring the shoulder down to it, so the arm itself stays nearly level
 * and carries on the line of the body.
 */
const CROSS_DIP = deg(8);
/** The rear shoulder driving through behind the cross; see {@link throwStraight}. */
const CROSS_SHOULDER_DRIVE = 0.5;
/**
 * The lead foot slides in under the cross, further than under the jab: the
 * weight goes forward onto it. Lifted clear of the floor while it travels.
 */
const CROSS_LEAD_STEP: FrameTable = [0, 0, 0.12, 0.28, 0.32, 0.32, 0.18, 0.05];
const CROSS_LEAD_LIFT: FrameTable = [0, 0, 0.03, 0.01, 0, 0, 0.03, 0.02];
const CROSS_EXTENSION = 0.97;

export function crossSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, CROSS_TRUNK);
  applyEffort(pose, frame, CROSS_EFFORT);
  pivotFoot(pose, 'rear', GUARD.rightFootPitch + frameValue(CROSS_HEEL, frame));
  stepLead(pose, frameValue(CROSS_LEAD_STEP, frame), frameValue(CROSS_LEAD_LIFT, frame));
  throwStraight(
    pose,
    'rear',
    CROSS_DIP,
    CROSS_EXTENSION,
    frameValue(CROSS_DRIVE, frame),
    CROSS_SHOULDER_DRIVE,
  );
  handToward(pose, 'lead', coverTarget(pose), frameValue(CROSS_COVER, frame));
  pose.rightFist = STRIKING_FIST;
  pose.leftFist = STRIKING_FIST;
  return pose;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * The hook, thrown with the rear hand: the elbow locked at a right angle and
 * swung round by the hips rather than by the arm. It is the rear hand's
 * because edge-on the lead arm is the far one, painted behind his torso: its
 * hook would swing where nobody can see it.
 *
 * Edge-on most of the swing runs through depth, so the hook is told from the
 * cross by the two parts of it that show. First the load: the hips turn away,
 * the knees dip and the elbow is drawn back and up behind his shoulder, the
 * forearm level — a wing standing off his back. Then the blow: the elbow
 * comes round level with the shoulder and the forearm stands up and across
 * in front of him, a bent arm at head height where the cross is a straight
 * one, and the follow-through carries the fist on across his chest.
 */
const HOOK_TRUNK: TrunkTracks = {
  crouch: [0, 0.08, 0.14, 0.22, 0.26, 0.26, 0.14, 0.04],
  lean: [0, -deg(4), -deg(6), deg(4), deg(8), deg(8), deg(4), deg(1)],
  twist: [0, -0.5, -0.8, 0.3, 1.1, 1.3, 0.6, 0.1],
  sway: [0, -0.1, -0.12, 0.12, 0.26, 0.26, 0.12, 0.03],
  headTilt: [0, deg(3), deg(6), deg(10), deg(12), deg(12), deg(6), deg(1)],
};
/** The rear heel turns out as the hips go through, a frame ahead of the arm. */
const HOOK_REAR_HEEL: FrameTable = [0, 0, deg(10), deg(40), deg(55), deg(55), deg(30), deg(12)];
const HOOK_EFFORT: FrameTable = [0, 0.3, 0.6, 0.9, 1, 0.9, 0.5, 0.2];
/**
 * The hooking arm's joint angles, frame by frame: drawn back into the wing,
 * swung out to the side (the upper arm pointing into depth, so drawn short),
 * round level in front with the forearm standing up and across, then on
 * across the chest. At the blow the upper arm is drawn longer than itself for
 * the same reason as a straight punch's (see {@link throwStraight}): the elbow
 * has to clear the chest, or the hook is only a fist beside the chin.
 */
const HOOK_UPPER: FrameTable = [
  0,
  -deg(50),
  -deg(95),
  deg(20),
  deg(88),
  deg(100),
  deg(55),
  deg(25),
];
const HOOK_UPPER_SCALE: FrameTable = [1, 0.95, 1, 0.5, 1.15, 0.9, 0.95, 1];
const HOOK_FORE: FrameTable = [
  0,
  deg(115),
  deg(125),
  deg(100),
  deg(140),
  deg(172),
  deg(150),
  deg(158),
];
const HOOK_FORE_SCALE: FrameTable = [1, 1, 1, 0.9, 0.85, 0.6, 0.85, 0.95];
/** See {@link CROSS_LEAD_STEP}: the hook turns on the lead foot rather than stepping in. */
const HOOK_LEAD_STEP: FrameTable = [0, 0, 0.04, 0.1, 0.12, 0.12, 0.06, 0.01];
const HOOK_LEAD_LIFT: FrameTable = [0, 0, 0.02, 0, 0, 0, 0.02, 0.01];
/** How far the arm has left the guard: all the way through the blow, half back by the last frame. */
const HOOK_ARM_WEIGHT: FrameTable = [0, 1, 1, 1, 1, 1, 1, 0.5];
const HOOK_COVER: FrameTable = [0, 0.4, 0.8, 1, 1, 1, 0.7, 0.3];

function hookArm(frame: number): ArmAngles {
  const weight = frameValue(HOOK_ARM_WEIGHT, frame);
  const guard = REAR_GUARD_ANGLES;
  return {
    upper: guard.upper + (frameValue(HOOK_UPPER, frame) - guard.upper) * weight,
    fore: guard.fore + (frameValue(HOOK_FORE, frame) - guard.fore) * weight,
    foreScale: guard.foreScale + (frameValue(HOOK_FORE_SCALE, frame) - guard.foreScale) * weight,
  };
}

function hookUpperScale(frame: number): number {
  const weight = frameValue(HOOK_ARM_WEIGHT, frame);
  return FULL_UPPER_ARM + (frameValue(HOOK_UPPER_SCALE, frame) - FULL_UPPER_ARM) * weight;
}

export function hookSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, HOOK_TRUNK);
  applyEffort(pose, frame, HOOK_EFFORT);
  pivotFoot(pose, 'rear', GUARD.rightFootPitch + frameValue(HOOK_REAR_HEEL, frame));
  stepLead(pose, frameValue(HOOK_LEAD_STEP, frame), frameValue(HOOK_LEAD_LIFT, frame));
  if (frame > 0) setArmAngles(pose, 'right', hookArm(frame), hookUpperScale(frame));
  handToward(pose, 'lead', coverTarget(pose), frameValue(HOOK_COVER, frame));
  pose.leftFist = STRIKING_FIST;
  pose.rightFist = STRIKING_FIST;
  return pose;
}

// ── Punt ─────────────────────────────────────────────────────────────────────

/**
 * The punt: the canon rat-punting kick. Weight rocks onto the lead foot, the
 * rear knee chambers up in front of him, and the foot is driven out low —
 * knee-high on a man, which is where a rat or a grub actually is — then
 * carries on up through it before the knee folds back and the foot returns
 * to the guard.
 */
const PUNT_TRUNK: TrunkTracks = {
  crouch: [0, 0.04, 0.02, 0.04, 0.06, 0.06, 0.04, 0.01],
  lean: [0, deg(2), -deg(2), -deg(4), -deg(6), -deg(7), -deg(4), -deg(1)],
  twist: [0, -0.1, 0.1, 0.25, 0.3, 0.3, 0.15, 0.03],
  sway: [0, 0.1, 0.22, 0.3, 0.32, 0.3, 0.18, 0.05],
  headTilt: [0, 0, deg(2), deg(4), deg(6), deg(6), deg(3), deg(1)],
};
const PUNT_EFFORT: FrameTable = [0, 0.3, 0.6, 0.9, 1, 0.9, 0.5, 0.2];
/**
 * The kicking foot, frame by frame, from the guard: heel up, knee chambered
 * with the foot tucked under it, driving out, contact, the follow-through
 * rising, the knee folding back.
 */
const PUNT_FOOT_X: FrameTable = [0, 0, 0.05, 0.38, 0, 0, 0.22, -0.05];
const PUNT_FOOT_LIFT: FrameTable = [0, 0, 0.38, 0.34, 0, 0, 0.3, 0.06];
const PUNT_FOOT_PITCH: FrameTable = [
  0,
  deg(30),
  deg(40),
  deg(10),
  -deg(18),
  -deg(8),
  deg(28),
  deg(18),
];
/** On the contact and follow-through frames the leg is placed from the hip instead. */
const PUNT_CONTACT_FRAME = 4;
const PUNT_FOLLOW_FRAME = 5;
/**
 * Contact is well below the hip — a knee-high target. The frame after, the
 * knee is already folding the foot back in: the impact frame is the one the
 * leg is longest on, so the recoil lifts it only a little as it shortens.
 */
const PUNT_CONTACT_DIP = deg(42);
const PUNT_FOLLOW_DIP = deg(40);
const PUNT_EXTENSION = 0.99;
const PUNT_FOLLOW_EXTENSION = 0.84;
/**
 * Every kick off the rear leg first rocks the weight forward and peels the
 * rear heel up about its toe, one frame before the foot leaves the floor.
 */
const KICK_HEEL_UP_FRAME = 1;

/**
 * The kicking foot keyed as its ankle's offset from where it stands in the
 * guard, and its pitch — for the frames the leg is folded and the foot is
 * simply carried, rather than driven out along the leg.
 */
function kickingFoot(
  pose: CarlPose,
  frame: number,
  footX: FrameTable,
  lift: FrameTable,
  pitch: FrameTable,
): void {
  const ankle = pt(
    GUARD_REAR_ANKLE.x + frameValue(footX, frame),
    GUARD_REAR_ANKLE.y - frameValue(lift, frame),
  );
  setFoot(
    pose,
    'rear',
    profileFootTarget(ankle, frameValue(pitch, frame)),
    frameValue(pitch, frame),
  );
}

const GUARD_REAR_ANKLE = ankleOverPivot(GUARD_REAR_TOE_X, 'toe', GUARD.rightFootPitch);

export function puntSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, PUNT_TRUNK);
  applyEffort(pose, frame, PUNT_EFFORT);
  const pitch = frameValue(PUNT_FOOT_PITCH, frame);
  if (frame === PUNT_CONTACT_FRAME) {
    setFoot(pose, 'rear', kickTarget(pose, 'rear', PUNT_CONTACT_DIP, PUNT_EXTENSION, pitch), pitch);
  } else if (frame === PUNT_FOLLOW_FRAME) {
    setFoot(
      pose,
      'rear',
      kickTarget(pose, 'rear', PUNT_FOLLOW_DIP, PUNT_FOLLOW_EXTENSION, pitch),
      pitch,
    );
  } else if (frame === KICK_HEEL_UP_FRAME) {
    pivotFoot(pose, 'rear', pitch);
  } else if (frame > 0) {
    kickingFoot(pose, frame, PUNT_FOOT_X, PUNT_FOOT_LIFT, PUNT_FOOT_PITCH);
  }
  pose.rightKneeBreak = 1;
  // The arms open for balance against the leg: the lead hand stays up by the
  // face, the rear one swings back past the hip as the leg goes forward.
  swingArm(pose, 'rear', PUNT_REAR_ARM_BACK, frameValue(PUNT_ARM_SWING, frame));
  handToward(pose, 'lead', coverTarget(pose), frameValue(PUNT_ARM_SWING, frame));
  return pose;
}

const PUNT_ARM_SWING: FrameTable = [0, 0.2, 0.5, 0.85, 1, 1, 0.6, 0.2];
/** The rear arm swings back against the kicking leg, as a walking arm counters its leg. */
const PUNT_REAR_ARM_BACK = -deg(10);

// ── Roundhouse ───────────────────────────────────────────────────────────────

/**
 * The roundhouse: the standing foot pivots on its ball, the hip turns over,
 * and the rear leg whips round nearly straight, level at chest height, so the
 * shin lands. The torso leans hard away from the leg to balance it — the leg
 * and the body make one long line tipped over the standing foot — and the
 * rear arm is flung down and back. Everything the punt keeps low and close,
 * the roundhouse throws high and wide.
 */
const ROUNDHOUSE_TRUNK: TrunkTracks = {
  crouch: [0, 0.04, 0.06, 0.06, 0.06, 0.06, 0.05, 0.01],
  lean: [0, deg(2), -deg(10), -deg(22), -deg(32), -deg(30), -deg(14), -deg(3)],
  twist: [0, -0.2, 0.4, 0.9, 1.1, 1.1, 0.5, 0.1],
  sway: [0, 0.12, 0.2, 0.2, 0.15, 0.15, 0.12, 0.04],
  // The head stays level on the target while the body tips away under it.
  headTilt: [0, 0, deg(6), deg(14), deg(20), deg(20), deg(10), deg(2)],
};
const ROUNDHOUSE_EFFORT: FrameTable = [0, 0.3, 0.6, 0.9, 1, 0.9, 0.5, 0.2];
/** The standing (lead) foot turns on its ball as the hip comes over. */
const ROUNDHOUSE_LEAD_HEEL: FrameTable = [
  0,
  deg(6),
  deg(14),
  deg(20),
  deg(22),
  deg(22),
  deg(12),
  deg(3),
];
/**
 * The chamber carries the knee up high and forward with the foot trailing
 * behind it — the shin nearly level — which is what turns into the whip.
 */
const ROUNDHOUSE_FOOT_X: FrameTable = [0, 0.02, 0.15, 0.35, 0, 0, 0.3, -0.04];
const ROUNDHOUSE_FOOT_LIFT: FrameTable = [0, 0.04, 0.45, 0.85, 0, 0, 0.5, 0.05];
const ROUNDHOUSE_FOOT_PITCH: FrameTable = [
  0,
  deg(30),
  deg(60),
  deg(50),
  deg(20),
  deg(20),
  deg(35),
  deg(18),
];
const ROUNDHOUSE_CONTACT_FRAME = 4;
const ROUNDHOUSE_FOLLOW_FRAME = 5;
/** Negative dips rise above level: the shin lands at chest height. */
const ROUNDHOUSE_CONTACT_DIP = -deg(20);
const ROUNDHOUSE_FOLLOW_DIP = -deg(16);
const ROUNDHOUSE_EXTENSION = 0.97;
/** Past the contact the shin whips on through, the knee already folding it in. */
const ROUNDHOUSE_FOLLOW_EXTENSION = 0.86;
/** Flung down and back past the hip, the counterweight to the leg. */
const ROUNDHOUSE_REAR_ARM_BACK = -deg(35);
const ROUNDHOUSE_ARM_FLING: FrameTable = [0, 0.2, 0.55, 0.9, 1, 1, 0.55, 0.15];

export function roundhouseSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, ROUNDHOUSE_TRUNK);
  applyEffort(pose, frame, ROUNDHOUSE_EFFORT);
  pivotFoot(pose, 'lead', frameValue(ROUNDHOUSE_LEAD_HEEL, frame));
  const pitch = frameValue(ROUNDHOUSE_FOOT_PITCH, frame);
  if (frame === ROUNDHOUSE_CONTACT_FRAME) {
    setFoot(
      pose,
      'rear',
      kickTarget(pose, 'rear', ROUNDHOUSE_CONTACT_DIP, ROUNDHOUSE_EXTENSION, pitch),
      pitch,
    );
  } else if (frame === ROUNDHOUSE_FOLLOW_FRAME) {
    setFoot(
      pose,
      'rear',
      kickTarget(pose, 'rear', ROUNDHOUSE_FOLLOW_DIP, ROUNDHOUSE_FOLLOW_EXTENSION, pitch),
      pitch,
    );
  } else if (frame === KICK_HEEL_UP_FRAME) {
    pivotFoot(pose, 'rear', pitch);
  } else if (frame > 0) {
    kickingFoot(pose, frame, ROUNDHOUSE_FOOT_X, ROUNDHOUSE_FOOT_LIFT, ROUNDHOUSE_FOOT_PITCH);
  }
  pose.rightKneeBreak = 1;
  const fling = frameValue(ROUNDHOUSE_ARM_FLING, frame);
  swingArm(pose, 'rear', ROUNDHOUSE_REAR_ARM_BACK, fling);
  handToward(pose, 'lead', coverTarget(pose), fling);
  pose.leftFist = STRIKING_FIST;
  return pose;
}

// ── Knee ─────────────────────────────────────────────────────────────────────

/**
 * The knee strike: both hands reach out to a clinch on the head or the
 * scruff and haul it down as the rear knee drives straight up to meet it —
 * the knee rising past the hip to the chest, the hips thrust in under a torso
 * that leans back off them, and the standing foot up on its toes. The two
 * arms reaching long and pulling down to a knee higher than the hip is what
 * no chamber for a stomp or a kick has.
 */
const KNEE_TRUNK: TrunkTracks = {
  crouch: [0, 0.04, 0, -0.02, -0.03, -0.03, 0, 0.01],
  lean: [0, deg(8), deg(6), -deg(4), -deg(10), -deg(10), -deg(2), deg(1)],
  twist: [0, -0.05, 0.1, 0.25, 0.3, 0.3, 0.15, 0.03],
  sway: [0, 0.1, 0.25, 0.4, 0.5, 0.5, 0.25, 0.05],
  headTilt: [0, deg(4), deg(10), deg(16), deg(20), deg(20), deg(10), deg(2)],
};
const KNEE_EFFORT: FrameTable = [0, 0.3, 0.6, 0.9, 1, 0.9, 0.5, 0.2];
/** The standing foot rises onto its ball under the drive. */
const KNEE_LEAD_HEEL: FrameTable = [0, 0, deg(8), deg(16), deg(20), deg(20), deg(10), deg(3)];
/** The knee's foot: tucked under and behind the knee as it rises, toes pointed down. */
const KNEE_FOOT_X: FrameTable = [0, 0, 0.2, 0.45, 0.6, 0.58, 0.25, -0.02];
const KNEE_FOOT_LIFT: FrameTable = [0, 0, 0.3, 0.55, 0.72, 0.68, 0.3, 0.04];
const KNEE_FOOT_PITCH: FrameTable = [
  0,
  deg(25),
  deg(50),
  deg(62),
  deg(68),
  deg(68),
  deg(40),
  deg(18),
];
/** Both hands: out to the clinch, then hauled down to meet the knee. */
const KNEE_REACH: FrameTable = [0, 0.8, 1, 0.6, 0.2, 0.1, 0.4, 0.15];
const KNEE_HAUL: FrameTable = [0, 0, 0.1, 0.55, 1, 1.05, 0.5, 0.1];
/**
 * The clinch is on the head of whatever he fights, out in front of him at
 * arm's length, and is hauled down only as far as the rising knee: the hands
 * stop just above it, so the gap between them is where the enemy is.
 */
const KNEE_CLINCH_AHEAD = 0.75;
const KNEE_CLINCH_HEIGHT = -1.82;
const KNEE_HAULED_AHEAD = 0.62;
const KNEE_HAULED_HEIGHT = -1.42;
const CLINCH_FIST = 0.7;
/** The two hands of the clinch: the lead a little further round the head than the rear. */
const CLINCH_LEAD_OFFSET: Pt = pt(0.04, 0);
const CLINCH_REAR_OFFSET: Pt = pt(-0.02, 0.02);

export function kneeSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, KNEE_TRUNK);
  applyEffort(pose, frame, KNEE_EFFORT);
  pivotFoot(pose, 'lead', frameValue(KNEE_LEAD_HEEL, frame));
  if (frame === KICK_HEEL_UP_FRAME) {
    pivotFoot(pose, 'rear', frameValue(KNEE_FOOT_PITCH, frame));
  } else if (frame > 0) {
    kickingFoot(pose, frame, KNEE_FOOT_X, KNEE_FOOT_LIFT, KNEE_FOOT_PITCH);
  }
  pose.rightKneeBreak = 1;
  const reach = frameValue(KNEE_REACH, frame);
  const haul = frameValue(KNEE_HAUL, frame);
  const clinch = pt(KNEE_CLINCH_AHEAD, KNEE_CLINCH_HEIGHT);
  const hauled = pt(KNEE_HAULED_AHEAD, KNEE_HAULED_HEIGHT);
  const hands = mixPt(clinch, hauled, haul);
  const blend = Math.min(1, reach + haul);
  handToward(pose, 'lead', offset(hands, CLINCH_LEAD_OFFSET.x, CLINCH_LEAD_OFFSET.y), blend);
  handToward(pose, 'rear', offset(hands, CLINCH_REAR_OFFSET.x, CLINCH_REAR_OFFSET.y), blend);
  pose.leftFist = CLINCH_FIST;
  pose.rightFist = CLINCH_FIST;
  return pose;
}

// ── Shoulder barge ───────────────────────────────────────────────────────────

/**
 * The shoulder barge, a combo's finisher: a long step in on the lead foot, the
 * hips turned through, and the whole body dropped low and pitched forward
 * behind the point of the shoulder and elbow — a lunge, the rear leg driving
 * straight behind him, the head tucked in behind the shoulder, the other fist
 * at the chin. Then he pushes back off the lead foot to his guard.
 */
const BARGE_TRUNK: TrunkTracks = {
  crouch: [0, 0.1, 0.22, 0.34, 0.4, 0.4, 0.2, 0.04],
  lean: [0, deg(6), deg(16), deg(28), deg(36), deg(35), deg(16), deg(3)],
  twist: [0, -0.1, 0.3, 0.7, 1, 0.95, 0.45, 0.08],
  sway: [0, 0.1, 0.5, 1.1, 1.5, 1.45, 0.6, 0.08],
  // The chin tucks back in behind the driving shoulder, so the point of the
  // shoulder, not the face, is the front of him.
  headTilt: [0, 0, -deg(6), -deg(12), -deg(16), -deg(16), -deg(7), 0],
};
const BARGE_EFFORT: FrameTable = [0, 0.4, 0.7, 0.9, 1, 1, 0.6, 0.2];
/** The step in: lead foot lifted, carried well forward, planted, then back. */
const BARGE_LEAD_STEP: FrameTable = [0, 0.08, 0.28, 0.5, 0.5, 0.5, 0.24, 0.04];
const BARGE_LEAD_LIFT: FrameTable = [0, 0.07, 0.09, 0, 0, 0, 0.07, 0.02];
/** The rear leg drives straight behind him, up on the ball of its foot. */
const BARGE_REAR_HEEL: FrameTable = [
  0,
  deg(5),
  deg(25),
  deg(50),
  deg(62),
  deg(62),
  deg(30),
  deg(10),
];
/**
 * The driving arm folds into a battering ram: the elbow forward level with
 * the chest, the forearm folded flat back across the belly, so the point of
 * the shoulder and elbow leads the whole body in. It is the rear (near) arm,
 * the hips turned through to square that shoulder up: edge-on the lead arm is
 * painted behind his torso, and a ram nobody can see is a man ducking. The
 * fist stays low, well under the chin: a fist up by the face reads as a man
 * covering up, not driving in.
 */
const BARGE_RAM_UPPER: FrameTable = [
  0,
  deg(30),
  deg(55),
  deg(72),
  deg(80),
  deg(80),
  deg(55),
  deg(35),
];
const BARGE_RAM_FORE: FrameTable = [
  0,
  deg(175),
  deg(230),
  deg(262),
  deg(275),
  deg(275),
  deg(225),
  deg(175),
];
/** Folded across the belly the forearm points into depth, across his body, so it draws short. */
const BARGE_RAM_FORE_SCALE: FrameTable = [1, 1, 0.8, 0.6, 0.5, 0.5, 0.8, 1];
const BARGE_RAM_WEIGHT: FrameTable = [0, 1, 1, 1, 1, 1, 1, 0.5];
/**
 * The far arm is flung back behind him as he drives off the rear foot: the
 * charge's momentum, and no second fist up by the face to read as a block.
 */
const BARGE_LEAD_ARM_BACK = -deg(35);
const BARGE_LEAD_ARM_FLING: FrameTable = [0, 0.3, 0.7, 1, 1, 1, 0.6, 0.2];

function bargeRamArm(frame: number): ArmAngles {
  const weight = frameValue(BARGE_RAM_WEIGHT, frame);
  const guard = REAR_GUARD_ANGLES;
  return {
    upper: guard.upper + (frameValue(BARGE_RAM_UPPER, frame) - guard.upper) * weight,
    fore: guard.fore + (frameValue(BARGE_RAM_FORE, frame) - guard.fore) * weight,
    foreScale:
      guard.foreScale + (frameValue(BARGE_RAM_FORE_SCALE, frame) - guard.foreScale) * weight,
  };
}

export function bargeSide(frame: number): CarlPose {
  const pose = guardPose();
  applyTrunk(pose, frame, BARGE_TRUNK);
  applyEffort(pose, frame, BARGE_EFFORT);
  stepLead(pose, frameValue(BARGE_LEAD_STEP, frame), frameValue(BARGE_LEAD_LIFT, frame));
  pivotFoot(pose, 'rear', GUARD.rightFootPitch + frameValue(BARGE_REAR_HEEL, frame));
  if (frame > 0) pose.rightArmAngles = bargeRamArm(frame);
  swingArm(pose, 'lead', BARGE_LEAD_ARM_BACK, frameValue(BARGE_LEAD_ARM_FLING, frame));
  pose.leftFist = STRIKING_FIST;
  pose.rightFist = STRIKING_FIST;
  return pose;
}

// ── Strikes thrown on the run ────────────────────────────────────────────────

/**
 * A strike thrown on the move lasts the swing's ticks while he covers the
 * ground the run covers in that time, so its legs step through that many run
 * frames — one per row frame, the pace the foot-slip gate carries every
 * travelling row at.
 */
export const RUNNING_STRIKE_FRAMES = Math.round(
  (HUMAN_SWING_FRAMES * PLAYER_SPEED) / (RUN_GROUND_PER_CYCLE_PX / RUN_FRAMES),
);
/** The hit lands halfway through the swing, whatever the row's length. */
export const RUNNING_STRIKE_IMPACT_FRAME = Math.floor(RUNNING_STRIKE_FRAMES / 2);

/**
 * The running strikes' tracks are keyed one value a frame over a nine-frame
 * swing with the hit on its middle frame. The row is as many frames as the run
 * steps through in a swing, so it samples them at its own frame's share of the
 * swing: the hit still lands on the middle, whatever the row's length.
 */
function runningAt(track: FrameTable, frame: number): number {
  const position = (frame * (track.length - 1)) / (RUNNING_STRIKE_FRAMES - 1);
  const below = Math.min(Math.floor(position), track.length - 1);
  const above = Math.min(below + 1, track.length - 1);
  return track[below] + (track[above] - track[below]) * (position - below);
}

/** The run phase a strike thrown on the run, begun at `entry`, hands the legs back at. */
export function runningStrikeExitPhase(entry: number): number {
  return runPhaseAt(entry, RUNNING_STRIKE_FRAMES - 1);
}

/** How much of the strike the upper body has taken over from the run's arms, per frame. */
const RUNNING_JAB_BLEND: FrameTable = [0, 0.45, 0.85, 1, 1, 1, 0.75, 0.4, 0];
const RUNNING_JAB_DRIVE: FrameTable = [0, -0.05, 0.35, 0.8, 1, 0.97, 0.55, 0.2, 0];
/**
 * The rear fist tucks in under the chin, a little behind and below where the
 * lead fist starts from, so the two do not paint on top of each other.
 */
const RUNNING_REAR_COVER_OFFSET: Pt = pt(-0.06, 0.04);
const RUNNING_JAB_TWIST: FrameTable = [0, -0.05, -0.15, -0.3, -0.38, -0.38, -0.2, -0.08, 0];
/**
 * He leans into the jab on the run: the lead arm is the far one, painted
 * behind his chest, so only what the lean carries past the chest shows.
 */
const RUNNING_JAB_LEAN: FrameTable = [0, 0, deg(3), deg(8), deg(11), deg(10), deg(5), deg(2), 0];

function runWrists(pose: CarlPose): { lead: Pt; rear: Pt } {
  const skeleton = skeletonOf(pose);
  return { lead: skeleton.leftArm.end, rear: skeleton.rightArm.end };
}

/**
 * The jab thrown on the run, its legs the run's own from `entry` on. Only the
 * arms and shoulders strike, so every entry throws the same punch over
 * whichever step the stride is in.
 */
export function jabRunSide(frame: number, entry: number): CarlPose {
  const pose = runSide(runPhaseAt(entry, frame));
  const blend = runningAt(RUNNING_JAB_BLEND, frame);
  if (blend <= 0) return pose;
  const running = runWrists(pose);
  pose.twist += runningAt(RUNNING_JAB_TWIST, frame);
  pose.lean += runningAt(RUNNING_JAB_LEAN, frame);
  const drive = runningAt(RUNNING_JAB_DRIVE, frame);
  const chamber = coverTarget(pose);
  const upperScale = 1 + JAB_SHOULDER_DRIVE * Math.max(0, drive) * blend;
  const extended = punchTarget(pose, 'lead', JAB_DIP, JAB_EXTENSION, upperScale);
  const fist = mixPt(chamber, extended, drive);
  placeHand(pose, 'lead', mixPt(running.lead, fist, blend), upperScale);
  const rearCover = offset(chamber, RUNNING_REAR_COVER_OFFSET.x, RUNNING_REAR_COVER_OFFSET.y);
  placeHand(pose, 'rear', mixPt(running.rear, rearCover, blend));
  pose.leftFist = STRIKING_FIST;
  pose.rightFist = STRIKING_FIST;
  pose.elbowFlare = GUARD.elbowFlare;
  pose.brow = GUARD.brow;
  pose.mouth = EFFORT_MOUTH * blend;
  return pose;
}

/**
 * The running punt swings a leg through as the other is planted under him, so
 * it lands at the middle of the planted foot's stance: the kicking leg is then
 * this far round its own cycle, half a cycle on from the other's mid-stance.
 */
const PUNT_KICKING_LEG_PHASE = HALF_CYCLE + RUN_TOE_OFF_PHASE / 2;

/**
 * The run's own swing already throws the heel up behind him, which is the
 * punt's draw-back; the kick takes the leg over from there, drives it through
 * low, and folds it back in to rejoin the stride.
 */
const RUNNING_PUNT_BLEND: FrameTable = [0, 0, 0.3, 0.8, 1, 1, 0.8, 0.4, 0];
const RUNNING_PUNT_DIP: FrameTable = [
  0,
  0,
  deg(50),
  deg(44),
  deg(40),
  deg(38),
  deg(36),
  deg(38),
  0,
];
const RUNNING_PUNT_REACH: FrameTable = [0, 0, 0.8, 0.9, 0.97, 0.84, 0.8, 0.78, 0];
const RUNNING_PUNT_LEAN: FrameTable = [
  0,
  0,
  -deg(2),
  -deg(4),
  -deg(6),
  -deg(7),
  -deg(4),
  -deg(1),
  0,
];
const RUNNING_PUNT_ARMS: FrameTable = [0, 0.2, 0.5, 0.85, 1, 1, 0.7, 0.35, 0];
const RUNNING_PUNT_PITCH = -deg(10);
/**
 * Kicked with the far leg, the punt is painted behind the near one, which is
 * mid-stride under him: at the same height and lean it reads as one more long
 * running step. So the far leg kicks higher, and he leans back further off it.
 */
const FAR_LEG_PUNT_RAISE = deg(10);
const FAR_LEG_PUNT_LEAN_BACK = -deg(5);
/** The arms open against the kick: the one on the kicking side flung back, the other out in front. */
const RUNNING_PUNT_KICKING_SIDE_ARM = -deg(45);
const RUNNING_PUNT_OTHER_ARM = deg(55);

/** Which profile side, lead or rear, a run foot's sign is. */
function sideOf(sign: number): Side {
  return sign === RIGHT_ARM ? 'rear' : 'lead';
}

/** Which foot, as `placeFoot`'s sign, the running punt begun at `entry` kicks with. */
export function puntRunKickingSide(entry: number): number {
  return kickingLeg(
    (frame) => runPhaseAt(entry, frame),
    Array.from({ length: RUNNING_STRIKE_FRAMES }, (_unused, frame) =>
      runningAt(RUNNING_PUNT_BLEND, frame),
    ),
    RUNNING_STRIKE_IMPACT_FRAME,
    PUNT_KICKING_LEG_PHASE,
  ).side;
}

/**
 * The punt thrown on the run, its legs the run's own from `entry` on. The
 * kick is made with whichever leg's own swing is nearest the phase the punt
 * lands at, so the draw-back is always that leg's own recovery rather than a
 * planted foot torn off the floor.
 */
export function puntRunSide(frame: number, entry: number): CarlPose {
  const phase = runPhaseAt(entry, frame);
  const pose = runSide(phase);
  const kicking = sideOf(puntRunKickingSide(entry));
  const other: Side = kicking === 'rear' ? 'lead' : 'rear';
  const arms = runningAt(RUNNING_PUNT_ARMS, frame);
  if (arms > 0) {
    const running = { lead: pose.leftArmAngles, rear: pose.rightArmAngles };
    const kickingArm = running[kicking];
    const otherArm = running[other];
    if (kickingArm !== null)
      swingArm(pose, kicking, RUNNING_PUNT_KICKING_SIDE_ARM, arms, kickingArm);
    if (otherArm !== null) swingArm(pose, other, RUNNING_PUNT_OTHER_ARM, arms, otherArm);
  }
  const blend = runningAt(RUNNING_PUNT_BLEND, frame);
  if (blend <= 0) return pose;
  const farLeg = kicking === 'lead';
  pose.lean += runningAt(RUNNING_PUNT_LEAN, frame) + (farLeg ? FAR_LEG_PUNT_LEAN_BACK * blend : 0);
  const kick = kickTarget(
    pose,
    kicking,
    runningAt(RUNNING_PUNT_DIP, frame) - (farLeg ? FAR_LEG_PUNT_RAISE * blend : 0),
    runningAt(RUNNING_PUNT_REACH, frame),
    RUNNING_PUNT_PITCH,
  );
  const strideFoot = kicking === 'rear' ? pose.rightFoot : pose.leftFoot;
  const runPitch = kicking === 'rear' ? pose.rightFootPitch : pose.leftFootPitch;
  setFoot(
    pose,
    kicking,
    mixPt(strideFoot, kick, blend),
    runPitch + (RUNNING_PUNT_PITCH - runPitch) * blend,
  );
  if (kicking === 'rear') pose.rightFootPlanted = false;
  else pose.leftFootPlanted = false;
  pose.brow = GUARD.brow;
  pose.mouth = EFFORT_MOUTH * blend;
  return pose;
}
