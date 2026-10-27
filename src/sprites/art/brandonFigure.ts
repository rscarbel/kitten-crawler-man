/**
 * Brandon's choreography and his `FigureDef`.
 *
 * Every row is authored once, as a pose of the three-dimensional rig, and
 * painted in all three views by projection: the front view is his front, not
 * his profile flipped, and the away view his back. A row therefore cannot
 * drift out of step between views, and the akimbo hand stays his left
 * whichever way he faces.
 *
 * The gait is the biped rig's structure, re-derived for a taller, longer-legged man:
 * the stance foot slides back at exactly the ground the stride covers, the
 * pelvis rides the lower of the two stance legs' reach arcs rather than a
 * keyed bob, and the free arm swings from its shoulder by its joint angles,
 * back on the same side as the foot striking the floor.
 */

import { clamp01, easeInOut, lerp } from './bipedArt';
import {
  type ArmAngles,
  type ArmPose,
  type BrandonPose,
  type BrandonView,
  type FootPose,
  type HandShape,
  HIP_HEIGHT,
  LEG_MAX_REACH,
  type V3,
  add3,
  ankleOverPivot,
  drawBrandon,
  RESTING_RIGHT_HAND,
  restingPose,
  sub3,
  v3,
} from './brandonArt';
import { GROUND_OFFSET_IN_TILE } from './humanFigure';
import { figureStates, type FigureDef } from '../figure/figureDef';
import {
  BRANDON_IDLE_FRAMES,
  BRANDON_SALUTE_FRAMES,
  BRANDON_SALUTE_RAISED_FRAME,
  BRANDON_WALK_FRAMES,
} from '../brandonTiming';

const TWO_PI = Math.PI * 2;

// ── Keyed tracks ─────────────────────────────────────────────────────────────

type Keys = readonly (readonly [number, number])[];

/** A value keyed on frame indices, eased between keys. */
function keyed(keys: Keys, t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

/** A Catmull–Rom point through evenly keyed points, for a swinging foot's path. */
function splinePoint(points: readonly V3[], stops: readonly number[], s: number): V3 {
  const last = points.length - 1;
  let index = 0;
  while (index < last - 1 && s > stops[index + 1]) index++;
  const span = stops[index + 1] - stops[index];
  const u = clamp01((s - stops[index]) / span);
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[Math.min(last, index + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  const blend = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return v3(
    blend(p0.x, p1.x, p2.x, p3.x),
    blend(p0.y, p1.y, p2.y, p3.y),
    blend(p0.z, p1.z, p2.z, p3.z),
  );
}

function wrap(phase: number): number {
  return phase - Math.floor(phase);
}

/** A loop row's phase at a frame: evenly spaced, never reaching 1, so the last frame is not the first. */
function loopPhase(frame: number, frames: number): number {
  return frame / frames;
}

/** Soft minimum: rides the lowest value and hands between near-equal ones without a corner. */
function softMin(values: readonly number[], sharpness: number): number {
  const floor = Math.min(...values);
  const sum = values.reduce((acc, v) => acc + Math.exp(-(v - floor) / sharpness), 0);
  return floor - sharpness * Math.log(sum);
}

// ── Shared body settings ─────────────────────────────────────────────────────

/**
 * Standing, the pelvis rides this far over the rig's hip height, so the legs
 * stand all but straight instead of breaking forward at the knee.
 */
const STANDING_LEG_STRAIGHTEN = 0.018;
const STANDING_HIP: V3 = v3(0, -(HIP_HEIGHT + STANDING_LEG_STRAIGHTEN), 0);
/** The hip joint sits this far below the pelvis centre. */
const HIP_JOINT_DROP = 0.02;
/** Standing, his left fist rests on his hip, elbow out: the proud akimbo. */
const AKIMBO_HAND: V3 = v3(-0.15, -0.97, 0.02);
/** The akimbo elbow breaks out and back: head-on it reads as a fist on the hip, and in profile it shows behind him. */
const AKIMBO_ELBOW_POLE: V3 = v3(-1, 0, -0.35);

function withAngles(angles: ArmAngles): ArmPose {
  return { kind: 'angles', angles };
}

// ── Idle: the breath ─────────────────────────────────────────────────────────

/**
 * The breath through the idle, frame by frame: pumped, let go all at once,
 * sagging, and hauled back up. One cycle over the row — a breath that cycled
 * more often than every four frames would alias into a flicker.
 */
const IDLE_BREATH: readonly number[] = [1, 0.74, 0.38, 0.1, 0, 0.02, 0.24, 0.55, 0.82, 0.97];
/** On the deflated beat he blinks, as a man does when he sighs. */
const IDLE_BLINK_FRAME = 5;
/** The rush of air on the way out. */
const IDLE_PUFF_FRAMES: ReadonlyMap<number, number> = new Map([
  [2, 0.35],
  [3, 0.25],
]);
const IDLE_CHIN_LIFT = -0.12;
const IDLE_CHIN_DROP = 0.1;
/** Standing at his door he holds himself upright, the chest a touch forward of his hips. */
const IDLE_LEAN = -0.02;
/** The deflated hips settle this far. */
const IDLE_SAG = 0.004;
/** His free hand sinks down his thigh as he goes soft. */
const IDLE_HAND_SAG = 0.03;

export function idlePose(frame: number): BrandonPose {
  const pose = restingPose();
  const breath = IDLE_BREATH[frame % BRANDON_IDLE_FRAMES];
  const slump = 1 - breath;
  const sag = v3(0, IDLE_SAG * slump, 0);
  pose.breath = breath;
  pose.hip = add3(STANDING_HIP, sag);
  pose.headPitch = lerp(IDLE_CHIN_DROP, IDLE_CHIN_LIFT, breath);
  pose.lean = IDLE_LEAN;
  pose.leftArm = {
    kind: 'reach',
    hand: add3(AKIMBO_HAND, v3(0, IDLE_HAND_SAG * slump, 0)),
    pole: AKIMBO_ELBOW_POLE,
  };
  pose.rightArm = {
    kind: 'reach',
    hand: add3(RESTING_RIGHT_HAND, add3(sag, v3(0, IDLE_HAND_SAG * slump, 0))),
  };
  pose.blink = frame === IDLE_BLINK_FRAME ? 1 : 0;
  pose.mouth = IDLE_PUFF_FRAMES.get(frame) ?? 0;
  pose.beardSwing = 0.01 * Math.sin((TWO_PI * frame) / BRANDON_IDLE_FRAMES);
  return pose;
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** Ten frames of sixteen with each foot down: a stance of 62%, double support either side of each contact. */
const WALK_STANCE_FRAMES = 10;
const WALK_STANCE_SHARE = (WALK_STANCE_FRAMES - 1) / BRANDON_WALK_FRAMES;
/** He strikes heel first with the toe lifted, and rolls off the ball of the foot. */
const WALK_HEEL_STRIKE_PITCH = 0.22;
const WALK_TOE_OFF_PITCH = -0.45;
/** The pelvis at double support, where the stride's reach is measured. */
const WALK_CONTACT_HIP = HIP_HEIGHT + 0.004;
/**
 * The share of a straight leg's full reach each foot takes: a host walking his
 * own floor takes short, unhurried steps, not a marcher's full stride.
 */
const WALK_STRIDE_SHARE = 0.68;
/** A walking leg is never quite locked, but the supporting one is close to it. */
const WALK_LEG_SPAN = LEG_MAX_REACH * 0.997;
const WALK_FOOT_HALF = 0.085;
const SOLE_LENGTH = 0.225;

function reachAhead(hipHeight: number, ankle: V3): number {
  const rootHeight = hipHeight - HIP_JOINT_DROP;
  const rise = rootHeight + ankle.y;
  return WALK_STRIDE_SHARE * Math.sqrt(Math.max(0, WALK_LEG_SPAN * WALK_LEG_SPAN - rise * rise));
}

const STRIKE_ANKLE_OFFSET = ankleOverPivot(0, 'heel', WALK_HEEL_STRIKE_PITCH);
const TOE_OFF_ANKLE_OFFSET = ankleOverPivot(0, 'toe', WALK_TOE_OFF_PITCH);
/** Where the striking heel lands, ahead of the pelvis. */
const WALK_HEEL_STRIKE = reachAhead(WALK_CONTACT_HIP, STRIKE_ANKLE_OFFSET) - STRIKE_ANKLE_OFFSET.z;
/** Where the pushing toe is as it leaves the floor, behind the pelvis. */
const WALK_TOE_OFF = -reachAhead(WALK_CONTACT_HIP, TOE_OFF_ANKLE_OFFSET) - TOE_OFF_ANKLE_OFFSET.z;
/** Ground covered in one stance: heel strike to toe-off, the foot rolling heel to toe. */
const WALK_STANCE_GROUND = WALK_HEEL_STRIKE + SOLE_LENGTH - WALK_TOE_OFF;
/**
 * Ground one full walk cycle covers, in tiles. The resident advances the walk's
 * phase by the ground he actually covers over this, or the planted foot skates.
 */
export const BRANDON_WALK_GROUND_PER_CYCLE = WALK_STANCE_GROUND / WALK_STANCE_SHARE;

/** Heel strike toes-up, flat through mid-stance, heel off late and up onto the toes. */
const WALK_STANCE_PITCH: Keys = [
  [0, WALK_HEEL_STRIKE_PITCH],
  [0.16, 0],
  [0.55, 0],
  [1, WALK_TOE_OFF_PITCH],
];

/** A stance foot rocks on its heel while its toe is up and on its toe once its heel is. */
function walkStanceFoot(u: number, x: number): FootPose {
  const heel = WALK_HEEL_STRIKE - WALK_STANCE_GROUND * u;
  const pitch = keyed(WALK_STANCE_PITCH, u);
  const ankle =
    pitch >= 0
      ? ankleOverPivot(heel, 'heel', pitch)
      : ankleOverPivot(heel + SOLE_LENGTH, 'toe', pitch);
  return { ankle: v3(x, ankle.y, ankle.z), pitch, planted: true };
}

/**
 * The swing: the foot peels off behind, tucks up with the knee folded, passes
 * low under the hip and reaches forward straight-kneed to strike. His tuck is
 * shallower than the biped figure's — an old soldier's stiff march — but it is there, or
 * the swing is a goose step.
 */
const WALK_SWING_STOPS: readonly number[] = [0, 0.3, 0.58, 0.84, 1];
/**
 * How high the swinging ankle rides as it peels off and as it passes under
 * him: low, for a short unhurried step, so the knee folds only a little.
 */
const WALK_SWING_PEEL_ANKLE = 0.18;
const WALK_SWING_PASS_ANKLE = 0.14;
const WALK_SWING_PITCH: Keys = [
  [0, WALK_TOE_OFF_PITCH],
  [0.3, -0.5],
  [0.58, 0],
  [0.84, 0.22],
  [1, WALK_HEEL_STRIKE_PITCH],
];

function walkSwingFoot(s: number, x: number): FootPose {
  const start = walkStanceFoot(1, x).ankle;
  const end = walkStanceFoot(0, x).ankle;
  const points = [
    start,
    v3(x, -WALK_SWING_PEEL_ANKLE, start.z + 0.1),
    v3(x, -WALK_SWING_PASS_ANKLE, 0.02),
    v3(x, end.y - 0.06, end.z + 0.03),
    end,
  ];
  return {
    ankle: splinePoint(points, WALK_SWING_STOPS, s),
    pitch: keyed(WALK_SWING_PITCH, s),
    planted: false,
  };
}

function walkFoot(phase: number, x: number): FootPose {
  const cycle = wrap(phase);
  if (cycle <= WALK_STANCE_SHARE) return walkStanceFoot(cycle / WALK_STANCE_SHARE, x);
  return walkSwingFoot((cycle - WALK_STANCE_SHARE) / (1 - WALK_STANCE_SHARE), x);
}

const WALK_MID_STANCE_RISE = 0.03;
/** How sharply the pelvis hands from one stance leg's arc to the other's. */
const WALK_ARC_BLEND = 0.008;
/**
 * Set above anything the legs can reach, so at mid-stance the pelvis rides
 * the supporting leg's full arc and that knee straightens.
 */
const WALK_TOP_HIP = HIP_HEIGHT + WALK_MID_STANCE_RISE;

/**
 * The walking pelvis: lowest at each contact, highest as he vaults over the
 * planted leg at mid-stance, on a smooth curve twice a cycle — and never
 * higher than either planted leg can reach, which is what sets the contact
 * low. Riding the reach ceilings alone drops it the whole way in the one
 * frame the heel strikes, a visible jolt; the curve spreads that fall over
 * the frames running into contact.
 */
function walkHipHeight(phase: number, right: FootPose, left: FootPose): number {
  const ceilings = [WALK_TOP_HIP];
  for (const foot of [right, left]) {
    if (!foot.planted) continue;
    const rise = Math.sqrt(
      Math.max(0, WALK_LEG_SPAN * WALK_LEG_SPAN - foot.ankle.z * foot.ankle.z),
    );
    ceilings.push(-foot.ankle.y + rise + HIP_JOINT_DROP);
  }
  const vault = (1 - Math.cos(2 * TWO_PI * phase)) / 2;
  const curve = WALK_CONTACT_HIP + (WALK_TOP_HIP - WALK_CONTACT_HIP) * vault;
  return softMin([...ceilings, curve], WALK_ARC_BLEND);
}

/** The free arm's swing, forward first at right-foot contact. */
const WALK_ARM_SWING = 0.2;
const WALK_ARM_ABDUCT = 0.05;
const WALK_ELBOW = 0.12;
/** The elbow bends a little more as the arm comes forward. */
const WALK_ELBOW_FORWARD_FLEX = 0.08;
/** He walks upright, a touch forward of plumb, chin level. */
const WALK_LEAN = 0.02;
const WALK_CHIN = 0;
const WALK_TWIST = 0.03;
const WALK_SWAY = 0.018;

export function walkPose(frame: number): BrandonPose {
  const phase = loopPhase(frame, BRANDON_WALK_FRAMES);
  const pose = restingPose();
  const right = walkFoot(phase, WALK_FOOT_HALF);
  const left = walkFoot(phase + 0.5, -WALK_FOOT_HALF);
  const hipHeight = walkHipHeight(phase, right, left);
  const angle = TWO_PI * phase;
  const sway = WALK_SWAY * Math.cos(angle - TWO_PI * (WALK_STANCE_SHARE / 2));
  pose.hip = v3(sway, -hipHeight, 0);
  pose.rightFoot = right;
  pose.leftFoot = left;
  pose.lean = WALK_LEAN;
  pose.headPitch = WALK_CHIN;
  pose.twist = -WALK_TWIST * Math.cos(angle);
  // Each arm swings forward with the opposite foot: the left leads at right-foot contact.
  for (const side of [-1, 1] as const) {
    const forward = Math.cos(angle) * -side;
    const arm = withAngles({
      swing: WALK_ARM_SWING * forward,
      abduct: WALK_ARM_ABDUCT,
      elbow: WALK_ELBOW + WALK_ELBOW_FORWARD_FLEX * Math.max(0, forward),
    });
    if (side === 1) pose.rightArm = arm;
    else pose.leftArm = arm;
  }
  pose.beardSwing = 0.02 + 0.012 * Math.sin(2 * angle - 1);
  return pose;
}

// ── Salute ───────────────────────────────────────────────────────────────

/**
 * Where his right wrist is on each frame of the salute. It starts exactly
 * where the idle holds it, so the greeting begins without a pop, and rises
 * flat and close to his body. On {@link BRANDON_SALUTE_RAISED_FRAME} the
 * fingertips meet his temple, above the eye. The hand stays at his brow as
 * the bow begins, comes down in front of him with the elbow bent close to his
 * body, and lies flat over his heart while he bows, then drops back to hang
 * at his side. The last frame is one step short of the idle's hand, so the
 * row never repeats its first frame.
 */
const SALUTE_WRIST_PATH: readonly V3[] = [
  RESTING_RIGHT_HAND,
  v3(0.27, -1.08, 0.12),
  v3(0.26, -1.28, 0.2),
  v3(0.22, -1.48, 0.22),
  v3(0.17, -1.665, 0.2),
  v3(0.17, -1.665, 0.2),
  v3(0.17, -1.665, 0.2),
  v3(0.17, -1.665, 0.2),
  v3(0.12, -1.47, 0.3),
  v3(-0.04, -1.32, 0.16),
  v3(-0.04, -1.32, 0.16),
  v3(0.29, -0.97, 0.08),
  v3(0.29, -0.92, 0.065),
];
/**
 * At his brow the elbow lifts forward and a little out, just over shoulder
 * height: head-on and from behind the forearm slopes up and in to his temple
 * on its own side of his face, and in profile it is a diagonal up and back to
 * the brow, clear of his eye.
 */
const SALUTE_ELBOW_POLE: V3 = v3(0.3, -0.2, 1);
/**
 * Everywhere else the elbow stays low and forward, under the hand, so the
 * hand travels close to his body rather than out on a level arm.
 */
const CLOSE_ELBOW_POLE: V3 = v3(0.15, 1, 0.1);
/** The frame the hand leaves his brow, coming down in front of him. */
const SALUTE_SWEEP_FRAME = 8;
/** From here the arm hangs again as it does at idle, so it settles back without a pop. */
const SALUTE_HANGING_FROM = 11;
/** The frames the hand lies over his heart for the bow. */
const SALUTE_HEART_FROM = 9;
const SALUTE_LAST = BRANDON_SALUTE_FRAMES - 1;
const SALUTE_HELD_TO = BRANDON_SALUTE_RAISED_FRAME + 2;
const SALUTE_FLAT_FROM = 1;
/** At the brow he nods once, sharply down and slowly back up, the hand riding with his head. */
const SALUTE_NOD = 0.12;
const SALUTE_NOD_HAND_DROP = 0.012;
const SALUTE_NOD_KEYS: Keys = [
  [BRANDON_SALUTE_RAISED_FRAME, 0],
  [BRANDON_SALUTE_RAISED_FRAME + 1, 1],
  [BRANDON_SALUTE_RAISED_FRAME + 2, 0.5],
  [SALUTE_HELD_TO, 0.2],
  [SALUTE_HELD_TO + 1, 0],
];
/** The second frame over his heart is already on its way back up, so the two never match. */
const SALUTE_BOW_RISING = 0.85;
/**
 * He bows from the hips, back straight and legs straight, starting while his
 * fingertips are still at his brow and deepest with his hand over his heart:
 * a host's welcome.
 */
const SALUTE_BOW_KEYS: Keys = [
  [SALUTE_HELD_TO, 0],
  [SALUTE_SWEEP_FRAME, 0.7],
  [SALUTE_HEART_FROM, 1],
  [SALUTE_HEART_FROM + 1, SALUTE_BOW_RISING],
  [SALUTE_LAST, 0],
];
/** About 29 degrees at the hips: deep enough that head-on the head and shoulders drop, never a fold. */
const SALUTE_BOW_LEAN = 0.5;
/** The chin tucks into the bow so the beard folds against his chest. */
const SALUTE_BOW_CHIN_TUCK = 0.3;
const SALUTE_PUFF = 1.1;
/** The pelvis the bow pivots on, as the hand rides the torso through it. */
const BOW_PIVOT: V3 = v3(0, -HIP_HEIGHT, 0);

/** A point carried forward with the torso as it pitches `lean` about the pelvis. */
function bowed(point: V3, lean: number): V3 {
  const rel = sub3(point, BOW_PIVOT);
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  return add3(BOW_PIVOT, v3(rel.x, rel.y * cos + rel.z * sin, rel.z * cos - rel.y * sin));
}

function saluteElbowPole(frame: number): V3 | undefined {
  if (frame === 0 || frame >= SALUTE_HANGING_FROM) return undefined;
  const atBrow = frame >= BRANDON_SALUTE_RAISED_FRAME && frame < SALUTE_SWEEP_FRAME;
  return atBrow ? SALUTE_ELBOW_POLE : CLOSE_ELBOW_POLE;
}

function saluteHand(frame: number): HandShape {
  if (frame >= BRANDON_SALUTE_RAISED_FRAME && frame < SALUTE_SWEEP_FRAME) return 'blade';
  if (frame >= SALUTE_FLAT_FROM && frame < BRANDON_SALUTE_RAISED_FRAME) return 'open';
  if (frame >= SALUTE_SWEEP_FRAME && frame < SALUTE_LAST) return 'open';
  return 'fist';
}

export function salutePose(frame: number): BrandonPose {
  // Built on the idle's first frame, so the greeting starts from exactly the
  // stance and breath he was standing in.
  const pose = idlePose(0);
  const nod = SALUTE_NOD * keyed(SALUTE_NOD_KEYS, frame);
  const bow = keyed(SALUTE_BOW_KEYS, frame);
  const atBrow = frame >= BRANDON_SALUTE_RAISED_FRAME && frame <= SALUTE_HELD_TO;
  const bowLean = SALUTE_BOW_LEAN * bow;
  const wrist = add3(
    SALUTE_WRIST_PATH[Math.min(frame, SALUTE_LAST)],
    v3(0, SALUTE_NOD_HAND_DROP * (nod / SALUTE_NOD), 0),
  );
  const hand = bowed(wrist, bowLean);
  const pole = saluteElbowPole(frame);
  pose.rightArm = pole === undefined ? { kind: 'reach', hand } : { kind: 'reach', hand, pole };
  pose.rightHand = saluteHand(frame);
  pose.lean += bowLean;
  pose.breath = atBrow ? SALUTE_PUFF : pose.breath;
  pose.headPitch += nod + SALUTE_BOW_CHIN_TUCK * bow;
  pose.mouth = atBrow && frame < SALUTE_HELD_TO ? 0.45 : 0;
  pose.beardSwing = -0.02 * bow;
  return pose;
}

// ── The row table ────────────────────────────────────────────────────────────

export const BRANDON_ACTIONS = ['idle', 'walk', 'salute'] as const;
export type BrandonAction = (typeof BRANDON_ACTIONS)[number];

export type BrandonRowKind = 'loop' | 'oneShot';

export interface BrandonRow {
  readonly action: BrandonAction;
  readonly frames: number;
  readonly kind: BrandonRowKind;
  readonly pose: (frame: number, view: BrandonView) => BrandonPose;
  /**
   * How the row's frames advance: by ground covered (a gait), by the clock
   * with per-frame holds, or by the progress of the action it shows.
   */
  readonly pacing: 'ground' | 'clock' | 'progress';
}

export const BRANDON_ROWS: Readonly<Record<BrandonAction, BrandonRow>> = {
  idle: {
    action: 'idle',
    frames: BRANDON_IDLE_FRAMES,
    kind: 'loop',
    pose: idlePose,
    pacing: 'clock',
  },
  walk: {
    action: 'walk',
    frames: BRANDON_WALK_FRAMES,
    kind: 'loop',
    pose: walkPose,
    pacing: 'ground',
  },
  salute: {
    action: 'salute',
    frames: BRANDON_SALUTE_FRAMES,
    kind: 'oneShot',
    pose: salutePose,
    pacing: 'progress',
  },
};

export const BRANDON_VIEWS: readonly BrandonView[] = ['front', 'side', 'back'];

const VIEW_SUFFIX: Readonly<Record<BrandonView, string>> = {
  front: '',
  side: '_side',
  back: '_away',
};

/** The state name a row takes in a view: `walk`, `walk_side`, `walk_away`. */
export function brandonStateName(action: BrandonAction, view: BrandonView): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

interface ResolvedState {
  readonly row: BrandonRow;
  readonly view: BrandonView;
}

const STATE_INDEX: ReadonlyMap<string, ResolvedState> = new Map(
  BRANDON_ACTIONS.map((action) => BRANDON_ROWS[action]).flatMap((row) =>
    BRANDON_VIEWS.map((view): [string, ResolvedState] => [
      brandonStateName(row.action, view),
      { row, view },
    ]),
  ),
);

/** The pose a state paints at a frame; throws on a state the figure does not have. */
export function brandonPoseAt(
  state: string,
  frame: number,
): { pose: BrandonPose; view: BrandonView } {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) throw new Error(`Brandon has no state "${state}"`);
  return { pose: resolved.row.pose(frame, resolved.view), view: resolved.view };
}

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * Cell pixels per unit of his rig, the unit every pose, length and reach in
 * his art is authored in. A tile spans fewer cell pixels than a unit
 * ({@link TILE_SCALE}), so one unit of his rig stands taller than a tile in
 * the world.
 */
export const PX_PER_FIGURE_UNIT = 48;
/**
 * How many world tiles one unit of his rig is meant to span. He is a lanky
 * old man who stands a head over the crawlers he greets, so his rig is drawn
 * larger than a tile per unit.
 */
const BRANDON_SIZE_OVER_RIG = 1.2;
/**
 * Cell pixels per world tile; the runtime scales by tileSize / TILE_SCALE.
 * Rounded so the tile's edges fall on whole cell rows.
 */
export const TILE_SCALE = Math.round(PX_PER_FIGURE_UNIT / BRANDON_SIZE_OVER_RIG);
/** World tiles one unit of his rig spans, as {@link TILE_SCALE} lands it. */
export const BRANDON_TILES_PER_FIGURE_UNIT = PX_PER_FIGURE_UNIT / TILE_SCALE;
/**
 * How far his ink reaches from his origin, in figure units, a little past the
 * widest pose on each side: the stride and the swinging arms in profile
 * (the cell is mirrored about his tile's centre for a left facing), the crown
 * of his hair, and the front foot reaching toward the camera head-on. The
 * cell is cut to these and no wider; the structural gate fails any pose that
 * outgrows it.
 */
const REACH_LEFT_UNITS = 0.7;
const REACH_RIGHT_UNITS = 0.7;
const REACH_UP_UNITS = 1.9;
const REACH_DOWN_UNITS = 0.16;
/** His feet stand on the same line down a tile as the human crawler's, so the two share a floor. */
const GROUND_ROW_IN_TILE = Math.round(GROUND_OFFSET_IN_TILE * TILE_SCALE);
export const ORIGIN_X = Math.round(REACH_LEFT_UNITS * PX_PER_FIGURE_UNIT);
export const ORIGIN_Y = Math.round(REACH_UP_UNITS * PX_PER_FIGURE_UNIT);
export const FRAME_W = ORIGIN_X + Math.round(REACH_RIGHT_UNITS * PX_PER_FIGURE_UNIT);
export const FRAME_H = ORIGIN_Y + Math.round(REACH_DOWN_UNITS * PX_PER_FIGURE_UNIT);
export const TILE_X = ORIGIN_X - TILE_SCALE / 2;
export const TILE_Y = ORIGIN_Y - GROUND_ROW_IN_TILE;

function paintBrandonFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const resolved = STATE_INDEX.get(state);
  if (resolved === undefined) return;
  const pose = resolved.row.pose(frame, resolved.view);
  ctx.save();
  try {
    ctx.translate(ORIGIN_X, ORIGIN_Y);
    ctx.scale(PX_PER_FIGURE_UNIT, PX_PER_FIGURE_UNIT);
    drawBrandon(ctx, pose, resolved.view);
  } finally {
    ctx.restore();
  }
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [state, resolved] of STATE_INDEX) frames[state] = resolved.row.frames;
  return frames;
}

export const BRANDON_FIGURE: FigureDef = {
  id: 'brandon',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(stateFrames()),
  paintFrame: paintBrandonFrame,
};
