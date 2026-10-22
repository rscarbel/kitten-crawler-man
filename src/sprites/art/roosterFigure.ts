/**
 * The roosters as painted figures: the choreography, the row table, the cell
 * geometry, the held-dumbbell anchors, gore placement and the three
 * `FigureDef`s the runtime cache and the review harness draw through.
 *
 * Anatomy and paint live in `roosterArt.ts` and `rooster/`; the severed pieces
 * in `roosterGore.ts`. This module poses.
 *
 * Two mechanisms meet in every row. Below the waist he moves like a bird: the
 * walk lifts each foot high, folds the shank back at the ankle and curls the
 * toes shut as the foot leaves the floor, and the head holds still in space
 * while the body walks under it, then snaps forward — the head-bob is what a
 * fowl's walk is, frame for frame, in Muybridge's plates. Above the waist he
 * moves like a man: the arms swing from the shoulder by joint angles, as
 * Carl's do (`human/locomotion.ts`), and every strike is a fist or a held
 * weapon driven to a target. The gait is paced by ground covered: a stance
 * foot slides back through the cell at a constant rate, so a planted foot holds
 * its place on the floor while the sprite carries him.
 *
 * Every pose is an edit of the resting pose. One-shots are keyframed: each key
 * is a whole pose and the row eases between them, so an impact frame is a key
 * the row passes through rather than an extreme it happens to reach.
 */

import { clamp01, deg, easeInOut, lerp } from './carlArt';
import {
  type ArmAngles,
  ELBOW_IN,
  ELBOW_OUT,
  type FootPose,
  HEAD_ON_HAND_HANG,
  PROFILE_HAND_HANG,
  type Pt,
  ROOSTER_BUILD_SPECS,
  type RoosterBuild,
  type RoosterPose,
  type RoosterView,
  SHOULDER_HALF,
  SHOULDER_Y,
  beakTipOffset,
  eyeOffset,
  headToFigure,
  mixPt,
  ROOSTER_TILE_SCALE,
  VIEWS,
  buildRoosterSkeleton,
  cellPxPerRigUnit,
  tilesPerRigUnit,
  drawRooster,
  fistCentre,
  handAngle,
  pt,
  restingPose,
  standingFoot,
} from './roosterArt';
import { type RoosterGorePiece, roosterGorePieces } from './roosterGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Row table ────────────────────────────────────────────────────────────────

export type RoosterRowBase =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'carry_walk'
  | 'peck'
  | 'punch'
  | 'club_swing'
  | 'throw'
  | 'slam'
  | 'pickup'
  | 'crow';

type RowKind = 'loop' | 'oneShot';

/** What the runtime needs to know about one row, whatever view it is drawn in. */
interface RoosterRowTiming {
  readonly frames: number;
  readonly kind: RowKind;
  /**
   * The frame a blow lands, a dumbbell leaves the hand, a dumbbell is taken
   * off the rack, or the crow peaks. Absent on rows with no such moment.
   */
  readonly impactFrame?: number;
}

/**
 * The one place the rows' lengths and their impact frames are written down.
 * The choreography keys its strikes on these frames, the art gates assert each
 * strike peaks on its frame, and gameplay derives its wind-up and hit ticks
 * from {@link rowImpactProgress} — so a retune here moves all three together.
 */
export const ROOSTER_ROW_TIMING: Readonly<Record<RoosterRowBase, RoosterRowTiming>> = {
  idle: { frames: 8, kind: 'loop' },
  walk: { frames: 16, kind: 'loop' },
  sprint: { frames: 12, kind: 'loop' },
  carry_walk: { frames: 16, kind: 'loop' },
  peck: { frames: 8, kind: 'oneShot', impactFrame: 4 },
  punch: { frames: 8, kind: 'oneShot', impactFrame: 4 },
  club_swing: { frames: 10, kind: 'oneShot', impactFrame: 6 },
  throw: { frames: 10, kind: 'oneShot', impactFrame: 5 },
  slam: { frames: 12, kind: 'oneShot', impactFrame: 6 },
  pickup: { frames: 6, kind: 'oneShot', impactFrame: 3 },
  crow: { frames: 10, kind: 'oneShot', impactFrame: 5 },
};

/** The rows each build paints. The minions have no dumbbell work and no slam. */
const ROOSTER_BUILD_ROWS: Readonly<Record<RoosterBuild, readonly RoosterRowBase[]>> = {
  big: [
    'idle',
    'walk',
    'sprint',
    'carry_walk',
    'peck',
    'punch',
    'club_swing',
    'throw',
    'slam',
    'pickup',
    'crow',
  ],
  little: ['idle', 'walk', 'peck', 'punch'],
  bent: ['idle', 'walk', 'peck', 'punch'],
};

/** Halfway into a frame, so a progress lands on it under `floor(progress × frames)`. */
const MID_FRAME = 0.5;

/**
 * How far through a one-shot its impact frame is drawn, as the 0–1 progress
 * the runtime passes in: the middle of the impact frame, so rounding cannot
 * land the hit a frame early or late.
 */
export function rowImpactProgress(base: RoosterRowBase): number {
  const timing = ROOSTER_ROW_TIMING[base];
  if (timing.impactFrame === undefined) return 0;
  return (timing.impactFrame + MID_FRAME) / timing.frames;
}

export const ROOSTER_VIEWS: readonly RoosterView[] = ['front', 'side', 'back'];

/** A row's state name in a view: the head-on front row is bare, the others suffixed. */
export function roosterStateName(base: RoosterRowBase, view: RoosterView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'back') return `${base}_away`;
  return base;
}

// ── Keyframes ────────────────────────────────────────────────────────────────

function lerpFoot(a: FootPose, b: FootPose, t: number): FootPose {
  return {
    forward: lerp(a.forward, b.forward, t),
    lift: lerp(a.lift, b.lift, t),
    curl: lerp(a.curl, b.curl, t),
    lateral: lerp(a.lateral, b.lateral, t),
    planted: t < MID_FRAME ? a.planted : b.planted,
  };
}

function lerpAngles(a: ArmAngles | null, b: ArmAngles | null, t: number): ArmAngles | null {
  if (a === null || b === null) return t < MID_FRAME ? a : b;
  return {
    upper: lerp(a.upper, b.upper, t),
    fore: lerp(a.fore, b.fore, t),
    foreScale: lerp(a.foreScale, b.foreScale, t),
  };
}

/** Every continuous field eased between two poses; flags switch at the midpoint. */
function blendPose(a: RoosterPose, b: RoosterPose, t: number): RoosterPose {
  const n = (key: NumericField): number => lerp(a[key], b[key], t);
  return {
    bob: n('bob'),
    sway: n('sway'),
    lean: n('lean'),
    roll: n('roll'),
    crouch: n('crouch'),
    rise: n('rise'),
    chestPuff: n('chestPuff'),
    shrug: n('shrug'),
    twist: n('twist'),
    headShift: mixPt(a.headShift, b.headShift, t),
    headPitch: n('headPitch'),
    headTurn: n('headTurn'),
    beakOpen: n('beakOpen'),
    blink: n('blink'),
    hackleLift: n('hackleLift'),
    wattleLag: n('wattleLag'),
    tailLift: n('tailLift'),
    tailSwing: n('tailSwing'),
    leftHand: mixPt(a.leftHand, b.leftHand, t),
    rightHand: mixPt(a.rightHand, b.rightHand, t),
    leftArmAngles: lerpAngles(a.leftArmAngles, b.leftArmAngles, t),
    rightArmAngles: lerpAngles(a.rightArmAngles, b.rightArmAngles, t),
    leftFist: n('leftFist'),
    rightFist: n('rightFist'),
    elbowFlare: t < MID_FRAME ? a.elbowFlare : b.elbowFlare,
    leftArmBehind: t < MID_FRAME ? a.leftArmBehind : b.leftArmBehind,
    rightArmBehind: t < MID_FRAME ? a.rightArmBehind : b.rightArmBehind,
    headOverArms: t < MID_FRAME ? a.headOverArms : b.headOverArms,
    leftUpperArmScale: n('leftUpperArmScale'),
    rightUpperArmScale: n('rightUpperArmScale'),
    leftFoot: lerpFoot(a.leftFoot, b.leftFoot, t),
    rightFoot: lerpFoot(a.rightFoot, b.rightFoot, t),
  };
}

type NumericField = {
  [K in keyof RoosterPose]: RoosterPose[K] extends number ? K : never;
}[keyof RoosterPose];

/** A whole pose at a moment of a one-shot, given as a frame of the row. */
interface Key {
  readonly frame: number;
  readonly pose: RoosterPose;
}

/** The pose at `frame`, eased between the keys either side of it. */
function keyed(keys: readonly Key[], frame: number): RoosterPose {
  if (frame <= keys[0].frame) return keys[0].pose;
  for (let i = 1; i < keys.length; i++) {
    const before = keys[i - 1];
    const after = keys[i];
    if (frame > after.frame) continue;
    const t = (frame - before.frame) / (after.frame - before.frame);
    return blendPose(before.pose, after.pose, easeInOut(t));
  }
  return keys[keys.length - 1].pose;
}

/**
 * How far into its first move a one-shot already is on its first frame. A row
 * that starts on the idle's own picture and ends on it paints the same frame
 * twice, and the start is a frame the player never sees move.
 */
const SHOT_START_SHARE = 0.3;
/** One frame before the end a one-shot is this far home, so the hand-off is not crammed into the last step. */
const SHOT_SETTLE_SHARE = 0.86;

/**
 * A one-shot from its keys: the first frame already leaning into the first
 * move, and a settling key one frame from the end, so the recovery approaches
 * the pose it hands to rather than snapping onto it. `shapeHandOff` reshapes
 * those two in-between frames, for a move whose straight blend between the
 * idle and its first key passes through a pose of its own.
 */
function settledShot(
  keys: readonly Key[],
  shapeHandOff: (leaving: RoosterPose) => RoosterPose = (leaving) => leaving,
): (frame: number) => RoosterPose {
  const first = keys[0];
  const second = keys[1];
  const last = keys[keys.length - 1];
  const beforeLast = keys[keys.length - 2];
  const shaped: Key[] = [
    {
      frame: first.frame,
      pose: shapeHandOff(blendPose(first.pose, second.pose, SHOT_START_SHARE)),
    },
    ...keys.slice(1, -1),
  ];
  if (last.frame - 1 > beforeLast.frame) {
    shaped.push({
      frame: last.frame - 1,
      pose: shapeHandOff(blendPose(beforeLast.pose, last.pose, SHOT_SETTLE_SHARE)),
    });
  }
  shaped.push(last);
  return (frame) => keyed(shaped, frame);
}

// ── Gait ─────────────────────────────────────────────────────────────────────

const FULL_TURN = Math.PI * 2;
/** Where in the stride a gait row's first frame sits, as a share of the cycle. */
const GAIT_ROW_OFFSET = 0.25;
/** The left foot is half a cycle behind the right. */
const HALF_CYCLE = 0.5;
/** A swinging foot's lift is fuller than a plain arch: it rises quickly and holds. */
const SWING_LIFT_FULLNESS = 0.8;
/** Swung forward, an edge-on forearm curls in by half its bend again. */
const FORWARD_ELBOW_CURL = 0.5;
/** Head-on only part of the elbow's bend shows; the forearm's inward swing is twice the upper arm's. */
const HEAD_ON_ELBOW_SHOWN = 0.4;
const HEAD_ON_FOREARM_INWARD = 2;
/** Head-on the running neck's stretch shows as half its drop. */
const HEAD_ON_SPRINT_NECK_SHARE = 0.5;

interface GaitSpec {
  /** How far each foot travels either side of the hip through stance. */
  readonly stride: number;
  /** The share of the cycle each foot is down. */
  readonly stance: number;
  /** How high the swinging foot lifts at its highest. */
  readonly lift: number;
  /** How far the toes curl shut at their tightest through the swing. */
  readonly curl: number;
}

/**
 * A walking leg is barely longer than the hip is high, so the stride is held
 * where the leg still reaches a foot planted at either end of it with the hip
 * at its walking height; a foot set further out clamps the IK and the step
 * reads as a hop.
 */
const WALK: GaitSpec = { stride: 0.23, stance: 0.62, lift: 0.22, curl: 0.95 };
/** A run: a longer stride and less of it on the floor, so both feet leave it between steps. */
const SPRINT: GaitSpec = { stride: 0.4, stance: 0.42, lift: 0.3, curl: 0.8 };
/**
 * Little Rooster walks up to a fight at nearly Big Rooster's pace on legs half
 * as long, so his steps are a scrappy cockerel's: longer for his size, and
 * springier, each foot spending less of the cycle down and lifting higher.
 * Paced by the ground covered, a short stride at his speed would play faster
 * than one frame a tick.
 */
const LITTLE_WALK: GaitSpec = { stride: 0.25, stance: 0.5, lift: 0.28, curl: 0.95 };
const WALK_BY_BUILD: Readonly<Record<RoosterBuild, GaitSpec>> = {
  big: WALK,
  little: LITTLE_WALK,
  bent: WALK,
};
/** Where in the swing the toes are curled tightest: just after they leave the floor. */
const CURL_PEAK = 0.35;
/** By here the toes have opened again to meet the floor. */
const CURL_OPEN_BY = 0.85;

/**
 * One foot at `phase` (0 at its own contact). Through stance it slides back at
 * the constant rate the body is carried over the floor; through swing it lifts,
 * folds the shank up behind it, curls its toes shut, and reaches forward again.
 */
function footAt(phase: number, gait: GaitSpec): FootPose {
  const p = ((phase % 1) + 1) % 1;
  if (p < gait.stance) {
    const t = p / gait.stance;
    return {
      forward: lerp(gait.stride, -gait.stride, t),
      lift: 0,
      curl: 0,
      lateral: 0,
      planted: true,
    };
  }
  const t = (p - gait.stance) / (1 - gait.stance);
  const curlRise = clamp01(t / CURL_PEAK);
  const curlFall = clamp01((CURL_OPEN_BY - t) / (CURL_OPEN_BY - CURL_PEAK));
  return {
    forward: lerp(-gait.stride, gait.stride, easeInOut(t)),
    lift: Math.sin(t * Math.PI) ** SWING_LIFT_FULLNESS * gait.lift,
    curl: gait.curl * Math.min(curlRise, curlFall),
    lateral: 0,
    planted: false,
  };
}

function groundPerCycle(gait: GaitSpec): number {
  return (2 * gait.stride) / gait.stance;
}

/** Ground one cycle of a build's gait covers, in rig units: what the stance foot slides back while down. */
export function gaitGroundPerCycle(build: RoosterBuild, gait: 'walk' | 'sprint'): number {
  return groundPerCycle(gait === 'walk' ? WALK_BY_BUILD[build] : SPRINT);
}

/** The share of each step the head holds still in space before it snaps forward. */
const HEAD_HOLD_SHARE = 0.7;

/**
 * The head-bob, along the way he walks, against the trunk. Through the hold the
 * head stays put on the floor while the trunk walks under it, so against the
 * trunk it slides back at the walking rate; then it snaps forward past the
 * trunk to its next hold.
 */
function headBob(phase: number, groundPerCycle: number): number {
  const stepPhase = (((phase * 2) % 1) + 1) % 1;
  const travel = (groundPerCycle / 2) * HEAD_HOLD_SHARE;
  if (stepPhase < HEAD_HOLD_SHARE) return travel * (MID_FRAME - stepPhase / HEAD_HOLD_SHARE);
  const thrust = (stepPhase - HEAD_HOLD_SHARE) / (1 - HEAD_HOLD_SHARE);
  return travel * (easeInOut(thrust) - MID_FRAME);
}

/** The hip drops onto each planted leg: the pelvis vaults over the stance foot. */
const WALK_DROP = 0.035;
const WALK_CROUCH = 0.05;
const WALK_LEAN = deg(5);
/** Head-on the hips shift over the planted foot. */
const WALK_SWAY = 0.035;
/** Edge-on arm swing, from the shoulder: a lifter's swing is short and wide. */
const WALK_ARM_SWING = deg(22);
const WALK_ELBOW = deg(24);
/** Arms swing a little further forward than back. */
const ARM_FORWARD_SHARE = 0.55;
/** Head-on the arms hang out off the lats and swing in toward the centreline coming forward. */
const HEAD_ON_ARM_OUT = deg(13);
const HEAD_ON_ARM_INWARD = deg(5);
const HEAD_ON_ELBOW = deg(14);
/** A forearm swung at the camera draws shorter. */
const HEAD_ON_FORE_FORESHORTEN = 0.18;
const CARRY_SWING_SHARE = 0.35;
const CARRY_ELBOW = deg(32);
const CLOSED_FIST = 1;
const TAIL_LAG = 0.6;

function armSwing(forward: number, amplitude: number): number {
  const share = forward >= 0 ? ARM_FORWARD_SHARE : 1 - ARM_FORWARD_SHARE;
  return forward * amplitude * share * 2;
}

/** A profile arm swung from the shoulder: forward is +X. */
function profileArm(forward: number, amplitude: number, elbow: number): ArmAngles {
  const upper = armSwing(forward, amplitude);
  return {
    upper,
    fore: upper + elbow + Math.max(0, forward) * elbow * FORWARD_ELBOW_CURL,
    foreScale: 1,
  };
}

/**
 * A head-on arm. `side` is +1 for his right (authored at +X). Forward swing is
 * depth the camera cannot see, so it shows as the forearm drawing shorter and
 * the hand swinging in toward the centreline — a remap of the swing, never a
 * rectified one, or each arm makes two inward trips a stride.
 */
function headOnArm(side: number, forward: number, amplitude: number, elbow: number): ArmAngles {
  const inward = ((forward + 1) / 2) * HEAD_ON_ARM_INWARD * (amplitude / WALK_ARM_SWING);
  const out = HEAD_ON_ARM_OUT - inward;
  return {
    upper: side * out,
    fore: side * (out - elbow * HEAD_ON_ELBOW_SHOWN) - side * inward * HEAD_ON_FOREARM_INWARD,
    foreScale: 1 - Math.max(0, forward) * HEAD_ON_FORE_FORESHORTEN * (amplitude / WALK_ARM_SWING),
  };
}

function gaitPose(
  view: RoosterView,
  phase: number,
  gait: GaitSpec,
  options: { readonly carry: boolean; readonly sprint: boolean; readonly build: RoosterBuild },
): RoosterPose {
  const rest = restingPose(view);
  const profile = view === 'side';
  const carriage = ROOSTER_BUILD_SPECS[options.build].carriage;
  const right = footAt(phase, gait);
  const left = footAt(phase + HALF_CYCLE, gait);
  const contact = (Math.cos(phase * FULL_TURN * 2) + 1) / 2;
  const angle = phase * FULL_TURN;
  const rightForward = -Math.cos(angle);
  const leftForward = Math.cos(angle);
  const swing = options.sprint ? SPRINT_ARM_SWING : WALK_ARM_SWING;
  const elbow = options.sprint ? SPRINT_ELBOW : WALK_ELBOW;
  const ground = groundPerCycle(gait);
  const bob = options.sprint ? 0 : headBob(phase, ground);
  // He rolls further over onto his listing side than back up off it.
  const rollWave = Math.sin(angle);
  const lopsided =
    carriage.bodyRoll > 0
      ? rollWave *
        LOPSIDED_ROLL *
        (rollWave > 0 ? LOPSIDED_LIST_SHARE : 1 - LOPSIDED_LIST_SHARE) *
        2
      : 0;
  const rocking = carriage.bodyRoll > 0 ? Math.sin(angle) * LOPSIDED_ROCK : 0;
  const headLag = carriage.bodyRoll > 0 ? -Math.sin(angle - TAIL_LAG) * LOPSIDED_HEAD_LAG : 0;

  const rightArm = options.carry
    ? profile
      ? profileArm(rightForward * CARRY_SWING_SHARE, swing, CARRY_ELBOW)
      : headOnArm(1, rightForward * CARRY_SWING_SHARE, swing, CARRY_ELBOW)
    : profile
      ? profileArm(rightForward, swing, elbow)
      : headOnArm(1, rightForward, swing, elbow);
  const leftArm = profile
    ? profileArm(leftForward, swing, elbow)
    : headOnArm(-1, leftForward, swing, elbow);

  const sprint = options.sprint;
  return {
    ...rest,
    bob: sprint ? SPRINT_BOB * Math.cos(angle * 2) : WALK_DROP * contact * carriage.bounce,
    sway: profile ? 0 : WALK_SWAY * Math.cos(angle),
    lean: sprint ? SPRINT_LEAN : WALK_LEAN + (profile ? rocking : 0),
    roll: lopsided,
    crouch: sprint ? SPRINT_CROUCH : WALK_CROUCH,
    headShift: profile
      ? pt(bob + (sprint ? SPRINT_NECK.x : 0), sprint ? SPRINT_NECK.y : 0)
      : pt(
          headLag,
          sprint ? SPRINT_NECK.y * HEAD_ON_SPRINT_NECK_SHARE : Math.max(0, -bob) * HEAD_ON_BOB_DIP,
        ),
    headPitch: sprint ? SPRINT_HEAD_PITCH : 0,
    wattleLag: profile ? -bob * WATTLE_FOLLOW : 0,
    tailLift: sprint ? SPRINT_TAIL_LIFT : Math.sin(angle * 2 - TAIL_LAG) * WALK_TAIL_BOUNCE,
    tailSwing: Math.sin(angle - TAIL_LAG),
    leftArmAngles: leftArm,
    rightArmAngles: rightArm,
    leftFist: sprint ? CLOSED_FIST : rest.leftFist,
    rightFist: options.carry || sprint ? CLOSED_FIST : rest.rightFist,
    leftFoot: left,
    rightFoot: right,
  };
}

const SPRINT_ARM_SWING = deg(32);
const SPRINT_ELBOW = deg(70);
const SPRINT_LEAN = deg(20);
const SPRINT_CROUCH = 0.17;
const SPRINT_BOB = 0.03;
/** Running, the neck stretches out ahead and down. */
const SPRINT_NECK = pt(0.3, 0.2);
const SPRINT_HEAD_PITCH = deg(10);
/** The tail streams out behind, dropped toward level. */
const SPRINT_TAIL_LIFT = deg(-22);
const WALK_TAIL_BOUNCE = deg(3);
/** Head-on the snap forward reads as the head dipping a little. */
const HEAD_ON_BOB_DIP = 0.25;
/** The wattles swing back as the head snaps forward. */
const WATTLE_FOLLOW = 4;
/**
 * A battered bird swaggers: he rolls from side to side as he walks, rocks
 * fore and aft once a stride rather than once a step, so his two steps are
 * not alike, and his head swings a beat behind his body.
 */
const LOPSIDED_ROLL = deg(8);
const LOPSIDED_ROCK = deg(6);
const LOPSIDED_HEAD_LAG = 0.06;
/** The share of the roll's swing that goes over toward his listing side. */
const LOPSIDED_LIST_SHARE = 0.75;

// ── Idle ─────────────────────────────────────────────────────────────────────

const BREATH_PUFF = 0.35;
const BREATH_LIFT = 0.015;
/** The idle flexes: the elbows pump a little and the fists clench with the breath. */
const IDLE_FLEX = deg(10);
/** Edge-on the head cocks round toward the camera and back: a bird looking with each eye. */
const IDLE_PROFILE_LOOK = deg(-38);
const IDLE_HEAD_TILT = deg(6);
/**
 * Head-on the head snaps round and back, staying on the side his body is
 * turned to: facing the camera it turns toward full profile, and from behind
 * further away, so the back of the skull is all that shows. Flipping across to
 * look with the other eye passes through square-on, where the comb shrinks to
 * a blade and the beak to a dot; from behind, turning toward profile puts his
 * face on the back of the figure.
 */
const HEAD_ON_LOOK_SHARE = 0.8;
function headOnLook(view: RoosterView): number {
  const rest = VIEWS[view].headTurn;
  const toward = rest < Math.PI / 2 ? Math.PI / 2 : Math.PI;
  return (toward - rest) * HEAD_ON_LOOK_SHARE;
}
const IDLE_WOBBLE = deg(6);
const IDLE_WATTLE_SWING = 0.3;
/** Standing, the far arm hangs a little forward and the near one a little back, both slightly bent. */
const IDLE_FAR_ARM_FORWARD = 0.15;
const IDLE_FAR_ELBOW = deg(8);
const IDLE_NEAR_ARM_FORWARD = -0.1;
const IDLE_NEAR_ARM_SWING = 0.3;
const IDLE_NEAR_ELBOW = deg(12);
const IDLE_HEAD_ON_ARM_BACK = -0.2;
/** The fists clench as he breathes in and loosen to this as he breathes out. */
const IDLE_LOOSE_FIST = 0.5;
/**
 * A bouncing build bounces twice a breath: up onto the tips of his toes, then
 * down onto bent legs. The lift is a rise on the toes, which raises the hips
 * and the ankles together, rather than a hop: his legs are near full reach
 * standing, and lifting the hips alone would clamp them straight.
 */
const BOUNCE_DIP = 0.04;
const BOUNCE_RISE = 0.115;
const BLINK_FRAME = 6;
const IDLE_BREATH_OFFSET = 0.25;
const IDLE_FOOT_STAGGER = 0.14;
/** The tail sways once a breath, lagging it: any faster the long sickles flicker. */
const IDLE_TAIL_SWAY = 0.25;

/**
 * The head's turn through the idle: two quick frames round, a beat looking one
 * way, two quick frames back, a beat the other way. Quick rather than eased: a
 * bird's head does not drift. The seam falls on a held look, because the breath
 * is at its fastest there and carries the step on its own.
 */
function idleLook(frame: number): number {
  const KEYS = [0, 0.45, 0.9, 1, 1, 0.55, 0.1, 0];
  return KEYS[frame % KEYS.length];
}

/** The idle's hanging arm, swung by its joints. `side` is +1 for his right. */
function hangingArmAngles(view: RoosterView, side: -1 | 1, flex: number): ArmAngles {
  if (view !== 'side') {
    return headOnArm(side, IDLE_HEAD_ON_ARM_BACK, WALK_ARM_SWING, HEAD_ON_ELBOW + flex);
  }
  return side < 0
    ? profileArm(IDLE_FAR_ARM_FORWARD, 0, IDLE_FAR_ELBOW + flex)
    : profileArm(
        IDLE_NEAR_ARM_FORWARD,
        WALK_ARM_SWING * IDLE_NEAR_ARM_SWING,
        IDLE_NEAR_ELBOW + flex,
      );
}

/**
 * Whether this build waits in his guard in this view. From behind, fists at
 * his chin are hidden by his back and a raised guard held up beside his head
 * on short arms lies level with his shoulders, a pair of spread wings; there
 * his arms hang.
 */
function waitsFistsUp(view: RoosterView, build: RoosterBuild): boolean {
  return ROOSTER_BUILD_SPECS[build].carriage.fistsUp && view !== 'back';
}

/**
 * A scrapper waits with his fists up in his guard, riding the breath. Edge-on
 * an arm hanging straight down his side lies flat against the round body
 * where a folded wing would.
 */
const WAITING_GUARD_WIDTH = 0.85;
const WAITING_GUARD_DROP = 0.3;
const WAITING_GUARD_REACH = 0.3;

function fistsUpIdle(
  view: RoosterView,
  rest: RoosterPose,
  handLift: (hand: Pt) => Pt,
): Pick<RoosterPose, 'leftHand' | 'rightHand' | 'leftArmAngles' | 'rightArmAngles' | 'elbowFlare'> {
  const ready = guard(view, rest);
  // Head-on his waiting guard is held wide, each fist in front of its own
  // shoulder: tucked together under his chin the two arms merge into one
  // lump on his chest.
  // Edge-on his fists stand out ahead of his breast: folded flat against his
  // chest a short arm is a folded wing.
  const leftHand =
    view === 'side'
      ? pt(ready.leftHand.x + WAITING_GUARD_REACH, ready.leftHand.y + WAITING_GUARD_DROP)
      : pt(-SHOULDER_HALF * WAITING_GUARD_WIDTH, SHOULDER_Y + WAITING_GUARD_DROP);
  const rightHand =
    view === 'side'
      ? pt(ready.rightHand.x + WAITING_GUARD_REACH, ready.rightHand.y + WAITING_GUARD_DROP)
      : pt(SHOULDER_HALF * WAITING_GUARD_WIDTH, SHOULDER_Y + WAITING_GUARD_DROP);
  return {
    leftHand: handLift(leftHand),
    rightHand: handLift(rightHand),
    leftArmAngles: null,
    rightArmAngles: null,
    elbowFlare: ready.elbowFlare,
  };
}

function idlePose(view: RoosterView, frame: number, build: RoosterBuild): RoosterPose {
  const rest = restingPose(view);
  const carriage = ROOSTER_BUILD_SPECS[build].carriage;
  const frames = ROOSTER_ROW_TIMING.idle.frames;
  // The breath is a quarter turn in at the row's first frame, so its seam is
  // mid-breath rather than two frames resting at the bottom of one.
  const angle = (frame / frames + IDLE_BREATH_OFFSET) * FULL_TURN;
  const breath = (1 - Math.cos(angle)) / 2;
  const look = idleLook(frame);
  const profile = view === 'side';
  const flex = breath * IDLE_FLEX;
  const bounce = carriage.bounce;
  const handLift = (hand: Pt): Pt => pt(hand.x, hand.y - breath * BREATH_LIFT * 2);
  return {
    ...rest,
    bob: -breath * BREATH_LIFT + Math.abs(Math.sin(angle)) * (bounce - 1) * BOUNCE_DIP,
    rise: Math.abs(Math.cos(angle)) * (bounce - 1) * BOUNCE_RISE,
    roll: carriage.bodyRoll > 0 ? Math.sin(angle) * IDLE_WOBBLE : 0,
    // Edge-on a battered bird's wobble shows as a rock fore and aft.
    lean: profile && carriage.bodyRoll > 0 ? Math.sin(angle) * IDLE_WOBBLE : 0,
    chestPuff: rest.chestPuff + breath * BREATH_PUFF,
    headTurn: profile ? look * IDLE_PROFILE_LOOK : look * headOnLook(view),
    headPitch: profile ? -look * IDLE_HEAD_TILT : 0,
    headShift: pt(0, -breath * BREATH_LIFT),
    blink: frame === BLINK_FRAME ? 1 : 0,
    wattleLag: Math.sin(angle * 2) * IDLE_WATTLE_SWING,
    tailLift: Math.sin(angle - TAIL_LAG) * deg(2),
    tailSwing: Math.sin(angle - TAIL_LAG) * IDLE_TAIL_SWAY,
    ...(waitsFistsUp(view, build)
      ? fistsUpIdle(view, rest, handLift)
      : {
          leftHand: handLift(rest.leftHand),
          rightHand: handLift(rest.rightHand),
          leftArmAngles: hangingArmAngles(view, -1, flex),
          rightArmAngles: hangingArmAngles(view, 1, flex),
        }),
    leftFist: waitsFistsUp(view, build) ? CLOSED_FIST : lerp(IDLE_LOOSE_FIST, CLOSED_FIST, breath),
    rightFist:
      build === 'big' || waitsFistsUp(view, build)
        ? CLOSED_FIST
        : lerp(IDLE_LOOSE_FIST, CLOSED_FIST, breath),
    // Edge-on he stands with his far foot a little back, so both legs show.
    leftFoot: profile ? { ...standingFoot(), forward: -IDLE_FOOT_STAGGER } : rest.leftFoot,
    rightFoot: profile ? { ...standingFoot(), forward: IDLE_FOOT_STAGGER / 2 } : rest.rightFoot,
  };
}

// ── Strikes ──────────────────────────────────────────────────────────────────

/** The idle's first frame, which every one-shot ends on so the hand-off is not a snap. */
function settle(view: RoosterView, build: RoosterBuild): RoosterPose {
  return idlePose(view, 0, build);
}

/** Overrides on top of the idle, for writing keys briefly. */
function edit(base: RoosterPose, changes: Partial<RoosterPose>): RoosterPose {
  return { ...base, ...changes };
}

/**
 * A hand taken over by a target hangs a hair short of where its angles put it:
 * a strike that leans the trunk back carries the shoulder away from the hand,
 * and a target at full reach would clamp the arm straight.
 */
const IK_HANG_REACH_SHARE = 0.985;

/**
 * The same pose with its arms placed by hand targets where its joint angles put
 * the hands. The idle swings its arms by angle and a one-shot reaches by
 * target; converting rather than swapping keeps a strike's first and last
 * frames on the idle's own arms instead of popping to a different hang.
 */
function ikArms(pose: RoosterPose, view: RoosterView, build: RoosterBuild): RoosterPose {
  const skeleton = buildRoosterSkeleton(pose, view, ROOSTER_BUILD_SPECS[build]);
  const authored = (p: Pt): Pt => (view === 'front' ? pt(-p.x, p.y) : p);
  // A turned body carries each arm across the picture with its shoulder; the
  // pose's targets are written square-on, so the carry comes back off.
  // A shorter arm's target is drawn that share of the way from its shoulder,
  // so a step of the drawn hand is a longer step of the written target.
  const armLength = ROOSTER_BUILD_SPECS[build].proportions.armLength;
  const slackened = (chain: { root: Pt; end: Pt }, drawnTarget: Pt, poseTarget: Pt): Pt => {
    const drawn = authored(mixPt(chain.root, chain.end, IK_HANG_REACH_SHARE));
    const carried = authored(drawnTarget);
    return pt(
      poseTarget.x + (drawn.x - carried.x) / armLength,
      poseTarget.y + (drawn.y - carried.y) / armLength,
    );
  };
  return {
    ...pose,
    leftArmAngles: null,
    rightArmAngles: null,
    leftHand: slackened(skeleton.leftArm, skeleton.leftHandTarget, pose.leftHand),
    rightHand: slackened(skeleton.rightArm, skeleton.rightHandTarget, pose.rightHand),
  };
}

/** Both fists up at the chin, elbows down: the guard a punch comes from. */
function guard(view: RoosterView, base: RoosterPose): RoosterPose {
  if (view === 'side') {
    return edit(base, {
      rightHand: pt(0.42, SHOULDER_Y - 0.05),
      leftHand: pt(0.55, SHOULDER_Y - 0.12),
      leftFist: CLOSED_FIST,
      rightFist: CLOSED_FIST,
    });
  }
  // From behind, fists at the chin are hidden by his own back and the row
  // goes armless; what shows of a guard from behind is the forearms raised
  // beside the head with the elbows hanging below the fists. Elbows bowed up
  // level with the shoulders read, from behind, as wings spread.
  if (view === 'back') {
    return edit(base, {
      rightHand: pt(SHOULDER_HALF + AWAY_GUARD_OUT, SHOULDER_Y + AWAY_GUARD_RIGHT_DROP),
      leftHand: pt(-SHOULDER_HALF - AWAY_GUARD_OUT, SHOULDER_Y + AWAY_GUARD_LEFT_DROP),
      leftFist: CLOSED_FIST,
      rightFist: CLOSED_FIST,
      elbowFlare: ELBOW_IN,
    });
  }
  return edit(base, {
    rightHand: pt(SHOULDER_HALF * 0.4, SHOULDER_Y + 0.15),
    leftHand: pt(-SHOULDER_HALF * 0.35, SHOULDER_Y + 0.1),
    leftFist: CLOSED_FIST,
    rightFist: CLOSED_FIST,
    elbowFlare: ELBOW_OUT,
  });
}
const AWAY_GUARD_OUT = 0.2;
const AWAY_GUARD_RIGHT_DROP = -0.34;
const AWAY_GUARD_LEFT_DROP = -0.4;

const PECK_HEAD_ON_CROUCH = 0.16;
/** Drawing his neck back he leans back, and his hanging hands go with his shoulders. */
const PECK_HAND_DRAW_BACK = 0.08;

function peckRow(view: RoosterView, build: RoosterBuild): (frame: number) => RoosterPose {
  const idle = ikArms(settle(view, build), view, build);
  const impact = ROOSTER_ROW_TIMING.peck.impactFrame ?? 0;
  const last = ROOSTER_ROW_TIMING.peck.frames - 1;
  const profile = view === 'side';
  const away = view === 'back';
  const drawBack = profile
    ? edit(idle, {
        headShift: pt(-0.24, -0.1),
        headPitch: deg(-22),
        lean: deg(-8),
        rightHand: pt(
          idle.rightHand.x - PECK_HAND_DRAW_BACK,
          idle.rightHand.y - PECK_HAND_DRAW_BACK,
        ),
        leftHand: pt(idle.leftHand.x - PECK_HAND_DRAW_BACK, idle.leftHand.y - PECK_HAND_DRAW_BACK),
        beakOpen: 0.35,
        hackleLift: 0.8,
        tailLift: deg(6),
        chestPuff: 0.9,
      })
    : edit(idle, {
        headShift: pt(0, -0.14),
        headPitch: deg(-18),
        beakOpen: 0.35,
        hackleLift: 0.8,
        chestPuff: 0.9,
      });
  const strike = profile
    ? edit(idle, {
        headShift: pt(0.5, 0.5),
        headPitch: deg(38),
        lean: deg(30),
        crouch: 0.12,
        beakOpen: 0.15,
        wattleLag: -1,
        hackleLift: 0.4,
        tailLift: deg(10),
      })
    : edit(idle, {
        headShift: pt(0, away ? 0.42 : 0.62),
        headPitch: deg(30),
        crouch: PECK_HEAD_ON_CROUCH,
        // A guard rides down with his shoulders as he ducks into the peck.
        ...(waitsFistsUp(view, build)
          ? {
              leftHand: pt(idle.leftHand.x, idle.leftHand.y + PECK_HEAD_ON_CROUCH),
              rightHand: pt(idle.rightHand.x, idle.rightHand.y + PECK_HEAD_ON_CROUCH),
            }
          : {}),
        beakOpen: 0.15,
        wattleLag: -1,
        hackleLift: 0.4,
        roll: deg(2),
      });
  const recoil = edit(blendPose(strike, idle, 0.45), { wattleLag: 0.8, beakOpen: 0 });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: 2, pose: drawBack },
    { frame: impact - 1, pose: blendPose(drawBack, strike, 0.35) },
    { frame: impact, pose: strike },
    { frame: impact + 1, pose: recoil },
    { frame: last, pose: idle },
  ]);
}

/** Head-on, where the guard fist waits while the other drives: by the chin, not folded flat on the shoulder. */
const STRIKE_GUARD_ACROSS = 0.3;
const STRIKE_GUARD_DROP = 0.05;
const PUNCH_TUCK_CROUCH = 0.06;
const PUNCH_TUCK_SHRUG = 0.05;

function punchRow(view: RoosterView, build: RoosterBuild): (frame: number) => RoosterPose {
  const idle = ikArms(settle(view, build), view, build);
  const timing = ROOSTER_ROW_TIMING.punch;
  const impact = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  // A fighter already waiting in his guard has nowhere to raise his fists to:
  // his punch starts by tucking down into it.
  const guarded = guard(view, idle);
  const ready = waitsFistsUp(view, build)
    ? edit(guarded, { crouch: PUNCH_TUCK_CROUCH, shrug: PUNCH_TUCK_SHRUG, chestPuff: 0 })
    : guarded;
  if (view === 'side') {
    const cock = edit(ready, {
      twist: -0.8,
      rightHand: pt(0.15, SHOULDER_Y + 0.5),
      lean: deg(-4),
      chestPuff: 0.8,
    });
    const strike = edit(ready, {
      twist: 1,
      lean: deg(12),
      rightHand: pt(1.14, SHOULDER_Y + 0.02),
      leftHand: pt(0.32, SHOULDER_Y - 0.1),
      headShift: pt(0.08, 0.04),
      rightFoot: { ...standingFoot(), forward: 0.08 },
      leftFoot: { ...standingFoot(), forward: -0.08 },
    });
    return settledShot([
      { frame: 0, pose: idle },
      { frame: 1, pose: ready },
      { frame: impact - 1, pose: cock },
      { frame: impact, pose: strike },
      { frame: impact + 1, pose: blendPose(strike, ready, 0.5) },
      { frame: last, pose: idle },
    ]);
  }
  const away = view === 'back';
  const chambered = (leaving: RoosterPose): RoosterPose => chamberHeadOn(leaving, view, build);
  const cock = edit(ready, {
    twist: -0.8,
    rightHand: pt(SHOULDER_HALF + 0.28, SHOULDER_Y + 0.5),
    chestPuff: 0.8,
  });
  // Head-on the fist drives at the camera: it crosses to his middle and the
  // upper arm, pointing down the camera's line, draws short.
  const strike = edit(ready, {
    twist: 1,
    rightHand: pt(0.08, SHOULDER_Y + 0.22),
    rightUpperArmScale: 0.6,
    rightArmBehind: away,
    leftHand: away
      ? ready.leftHand
      : pt(-SHOULDER_HALF * STRIKE_GUARD_ACROSS, SHOULDER_Y + STRIKE_GUARD_DROP),
    crouch: 0.04,
    headShift: pt(-0.05, 0.03),
  });
  return settledShot(
    [
      { frame: 0, pose: idle },
      { frame: 1, pose: ready },
      { frame: impact - 1, pose: cock },
      { frame: impact, pose: strike },
      // From behind the punching fist comes back down to its chamber, not up to
      // the guard beside the head: that way passes through the shoulder.
      {
        frame: impact + 1,
        pose: away
          ? edit(blendPose(strike, cock, 0.5), { leftHand: ready.leftHand, rightArmBehind: away })
          : edit(blendPose(strike, ready, 0.5), { rightArmBehind: away }),
      },
      { frame: last, pose: idle },
    ],
    chambered,
  );
}

/**
 * Head-on, how far the forearm draws as it swings up toward the camera on its
 * way to the guard, and how far it angles in across the body.
 */
const CHAMBER_FORE_SCALE = 0.45;
const CHAMBER_FORE_IN = deg(10);

/**
 * Head-on, the beat between his hanging arms and the guard, raising the fists
 * and lowering them again: the elbows stay hanging at his sides and the
 * forearms swing up at the camera, so they draw short. Blending the hand
 * targets instead moves each fist along the straight line between its hang and
 * his chin, and the elbows bow out sideways around it with the fists at his
 * hips: hands on hips.
 */
function chamberHeadOn(leaving: RoosterPose, view: RoosterView, build: RoosterBuild): RoosterPose {
  if (waitsFistsUp(view, build)) return leaving;
  const hanging = settle(view, build);
  const chamber = (angles: ArmAngles | null, side: number): ArmAngles | null =>
    angles === null
      ? null
      : {
          upper: angles.upper,
          fore: angles.upper - side * CHAMBER_FORE_IN,
          foreScale: CHAMBER_FORE_SCALE,
        };
  return edit(leaving, {
    leftArmAngles: chamber(hanging.leftArmAngles, -1),
    rightArmAngles: chamber(hanging.rightArmAngles, 1),
  });
}

/** Head-on the carrying fist hangs just outside its shoulder: any wider and the elbow juts out like a hand on a hip. */
const HEAD_ON_CARRY_OUT = 0.16;
/** Carrying, the fist rides a little higher than a free hand hangs: the elbow holds the weight. */
const HEAD_ON_CARRY_LIFT = 0.06;
const PROFILE_CARRY_FORWARD = 0.08;
const PROFILE_CARRY_LIFT = 0.12;

/** The carry: the right fist closed at his side, the dumbbell hanging from it. */
function carryHand(view: RoosterView): Pt {
  return view === 'side'
    ? pt(PROFILE_HAND_HANG.x + PROFILE_CARRY_FORWARD, PROFILE_HAND_HANG.y - PROFILE_CARRY_LIFT)
    : pt(SHOULDER_HALF + HEAD_ON_CARRY_OUT, HEAD_ON_HAND_HANG.y - HEAD_ON_CARRY_LIFT);
}

/** The idle as a row that holds a dumbbell starts and ends it: the carry fist at his side. */
function carryingIdle(view: RoosterView): RoosterPose {
  return edit(ikArms(settle(view, 'big'), view, 'big'), {
    rightHand: carryHand(view),
    rightFist: CLOSED_FIST,
  });
}

function clubRow(view: RoosterView): (frame: number) => RoosterPose {
  const idle = carryingIdle(view);
  const timing = ROOSTER_ROW_TIMING.club_swing;
  const impact = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  if (view === 'side') {
    const lift = edit(idle, { rightHand: pt(-0.5, SHOULDER_Y + 0.3), twist: -0.6, lean: deg(-5) });
    const raise = edit(idle, {
      rightHand: pt(-0.42, SHOULDER_Y - 0.62),
      twist: -0.9,
      lean: deg(-10),
      chestPuff: 1,
      hackleLift: 0.6,
      tailLift: deg(8),
    });
    const over = edit(raise, {
      rightHand: pt(-0.12, SHOULDER_Y - 0.98),
      twist: -0.2,
      lean: deg(0),
    });
    const strike = edit(idle, {
      rightHand: pt(1.08, SHOULDER_Y + 0.38),
      twist: 1,
      lean: deg(20),
      crouch: 0.1,
      rightFoot: { ...standingFoot(), forward: 0.12 },
      leftFoot: { ...standingFoot(), forward: -0.1 },
      wattleLag: -0.8,
    });
    const follow = edit(strike, {
      rightHand: pt(0.55, SHOULDER_Y + 0.98),
      lean: deg(24),
      twist: 0.7,
    });
    return settledShot([
      { frame: 0, pose: idle },
      { frame: 1, pose: lift },
      { frame: 3, pose: raise },
      { frame: impact - 1, pose: over },
      { frame: impact, pose: strike },
      { frame: impact + 1, pose: follow },
      { frame: last, pose: idle },
    ]);
  }
  const away = view === 'back';
  const raise = edit(idle, {
    rightHand: pt(SHOULDER_HALF + 0.35, SHOULDER_Y - 0.78),
    twist: -0.6,
    chestPuff: 1,
    hackleLift: 0.6,
    roll: deg(-4),
  });
  const over = edit(raise, {
    rightHand: pt(SHOULDER_HALF * 0.6, SHOULDER_Y - 0.95),
    roll: 0,
  });
  const strike = edit(idle, {
    rightHand: pt(0.05, SHOULDER_Y + 0.62),
    twist: 1,
    crouch: 0.12,
    roll: deg(5),
    rightArmBehind: away,
    rightUpperArmScale: 0.8,
  });
  const follow = edit(strike, {
    rightHand: pt(-0.12, SHOULDER_Y + 0.5),
    roll: deg(6),
    rightUpperArmScale: 0.75,
  });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: 3, pose: raise },
    { frame: impact - 1, pose: over },
    { frame: impact, pose: strike },
    { frame: impact + 1, pose: follow },
    { frame: last, pose: idle },
  ]);
}

/** At the release the free hand comes up and in a little, as the shoulders turn over. */
const THROW_FREE_HAND_LIFT = 0.08;

function throwRow(view: RoosterView): (frame: number) => RoosterPose {
  const idle = carryingIdle(view);
  const timing = ROOSTER_ROW_TIMING.throw;
  const release = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  if (view === 'side') {
    const coil = edit(idle, {
      rightHand: pt(-0.55, SHOULDER_Y + 0.62),
      twist: -1,
      lean: deg(-14),
      crouch: 0.12,
      leftHand: pt(0.5, SHOULDER_Y + 0.2),
      chestPuff: 1,
    });
    const heave = edit(coil, {
      rightHand: pt(-0.25, SHOULDER_Y - 0.8),
      twist: -0.3,
      lean: deg(-6),
      crouch: 0.04,
    });
    const letGo = edit(idle, {
      rightHand: pt(0.98, SHOULDER_Y - 0.42),
      twist: 1,
      lean: deg(18),
      rightFist: 0.3,
      leftHand: pt(-0.2, SHOULDER_Y + 0.8),
      rightFoot: { ...standingFoot(), forward: 0.12 },
      leftFoot: { ...standingFoot(), forward: -0.1 },
      beakOpen: 0.6,
    });
    const follow = edit(letGo, {
      rightHand: pt(0.62, SHOULDER_Y + 0.66),
      lean: deg(22),
      rightFist: 0.2,
      beakOpen: 0.2,
    });
    return settledShot([
      { frame: 0, pose: idle },
      { frame: 2, pose: coil },
      { frame: release - 1, pose: heave },
      { frame: release, pose: letGo },
      { frame: release + 1, pose: follow },
      { frame: last, pose: idle },
    ]);
  }
  const away = view === 'back';
  const coil = edit(idle, {
    rightHand: pt(SHOULDER_HALF + 0.38, SHOULDER_Y + 0.4),
    twist: -0.9,
    crouch: 0.12,
    roll: deg(-6),
    chestPuff: 1,
  });
  const heave = edit(coil, {
    rightHand: pt(SHOULDER_HALF + 0.3, SHOULDER_Y - 0.78),
    roll: deg(-3),
    crouch: 0.03,
  });
  const letGo = edit(idle, {
    rightHand: pt(0.36, SHOULDER_Y - 0.86),
    leftHand: pt(idle.leftHand.x + THROW_FREE_HAND_LIFT, idle.leftHand.y - THROW_FREE_HAND_LIFT),
    twist: 1,
    roll: deg(3),
    rightFist: 0.3,
    beakOpen: away ? 0 : 0.6,
  });
  const follow = edit(letGo, {
    rightHand: pt(-0.05, SHOULDER_Y + 0.45),
    rightFist: 0.2,
    rightArmBehind: away,
    rightUpperArmScale: 0.8,
    crouch: 0.08,
  });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: 2, pose: coil },
    { frame: release - 1, pose: heave },
    { frame: release, pose: letGo },
    { frame: release + 1, pose: follow },
    { frame: last, pose: idle },
  ]);
}

/** Over the comb: the fists' height at the top of the slam's wind-up. */
const SLAM_FISTS_UP = SHOULDER_Y - 0.92;
/**
 * Head-on the slam is a double hammer-fist: the fists clasped together high
 * over his comb, the elbows bent out so the arms frame his head rather than
 * cross it, then driven down together into the floor between his feet. Fists
 * held apart either side of the comb and landed beside the hips in a wide,
 * elbows-out squat is a bodybuilder's ground punch, a different fighter's move.
 */
const SLAM_HEAD_ON_CLASP_HALF = 0.12;
const SLAM_HEAD_ON_CLASP_RISE = 0.06;
const SLAM_HEAD_ON_STRIKE = pt(0.1, -0.22);
const SLAM_HEAD_ON_DESCENT = pt(0.08, SHOULDER_Y + 0.12);
/** On the way up the fists meet in front of his chest before they rise. */
const SLAM_HEAD_ON_GATHER = pt(0.18, SHOULDER_Y - 0.1);
/**
 * Coming down, the fists swing out and forward round the shoulders rather than
 * past them: a fist dropped straight down from over the comb brushes the
 * shoulder and folds the arm flat.
 */
const SLAM_DESCENT_SHARE = 0.55;
const SLAM_HOP = 0.14;
const SLAM_HOP_CURL = 0.6;
const SLAM_PROFILE_DESCENT_HAND = pt(0.6, SHOULDER_Y - 0.25);
const SLAM_FAR_FIST_BEHIND = 0.06;
/** After the blow the fists come up off the floor while he is still down. */
const SLAM_REBOUND_HEIGHT = -0.42;

function slamRow(view: RoosterView): (frame: number) => RoosterPose {
  const idle = ikArms(settle(view, 'big'), view, 'big');
  const timing = ROOSTER_ROW_TIMING.slam;
  const impact = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  const profile = view === 'side';
  const fists = { leftFist: CLOSED_FIST, rightFist: CLOSED_FIST };
  const raise = profile
    ? edit(idle, {
        ...fists,
        rightHand: pt(-0.32, SLAM_FISTS_UP + 0.06),
        leftHand: pt(-0.4, SLAM_FISTS_UP + 0.1),
        headShift: pt(0.08, 0),
        shrug: 0.08,
        lean: deg(-8),
        chestPuff: 1,
        hackleLift: 1,
        beakOpen: 0.8,
        tailLift: deg(10),
      })
    : edit(idle, {
        ...fists,
        rightHand: pt(SLAM_HEAD_ON_CLASP_HALF, SLAM_FISTS_UP - SLAM_HEAD_ON_CLASP_RISE),
        leftHand: pt(-SLAM_HEAD_ON_CLASP_HALF, SLAM_FISTS_UP - SLAM_HEAD_ON_CLASP_RISE),
        shrug: 0.08,
        chestPuff: 1,
        hackleLift: 1,
        beakOpen: 0.8,
        // Reaching up past the shoulder the IK's outward bend turns the elbows
        // in, and the arms cross in an X over his face; bent the other way the
        // elbows stand out to the sides and the fists frame his comb.
        elbowFlare: ELBOW_IN,
        headOverArms: true,
      });
  const strike = profile
    ? edit(idle, {
        ...fists,
        // A squat straight down onto both fists, trunk near upright and the
        // tail thrown up behind: a cock landing from a jump, not a lunge.
        rightHand: pt(0.44, -0.1),
        leftHand: pt(0.36, -0.08),
        lean: deg(12),
        crouch: 0.66,
        headShift: pt(0.05, 0.05),
        headPitch: deg(25),
        tailLift: deg(22),
        hackleLift: 1,
        wattleLag: -1,
      })
    : edit(idle, {
        ...fists,
        rightHand: SLAM_HEAD_ON_STRIKE,
        leftHand: pt(-SLAM_HEAD_ON_STRIKE.x, SLAM_HEAD_ON_STRIKE.y),
        crouch: 0.6,
        headShift: pt(0, 0.16),
        wattleLag: -1,
      });
  const gather = profile
    ? edit(blendPose(idle, raise, 0.6), {
        rightHand: pt(0.35, SHOULDER_Y - 0.55),
        leftHand: pt(0.25, SHOULDER_Y - 0.5),
      })
    : edit(blendPose(idle, raise, 0.6), {
        rightHand: SLAM_HEAD_ON_GATHER,
        leftHand: pt(-SLAM_HEAD_ON_GATHER.x, SLAM_HEAD_ON_GATHER.y),
      });
  const rebound = edit(strike, {
    crouch: 0.5,
    headShift: pt(profile ? -0.2 : 0, 0.06),
    wattleLag: 0.6,
    rightHand: pt(strike.rightHand.x - (profile ? 0.12 : 0), SLAM_REBOUND_HEIGHT),
    leftHand: pt(strike.leftHand.x - (profile ? 0.12 : 0), SLAM_REBOUND_HEIGHT),
  });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: 2, pose: gather },
    { frame: 3, pose: raise },
    {
      frame: 4,
      pose: edit(raise, {
        shrug: 0.12,
        chestPuff: 1.15,
        // He hops at the top of the wind-up: both feet off the floor, toes
        // curled, so the fists come down with his whole weight behind them.
        bob: -SLAM_HOP,
        leftFoot: { ...standingFoot(), lift: SLAM_HOP, curl: SLAM_HOP_CURL, planted: false },
        rightFoot: { ...standingFoot(), lift: SLAM_HOP, curl: SLAM_HOP_CURL, planted: false },
      }),
    },
    {
      frame: impact - 1,
      pose: edit(blendPose(raise, strike, SLAM_DESCENT_SHARE), {
        rightHand: profile ? SLAM_PROFILE_DESCENT_HAND : SLAM_HEAD_ON_DESCENT,
        leftHand: profile
          ? pt(SLAM_PROFILE_DESCENT_HAND.x - SLAM_FAR_FIST_BEHIND, SLAM_PROFILE_DESCENT_HAND.y)
          : pt(-SLAM_HEAD_ON_DESCENT.x, SLAM_HEAD_ON_DESCENT.y),
      }),
    },
    { frame: impact, pose: strike },
    { frame: impact + 1, pose: rebound },
    { frame: last - 2, pose: blendPose(rebound, idle, 0.6) },
    { frame: last, pose: idle },
  ]);
}

function pickupRow(view: RoosterView): (frame: number) => RoosterPose {
  const idle = ikArms(settle(view, 'big'), view, 'big');
  const timing = ROOSTER_ROW_TIMING.pickup;
  const grab = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  const profile = view === 'side';
  const reach = profile
    ? edit(idle, {
        rightHand: pt(0.86, -0.3),
        lean: deg(48),
        crouch: 0.38,
        headShift: pt(-0.15, 0.05),
        rightFist: 0.2,
      })
    : edit(idle, {
        rightHand: pt(SHOULDER_HALF + 0.08, -0.46),
        crouch: 0.42,
        roll: deg(6),
        rightFist: 0.2,
      });
  const closed = edit(reach, {
    rightFist: CLOSED_FIST,
    rightHand: pt(reach.rightHand.x, reach.rightHand.y + 0.06),
  });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: grab - 1, pose: reach },
    { frame: grab, pose: closed },
    { frame: last, pose: carryingIdle(view) },
  ]);
}

const CROW_PROFILE_STRETCH = pt(-0.1, -0.28);
const CROW_HEAD_THROWN_BACK = deg(-62);
const CROW_HEAD_ON_STRETCH = pt(0, -0.22);
const CROW_DRAW_OUT = 0.35;
const CROW_DRAW_DROP = 0.55;
const CROW_CRAB_FIST_HALF = 0.16;
const CROW_CRAB_FIST_DROP = 0.62;
/**
 * Edge-on, the fists drawn back beside the hip as he fills his chest: held at
 * the hip itself the near fist sits on the shank's top and the two read as one
 * yellow shape.
 */
const CROW_PROFILE_SPREAD_NEAR = pt(-0.2, SHOULDER_Y + 0.72);
const CROW_PROFILE_SPREAD_FAR = pt(-0.28, SHOULDER_Y + 0.68);

function crowRow(view: RoosterView): (frame: number) => RoosterPose {
  const idle = ikArms(settle(view, 'big'), view, 'big');
  const timing = ROOSTER_ROW_TIMING.crow;
  const peak = timing.impactFrame ?? 0;
  const last = timing.frames - 1;
  const profile = view === 'side';
  const inhale = edit(idle, {
    chestPuff: 1,
    lean: profile ? deg(-6) : 0,
    hackleLift: 0.6,
    shrug: 0.03,
    rightHand: pt(idle.rightHand.x, idle.rightHand.y - 0.12),
    leftHand: pt(idle.leftHand.x, idle.leftHand.y - 0.12),
  });
  // Head-on the elbows draw out and back before the fists come in: arms flung
  // out level with the shoulders read as a pair of wings beating.
  const spread = profile
    ? edit(inhale, {
        rightHand: CROW_PROFILE_SPREAD_NEAR,
        leftHand: CROW_PROFILE_SPREAD_FAR,
      })
    : edit(inhale, {
        rightHand: pt(SHOULDER_HALF + CROW_DRAW_OUT, SHOULDER_Y + CROW_DRAW_DROP),
        leftHand: pt(-SHOULDER_HALF - CROW_DRAW_OUT, SHOULDER_Y + CROW_DRAW_DROP),
        elbowFlare: ELBOW_OUT,
      });
  const flexArms = profile
    ? {
        // Edge-on he crows as a rooster does, chest thrown out and the arms
        // swept back where a cock beats his wings.
        rightHand: pt(-0.5, SHOULDER_Y + 0.62),
        leftHand: pt(-0.58, SHOULDER_Y + 0.55),
        elbowFlare: ELBOW_OUT,
      }
    : {
        // Head-on a lifter's crab: fists driven together low in front of the
        // breast, elbows out, every muscle braced. From behind the same
        // picture is the fists swept back behind his rump.
        rightHand: pt(CROW_CRAB_FIST_HALF, SHOULDER_Y + CROW_CRAB_FIST_DROP),
        leftHand: pt(-CROW_CRAB_FIST_HALF, SHOULDER_Y + CROW_CRAB_FIST_DROP),
        elbowFlare: ELBOW_OUT,
      };
  const crow = edit(idle, {
    ...flexArms,
    chestPuff: 1.2,
    lean: profile ? deg(-16) : 0,
    // The neck stretches up tall to crow: thrown back without the stretch the
    // head moves a few pixels at the tile and the beat does not read.
    headShift: profile ? CROW_PROFILE_STRETCH : CROW_HEAD_ON_STRETCH,
    headPitch: CROW_HEAD_THROWN_BACK,
    beakOpen: 1,
    hackleLift: 1,
    tailLift: deg(12),
    leftFist: CLOSED_FIST,
    rightFist: CLOSED_FIST,
    shrug: 0.06,
  });
  return settledShot([
    { frame: 0, pose: idle },
    { frame: 2, pose: inhale },
    { frame: 3, pose: spread },
    { frame: peak, pose: crow },
    { frame: peak + 1, pose: edit(blendPose(crow, idle, 0.35), { beakOpen: 0.8 }) },
    { frame: last, pose: idle },
  ]);
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface RowSpec {
  readonly name: string;
  readonly base: RoosterRowBase;
  readonly view: RoosterView;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => RoosterPose;
}

function rowPose(
  base: RoosterRowBase,
  view: RoosterView,
  build: RoosterBuild,
): (frame: number) => RoosterPose {
  const frames = ROOSTER_ROW_TIMING[base].frames;
  // Gaits open a quarter of the way into the stride, at mid-swing: a contact
  // is where the feet are slowest, and a seam laid on one is a near-held frame.
  const cycle = (frame: number): number => frame / frames + GAIT_ROW_OFFSET;
  switch (base) {
    case 'idle':
      return (frame) => idlePose(view, frame, build);
    case 'walk':
      return (frame) =>
        gaitPose(view, cycle(frame), WALK_BY_BUILD[build], { carry: false, sprint: false, build });
    case 'carry_walk':
      return (frame) =>
        gaitPose(view, cycle(frame), WALK_BY_BUILD[build], { carry: true, sprint: false, build });
    case 'sprint':
      return (frame) => gaitPose(view, cycle(frame), SPRINT, { carry: false, sprint: true, build });
    case 'peck':
      return peckRow(view, build);
    case 'punch':
      return punchRow(view, build);
    case 'club_swing':
      return clubRow(view);
    case 'throw':
      return throwRow(view);
    case 'slam':
      return slamRow(view);
    case 'pickup':
      return pickupRow(view);
    case 'crow':
      return crowRow(view);
  }
}

function rowsFor(build: RoosterBuild): RowSpec[] {
  return ROOSTER_BUILD_ROWS[build].flatMap((base) =>
    ROOSTER_VIEWS.map((view) => ({
      name: roosterStateName(base, view),
      base,
      view,
      frameCount: ROOSTER_ROW_TIMING[base].frames,
      kind: ROOSTER_ROW_TIMING[base].kind,
      pose: rowPose(base, view, build),
    })),
  );
}

export const ROOSTER_ROWS: Readonly<Record<RoosterBuild, readonly RowSpec[]>> = {
  big: rowsFor('big'),
  little: rowsFor('little'),
  bent: rowsFor('bent'),
};

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * Where the floor sits inside the creature's tile, matching the other dungeon
 * mobs: 58 of a 64 px tile, here at the rooster's 32.
 */
export const GROUND_OFFSET_PX = 29;

/**
 * The big build's cell, in tiles from his origin on the floor: either side,
 * room for the tail fountain behind him edge-on (the widest reach of any row,
 * and mirrored for the other facing); above the floor, the slam's fists and
 * the crow's stretched neck; below it, toes coming at the camera. Measured from every painted cell with a pixel or two of margin, as
 * every byte of it is held for each of his cells. Every other build is the
 * same cell scaled to his height. The structural gate fails a pose that
 * reaches the edge.
 */
const BIG_CELL_HALF_WIDTH_TILES = 2.22;
const BIG_CELL_ABOVE_GROUND_TILES = 3.47;
const BIG_CELL_BELOW_GROUND_TILES = 0.2;

interface RoosterCell {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  /** Cell pixels per rig unit. */
  readonly pxPerUnit: number;
  /** Game tiles per rig unit. */
  readonly tilesPerUnit: number;
  readonly groundRow: number;
}

function cellFor(build: RoosterBuild): RoosterCell {
  const spec = ROOSTER_BUILD_SPECS[build];
  const tilesPerUnit = tilesPerRigUnit(spec);
  const pxPerBigTile = ROOSTER_TILE_SCALE * tilesPerUnit;
  const halfWidth = Math.ceil(BIG_CELL_HALF_WIDTH_TILES * pxPerBigTile);
  const frameWidth = halfWidth * 2;
  const groundRow = Math.ceil(BIG_CELL_ABOVE_GROUND_TILES * pxPerBigTile);
  const frameHeight = groundRow + Math.ceil(BIG_CELL_BELOW_GROUND_TILES * pxPerBigTile);
  return {
    frameWidth,
    frameHeight,
    tileX: halfWidth - ROOSTER_TILE_SCALE / 2,
    tileY: groundRow - GROUND_OFFSET_PX,
    pxPerUnit: cellPxPerRigUnit(ROOSTER_BUILD_SPECS[build]),
    tilesPerUnit,
    groundRow,
  };
}

export const ROOSTER_CELLS: Readonly<Record<RoosterBuild, RoosterCell>> = {
  big: cellFor('big'),
  little: cellFor('little'),
  bent: cellFor('bent'),
};

// ── Held-dumbbell anchors ────────────────────────────────────────────────────

/** A point inside the creature's own tile, as fractions of a tile from its top-left. */
interface TileFraction {
  readonly x: number;
  readonly y: number;
}

/** Where the gripping fist is on one frame, and which way a bar across it lies. */
export interface HandAnchor {
  readonly at: TileFraction;
  /** The bar's angle on screen, radians, as the unflipped cell is drawn. */
  readonly angle: number;
}

const TILE_CENTRE_FRACTION = 0.5;
const GROUND_TILE_FRACTION = GROUND_OFFSET_PX / ROOSTER_TILE_SCALE;
/** A bar gripped in a fist lies across it, square to the way the fist points. */
const BAR_ACROSS_FIST = Math.PI / 2;

function rowNamed(build: RoosterBuild, name: string): RowSpec {
  const row = ROOSTER_ROWS[build].find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`the ${build} rooster has no row named "${name}"`);
  return row;
}

/** His right fist on one frame of a row, in tile fractions of his own tile. */
export function rightHandAnchor(build: RoosterBuild, name: string, frame: number): HandAnchor {
  const row = rowNamed(build, name);
  const spec = ROOSTER_BUILD_SPECS[build];
  const skeleton = buildRoosterSkeleton(row.pose(frame), row.view, spec);
  const fist = fistCentre(skeleton.rightArm);
  const scale = ROOSTER_CELLS[build].tilesPerUnit;
  return {
    at: { x: TILE_CENTRE_FRACTION + fist.x * scale, y: GROUND_TILE_FRACTION + fist.y * scale },
    angle: handAngle(skeleton.rightArm) + BAR_ACROSS_FIST,
  };
}

/**
 * The rows a dumbbell can be held through, and from which frame. The throw lets
 * go on its release frame; the pickup closes on the dumbbell on its grab frame.
 * He stands, pecks and crows with or without one, and runs with one when he
 * outpaces his walk, so those rows hold it throughout when he has it; punch
 * and slam are never played holding one.
 */
export const DUMBBELL_HELD_FRAMES: Readonly<
  Partial<Record<RoosterRowBase, { readonly from: number; readonly until: number }>>
> = {
  idle: { from: 0, until: ROOSTER_ROW_TIMING.idle.frames },
  carry_walk: { from: 0, until: ROOSTER_ROW_TIMING.carry_walk.frames },
  sprint: { from: 0, until: ROOSTER_ROW_TIMING.sprint.frames },
  peck: { from: 0, until: ROOSTER_ROW_TIMING.peck.frames },
  crow: { from: 0, until: ROOSTER_ROW_TIMING.crow.frames },
  club_swing: { from: 0, until: ROOSTER_ROW_TIMING.club_swing.frames },
  throw: { from: 0, until: ROOSTER_ROW_TIMING.throw.impactFrame ?? 0 },
  pickup: {
    from: ROOSTER_ROW_TIMING.pickup.impactFrame ?? 0,
    until: ROOSTER_ROW_TIMING.pickup.frames,
  },
};

/**
 * Every held frame's anchor, per state, computed from the rig the painter
 * draws. Computed rather than frozen: the anchor is a property of the pose,
 * not of ink, so the runtime and the gates read the same solve.
 */
function anchorTable(): ReadonlyMap<string, readonly (HandAnchor | null)[]> {
  const table = new Map<string, (HandAnchor | null)[]>();
  for (const row of ROOSTER_ROWS.big) {
    const held = DUMBBELL_HELD_FRAMES[row.base];
    if (held === undefined) continue;
    table.set(
      row.name,
      Array.from({ length: row.frameCount }, (_unused, frame) =>
        frame >= held.from && frame < held.until ? rightHandAnchor('big', row.name, frame) : null,
      ),
    );
  }
  return table;
}

export const BIG_ROOSTER_HAND_ANCHORS = anchorTable();

/** Where the beak's tip is on one frame, in rig units: what a peck reaches with. */
export function beakTipOf(build: RoosterBuild, name: string, frame: number): Pt {
  const row = rowNamed(build, name);
  const spec = ROOSTER_BUILD_SPECS[build];
  const skeleton = buildRoosterSkeleton(row.pose(frame), row.view, spec);
  return headToFigure(skeleton, beakTipOffset(skeleton.headTurn, spec.proportions.headSize));
}

// ── Gore placement ───────────────────────────────────────────────────────────

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = roosterGorePieces('big').map((piece) => piece.state);

function gorePieceOf(build: RoosterBuild, state: string): RoosterGorePiece {
  const piece = roosterGorePieces(build).find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`the ${build} rooster has no gore piece "${state}"`);
  return piece;
}

// ── Figures ──────────────────────────────────────────────────────────────────

function paintRoosterFrame(
  build: RoosterBuild,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const cell = ROOSTER_CELLS[build];
  const row = ROOSTER_ROWS[build].find((candidate) => candidate.name === state);
  ctx.save();
  try {
    if (row === undefined) {
      ctx.translate(cell.frameWidth / 2, cell.frameHeight / 2);
      ctx.scale(cell.pxPerUnit, cell.pxPerUnit);
      gorePieceOf(build, state).paint(ctx);
      return;
    }
    ctx.translate(cell.frameWidth / 2, cell.groundRow);
    ctx.scale(cell.pxPerUnit, cell.pxPerUnit);
    drawRooster(ctx, build, row.view, row.pose(frame), cell.pxPerUnit);
  } finally {
    ctx.restore();
  }
}

function stateFrames(build: RoosterBuild): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ROOSTER_ROWS[build]) frames[row.name] = row.frameCount;
  for (const piece of roosterGorePieces(build)) frames[piece.state] = 1;
  return frames;
}

function figureFor(build: RoosterBuild, id: string): FigureDef {
  const cell = ROOSTER_CELLS[build];
  return {
    id,
    frameWidth: cell.frameWidth,
    frameHeight: cell.frameHeight,
    tileX: cell.tileX,
    tileY: cell.tileY,
    tileScale: ROOSTER_TILE_SCALE,
    states: figureStates(stateFrames(build)),
    paintFrame: (ctx, state, frame) => paintRoosterFrame(build, ctx, state, frame),
    skipSupersample: true,
  };
}

export const BIG_ROOSTER_FIGURE: FigureDef = figureFor('big', 'big_rooster');
export const LITTLE_ROOSTER_FIGURE: FigureDef = figureFor('little', 'little_rooster');
export const BENT_ROOSTER_FIGURE: FigureDef = figureFor('bent', 'slightly_bent_rooster');

export const ROOSTER_FIGURES: Readonly<Record<RoosterBuild, FigureDef>> = {
  big: BIG_ROOSTER_FIGURE,
  little: LITTLE_ROOSTER_FIGURE,
  bent: BENT_ROOSTER_FIGURE,
};

// ── Rig-derived placements ───────────────────────────────────────────────────

interface RoosterEyeRig {
  /** The near eye in the idle profile, in rig units from the ground point. */
  readonly side: Pt;
  /** The eyes' midpoint in the idle facing the camera, in rig units. */
  readonly front: Pt;
  readonly sideSpacing: number;
  readonly frontSpacing: number;
  /** The ground line's height in the tile, as a fraction of the tile. */
  readonly groundTileFraction: number;
}

/** The across-the-face gap between a rooster's eyes against his head size, in rig units. */
const EYE_GAP = 0.2;
/** Edge-on the far eye is behind the skull; the shine keeps a sliver of gap. */
const PROFILE_EYE_GAP = 0.04;

function eyeIn(build: RoosterBuild, view: RoosterView): Pt {
  const spec = ROOSTER_BUILD_SPECS[build];
  const skeleton = buildRoosterSkeleton(idlePose(view, 0, build), view, spec);
  return headToFigure(skeleton, eyeOffset(skeleton.headTurn, spec.proportions.headSize));
}

/** Where a build's eyes are, read off the rig's own head. */
export function roosterEyeRig(build: RoosterBuild): RoosterEyeRig {
  const size = ROOSTER_BUILD_SPECS[build].proportions.headSize;
  return {
    side: eyeIn(build, 'side'),
    front: eyeIn(build, 'front'),
    sideSpacing: PROFILE_EYE_GAP * size,
    frontSpacing: EYE_GAP * size,
    groundTileFraction: GROUND_TILE_FRACTION,
  };
}
