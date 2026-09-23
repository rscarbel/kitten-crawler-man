/**
 * Pieces of Carl's choreography more than one row family is built from: a
 * one-shot's progress split around its impact, the blink, where a relaxed arm
 * hangs, a smooth path through timed keys, the rolling foot and the leg's
 * reach at a given knee bend, the damped spring loose parts hang on, and the
 * walking arm swing.
 */

import { footSoleLandmarks, RIGHT_FOOT_OUT } from '../carl/feet';
import { HALF_PI, offset, pt, rotate, TWO_PI } from '../carl/geometry';
import {
  ANKLE_Y,
  ARM_LENGTH,
  FACING_ARM_ROOT_HALF,
  FOREARM_LENGTH,
  SHIN_LENGTH,
  SHOULDER_JOINT_DROP,
  THIGH_LENGTH,
  UPPER_ARM_LENGTH,
} from '../carl/proportions';
import { type ArmAngles, type BodySide, FULL_UPPER_ARM, LEG_MAX_REACH, VIEWS } from '../carl/rig';
import { deg, hump, type Pt } from '../carlArt';
import { RUN_FRAMES } from './timing';

// ── Phase ────────────────────────────────────────────────────────────────────

/** Every gait keys its cycle at the right foot's contact; the left runs half a cycle behind. */
export const HALF_CYCLE = 0.5;
/** One run frame's share of the cycle: what a frame of a blow thrown on the move carries the legs on. */
export const RUN_FRAME_PHASE = 1 / RUN_FRAMES;

/** The run phase `frame` frames on from `entry`, the legs carried `perFrame` of a cycle a frame. */
export function runPhaseAt(entry: number, frame: number, perFrame = RUN_FRAME_PHASE): number {
  return (entry + frame * perFrame) % 1;
}

/** Wraps a phase into `[0, 1)`. */
export function wrapPhase(phase: number): number {
  return ((phase % 1) + 1) % 1;
}

/**
 * Where in a loop the blink is shut. Three quarters of a turn is a whole frame
 * of both the 8-frame and the 16-frame loops, so every row that blinks paints
 * the eye fully closed on one of its own frames rather than only between two.
 */
export const BLINK_AT = 0.75;
const BLINK_WIDTH = 0.08;
/**
 * `hump` peaks halfway through its interval, so the blink's half-width is
 * mapped onto the rising half of it: 1 at the centre, 0 at the edge.
 */
const HUMP_PEAK = 0.5;

/**
 * How far `phase` lies from `at` round a loop, signed and in [-0.5, 0.5): the
 * short way round, so a point just past the loop's end is near its start.
 */
function wrappedPhaseDistance(phase: number, at: number): number {
  return ((phase - at + WRAP_BIAS) % 1) - HALF_LOOP;
}

/** Keeps the `%` operand positive for any phase down to one loop behind `at`. */
const WRAP_BIAS = 1.5;
const HALF_LOOP = 0.5;

/** A blink centred on `at`, expressed in cycle phase: 1 with the eye shut. */
export function blink(phase: number, at: number): number {
  const distance = Math.abs(wrappedPhaseDistance(phase, at));
  return distance > BLINK_WIDTH ? 0 : hump(HUMP_PEAK * (1 - distance / BLINK_WIDTH));
}

/**
 * Where a relaxed arm hangs: straight down from the shoulder root, wrist level
 * with the boxer hem. Standing and the head-on walk share these, because the
 * walk has to start from where he stands.
 *
 * Both numbers are load-bearing. Set the hands inboard of the shoulder roots
 * (`SHOULDER_HALF * ARM_INSET`, 0.252) and the forearms converge on the
 * centreline, which turns his hands inward in front of his own crotch. Set the
 * drop past the arm's reach (0.628) and the IK clamps it, which tips the whole
 * arm toward whatever the target was — inward, again.
 *
 * Any further out than this and a one-pixel gap opens between the thick
 * forearm and the boxers, which the silhouette outline fills with an ink line
 * down each side of his hips. A heavy man's forearms hang against his thighs.
 */
const HAND_HANG_SPREAD = 0.31;
/**
 * How far the wrist sits below the shoulder *joint* — just inside the arm's own
 * reach, so the IK has nothing to bend to take up. Measured from the shoulder
 * line instead (the joint is `SHOULDER_JOINT_DROP` lower) the arm comes up 0.05
 * short of straight, and the solver spends every bit of that slack throwing the
 * elbow sideways: a 6px bow on a 46px-per-tile sheet.
 */
const ARM_HANG_REACH = ARM_LENGTH * 0.995;
/** The same hang, measured from the shoulder line, where poses place hands. */
export const HAND_HANG_DROP = SHOULDER_JOINT_DROP + ARM_HANG_REACH;
/**
 * Feet stand under the hips. Any wider and the thighs have to angle out to
 * reach them, which reads as knock-kneed however subtle the knee itself is.
 */
export const IDLE_FOOT_SPREAD = 0.135;

// ── Arms posed by their joints ───────────────────────────────────────────────

/** A straight arm is never asked for its full length: a locked elbow is a hyper-extended one. */
const ARM_REACH_CAP = 0.985;

/** Shoulder to wrist, with the upper arm drawn `upperScale` of its length. */
export function armLength(upperScale = FULL_UPPER_ARM): number {
  return UPPER_ARM_LENGTH * upperScale + FOREARM_LENGTH;
}

/**
 * The joint angles that put a wrist on `target`, with the elbow below the line
 * from shoulder to wrist — the way a boxer's elbow hangs behind a punch.
 * `upperScale` is the share of the upper arm drawn, which the pose must carry
 * too for the arm to be drawn the length it was solved at.
 *
 * Solved here rather than handed to the rig's IK because edge-on the rig bends
 * its two arms' elbows in opposite senses (head-on that keeps them off the
 * ribs); the near arm solved from a hand target flips its elbow up over the
 * face.
 */
export function armReaching(shoulder: Pt, target: Pt, upperScale = FULL_UPPER_ARM): ArmAngles {
  const upperLength = UPPER_ARM_LENGTH * upperScale;
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  const span = Math.min(distance, armLength(upperScale) * ARM_REACH_CAP);
  const towardTarget = Math.atan2(dx, dy);
  const cosAtShoulder =
    (upperLength * upperLength + span * span - FOREARM_LENGTH * FOREARM_LENGTH) /
    (2 * upperLength * span);
  const upper = towardTarget - Math.acos(Math.max(-1, Math.min(1, cosAtShoulder)));
  const elbow = offset(shoulder, Math.sin(upper) * upperLength, Math.cos(upper) * upperLength);
  const wrist = offset(shoulder, (dx / distance) * span, (dy / distance) * span);
  const fore = Math.atan2(wrist.x - elbow.x, wrist.y - elbow.y);
  return { upper, fore, foreScale: 1 };
}

/**
 * The joint angles that draw an arm through `joint` (the elbow) to `end` (the
 * wrist) from `root` (the shoulder), the forearm drawn at the length that
 * takes. Pair it with {@link upperArmShareThrough} for the upper arm's.
 *
 * It is how two differently driven arms — a guard fist placed by its hand, an
 * idle arm hung by its angles — are blended joint by joint rather than hand by
 * hand: blending the hands sends the IK through elbow solutions neither end
 * pose uses.
 */
export function anglesThrough(root: Pt, joint: Pt, end: Pt): ArmAngles {
  const upperX = joint.x - root.x;
  const upperY = joint.y - root.y;
  const foreX = end.x - joint.x;
  const foreY = end.y - joint.y;
  return {
    upper: Math.atan2(upperX, upperY),
    fore: Math.atan2(foreX, foreY),
    foreScale: Math.hypot(foreX, foreY) / FOREARM_LENGTH,
  };
}

/** The share of the upper arm drawn by an arm whose elbow is at `joint`, from its shoulder at `root`. */
export function upperArmShareThrough(root: Pt, joint: Pt): number {
  return Math.hypot(joint.x - root.x, joint.y - root.y) / UPPER_ARM_LENGTH;
}

/** Enough halvings to narrow any of the choreography's searches below a millionth of a tile. */
const BISECTION_STEPS = 40;

/**
 * The value in [`low`, `high`] where `below` turns from true to false, found by
 * bisection: `below(x)` is true when the answer lies above `x`.
 */
export function bisect(low: number, high: number, below: (x: number) => boolean): number {
  let from = low;
  let to = high;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (from + to) / 2;
    if (below(mid)) from = mid;
    else to = mid;
  }
  return (from + to) / 2;
}

// ── Keyed paths ──────────────────────────────────────────────────────────────

/** One key of a path: a value at a phase. */
export type PathKey = readonly [t: number, value: number];

/**
 * A smooth curve through timed keys: a cubic Hermite spline whose slope at
 * each key is the chord across its two neighbours, divided by the *time*
 * between them.
 *
 * Dividing by time rather than by key count is what keeps it smooth. Keys are
 * spaced by what the motion does, not evenly, and a spline that treats them as
 * evenly spaced turns every sharp change of spacing into a corner in the
 * joint's path. Before the first key and after the last the path holds that
 * key's value; a caller that needs a slope at the ends passes a key beyond
 * them.
 */
export function splineKeys(t: number, keys: readonly PathKey[]): number {
  const last = keys.length - 1;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[last][0]) return keys[last][1];
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const [t0, v0] = keys[i];
  const [t1, v1] = keys[i + 1];
  const span = t1 - t0;
  const slopeAt = (k: number): number => {
    const before = keys[Math.max(0, k - 1)];
    const after = keys[Math.min(last, k + 1)];
    return (after[1] - before[1]) / (after[0] - before[0]);
  };
  const m0 = slopeAt(i) * span;
  const m1 = slopeAt(i + 1) * span;
  const u = (t - t0) / span;
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1
  );
}

/** A channel keyed by frame and sampled by {@link splineKeys}. */
export type Track = readonly PathKey[];

export function trackAt(frame: number, track: Track): number {
  return splineKeys(frame, track);
}

/** A channel that starts and ends on `rest`, with `keys` in between. */
export function fromRest(rest: number, lastFrame: number, keys: readonly PathKey[]): Track {
  return [[0, rest], ...keys, [lastFrame, rest]];
}

/** A channel that is zero on the first and last frame: an offset from the pose it leaves and returns to. */
export function offsetTrack(lastFrame: number, keys: readonly PathKey[]): Track {
  return fromRest(0, lastFrame, keys);
}

/** One value per frame of a row, read without interpolation. */
export type FrameTable = readonly number[];

/** A table's value on `frame`, held at its ends past either end of the row. */
export function frameValue(table: FrameTable, frame: number): number {
  const last = table.length - 1;
  return table[Math.min(last, Math.max(0, frame))];
}

// ── The rolling foot ─────────────────────────────────────────────────────────

/** Where the heel and toe ends of the sole sit relative to the ankle, at a pitch, in profile. */
export function soleOffsets(pitch: number): { heel: Pt; toe: Pt } {
  return footSoleLandmarks(pt(0, 0), pitch, VIEWS.side, RIGHT_FOOT_OUT);
}

/**
 * The height, in figure space, a sole landmark rests at when the foot stands
 * flat: the height every standing row's feet already stand at, so a planted
 * gait foot and an idle foot share one floor.
 */
export const SOLE_REST_Y = ANKLE_Y + soleOffsets(0).toe.y;

/** Which end of the sole a planted foot rolls over. */
type SolePivot = 'heel' | 'toe';

/**
 * The ankle of a foot rolling about one end of its sole: that end stays on the
 * floor at `pivotX` while the foot pitches about it. This is the only way a
 * foot can heel-strike or push off without its contact point skating — the
 * ankle moves, the point on the floor does not.
 */
export function ankleOverPivot(pivotX: number, pivot: SolePivot, pitch: number): Pt {
  const offsets = soleOffsets(pitch);
  const end = pivot === 'heel' ? offsets.heel : offsets.toe;
  return pt(pivotX - end.x, SOLE_REST_Y - end.y);
}

/** How far ahead of its ankle the toe end of a flat foot reaches. */
export const TOE_AHEAD_OF_ANKLE = soleOffsets(0).toe.x;
/** How far the toe end of a flat foot lies ahead of its heel end. */
export const SOLE_LENGTH = soleOffsets(0).toe.x - soleOffsets(0).heel.x;

/**
 * The profile foot target that puts the ankle at `ankle` for a foot at
 * `pitch`: the rig measures a pitched foot's ankle up along the foot from its
 * target, so the target is the ankle stepped back down that line.
 */
export function profileFootTarget(ankle: Pt, pitch: number): Pt {
  const lifted = rotate(pt(0, ANKLE_Y), -pitch);
  return pt(ankle.x - lifted.x, ankle.y - lifted.y);
}

/**
 * Hip-to-ankle distance of a leg whose knee is bent `flex` radians off
 * straight. A gait's reach is set by the knee bend it lands and pushes off
 * with, so every stride constant below is solved from one of these rather than
 * chosen.
 */
export function legSpanAtKneeFlex(flex: number): number {
  return Math.sqrt(
    THIGH_LENGTH * THIGH_LENGTH +
      SHIN_LENGTH * SHIN_LENGTH +
      2 * THIGH_LENGTH * SHIN_LENGTH * Math.cos(flex),
  );
}

/**
 * How far out from under the hip joint an ankle can sit at a given knee bend,
 * with the hip joint `hipHeight` above the floor and the ankle `ankleHeight`
 * above it.
 */
export function ankleReachAtKneeFlex(flex: number, hipHeight: number, ankleHeight: number): number {
  const span = Math.min(legSpanAtKneeFlex(flex), LEG_MAX_REACH);
  const drop = hipHeight - ankleHeight;
  return Math.sqrt(Math.max(0, span * span - drop * drop));
}

// ── Secondary motion: a damped spring on a moving anchor ─────────────────────

/**
 * A loose part hung on a damped spring: `naturalCycles` is how many times it
 * would swing freely in one loop of the row, `damping` the damping ratio
 * (0 rings for ever, 1 settles without overshoot).
 */
export interface Spring {
  readonly naturalCycles: number;
  readonly damping: number;
}

/**
 * The fewest frames any oscillation drawn into a row may take per cycle.
 * Sampled more coarsely it aliases: to a freeze if the frames land on the same
 * part of each cycle, or to a strobe that jumps a part back and forth.
 */
const MIN_FRAMES_PER_FLUTTER_CYCLE = 4;

/** One harmonic of a periodic anchor path: `cos · cos(2πnφ) + sin · sin(2πnφ)`. */
export interface Harmonic {
  readonly n: number;
  readonly cos: number;
  readonly sin: number;
}

/**
 * The harmonics of an anchor path sampled evenly round one loop, up to the
 * highest a row of `frames` frames can draw without aliasing. The constant
 * term is dropped: a spring hangs at rest under a steady offset.
 */
export function anchorHarmonics(samples: readonly number[], frames: number): Harmonic[] {
  const count = samples.length;
  const highest = Math.floor(frames / MIN_FRAMES_PER_FLUTTER_CYCLE);
  const harmonics: Harmonic[] = [];
  for (let n = 1; n <= highest; n++) {
    let cosSum = 0;
    let sinSum = 0;
    samples.forEach((value, i) => {
      const angle = (TWO_PI * n * i) / count;
      cosSum += value * Math.cos(angle);
      sinSum += value * Math.sin(angle);
    });
    harmonics.push({ n, cos: (2 * cosSum) / count, sin: (2 * sinSum) / count });
  }
  return harmonics;
}

/**
 * How far a part on `spring` hangs off its anchor at `phase`, when the anchor
 * follows the periodic path `harmonics` describes: the steady-state answer, in
 * closed form, with no history.
 *
 * The part's offset `r` from its anchor obeys `r'' + 2ζω₀r' + ω₀²r = −a`,
 * where `a` is the anchor's acceleration. Driven by a harmonic at `ω`, the
 * answer is that harmonic scaled and delayed by `ρ² / (1 − ρ² + 2iζρ)`, with
 * `ρ = ω / ω₀` — so a slow anchor drags the part along with no lag at all,
 * and a fast one leaves it hanging back, half a cycle late past resonance.
 * Positive is the anchor's own positive direction.
 */
export function springLag(harmonics: readonly Harmonic[], phase: number, spring: Spring): number {
  let lag = 0;
  for (const { n, cos, sin } of harmonics) {
    const ratio = n / spring.naturalCycles;
    const ratioSq = ratio * ratio;
    const real = 1 - ratioSq;
    const imag = 2 * spring.damping * ratio;
    const norm = real * real + imag * imag;
    // ρ² / (real + i·imag), split into its real and imaginary parts.
    const gainRe = (ratioSq * real) / norm;
    const gainIm = (-ratioSq * imag) / norm;
    const angle = TWO_PI * n * phase;
    // The anchor harmonic as a complex amplitude A·e^{iθ}, with A = cos − i·sin.
    const re = cos * gainRe + sin * gainIm;
    const im = cos * gainIm - sin * gainRe;
    lag += re * Math.cos(angle) - im * Math.sin(angle);
  }
  return lag;
}

/**
 * How far a part on `spring` still hangs off its anchor `t` loops after the
 * anchor stepped by one unit, as a share of the step: −1 at the step, ringing
 * toward 0. The closed-form step response, for one-shots whose anchor stops
 * or starts rather than cycling.
 */
export function springSettle(t: number, spring: Spring): number {
  if (t <= 0) return -1;
  const omega = TWO_PI * spring.naturalCycles;
  const zeta = Math.min(spring.damping, MAX_UNDERDAMPED_RATIO);
  const ringing = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return (
    -decay * (Math.cos(ringing * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(ringing * t))
  );
}

/**
 * The step response above is the underdamped one; a ratio of 1 or more has no
 * ringing to express, so it is held just under critical, which settles the
 * same way to the eye.
 */
const MAX_UNDERDAMPED_RATIO = 0.999;

/** Shoulder rotation for a swing that is `forward` of vertical, −1 to 1. */
function armSwingAngle(forward: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * ARM_SWING_ANGLE;
}

/**
 * A profile arm, driven from its joints rather than from a hand target.
 *
 * Almost all of a walking arm's travel belongs to the shoulder; the elbow keeps
 * a near-constant bend and the forearm barely sweeps at all. Placed by its hand
 * the arm cannot do that — both segments are forced to swing together, and the
 * forearm ends up flailing at the full amplitude of the shoulder.
 */
export function sideArmAngles(forward: number): ArmAngles {
  const upper = armSwingAngle(forward);
  // Edge-on the swing is all in the picture plane, so nothing foreshortens.
  return { upper, fore: upper * FOREARM_FOLLOW + ELBOW_FLEX, foreScale: 1 };
}

/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(11);

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
export const RIGHT_ARM = 1;
export const LEFT_ARM = -1;

/** The sign a side of him is posed by: `placeFoot`'s and the arm swings'. */
export function sideSign(side: BodySide): number {
  return side === 'right' ? RIGHT_ARM : LEFT_ARM;
}

/** The side of him a pose sign names. */
export function sideOfSign(sign: number): BodySide {
  return sign === RIGHT_ARM ? 'right' : 'left';
}
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(36);
/**
 * An arm swings a little further forward than back — about 55% of its arc is
 * in front of the hang — so the backswing is this share of the forward swing.
 * Any less and edge-on the hand never clears the hip, and the torso hides the
 * whole of the backswing.
 */
const ARM_BACKSWING_SHARE = 0.8;
/**
 * One head-on arm, `swing` positive as it comes forward and crosses inboard.
 *
 * `forward` runs 0 at the back of the swing to 1 at the front, and drives the
 * foreshortening: an arm swung at the camera turns out of the picture plane, so
 * its forearm draws shorter and carries the hand *up* the body. Without that
 * the hand tracks a flat arc at one height, which is the last thing that kept
 * the head-on walk from looking like a walk.
 */
export function facingArmAngles(
  side: number,
  swing: number,
  forward: number,
  flex: number,
): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT - swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT - flex - swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/** How much of its length the forearm loses at the front of the swing. */
const FACING_FOREARM_FORESHORTEN = 0.18;

/**
 * A relaxed arm is not a straight rod: the elbow carries a little standing
 * flexion, which is what gives the arm a readable break at the joint and holds
 * it off the ribs. The upper arm therefore tilts out further than the forearm
 * does — elbow outboard, forearm hanging closer to vertical.
 */
const FACING_ELBOW_FLEX = deg(8);

/**
 * The pair of tilts that hold `FACING_ELBOW_FLEX` of bend while still landing
 * the wrist exactly where the idle's hand hangs. Two segments at two angles
 * have no tidy closed form for that, so it is solved by bisection at load.
 */
function solveForearmTilt(): number {
  const wristOffset = HAND_HANG_SPREAD - FACING_ARM_ROOT_HALF;
  const reach = (fore: number): number =>
    UPPER_ARM_LENGTH * Math.sin(fore + FACING_ELBOW_FLEX) + FOREARM_LENGTH * Math.sin(fore);
  return bisect(-HALF_PI, HALF_PI, (fore) => reach(fore) < wristOffset);
}

const FACING_FOREARM_TILT = solveForearmTilt();
const FACING_UPPER_TILT = FACING_FOREARM_TILT + FACING_ELBOW_FLEX;

/**
 * The shoulder does move — an arm swinging only at the elbow is a hand waving
 * on a fixed stick. It just moves far less than the elbow does, since head-on
 * the upper arm is close to end-on and has little of its travel to show.
 */
const FACING_UPPER_SWING = deg(5);
/** The forearm still carries most of the visible work at this angle. */
const FACING_FOREARM_SWING = deg(11);
