/**
 * What Tito's bust is doing at a moment: his expression, how far his body
 * leans, and where his arms are. Bust units throughout: origin at the top
 * centre of the square, one unit = its side, +y down.
 *
 * Every pose is a pure function of a quantized step, never of raw time, so the
 * body painted for a step is the same bitmap every time it comes round and
 * the cache can hand it back.
 */

import { clamp01, easeInOut, easeOut, hump, lerp, type Pt } from '../carlArt';
import { lerpPt, pt } from '../deuce/paint';
import { RESTING_EXPRESSION, type TitoExpression } from './head';

export type TitoBustPose = 'idle' | 'grin' | 'chuckle' | 'lunge';

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
  grip: 'steeple' | 'flat' | 'knife';
  /** For a knife grip: direction from the fist to the blade's tip, radians. */
  bladeAngle: number;
  /** 0→1 how much of the knife is shown; it fades as he tucks it away. */
  knifeAlpha: number;
}

export interface BustPose {
  expression: TitoExpression;
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

export const STEPS_PER_POSE: Readonly<Record<TitoBustPose, number>> = {
  idle: 1,
  grin: 10,
  chuckle: 12,
  lunge: 24,
};

/** The point the lean scales and rocks about: his belly at the counter's edge. */
export const LEAN_PIVOT = pt(0, 0.95);

const HALF = 0.5;

const NO_LEAN: BustLean = { scale: 1, dy: 0, tilt: 0 };

const STEEPLE_ELBOW = pt(0.4, 0.93);
const STEEPLE_WRIST = pt(0.13, 0.84);
const STEEPLE_ANGLE = -2.45;

function steepleArm(side: number): BustArm {
  return {
    elbow: pt(STEEPLE_ELBOW.x * side, STEEPLE_ELBOW.y),
    wrist: pt(STEEPLE_WRIST.x * side, STEEPLE_WRIST.y),
    handAngle: side > 0 ? STEEPLE_ANGLE : Math.PI - STEEPLE_ANGLE,
    grip: 'steeple',
    bladeAngle: 0,
    knifeAlpha: 0,
  };
}

const RESTING_RIGHT = steepleArm(-1);
const RESTING_LEFT = steepleArm(1);

const BRACED_HAND_ANGLE = 2.64;

/** His left hand braced flat on the counter while the right does the work. */
const BRACED_LEFT: BustArm = {
  elbow: pt(0.46, 0.9),
  wrist: pt(0.3, 0.93),
  handAngle: BRACED_HAND_ANGLE,
  grip: 'flat',
  bladeAngle: 0,
  knifeAlpha: 0,
};

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

// ── Lunge: wind-up, the stab across the counter, the hold, the recovery ─────

const WINDUP_END = 0.22;
const STRIKE_END = 0.38;
const HOLD_END = 0.7;
/** The knife is tucked away over this last share of the recovery. */
const TUCK_FROM = 0.85;

const RAISED_ELBOW = pt(-0.47, 0.56);
const RAISED_WRIST = pt(-0.36, 0.38);
const RAISED_HAND_ANGLE = -1.75;
const RAISED_BLADE_ANGLE = -1.45;
const STRUCK_ELBOW = pt(-0.38, 0.84);
const STRUCK_WRIST = pt(-0.14, 0.76);
const STRUCK_HAND_ANGLE = -0.15;
const STRUCK_BLADE_ANGLE = 0.5;
/** The stab's twist while it is held: a small wrench, not a wave. */
const HOLD_TWIST = 0.12;
const HOLD_TWIST_CYCLES = 1.5;

/**
 * The stab swings out past his shoulder and comes in low, under the chin: a
 * straight path from the raised hand would drag the blade across his own face.
 */
const STRIKE_SWING_CONTROL = pt(-0.56, 0.8);
/**
 * The blade turns outward and down, away from his face, and finishes turning
 * early in the swing so it leads the hand rather than trailing level with it.
 */
const BLADE_TURN_GAIN = 1.6;
/** Tucked away point-down below the counter, never back up past his chin. */
const TUCKED_BLADE_ANGLE = Math.PI / 2;

function swingPoint(from: Pt, control: Pt, to: Pt, t: number): Pt {
  const u = 1 - t;
  return pt(
    u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  );
}

const WINDUP_LEAN: BustLean = { scale: 0.96, dy: -0.025, tilt: -0.05 };
const STRUCK_LEAN: BustLean = { scale: 1.32, dy: 0.05, tilt: 0.06 };

const MANIC: TitoExpression = {
  lidOpen: 1.45,
  squint: 0,
  browRaise: -0.9,
  browSkew: 0,
  wink: 0,
  grin: 1,
  mouthOpen: 0.45,
  lookX: 0,
  lookY: 0.15,
};
/** Drawing the knife back: the mania arriving, mouth still shut. */
const WINDUP_FACE: TitoExpression = { ...MANIC, lidOpen: 1.2, mouthOpen: 0.1 };
const PLEASED: TitoExpression = {
  ...RESTING_EXPRESSION,
  grin: 0.85,
  squint: 0.6,
  browSkew: 0.7,
};

function lerpLean(a: BustLean, b: BustLean, t: number): BustLean {
  return {
    scale: lerp(a.scale, b.scale, t),
    dy: lerp(a.dy, b.dy, t),
    tilt: lerp(a.tilt, b.tilt, t),
  };
}

function lerpExpression(a: TitoExpression, b: TitoExpression, t: number): TitoExpression {
  return {
    lidOpen: lerp(a.lidOpen, b.lidOpen, t),
    squint: lerp(a.squint, b.squint, t),
    browRaise: lerp(a.browRaise, b.browRaise, t),
    browSkew: lerp(a.browSkew, b.browSkew, t),
    wink: lerp(a.wink, b.wink, t),
    grin: lerp(a.grin, b.grin, t),
    mouthOpen: lerp(a.mouthOpen, b.mouthOpen, t),
    lookX: lerp(a.lookX, b.lookX, t),
    lookY: lerp(a.lookY, b.lookY, t),
  };
}

function knifeArm(
  elbow: Pt,
  wrist: Pt,
  handAngle: number,
  bladeAngle: number,
  knifeAlpha: number,
): BustArm {
  return { elbow, wrist, handAngle, grip: 'knife', bladeAngle, knifeAlpha };
}

function lungePose(progress: number): BustPose {
  if (progress < WINDUP_END) {
    const t = easeInOut(progress / WINDUP_END);
    return {
      expression: lerpExpression(RESTING_EXPRESSION, WINDUP_FACE, t),
      lean: lerpLean(NO_LEAN, WINDUP_LEAN, t),
      headTilt: 0,
      bob: 0,
      right: knifeArm(
        lerpPt(RESTING_RIGHT.elbow, RAISED_ELBOW, t),
        lerpPt(RESTING_RIGHT.wrist, RAISED_WRIST, t),
        lerp(RESTING_RIGHT.handAngle, RAISED_HAND_ANGLE, t),
        RAISED_BLADE_ANGLE,
        clamp01(t * 3),
      ),
      left: BRACED_LEFT,
    };
  }
  if (progress < STRIKE_END) {
    const t = easeOut((progress - WINDUP_END) / (STRIKE_END - WINDUP_END));
    return {
      expression: lerpExpression(WINDUP_FACE, MANIC, t),
      lean: lerpLean(WINDUP_LEAN, STRUCK_LEAN, t),
      headTilt: 0,
      bob: 0,
      right: knifeArm(
        lerpPt(RAISED_ELBOW, STRUCK_ELBOW, t),
        swingPoint(RAISED_WRIST, STRIKE_SWING_CONTROL, STRUCK_WRIST, t),
        lerp(RAISED_HAND_ANGLE, STRUCK_HAND_ANGLE, t),
        lerp(RAISED_BLADE_ANGLE, STRUCK_BLADE_ANGLE - Math.PI * 2, clamp01(t * BLADE_TURN_GAIN)),
        1,
      ),
      left: BRACED_LEFT,
    };
  }
  if (progress < HOLD_END) {
    const t = (progress - STRIKE_END) / (HOLD_END - STRIKE_END);
    const twist = Math.sin(t * HOLD_TWIST_CYCLES * Math.PI * 2) * HOLD_TWIST;
    return {
      expression: MANIC,
      lean: STRUCK_LEAN,
      headTilt: 0,
      bob: 0,
      right: knifeArm(
        STRUCK_ELBOW,
        STRUCK_WRIST,
        STRUCK_HAND_ANGLE + twist,
        STRUCK_BLADE_ANGLE + twist,
        1,
      ),
      left: BRACED_LEFT,
    };
  }
  const t = easeInOut((progress - HOLD_END) / (1 - HOLD_END));
  const tuck = clamp01((progress - TUCK_FROM) / (1 - TUCK_FROM));
  return {
    expression: lerpExpression(MANIC, PLEASED, t),
    lean: lerpLean(STRUCK_LEAN, NO_LEAN, t),
    headTilt: 0,
    bob: 0,
    right: knifeArm(
      lerpPt(STRUCK_ELBOW, RESTING_RIGHT.elbow, t),
      lerpPt(STRUCK_WRIST, RESTING_RIGHT.wrist, t),
      lerp(STRUCK_HAND_ANGLE, RESTING_RIGHT.handAngle, t),
      lerp(STRUCK_BLADE_ANGLE, TUCKED_BLADE_ANGLE, t),
      1 - tuck,
    ),
    left: {
      ...RESTING_LEFT,
      elbow: lerpPt(BRACED_LEFT.elbow, RESTING_LEFT.elbow, t),
      wrist: lerpPt(BRACED_LEFT.wrist, RESTING_LEFT.wrist, t),
      handAngle: lerp(BRACED_LEFT.handAngle, RESTING_LEFT.handAngle, t),
      grip: t < HALF ? 'flat' : 'steeple',
    },
  };
}

/** `progress` snapped to the pose's cache steps. */
export function poseStep(pose: TitoBustPose, progress: number): number {
  const steps = STEPS_PER_POSE[pose];
  return Math.min(steps - 1, Math.floor(clamp01(progress) * steps));
}

/** The bust at a quantized step of `pose`; `idle` reads its beat instead. */
export function bustPoseAt(pose: TitoBustPose, step: number, beat: IdleBeat): BustPose {
  const steps = STEPS_PER_POSE[pose];
  const progress = steps > 1 ? step / (steps - 1) : 0;
  switch (pose) {
    case 'idle':
      return idlePose(beat);
    case 'grin':
      return grinPose(progress);
    case 'chuckle':
      return chucklePose(progress);
    case 'lunge':
      return lungePose(progress);
  }
}
