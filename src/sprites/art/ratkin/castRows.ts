/**
 * Choreography for the Briar Hollow cast: every row a villager or a militia
 * soldier plays beyond Mordecai's walk and idle.
 *
 * The walk and idle themselves are Mordecai's, imported rather than copied —
 * the gait is the one thing every ratkin shares, and the stride-sync gate is
 * written against it. What this module adds is:
 *
 * - **Carrying.** A held prop pins the right arm into a carry and damps its
 *   swing: a staff held upright does not pump like a free arm.
 * - **Talk** (front and side): the free paw raised in a beat, the head cocked.
 * - **Work** (front and side): one looping trade motion per worker.
 * - **Cower** (front): the hunched, clutching shelter pose.
 * - **Soldier rows** (all three views): a spear thrust, a flinch, a collapse,
 *   and getting back up.
 *
 * Arms are driven by joint angles throughout, as Mordecai's are: a hand placed
 * by IK sweeps both segments together and the forearm flails.
 */

import { clamp01, deg, easeInOut, hump, lerp } from '../carlArt';
import type { ArmAngles, FootPose, RatKinPose, RatKinView } from '../ratKinArt';
import {
  FACING_SWING_MIDPOINT,
  FAR_SIDE,
  NEAR_SIDE,
  facingArmAngles,
  idleFacing,
  idleSide,
  keyed,
  sideArmAngles,
  walkFacing,
  walkSide,
} from '../ratKinFigure';
import type { HeldPropKind } from './outfit';
import { AXIS_DOWN, AXIS_UP, PROP_CARRY, type PropCarry } from './props';

const TAU = Math.PI * 2;
/** Where `hump` reaches 1. */
const HUMP_PEAK = 0.5;

/** Which arm a view draws on the wearer's right. Head-on it is the far (−X) arm. */
type ArmSlot = 'near' | 'far';

function rightArmSlot(view: RatKinView): ArmSlot {
  return view === 'front' ? 'far' : 'near';
}

function otherSlot(slot: ArmSlot): ArmSlot {
  return slot === 'near' ? 'far' : 'near';
}

/** The picture side (+1 or −1) a head-on arm slot is drawn on. */
function slotSide(slot: ArmSlot): number {
  return slot === 'near' ? NEAR_SIDE : FAR_SIDE;
}

function setArm(pose: RatKinPose, slot: ArmSlot, angles: ArmAngles, curl: number): void {
  if (slot === 'near') {
    pose.nearArmAngles = angles;
    pose.nearPaw = curl;
  } else {
    pose.farArmAngles = angles;
    pose.farPaw = curl;
  }
}

function armOf(pose: RatKinPose, slot: ArmSlot): ArmAngles | null {
  return slot === 'near' ? pose.nearArmAngles : pose.farArmAngles;
}

/** An arm's joint angles in whichever convention the view uses. */
function anglesFor(
  view: RatKinView,
  slot: ArmSlot,
  upper: number,
  fore: number,
  foreScale = 1,
): ArmAngles {
  if (view === 'side') return { upper, fore, foreScale };
  const side = slotSide(slot);
  return { upper: upper * side, fore: fore * side, foreScale };
}

/** The resting arm a view's walk and idle swing about, for measuring a swing off it. */
function restArm(view: RatKinView, slot: ArmSlot): ArmAngles {
  if (view === 'side') return sideArmAngles(0);
  return facingArmAngles(slotSide(slot), 0, FACING_SWING_MIDPOINT);
}

/**
 * A prop axis authored for a right hand on the picture's +X side, as it is
 * edge-on and from behind, mirrored for head-on where the right hand is on −X.
 */
function rightHandAxis(view: RatKinView, axis: number): number {
  if (view !== 'front') return axis;
  // Wrapped into (−π, π] so a lerp from the carry axis takes the short way round.
  const mirrored = Math.PI - axis;
  return mirrored > Math.PI ? mirrored - TAU : mirrored;
}

/** The screen direction a forearm at absolute angle `fore` points, from elbow to wrist. */
function forearmAxis(view: RatKinView, slot: ArmSlot, fore: number): number {
  const signed = view === 'side' ? fore : fore * slotSide(slot);
  return Math.atan2(Math.cos(signed), Math.sin(signed));
}

// ── Carrying ─────────────────────────────────────────────────────────────────

/** A closed fist round a handle. */
const GRIP_CURL = 0.95;

interface CarrySpec {
  /** Profile upper arm and forearm, absolute radians from hanging. */
  readonly sideUpper: number;
  readonly sideFore: number;
  /** Head-on, as magnitudes the arm's own side sign is applied to. */
  readonly facingUpper: number;
  readonly facingFore: number;
  readonly facingForeScale: number;
  /** How much of a free arm's swing the carrying arm keeps. */
  readonly swingShare: number;
}

/**
 * How each kind of carry holds the right arm.
 *
 * A pole is held out beside him, forearm level, so the staff stands clear of
 * his body instead of splitting it down the middle. A hanging load pulls the
 * arm nearly straight. A held-up item keeps the ratkin's folded carriage.
 */
const CARRY_SPECS: Readonly<Record<PropCarry, CarrySpec>> = {
  pole: {
    sideUpper: deg(8),
    sideFore: deg(64),
    facingUpper: deg(20),
    facingFore: deg(-4),
    facingForeScale: 0.8,
    swingShare: 0.3,
  },
  hang: {
    sideUpper: deg(-2),
    sideFore: deg(14),
    facingUpper: deg(14),
    facingFore: deg(4),
    facingForeScale: 1,
    swingShare: 0.6,
  },
  hold: {
    sideUpper: deg(0),
    sideFore: deg(58),
    facingUpper: deg(22),
    facingFore: deg(-30),
    facingForeScale: 0.9,
    swingShare: 0.5,
  },
};

/**
 * Pins the right arm into the carry its prop calls for, keeping a damped share
 * of whatever swing the row gave it. A no-op for an empty paw.
 */
export function applyCarry(pose: RatKinPose, view: RatKinView, prop: HeldPropKind): void {
  if (prop === 'none') return;
  const slot = rightArmSlot(view);
  const current = armOf(pose, slot) ?? restArm(view, slot);
  const rest = restArm(view, slot);
  const spec = CARRY_SPECS[PROP_CARRY[prop].carry];
  const carried =
    view === 'side'
      ? anglesFor(view, slot, spec.sideUpper, spec.sideFore)
      : anglesFor(view, slot, spec.facingUpper, spec.facingFore, spec.facingForeScale);
  setArm(
    pose,
    slot,
    {
      upper: carried.upper + (current.upper - rest.upper) * spec.swingShare,
      fore: carried.fore + (current.fore - rest.fore) * spec.swingShare,
      foreScale: carried.foreScale,
    },
    GRIP_CURL,
  );
}

// ── Walk and idle ────────────────────────────────────────────────────────────

export function castWalkPose(phase: number, view: RatKinView, prop: HeldPropKind): RatKinPose {
  const pose = view === 'side' ? walkSide(phase) : walkFacing(phase, view === 'away');
  applyCarry(pose, view, prop);
  return pose;
}

export function castIdlePose(phase: number, view: RatKinView, prop: HeldPropKind): RatKinPose {
  const pose = view === 'side' ? idleSide(phase) : idleFacing(phase, view === 'away');
  applyCarry(pose, view, prop);
  return pose;
}

// ── Talk ─────────────────────────────────────────────────────────────────────

/** Two beats of the paw per loop: a talker punctuates, he does not wave. */
const TALK_BEATS = 2;
const TALK_SIDE_UPPER = deg(34);
const TALK_SIDE_FORE = deg(104);
const TALK_FACING_UPPER = deg(36);
const TALK_FACING_FORE = deg(-122);
const TALK_BEAT_UPPER = deg(6);
const TALK_BEAT_FORE = deg(14);
const TALK_OPEN_PAW = 0.1;
const TALK_HEAD_ROLL = deg(7);
const TALK_HEAD_LIFT = deg(-5);
const TALK_JAW = 0.45;
const TALK_EAR_PERK = deg(-6);

/**
 * The talk gesture: one paw raised and opened, beating in time with the words,
 * the head cocked toward the listener and the jaw working.
 *
 * The gesturing paw is the one that is free. Head-on that is always the left
 * (a prop rides in the right); edge-on the near paw talks unless it is holding
 * a staff, because the far paw is behind the body there and says nothing.
 */
export function castTalkPose(phase: number, view: RatKinView, prop: HeldPropKind): RatKinPose {
  const pose = castIdlePose(phase, view, prop);
  const beat = Math.max(0, Math.sin(phase * TAU * TALK_BEATS));
  const holdsPole = PROP_CARRY[prop].carry === 'pole' && prop !== 'none';
  const slot: ArmSlot =
    view === 'side' ? (holdsPole ? 'far' : 'near') : otherSlot(rightArmSlot(view));
  const gesture =
    view === 'side'
      ? anglesFor(
          view,
          slot,
          TALK_SIDE_UPPER + beat * TALK_BEAT_UPPER,
          TALK_SIDE_FORE + beat * TALK_BEAT_FORE,
        )
      : anglesFor(
          view,
          slot,
          TALK_FACING_UPPER + beat * TALK_BEAT_UPPER,
          TALK_FACING_FORE - beat * TALK_BEAT_FORE,
        );
  setArm(pose, slot, gesture, TALK_OPEN_PAW);
  pose.sniff = beat * TALK_JAW;
  pose.earNear = TALK_EAR_PERK;
  pose.earFar = TALK_EAR_PERK;
  if (view === 'side') pose.headPitch = TALK_HEAD_LIFT + beat * TALK_HEAD_LIFT;
  else pose.headRoll = Math.sin(phase * TAU) * TALK_HEAD_ROLL;
  return pose;
}

// ── Cower ────────────────────────────────────────────────────────────────────

const COWER_CROUCH = 0.8;
const COWER_DROP = 0.05;
const COWER_LEAN = deg(24);
const COWER_UPPER = deg(30);
const COWER_FORE = deg(-152);
const COWER_FORE_SCALE = 0.72;
const COWER_EARS_BACK = deg(38);
const COWER_SQUINT = 0.55;
const COWER_TAIL_CURL = deg(-150);
/**
 * The tremble, in figure units: half a pixel either way at a 32px tile, which
 * reads as shaking rather than as moving.
 */
const COWER_TREMBLE = 0.008;
const COWER_TREMBLE_BEATS = 4;
/** A staff clutched to the chest leans across it instead of standing upright. */
const COWER_POLE_LEAN = deg(30);

/**
 * Sheltering: crouched low, paws up at the chin, ears flat, eyes screwed half
 * shut, shaking. Head-on only — a sheltering villager faces out of the corner
 * they have backed into.
 */
export function castCowerPose(phase: number, prop: HeldPropKind): RatKinPose {
  const pose = idleFacing(phase, false);
  const tremble = Math.sin(phase * TAU * COWER_TREMBLE_BEATS) * COWER_TREMBLE;
  pose.crouch = COWER_CROUCH;
  pose.bob += COWER_DROP + tremble;
  pose.lean += COWER_LEAN;
  for (const slot of ['near', 'far'] as const) {
    setArm(
      pose,
      slot,
      anglesFor('front', slot, COWER_UPPER, COWER_FORE, COWER_FORE_SCALE),
      GRIP_CURL,
    );
  }
  pose.earNear = COWER_EARS_BACK;
  pose.earFar = COWER_EARS_BACK;
  pose.blink = Math.max(pose.blink, COWER_SQUINT);
  pose.sniff = 0;
  pose.tail = { ...pose.tail, curl: COWER_TAIL_CURL };
  pose.headRoll = tremble;
  if (prop !== 'none' && PROP_CARRY[prop].carry === 'pole') {
    pose.propAxis = PROP_CARRY[prop].axis + COWER_POLE_LEAN;
  }
  return pose;
}

// ── Work ─────────────────────────────────────────────────────────────────────

/** The trade motions the workers loop at their posts. */
export type WorkMotion = 'hammer' | 'stir' | 'hoe' | 'push' | 'plane' | 'crank' | 'sew' | 'sketch';

/** One arm's angles at one moment of a work loop: profile values, head-on magnitudes. */
interface ArmKey {
  readonly upper: number;
  readonly fore: number;
  readonly foreScale?: number;
}

/** A work loop, sampled at a phase. */
interface WorkFrame {
  readonly right: ArmKey;
  readonly left?: ArmKey;
  readonly lean: number;
  readonly headPitch: number;
  /** The prop's axis; `forearm` follows the right forearm, as a swung tool does. */
  readonly axis: number | 'forearm';
  /** Slides the tool along its axis in the paw; see `RatKinPose.propShift`. */
  readonly shift?: number;
}

/** A work loop per view, as a function of cycle phase. */
interface WorkChoreography {
  readonly side: (phase: number) => WorkFrame;
  readonly front: (phase: number) => WorkFrame;
}

/**
 * Where in the hammer loop the head lands on the anvil. On the row's sampling
 * grid (8 frames step 0.125), so the strike is actually drawn rather than
 * falling between two frames.
 */
export const HAMMER_STRIKE_PHASE = 0.625;

/** A swing that winds up slowly and comes down fast, landing at `strikeAt`. */
function swingCurve(phase: number, strikeAt: number): number {
  const windUpEnd = strikeAt - 0.125;
  return keyed(phase, [
    [0, 0],
    [windUpEnd, 1],
    [strikeAt, 0],
    [1, 0],
  ]);
}

/** A hoe is swung choked up its handle, which keeps the blade inside the cell overhead. */
const HOE_CHOKE = -0.34;

const WORK: Readonly<Record<WorkMotion, WorkChoreography>> = {
  hammer: {
    side: (phase) => {
      const raise = easeInOut(swingCurve(phase, HAMMER_STRIKE_PHASE));
      return {
        right: { upper: lerp(deg(40), deg(150), raise), fore: lerp(deg(58), deg(205), raise) },
        lean: lerp(deg(16), deg(4), raise),
        headPitch: deg(8),
        axis: 'forearm',
      };
    },
    front: (phase) => {
      const raise = easeInOut(swingCurve(phase, HAMMER_STRIKE_PHASE));
      return {
        right: {
          upper: lerp(deg(22), deg(150), raise),
          fore: lerp(deg(-12), deg(175), raise),
          foreScale: lerp(0.6, 1, raise),
        },
        lean: lerp(deg(12), deg(2), raise),
        headPitch: 0,
        axis: 'forearm',
      };
    },
  },
  stir: {
    side: (phase) => ({
      right: {
        upper: deg(24) + Math.cos(phase * TAU) * deg(10),
        fore: deg(74) + Math.sin(phase * TAU) * deg(14),
      },
      lean: deg(8),
      headPitch: deg(10),
      axis: AXIS_DOWN,
    }),
    front: (phase) => ({
      right: {
        upper: deg(20) + Math.cos(phase * TAU) * deg(8),
        fore: deg(-34) + Math.sin(phase * TAU) * deg(14),
        foreScale: 0.8,
      },
      lean: deg(6),
      headPitch: 0,
      axis: AXIS_DOWN,
    }),
  },
  hoe: {
    side: (phase) => {
      const raise = easeInOut(swingCurve(phase, HAMMER_STRIKE_PHASE));
      return {
        right: { upper: lerp(deg(40), deg(112), raise), fore: lerp(deg(58), deg(150), raise) },
        left: { upper: lerp(deg(34), deg(100), raise), fore: lerp(deg(62), deg(138), raise) },
        lean: lerp(deg(20), deg(4), raise),
        headPitch: deg(10),
        axis: 'forearm',
        shift: HOE_CHOKE,
      };
    },
    front: (phase) => {
      const raise = easeInOut(swingCurve(phase, HAMMER_STRIKE_PHASE));
      return {
        right: {
          upper: lerp(deg(20), deg(120), raise),
          fore: lerp(deg(-6), deg(165), raise),
          foreScale: lerp(0.55, 1, raise),
        },
        lean: lerp(deg(14), deg(2), raise),
        headPitch: 0,
        axis: 'forearm',
        shift: HOE_CHOKE,
      };
    },
  },
  push: {
    side: (phase) => {
      const push = hump(phase);
      return {
        right: { upper: deg(66) + push * deg(12), fore: deg(88) + push * deg(4) },
        left: { upper: deg(60) + push * deg(12), fore: deg(84) + push * deg(4) },
        lean: deg(20) + push * deg(8),
        headPitch: deg(-4),
        axis: AXIS_UP,
      };
    },
    front: (phase) => {
      const push = hump(phase);
      return {
        right: { upper: deg(30), fore: deg(-40), foreScale: 0.55 - push * 0.15 },
        left: { upper: deg(30), fore: deg(-40), foreScale: 0.55 - push * 0.15 },
        lean: deg(16) + push * deg(8),
        headPitch: 0,
        axis: AXIS_UP,
      };
    },
  },
  plane: {
    side: (phase) => {
      const stroke = Math.sin(phase * TAU);
      return {
        right: { upper: deg(42) + stroke * deg(18), fore: deg(82) + stroke * deg(8) },
        left: { upper: deg(38) + stroke * deg(18), fore: deg(86) + stroke * deg(8) },
        lean: deg(18) + stroke * deg(6),
        headPitch: deg(14),
        axis: 0,
      };
    },
    front: (phase) => {
      const stroke = Math.sin(phase * TAU);
      return {
        right: { upper: deg(24), fore: deg(-36), foreScale: 0.7 - stroke * 0.15 },
        left: { upper: deg(24), fore: deg(-36), foreScale: 0.7 - stroke * 0.15 },
        lean: deg(14) + stroke * deg(6),
        headPitch: 0,
        axis: AXIS_DOWN,
      };
    },
  },
  crank: {
    side: (phase) => ({
      right: {
        upper: deg(52) + Math.cos(phase * TAU) * deg(22),
        fore: deg(100) + Math.sin(phase * TAU) * deg(24),
      },
      lean: deg(10),
      headPitch: deg(4),
      axis: AXIS_UP,
    }),
    front: (phase) => ({
      right: {
        upper: deg(34) + Math.cos(phase * TAU) * deg(14),
        fore: deg(-64) + Math.sin(phase * TAU) * deg(26),
        foreScale: 0.8,
      },
      lean: deg(6),
      headPitch: 0,
      axis: AXIS_UP,
    }),
  },
  sew: {
    side: (phase) => {
      const pull = hump(phase);
      return {
        right: { upper: deg(30) + pull * deg(26), fore: deg(108) + pull * deg(34) },
        left: { upper: deg(26), fore: deg(100) },
        lean: deg(8),
        headPitch: deg(14),
        axis: AXIS_UP,
      };
    },
    front: (phase) => {
      const pull = hump(phase);
      return {
        right: { upper: deg(26) + pull * deg(22), fore: deg(-74) + pull * deg(40) },
        left: { upper: deg(26), fore: deg(-84) },
        lean: deg(6),
        headPitch: 0,
        axis: AXIS_UP,
      };
    },
  },
  sketch: {
    side: (phase) => {
      const scribble = Math.sin(phase * TAU * 2);
      return {
        right: { upper: deg(40) + scribble * deg(5), fore: deg(84) + scribble * deg(9) },
        left: { upper: deg(36), fore: deg(90) },
        lean: deg(18),
        headPitch: deg(16),
        axis: AXIS_DOWN,
      };
    },
    front: (phase) => {
      const scribble = Math.sin(phase * TAU * 2);
      return {
        right: {
          upper: deg(24) + scribble * deg(4),
          fore: deg(-40) + scribble * deg(10),
          foreScale: 0.7,
        },
        left: { upper: deg(24), fore: deg(-46), foreScale: 0.7 },
        lean: deg(14),
        headPitch: 0,
        axis: AXIS_DOWN,
      };
    },
  },
};

/** How tightly a working paw grips. */
const WORK_PAW_CURL = 0.85;

/** One frame of a work loop in `view` (`front` or `side`). */
export function castWorkPose(phase: number, view: RatKinView, motion: WorkMotion): RatKinPose {
  const pose = view === 'side' ? idleSide(phase) : idleFacing(phase, false);
  const work = view === 'side' ? WORK[motion].side(phase) : WORK[motion].front(phase);
  const right = rightArmSlot(view);
  const rightAngles = anglesFor(
    view,
    right,
    work.right.upper,
    work.right.fore,
    work.right.foreScale,
  );
  setArm(pose, right, rightAngles, WORK_PAW_CURL);
  if (work.left !== undefined) {
    const left = otherSlot(right);
    setArm(
      pose,
      left,
      anglesFor(view, left, work.left.upper, work.left.fore, work.left.foreScale),
      WORK_PAW_CURL,
    );
  }
  pose.lean += work.lean;
  if (view === 'side') pose.headPitch += work.headPitch;
  pose.propAxis = work.axis === 'forearm' ? forearmAxis(view, right, work.right.fore) : work.axis;
  if (work.shift !== undefined) pose.propShift = work.shift;
  return pose;
}

// ── Soldiers ─────────────────────────────────────────────────────────────────

/** The frame of the thrust on which the spear is fully out — the hit. */
export const STRIKE_IMPACT_FRAME = 4;

/** The thrust's keys, by frame: guard, draw back, drive, full reach, recover. */
const STRIKE_DRIVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, -1],
  [3, 0.55],
  [STRIKE_IMPACT_FRAME, 1],
  [5, 0.8],
  [7, 0],
];

const STRIKE_SIDE_GUARD: ArmKey = { upper: deg(22), fore: deg(84) };
const STRIKE_SIDE_DRAWN: ArmKey = { upper: deg(-14), fore: deg(64) };
const STRIKE_SIDE_REACH: ArmKey = { upper: deg(72), fore: deg(90) };
const STRIKE_FACING_GUARD: ArmKey = { upper: deg(22), fore: deg(-10), foreScale: 0.8 };
const STRIKE_FACING_DRAWN: ArmKey = { upper: deg(12), fore: deg(10), foreScale: 0.9 };
/** Head-on the jab drives the paw out and up along the spear's own line. */
const STRIKE_FACING_REACH: ArmKey = { upper: deg(84), fore: deg(40), foreScale: 1 };
const STRIKE_LEAN = deg(20);
const STRIKE_LEAN_BACK = deg(-5);
/** The spear levels to the horizon edge-on, and angles out and up head-on. */
const STRIKE_SIDE_AXIS = deg(-4);
const STRIKE_FACING_AXIS = deg(-58);
const STRIKE_LUNGE = 0.08;
/**
 * The spear is gripped near its middle for the thrust, not near its butt as it
 * is carried: the whole shaft slides back through the paw, which keeps the
 * blade inside the figure's cell at full reach.
 */
const STRIKE_SPEAR_SHIFT = -0.64;

function mixArm(a: ArmKey, b: ArmKey, t: number): ArmKey {
  return {
    upper: lerp(a.upper, b.upper, t),
    fore: lerp(a.fore, b.fore, t),
    foreScale: lerp(a.foreScale ?? 1, b.foreScale ?? 1, t),
  };
}

/** The spear thrust: guard, draw back, drive to full reach on the impact frame, recover. */
export function castStrikePose(frame: number, view: RatKinView): RatKinPose {
  const pose = view === 'side' ? idleSide(0) : idleFacing(0, view === 'away');
  const drive = keyed(frame, STRIKE_DRIVE);
  const guard = view === 'side' ? STRIKE_SIDE_GUARD : STRIKE_FACING_GUARD;
  const drawn = view === 'side' ? STRIKE_SIDE_DRAWN : STRIKE_FACING_DRAWN;
  const reach = view === 'side' ? STRIKE_SIDE_REACH : STRIKE_FACING_REACH;
  const arm = drive >= 0 ? mixArm(guard, reach, drive) : mixArm(guard, drawn, -drive);
  const right = rightArmSlot(view);
  setArm(pose, right, anglesFor(view, right, arm.upper, arm.fore, arm.foreScale), GRIP_CURL);
  pose.lean += drive >= 0 ? drive * STRIKE_LEAN : -drive * STRIKE_LEAN_BACK;
  pose.propAxis = rightHandAxis(view, view === 'side' ? STRIKE_SIDE_AXIS : STRIKE_FACING_AXIS);
  pose.propShift = STRIKE_SPEAR_SHIFT;
  if (view === 'side') {
    const lunge = Math.max(0, drive) * STRIKE_LUNGE;
    pose.nearFoot = {
      ...pose.nearFoot,
      ball: { x: pose.nearFoot.ball.x + lunge, y: pose.nearFoot.ball.y },
    };
  }
  pose.earNear = -Math.max(0, drive) * TALK_EAR_PERK;
  return pose;
}

const HURT_KEYS: readonly (readonly [number, number])[] = [
  [0, 0.7],
  [1, 1],
  [2, 0.55],
  [3, 0.15],
];
const HURT_LEAN = deg(-12);
const HURT_HEAD = deg(-16);
const HURT_RISE = -0.025;
const HURT_EARS_BACK = deg(30);
const HURT_ROLL = deg(9);
const HURT_SQUINT = 0.8;

/** A flinch: thrown back, head snapped up, ears flat, eyes screwed shut. */
export function castHurtPose(frame: number, view: RatKinView, prop: HeldPropKind): RatKinPose {
  const pose = castIdlePose(0, view, prop);
  const hit = keyed(frame, HURT_KEYS);
  pose.lean += hit * HURT_LEAN;
  pose.bob += hit * HURT_RISE;
  pose.earNear = hit * HURT_EARS_BACK;
  pose.earFar = hit * HURT_EARS_BACK;
  pose.blink = hit * HURT_SQUINT;
  if (view === 'side') pose.headPitch += hit * HURT_HEAD;
  else pose.headRoll = hit * HURT_ROLL;
  return pose;
}

/** The collapse: the knees go, he drops onto his shins, and pitches forward. */
const DOWN_CROUCH = 1;
const DOWN_DROP = 0.4;
const DOWN_LEAN = deg(62);
/** Kneeling on a digitigrade leg lays the metatarsus flat along the floor. */
const DOWN_FOOT_PITCH = deg(84);
const DOWN_HEAD = deg(24);
const DOWN_ARM_UPPER = deg(40);
const DOWN_ARM_FORE = deg(52);
const DOWN_SPEAR_AXIS = deg(-164);
const DOWN_FACING_SPEAR_AXIS = deg(-150);
const DOWN_SLUMP_TAIL_CURL = deg(-40);
/** As he goes down the paw slides to the spear's butt, so the butt never drives through the floor. */
const DOWN_SPEAR_CHOKE = 0.4;
const DOWN_TAIL_SWEEP = deg(80);

function kneelingFoot(foot: FootPose, amount: number): FootPose {
  return { ...foot, pitch: lerp(foot.pitch, DOWN_FOOT_PITCH, amount), toeCurl: 0, toeRoll: 0 };
}

/**
 * How far into the collapse a frame of the down row is. The knees give first
 * and fastest; the pitch forward follows.
 */
function collapseAt(frame: number, frameCount: number): number {
  return clamp01(frame / (frameCount - 1));
}

/** One moment of the collapse, 0 standing to 1 down. */
export function castCollapsePose(amount: number, view: RatKinView, prop: HeldPropKind): RatKinPose {
  const pose = castIdlePose(0, view, prop);
  const knees = easeInOut(clamp01(amount * 2));
  const slump = easeInOut(clamp01(amount * 2 - 1));
  pose.crouch = lerp(pose.crouch, DOWN_CROUCH, knees);
  pose.bob += DOWN_DROP * knees;
  pose.lean += DOWN_LEAN * slump;
  pose.nearFoot = kneelingFoot(pose.nearFoot, knees);
  pose.farFoot = kneelingFoot(pose.farFoot, knees);
  pose.blink = slump;
  pose.earNear = slump * HURT_EARS_BACK;
  pose.earFar = slump * HURT_EARS_BACK;
  if (view === 'side') pose.headPitch += DOWN_HEAD * slump;
  for (const slot of ['near', 'far'] as const) {
    const angles = anglesFor(view, slot, DOWN_ARM_UPPER * slump, DOWN_ARM_FORE * slump, 1);
    const current = armOf(pose, slot);
    if (current === null) continue;
    setArm(
      pose,
      slot,
      {
        upper: lerp(current.upper, angles.upper, slump),
        fore: lerp(current.fore, angles.fore, slump),
        foreScale: current.foreScale,
      },
      slot === rightArmSlot(view) ? GRIP_CURL : lerp(HUMP_PEAK, 0, slump),
    );
  }
  // Head-on and from behind the tail hangs off to one side; with the hips on
  // the floor it has to swing out level along the ground or it hangs through it.
  const tailSweep = view === 'front' ? 1 : view === 'away' ? -1 : 0;
  pose.tail = {
    ...pose.tail,
    base: pose.tail.base + DOWN_TAIL_SWEEP * knees * tailSweep,
    curl: lerp(pose.tail.curl, DOWN_SLUMP_TAIL_CURL, slump),
    wave: 0,
  };
  if (prop !== 'none') {
    const downAxis = rightHandAxis(
      view,
      view === 'side' ? DOWN_SPEAR_AXIS : DOWN_FACING_SPEAR_AXIS,
    );
    pose.propAxis = lerp(PROP_CARRY[prop].axis, downAxis, slump);
    pose.propShift = DOWN_SPEAR_CHOKE * knees;
  }
  return pose;
}

export function castDownPose(
  frame: number,
  frameCount: number,
  view: RatKinView,
  prop: HeldPropKind,
): RatKinPose {
  return castCollapsePose(collapseAt(frame, frameCount), view, prop);
}

/** Getting up is the collapse run backwards, pushing up off the knees. */
export function castRisePose(
  frame: number,
  frameCount: number,
  view: RatKinView,
  prop: HeldPropKind,
): RatKinPose {
  return castCollapsePose(1 - collapseAt(frame, frameCount), view, prop);
}
