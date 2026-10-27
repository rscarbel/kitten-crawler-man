/**
 * What Donald's bust is doing at a moment: his expression, how far his body
 * leans, and where his arms are. Bust units throughout: origin at the top
 * centre of the square, one unit = its side, +y down.
 *
 * Every pose is a pure function of a quantized step, never of raw time, so the
 * body painted for a step is the same bitmap every time it comes round and
 * the cache can hand it back.
 */

import { clamp01, easeInOut, hump, lerp, type Pt } from '../bipedArt';
import { pt } from '../deuce/paint';
import { RESTING_EXPRESSION, type DonaldExpression } from './head';

export type DonaldBustPose = 'idle' | 'grin' | 'chuckle';

export interface BustLean {
  /** Growth about the counter pivot: above 1 he comes at the viewer. */
  scale: number;
  dy: number;
  /** Radians the whole body rocks about the pivot. */
  tilt: number;
}

/** One arm, shoulder to hand, in body space (before the lean). */
export interface BustArm {
  elbow: Pt;
  wrist: Pt;
  /** Direction from wrist to fingertips, radians. */
  handAngle: number;
}

export interface BustPose {
  expression: DonaldExpression;
  lean: BustLean;
  /** Radians the head tips about the neck, on top of the lean. */
  headTilt: number;
  /** Vertical shoulder bounce, bust units. */
  bob: number;
  /** His right arm (screen left). */
  right: BustArm;
  /** His left arm (screen right). */
  left: BustArm;
}

export const STEPS_PER_POSE: Readonly<Record<DonaldBustPose, number>> = {
  idle: 1,
  grin: 10,
  chuckle: 12,
};

/** The point the lean scales and rocks about: his belly at the counter's edge. */
export const LEAN_PIVOT = pt(0, 0.95);

const NO_LEAN: BustLean = { scale: 1, dy: 0, tilt: 0 };

const STEEPLE_ELBOW = pt(0.4, 0.93);
const STEEPLE_WRIST = pt(0.13, 0.84);
const STEEPLE_ANGLE = -2.45;

function steepleArm(side: number): BustArm {
  return {
    elbow: pt(STEEPLE_ELBOW.x * side, STEEPLE_ELBOW.y),
    wrist: pt(STEEPLE_WRIST.x * side, STEEPLE_WRIST.y),
    handAngle: side > 0 ? STEEPLE_ANGLE : Math.PI - STEEPLE_ANGLE,
  };
}

const RESTING_RIGHT = steepleArm(-1);
const RESTING_LEFT = steepleArm(1);

// ── Idle ────────────────────────────────────────────────────────────────────

const BLINK_CYCLE_MS = 4300;
const BLINK_MS = 150;
/** Every so often his eyes slide to the wheel, then back to his mark. */
const GLANCE_CYCLE_MS = 7300;
const GLANCE_MS = 1400;
const GLANCE_LOOK_X = -0.75;
const GLANCE_LOOK_Y = -0.2;
const BREATH_PERIOD_MS = 4800;
const BREATH_AMOUNT = 0.004;

export interface IdleBeat {
  blinking: boolean;
  glancing: boolean;
}

export function idleBeatAt(timeMs: number): IdleBeat {
  return {
    blinking: timeMs % BLINK_CYCLE_MS < BLINK_MS,
    glancing: timeMs % GLANCE_CYCLE_MS > GLANCE_CYCLE_MS - GLANCE_MS,
  };
}

/** The idle breath, bust units: a translation applied over the cached body. */
export function breathAt(timeMs: number): number {
  return Math.sin(((timeMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * Math.PI * 2) * BREATH_AMOUNT;
}

function idlePose(beat: IdleBeat): BustPose {
  return {
    expression: {
      ...RESTING_EXPRESSION,
      lidOpen: beat.blinking ? 0 : RESTING_EXPRESSION.lidOpen,
      squint: beat.blinking ? 0 : RESTING_EXPRESSION.squint,
      lookX: beat.glancing ? GLANCE_LOOK_X : 0,
      lookY: beat.glancing ? GLANCE_LOOK_Y : 0,
    },
    lean: NO_LEAN,
    headTilt: 0,
    bob: 0,
    right: RESTING_RIGHT,
    left: RESTING_LEFT,
  };
}

// ── Grin: the slow widening smile, a cocked brow and a wink ─────────────────

const GRIN_RISE_UNTIL = 0.45;
const GRIN_WINK_FROM = 0.5;
const GRIN_WINK_TO = 0.85;
const GRIN_LEAN_SCALE = 0.04;
const GRIN_HEAD_TILT = 0.07;
const GRIN_SQUINT = 0.55;
const GRIN_BROW_RAISE = 0.2;

function grinPose(progress: number): BustPose {
  const rise = easeInOut(progress / GRIN_RISE_UNTIL);
  const wink = hump((progress - GRIN_WINK_FROM) / (GRIN_WINK_TO - GRIN_WINK_FROM));
  return {
    expression: {
      ...RESTING_EXPRESSION,
      grin: lerp(RESTING_EXPRESSION.grin, 1, rise),
      squint: lerp(RESTING_EXPRESSION.squint, GRIN_SQUINT, rise),
      browSkew: lerp(RESTING_EXPRESSION.browSkew, 1, rise),
      browRaise: GRIN_BROW_RAISE * rise,
      wink,
    },
    lean: { scale: 1 + GRIN_LEAN_SCALE * rise, dy: 0, tilt: 0 },
    headTilt: GRIN_HEAD_TILT * rise,
    bob: 0,
    right: RESTING_RIGHT,
    left: RESTING_LEFT,
  };
}

// ── Chuckle: eyes shut, shoulders shaking ───────────────────────────────────

const CHUCKLE_SHAKES = 4;
const CHUCKLE_BOB = 0.014;
const CHUCKLE_HEAD_BACK = -0.08;
const CHUCKLE_MOUTH_OPEN = 0.35;
const CHUCKLE_MOUTH_SHAKE = 0.25;
/** The laugh reaches its full face halfway up the envelope and holds it. */
const CHUCKLE_ONSET_GAIN = 2;
const CHUCKLE_BROW_RAISE = 0.5;

function chucklePose(progress: number): BustPose {
  const envelope = hump(progress);
  const shake = Math.abs(Math.sin(progress * CHUCKLE_SHAKES * Math.PI));
  const laughing = clamp01(envelope * CHUCKLE_ONSET_GAIN);
  return {
    expression: {
      ...RESTING_EXPRESSION,
      lidOpen: lerp(RESTING_EXPRESSION.lidOpen, 0, laughing),
      squint: lerp(RESTING_EXPRESSION.squint, 1, laughing),
      grin: lerp(RESTING_EXPRESSION.grin, 1, laughing),
      browRaise: CHUCKLE_BROW_RAISE * laughing,
      mouthOpen: laughing * (CHUCKLE_MOUTH_OPEN + CHUCKLE_MOUTH_SHAKE * shake),
    },
    lean: NO_LEAN,
    headTilt: CHUCKLE_HEAD_BACK * laughing,
    bob: -CHUCKLE_BOB * shake * envelope,
    right: RESTING_RIGHT,
    left: RESTING_LEFT,
  };
}

/** `progress` snapped to the pose's cache steps. */
export function poseStep(pose: DonaldBustPose, progress: number): number {
  const steps = STEPS_PER_POSE[pose];
  return Math.min(steps - 1, Math.floor(clamp01(progress) * steps));
}

/** The bust at a quantized step of `pose`; `idle` reads its beat instead. */
export function bustPoseAt(pose: DonaldBustPose, step: number, beat: IdleBeat): BustPose {
  const steps = STEPS_PER_POSE[pose];
  const progress = steps > 1 ? step / (steps - 1) : 0;
  switch (pose) {
    case 'idle':
      return idlePose(beat);
    case 'grin':
      return grinPose(progress);
    case 'chuckle':
      return chucklePose(progress);
  }
}
