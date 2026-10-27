/**
 * Magnum's stage act: six routines chained into one loop, each built from
 * sixteen-frame phrases, at {@link MAGNUM_DANCE_BPM}.
 *
 * A routine is a function of time in beats that returns a {@link DanceShot}: a
 * flat set of numeric channels (hips, chest, head, hands, feet, travel) plus
 * the few things that cannot be blended (the view, the face, where he looks).
 * Because every routine speaks the same channels, the hand-off from one to the
 * next is an eased blend over the last frames of the outgoing routine into the
 * first frame of the incoming one, so the loop never visibly restarts: the
 * last frame of the act hands to the first exactly as any other frame hands to
 * its next.
 *
 * **Where things are.** Feet and travel are in the stage's own screen tiles
 * from his home ground point, so a turn pivots him on his planted feet and a
 * strut carries him across the boards; hands are on his body, in his chest's
 * frame, or on the pole, which stands {@link MAGNUM_POLE_OFFSET_TILES} from
 * his home ground point and is drawn by the stage behind him.
 *
 * The routines, in order:
 *
 *    tease      hip cocked at the pole, tugging his bow tie, then his cuff
 *    pops       fists on hips, chest pops on the beat, capped by a double-biceps flex
 *    grind      hands behind his head, knees wide, a pelvic roll and grind
 *    poleSlide  grabs the pole high, leans into it and slides down it, rolls back up
 *    wave       side-on, holding the pole: rolling body waves, then hip-thrust hits
 *    strut      struts away, turns his back, looks over his shoulder, struts home
 */

import {
  HIP_HEIGHT,
  MAGNUM_BODY_SCALE,
  MAGNUM_FIST_MIDDLE,
  RELAXED_HAND_CLOSURE,
  TWO_PI,
  add,
  chestPoint,
  lerpV,
  restPose,
  scale3,
  shoulderJoint,
  sideSign,
  sub,
  unit3,
  v3,
  type ArmPose,
  type FaceState,
  type HandPose,
  type HeadLook,
  type LegPose,
  type MagnumPose,
  type MagnumView,
  type Side,
  type V3,
} from './magnumArt';
import { clamp01, easeInOut, hump, lerp } from './bipedArt';
import { MAGNUM_FRAMES_PER_BEAT, MAGNUM_PHRASE_FRAMES } from '../magnumTiming';

// ── The pole ─────────────────────────────────────────────────────────────────

/**
 * Where his pole stands, in screen tiles from his home ground point: to the
 * viewer's right, in the same depth as his feet, so its base is not
 * foreshortened against his.
 */
export const MAGNUM_POLE_OFFSET_TILES = { x: 0.4, y: 0 } as const;

/**
 * The pole in figure space for a view, at `height` screen tiles above the
 * floor, with him travelled `travel` tiles across the stage. Each view's
 * camera sees the same spot on the stage from a different side of his body.
 */
function poleInFigure(view: MagnumView, mirrored: boolean, travel: number, height: number): V3 {
  const across = (MAGNUM_POLE_OFFSET_TILES.x - travel) / MAGNUM_BODY_SCALE;
  const up = -height / MAGNUM_BODY_SCALE;
  if (view === 'front') return v3(-across, up, 0);
  if (view === 'back') return v3(across, up, 0);
  return v3(0, up, mirrored ? -across : across);
}

// ── Channels ─────────────────────────────────────────────────────────────────

/**
 * Every number a routine sets. Feet (`*FootX`, `*FootDepth`) and `travel` are
 * stage screen tiles; wrists are in his chest's frame; the rest are the pose
 * fields of the same names.
 */
const CHANNELS = [
  'hipX',
  'hipDrop',
  'hipZ',
  'hipRoll',
  'hipPitch',
  'lean',
  'twist',
  'roll',
  'chestX',
  'chestUp',
  'chestZ',
  'headNod',
  'headTilt',
  'headForward',
  'travel',
  'rWristX',
  'rWristY',
  'rWristZ',
  'lWristX',
  'lWristY',
  'lWristZ',
  'rElbowY',
  'lElbowY',
  'rGrip',
  'lGrip',
  'rGripHeight',
  'lGripHeight',
  'rClosed',
  'lClosed',
  'rFootX',
  'rFootDepth',
  'rFootLift',
  'rHeel',
  'lFootX',
  'lFootDepth',
  'lFootLift',
  'lHeel',
] as const;

type Channel = (typeof CHANNELS)[number];
export type DanceParams = Readonly<Record<Channel, number>>;

/** The channels a routine writes for one side's arm and leg. */
interface SideChannels {
  readonly wristX: Channel;
  readonly wristY: Channel;
  readonly wristZ: Channel;
  readonly elbowY: Channel;
  readonly grip: Channel;
  readonly gripHeight: Channel;
  readonly closed: Channel;
  readonly footX: Channel;
  readonly footDepth: Channel;
  readonly footLift: Channel;
  readonly heel: Channel;
}

const SIDE_CHANNELS: Readonly<Record<Side, SideChannels>> = {
  right: {
    wristX: 'rWristX',
    wristY: 'rWristY',
    wristZ: 'rWristZ',
    elbowY: 'rElbowY',
    grip: 'rGrip',
    gripHeight: 'rGripHeight',
    closed: 'rClosed',
    footX: 'rFootX',
    footDepth: 'rFootDepth',
    footLift: 'rFootLift',
    heel: 'rHeel',
  },
  left: {
    wristX: 'lWristX',
    wristY: 'lWristY',
    wristZ: 'lWristZ',
    elbowY: 'lElbowY',
    grip: 'lGrip',
    gripHeight: 'lGripHeight',
    closed: 'lClosed',
    footX: 'lFootX',
    footDepth: 'lFootDepth',
    footLift: 'lFootLift',
    heel: 'lHeel',
  },
};

/** A frame of the act: its channels, and what cannot be blended. */
export interface DanceShot {
  readonly params: DanceParams;
  readonly view: MagnumView;
  readonly mirrored: boolean;
  readonly face: FaceState;
  readonly look: HeadLook;
}

/**
 * The hips ride a little above the rig's athletic rest: a dancer stands tall
 * on soft knees, where the brawler's rest was a crouch on the balls of his feet.
 */
const SOFT_KNEES = -0.01;
const HANG_ACROSS = 0.27;
const HANG_HEIGHT = -0.03;
const HANG_FORWARD = 0.03;
/** An elbow pointing out and a little down, the way a relaxed arm bends. */
const ELBOW_HANGING = 0.3;
const HOME_FOOT_SPREAD = 0.09;
const HOME_FOOT_DEPTH = 0.06;
const GRIP_HEIGHT_DEFAULT = 0.9;

const NEUTRAL: DanceParams = {
  hipX: 0,
  hipDrop: SOFT_KNEES,
  hipZ: 0,
  hipRoll: 0,
  hipPitch: 0,
  lean: 0,
  twist: 0,
  roll: 0,
  chestX: 0,
  chestUp: 0,
  chestZ: 0,
  headNod: 0,
  headTilt: 0,
  headForward: 0,
  travel: 0,
  rWristX: HANG_ACROSS,
  rWristY: HANG_HEIGHT,
  rWristZ: HANG_FORWARD,
  lWristX: -HANG_ACROSS,
  lWristY: HANG_HEIGHT,
  lWristZ: HANG_FORWARD,
  rElbowY: ELBOW_HANGING,
  lElbowY: ELBOW_HANGING,
  rGrip: 0,
  lGrip: 0,
  rGripHeight: GRIP_HEIGHT_DEFAULT,
  lGripHeight: GRIP_HEIGHT_DEFAULT,
  rClosed: RELAXED_HAND_CLOSURE,
  lClosed: RELAXED_HAND_CLOSURE,
  rFootX: -HOME_FOOT_SPREAD,
  rFootDepth: HOME_FOOT_DEPTH,
  rFootLift: 0,
  rHeel: 0,
  lFootX: HOME_FOOT_SPREAD,
  lFootDepth: HOME_FOOT_DEPTH,
  lFootLift: 0,
  lHeel: 0,
};

function withChannels(base: DanceParams, changes: Partial<DanceParams>): DanceParams {
  return { ...base, ...changes };
}

function blendParams(a: DanceParams, b: DanceParams, t: number): DanceParams {
  const out: Record<Channel, number> = { ...a };
  for (const channel of CHANNELS) out[channel] = lerp(a[channel], b[channel], t);
  return out;
}

// ── Timing shapes ────────────────────────────────────────────────────────────

/**
 * A hit on the beat: rises over `attack` beats to land exactly on `at`, then
 * eases back off over `decay`. The rise is eased at both ends, so even a two
 * frame attack splits its travel evenly rather than doing most of it at once. A pop, a thrust and a tug are all this shape:
 * fast in, slower out, so the accent reads as the frame it lands on.
 */
function hit(beats: number, at: number, attack: number, decay: number): number {
  if (beats < at - attack || beats > at + decay) return 0;
  if (beats <= at) return easeInOut((beats - (at - attack)) / attack);
  return 1 - easeInOut((beats - at) / decay);
}

/** 0 before `from`, 1 after `to`, eased between. */
function ramp(beats: number, from: number, to: number): number {
  return easeInOut(clamp01((beats - from) / (to - from)));
}

/** One full turn of a cycle per `period` beats, as an angle. */
function cycle(beats: number, period: number, offset = 0): number {
  return (beats / period + offset) * TWO_PI;
}

/**
 * A step of one foot along the stage: planted at `from` until `lift`, carried
 * through the air to `to` by `land`, planted again after. `x` is where the
 * foot is and `rise` how high it is lifted, in tiles.
 */
interface FootStep {
  readonly lift: number;
  readonly land: number;
  readonly from: number;
  readonly to: number;
}

const STEP_RISE = 0.07;

function stepAt(
  beats: number,
  steps: readonly FootStep[],
  rest: number,
): { x: number; rise: number } {
  let x = rest;
  for (const step of steps) {
    if (beats < step.lift) return { x: step.from, rise: 0 };
    if (beats <= step.land) {
      const t = (beats - step.lift) / (step.land - step.lift);
      return { x: lerp(step.from, step.to, easeInOut(t)), rise: STEP_RISE * hump(t) };
    }
    x = step.to;
  }
  return { x, rise: 0 };
}

/** A steady breath under everything, so no two frames of a held pose paint alike. */
const BREATH_LIFT = 0.012;
const BREATH_PERIOD_BEATS = 2;
/**
 * Off the beat by an eighth of a breath, so a frame and its mirror about any
 * beat or half-beat — where every rhythmic term repeats — still differ.
 */
const BREATH_OFFSET = 0.125;

/**
 * A slow sway of the head over a whole bar, out of step with the breath: two
 * frames mirrored about a breath's crest still differ by where his head is.
 */
const DRIFT_TILT = 0.01;
const DRIFT_PERIOD_BEATS = 4;

function drift(beats: number): number {
  return DRIFT_TILT * Math.sin(cycle(beats, DRIFT_PERIOD_BEATS));
}

function breath(beats: number): number {
  return BREATH_LIFT * Math.sin(cycle(beats, BREATH_PERIOD_BEATS, BREATH_OFFSET));
}

const SMUG: FaceState = { mouth: 'smug', eyes: 'squint', brow: 0.6 };
const POUT: FaceState = { mouth: 'pout', eyes: 'squint', brow: 0.8 };
const GRIN: FaceState = { mouth: 'grin', eyes: 'open', brow: 0.8 };
const SAVOUR: FaceState = { mouth: 'smug', eyes: 'shut', brow: 0.4 };
const AHEAD: HeadLook = { kind: 'ahead' };

function frontShot(params: DanceParams, face: FaceState): DanceShot {
  return { params, view: 'front', mirrored: false, face, look: AHEAD };
}

// ── Tease: the bow tie and the cuff ──────────────────────────────────────────

/** Weight on his right leg, the left hip dropped and the left knee turned in. */
const COCK_HIP_SHIFT = 0.05;
const COCK_HIP_ROLL = -0.16;
const COCK_SHOULDER_ROLL = 0.06;
/** Shifted over one leg, the hips sit a little lower: the standing leg is not locked. */
const COCK_KNEES = 0.025;
const TEASE_FREE_FOOT_X = 0.055;
const TEASE_FREE_FOOT_DEPTH = 0.1;
const TEASE_FREE_HEEL = 0.6;
const TEASE_GRIP_HEIGHT = 0.92;
/** His hand at the bow: the fist just right of and below his throat. */
const BOW_WRIST = v3(0.09, -0.37, 0.15);
const BOW_TUG = v3(0.12, 0.03, 0.05);
/** Tugging, his elbow swings up and out: the gesture's silhouette. */
const BOW_TUG_ELBOW = -0.8;
const BOW_TUG_BEATS: readonly number[] = [0.5, 1.5];
/** Both hands meet in front of his chest; the right pinches the left cuff. */
const CUFF_LEFT_WRIST = v3(-0.13, -0.3, 0.2);
const CUFF_RIGHT_WRIST = v3(-0.06, -0.33, 0.2);
const CUFF_TUG = v3(-0.1, 0.06, -0.03);
const CUFF_TUG_BEATS: readonly number[] = [2.5, 3];
/** The cuff shot out to the side to finish: the left arm snapped straight. */
const CUFF_SHOOT_WRIST = v3(-0.52, -0.46, 0.1);
const CUFF_SHOOT_AT = 3.375;
const TUG_ATTACK = 0.25;
const TUG_DECAY = 0.5;
const TEASE_POLE_GRAB = { from: 0, to: 0.25 } as const;
const TEASE_POLE_RELEASE = { from: 2, to: 2.375 } as const;
const TEASE_HANDS_MEET = { from: 1.875, to: 2.375 } as const;

/** Where the right hand drops to, on his hip, as the left arm shoots the cuff. */
const SHOT_RIGHT_ON_HIP = v3(0.2, -0.14, 0.03);
/** The left wrist is pulled by the tug, a little less than the right hand pulls. */
const CUFF_TUG_FOLLOW = 0.6;
/** A slow sway of the cocked hip, once a bar. */
const TEASE_SWAY_PERIOD_BEATS = 2;
const TEASE_SWAY_SHIFT = 0.01;
const TEASE_SWAY_ROLL = 0.03;
const CUFF_TUG_SHOULDER_ROLL = 0.03;
const TEASE_LEAN = -0.04;
const BOW_TUG_CHEST_LIFT = 0.012;
const BOW_TUG_CHIN_LIFT = -0.014;
const BOW_TUG_HEAD_TILT = -0.012;
const CUFF_SHOT_HEAD_TILT = -0.008;
/** The elbows of a hand at his collar and a hand tugging a cuff point down; the shot one, out. */
const ELBOW_DOWN = 1;
const ELBOW_SHOT_OUT = 0.2;
const PINCH_CLOSURE = 0.85;
const LOOSE_FIST_CLOSURE = 0.6;
const CUFF_HAND_CLOSURE = 0.4;
const SHOT_HAND_CLOSURE = 0.15;
/** Past half a tug his face pouts. */
const TUG_FACE_AT = 0.5;

function teaseAt(beats: number): DanceShot {
  const bowTug = Math.max(...BOW_TUG_BEATS.map((at) => hit(beats, at, TUG_ATTACK, TUG_DECAY)));
  const cuffTug = Math.max(...CUFF_TUG_BEATS.map((at) => hit(beats, at, TUG_ATTACK, TUG_DECAY)));
  const meet = ramp(beats, TEASE_HANDS_MEET.from, TEASE_HANDS_MEET.to);
  const shoot = ramp(beats, CUFF_SHOOT_AT - TUG_ATTACK, CUFF_SHOOT_AT);
  const grip =
    ramp(beats, TEASE_POLE_GRAB.from, TEASE_POLE_GRAB.to) *
    (1 - ramp(beats, TEASE_POLE_RELEASE.from, TEASE_POLE_RELEASE.to));
  const bow = add(BOW_WRIST, scale3(BOW_TUG, bowTug));
  const rightCuff = add(CUFF_RIGHT_WRIST, scale3(CUFF_TUG, cuffTug));
  const right = lerpV(lerpV(bow, rightCuff, meet), SHOT_RIGHT_ON_HIP, shoot);
  const leftCuff = add(CUFF_LEFT_WRIST, scale3(CUFF_TUG, cuffTug * CUFF_TUG_FOLLOW));
  const hangingLeft = v3(NEUTRAL.lWristX, NEUTRAL.lWristY, NEUTRAL.lWristZ);
  const left = lerpV(lerpV(hangingLeft, leftCuff, meet), CUFF_SHOOT_WRIST, shoot);
  const sway = Math.sin(cycle(beats, TEASE_SWAY_PERIOD_BEATS));
  const params = withChannels(NEUTRAL, {
    hipX: COCK_HIP_SHIFT + TEASE_SWAY_SHIFT * sway,
    hipDrop: SOFT_KNEES + COCK_KNEES,
    hipRoll: COCK_HIP_ROLL - TEASE_SWAY_ROLL * sway,
    roll: COCK_SHOULDER_ROLL + CUFF_TUG_SHOULDER_ROLL * cuffTug,
    lean: TEASE_LEAN,
    chestUp: breath(beats) + BOW_TUG_CHEST_LIFT * bowTug,
    headNod: BOW_TUG_CHIN_LIFT * bowTug,
    headTilt: BOW_TUG_HEAD_TILT * bowTug + CUFF_SHOT_HEAD_TILT * shoot,
    rWristX: right.x,
    rWristY: right.y,
    rWristZ: right.z,
    rElbowY: lerp(lerp(ELBOW_DOWN, BOW_TUG_ELBOW, bowTug), ELBOW_HANGING, shoot),
    rClosed: lerp(PINCH_CLOSURE, LOOSE_FIST_CLOSURE, shoot),
    lWristX: left.x,
    lWristY: left.y,
    lWristZ: left.z,
    lElbowY: lerp(lerp(ELBOW_HANGING, ELBOW_DOWN, meet), ELBOW_SHOT_OUT, shoot),
    lClosed: lerp(lerp(1, CUFF_HAND_CLOSURE, meet * (1 - grip)), SHOT_HAND_CLOSURE, shoot),
    lGrip: grip,
    lGripHeight: TEASE_GRIP_HEIGHT,
    lFootX: TEASE_FREE_FOOT_X,
    lFootDepth: TEASE_FREE_FOOT_DEPTH,
    lHeel: TEASE_FREE_HEEL,
  });
  const tugging = bowTug > TUG_FACE_AT || cuffTug > TUG_FACE_AT;
  return frontShot(params, tugging ? POUT : SMUG);
}

// ── Pops: chest pops on the beat, capped by a flex ───────────────────────────

const HIP_FIST = v3(0.205, -0.14, 0.02);
/** Fists on the hips turn the elbows out and back. */
const ELBOW_ON_HIP = 0;
const POPS_FOOT_SPREAD = 0.13;
/** Each pop, alternating sides; the last two come twice as fast into the flex. */
const POP_BEATS: readonly number[] = [0.5, 1, 1.5, 2, 2.5];
/**
 * Every hit lands over two frames, never one: a whole-body jump drawn in a
 * single frame at this tempo reads as the sprite hopping, not as a move.
 */
const POP_ATTACK = 0.25;
const POP_DECAY = 0.3;
const POP_LIFT = 0.09;
const POP_PUSH = 0.04;
const POP_ROLL = 0.24;
const POP_SHIFT = 0.06;
/** Each pop flares the elbows up off the hips: the silhouette change that reads at the tile. */
const POP_ELBOW_FLARE = -1.2;
const POP_LEAN = -0.08;
/**
 * Each pop snaps him up onto the balls of his feet: the whole body rising is
 * what makes a chest pop read at the tile, where the chest alone moves a pixel.
 */
const POP_RISE = -0.035;
const POP_HEEL = 0.35;
/** The double-biceps: upper arms level out to the sides, fists up by his ears. */
const FLEX_WRIST = v3(0.42, -0.58, 0.0);
const ELBOW_FLEXED = 1;
const FLEX_AT = 3;
const FLEX_RAISE_BEATS = 0.375;
const FLEX_SQUEEZE_AT = 3.5;

const SQUEEZE_ATTACK = 0.25;
const SQUEEZE_DECAY = 0.375;
const FLEX_HIT_DECAY = 0.5;
/** The squeeze draws the fists in a little toward his head. */
const SQUEEZE_FISTS_IN = 0.02;
const FLEX_KNEE_DIP = 0.02;
const FLEX_LEAN = -0.06;
const FLEX_CHEST_LIFT = 0.025;
const SQUEEZE_CHEST_LIFT = 0.01;
const POP_HEAD_BOB = 0.012;
const FLEX_CHIN_LIFT = -0.01;
/** Once the arms are most of the way up, he grins. */
const FLEX_FACE_AT = 0.5;

function popsAt(beats: number): DanceShot {
  let lift = 0;
  let side = 0;
  POP_BEATS.forEach((at, i) => {
    const amount = hit(beats, at, POP_ATTACK, POP_DECAY);
    if (amount <= lift) return;
    lift = amount;
    side = i % 2 === 0 ? 1 : -1;
  });
  const flex = ramp(beats, FLEX_AT - FLEX_RAISE_BEATS, FLEX_AT);
  const squeeze = hit(beats, FLEX_SQUEEZE_AT, SQUEEZE_ATTACK, SQUEEZE_DECAY);
  const flexHit = hit(beats, FLEX_AT, POP_ATTACK, FLEX_HIT_DECAY);
  const wrist = (sign: number): V3 =>
    lerpV(
      v3(sign * HIP_FIST.x, HIP_FIST.y, HIP_FIST.z),
      v3(sign * (FLEX_WRIST.x - SQUEEZE_FISTS_IN * squeeze), FLEX_WRIST.y, FLEX_WRIST.z),
      flex,
    );
  const right = wrist(1);
  const left = wrist(-1);
  const params = withChannels(NEUTRAL, {
    hipDrop: SOFT_KNEES + POP_RISE * lift + FLEX_KNEE_DIP * flexHit,
    rHeel: POP_HEEL * lift,
    lHeel: POP_HEEL * lift,
    lean: POP_LEAN * lift + FLEX_LEAN * flex,
    roll: POP_ROLL * side * lift,
    chestX: POP_SHIFT * side * lift,
    chestUp:
      breath(beats) + POP_LIFT * lift + FLEX_CHEST_LIFT * flex + SQUEEZE_CHEST_LIFT * squeeze,
    chestZ: POP_PUSH * lift,
    headNod: POP_HEAD_BOB * lift + FLEX_CHIN_LIFT * flex,
    rWristX: right.x,
    rWristY: right.y,
    rWristZ: right.z,
    lWristX: left.x,
    lWristY: left.y,
    lWristZ: left.z,
    rElbowY: lerp(ELBOW_ON_HIP + POP_ELBOW_FLARE * lift, ELBOW_FLEXED, flex),
    lElbowY: lerp(ELBOW_ON_HIP + POP_ELBOW_FLARE * lift, ELBOW_FLEXED, flex),
    rClosed: 1,
    lClosed: 1,
    rFootX: -POPS_FOOT_SPREAD,
    lFootX: POPS_FOOT_SPREAD,
  });
  return frontShot(params, flex > FLEX_FACE_AT ? GRIN : SMUG);
}

// ── Grind: a pelvic roll with his hands behind his head ──────────────────────

const BEHIND_HEAD_WRIST = v3(0.1, -0.6, -0.14);
/**
 * His other hand runs down his belly to his waistband and back up, once a
 * bar: one hand up and one down keeps the head clear of a pair of raised
 * elbows, which at the tile read as earmuffs.
 */
const BELLY_HIGH = v3(-0.07, -0.36, 0.17);
const BELLY_LOW = v3(-0.1, -0.22, 0.17);
const BELLY_PERIOD_BEATS = 2;
const BELLY_HAND_CLOSURE = 0.15;
const ELBOW_RAISED = -1;
const GRIND_FOOT_SPREAD = 0.2;
const GRIND_DROP_HIGH = 0.07;
const GRIND_DROP_LOW = 0.13;
const GRIND_SHIFT = 0.11;
const GRIND_DEPTH = 0.04;
const GRIND_TIP = 0.22;
const GRIND_TUCK = 0.12;
const GRIND_BOB = 0.012;
/** The chest holds still while the hips circle: the isolation is the move. */
const GRIND_CHEST_HOLD = 0.85;
const GRIND_COUNTER_ROLL = 0.05;
const GRIND_DESCEND = { from: 1.5, to: 2.25 } as const;
const GRIND_RISE = { from: 3.25, to: 4 } as const;

/** One hip circle a beat. */
const GRIND_PERIOD_BEATS = 1;
/** Rising out of the grind he comes half way back up. */
const GRIND_RISE_SHARE = 0.5;
const GRIND_HEAD_BOB = 0.008;
const BEHIND_HEAD_CLOSURE = 0.5;
/** The first phrase he savours with his eyes shut; the second he watches the room. */
const GRIND_EYES_OPEN_AT = 2;

function grindAt(beats: number): DanceShot {
  const angle = cycle(beats, GRIND_PERIOD_BEATS);
  const depth =
    lerp(GRIND_DROP_HIGH, GRIND_DROP_LOW, ramp(beats, GRIND_DESCEND.from, GRIND_DESCEND.to)) *
    (1 - GRIND_RISE_SHARE * ramp(beats, GRIND_RISE.from, GRIND_RISE.to));
  const hipX = GRIND_SHIFT * Math.cos(angle);
  const belly = lerpV(
    BELLY_HIGH,
    BELLY_LOW,
    0.5 - 0.5 * Math.cos(cycle(beats, BELLY_PERIOD_BEATS)),
  );
  const params = withChannels(NEUTRAL, {
    hipX,
    hipZ: GRIND_DEPTH * Math.sin(angle),
    hipRoll: -GRIND_TIP * Math.cos(angle),
    hipPitch: GRIND_TUCK * Math.sin(angle),
    hipDrop: depth + GRIND_BOB * Math.sin(angle),
    chestX: -hipX * GRIND_CHEST_HOLD,
    roll: GRIND_COUNTER_ROLL * Math.cos(angle),
    chestUp: breath(beats),
    headNod: GRIND_HEAD_BOB * Math.cos(angle),
    rWristX: BEHIND_HEAD_WRIST.x,
    rWristY: BEHIND_HEAD_WRIST.y,
    rWristZ: BEHIND_HEAD_WRIST.z,
    lWristX: belly.x,
    lWristY: belly.y,
    lWristZ: belly.z,
    rElbowY: ELBOW_RAISED,
    lElbowY: ELBOW_HANGING,
    rClosed: BEHIND_HEAD_CLOSURE,
    lClosed: BELLY_HAND_CLOSURE,
    rFootX: -GRIND_FOOT_SPREAD,
    lFootX: GRIND_FOOT_SPREAD,
  });
  return frontShot(params, beats < GRIND_EYES_OPEN_AT ? SAVOUR : SMUG);
}

// ── Pole slide: lean into the pole, slide down it, roll back up ──────────────

const SLIDE_TRAVEL = 0.06;
const SLIDE_RIGHT_FOOT = -0.1;
const SLIDE_LEFT_FOOT = 0.26;
const SLIDE_GRIP_TOP = 1.02;
const SLIDE_GRIP_BOTTOM = 0.62;
const SLIDE_DROP = 0.34;
const SLIDE_LEAN_ROLL = -0.14;
const SLIDE_LEAN_HIPS = -0.05;
const SLIDE_DOWN = { from: 0.5, to: 1.75 } as const;
const SLIDE_UP = { from: 2, to: 3.25 } as const;
const SLIDE_HAND_CHEST = v3(0.13, -0.33, 0.13);
const SLIDE_HAND_THIGH = v3(0.19, 0.06, 0.14);
const SLIDE_HAND_CROWN = v3(0.12, -0.62, 0.08);
const SLIDE_ROLL_UP_LEAN = 0.18;
const SLIDE_ROLL_UP_PUSH = 0.04;

const SLIDE_LOW_HIP_TIP = 0.06;
/** Low in the squat he straightens off the pole a little. */
const SLIDE_LOW_STRAIGHTEN = 0.4;
const SLIDE_LOW_LEAN = 0.1;
const SLIDE_HEAD_TILT = -0.012;
const SLIDE_ROLL_UP_NOD = 0.01;
const SLIDE_POLE_ELBOW = 0.5;
const SLIDE_HAND_ELBOW_LOW = 0.8;
const SLIDE_HAND_ELBOW_UP = -0.2;
const SLIDE_HAND_CLOSURE = 0.2;
const SLIDE_RIGHT_HEEL = 0.25;
const SLIDE_LEFT_HEEL = 0.35;
/** Past half way down he pouts. */
const SLIDE_FACE_AT = 0.5;

function poleSlideAt(beats: number): DanceShot {
  const down = ramp(beats, SLIDE_DOWN.from, SLIDE_DOWN.to);
  const up = ramp(beats, SLIDE_UP.from, SLIDE_UP.to);
  const low = down * (1 - up);
  // Rising, the body rolls up from the hips: lean forward, then the chest last.
  const rolling = hump(clamp01((beats - SLIDE_UP.from) / (SLIDE_UP.to - SLIDE_UP.from)));
  const hand = lerpV(lerpV(SLIDE_HAND_CHEST, SLIDE_HAND_THIGH, down), SLIDE_HAND_CROWN, up);
  const params = withChannels(NEUTRAL, {
    travel: SLIDE_TRAVEL,
    hipX: SLIDE_LEAN_HIPS,
    hipDrop: SOFT_KNEES + SLIDE_DROP * low,
    hipRoll: SLIDE_LOW_HIP_TIP * low,
    roll: SLIDE_LEAN_ROLL * (1 - SLIDE_LOW_STRAIGHTEN * low),
    lean: SLIDE_LOW_LEAN * low + SLIDE_ROLL_UP_LEAN * rolling,
    chestZ: SLIDE_ROLL_UP_PUSH * rolling,
    chestUp: breath(beats),
    headTilt: SLIDE_HEAD_TILT,
    headNod: SLIDE_ROLL_UP_NOD * rolling,
    lGrip: 1,
    lGripHeight: lerp(SLIDE_GRIP_TOP, SLIDE_GRIP_BOTTOM, low),
    lClosed: 1,
    lElbowY: SLIDE_POLE_ELBOW,
    rWristX: hand.x,
    rWristY: hand.y,
    rWristZ: hand.z,
    rElbowY: lerp(SLIDE_HAND_ELBOW_LOW, SLIDE_HAND_ELBOW_UP, up),
    rClosed: SLIDE_HAND_CLOSURE,
    rFootX: SLIDE_RIGHT_FOOT,
    lFootX: SLIDE_LEFT_FOOT,
    rHeel: SLIDE_RIGHT_HEEL * low,
    lHeel: SLIDE_LEFT_HEEL * low,
  });
  return frontShot(params, low > SLIDE_FACE_AT ? POUT : SMUG);
}

// ── Wave: side-on at the pole, body waves then hip thrusts ───────────────────

const WAVE_TRAVEL = 0.165;
const WAVE_FRONT_FOOT = 0.235;
const WAVE_BACK_FOOT = 0.15;
const WAVE_FOOT_DEPTH = 0.035;
const WAVE_GRIP_HEIGHT = 0.78;
const WAVE_LEAN_BACK = -0.14;
const WAVE_LEAN_SWAY = 0.04;
/** The chest is carried against the hips' roll, so the shoulders stay within an arm of the pole. */
const WAVE_CHEST_HOLD = 0.55;
const WAVE_HEAD = 0.045;
const WAVE_CHEST = 0.13;
const WAVE_HIP = 0.15;
const WAVE_KNEE = 0.015;
const WAVE_TUCK = 0.16;
/** How far each body segment trails the one above it through the wave, in turns. */
const WAVE_LAG = 0.14;
const WAVE_END = 1.5;
const THRUST_BEATS: readonly number[] = [2, 3];
const THRUST_WINDUP = 0.5;
const THRUST_RECOVER = 0.5;
const THRUST_HIPS = 0.16;
const THRUST_TUCK = 0.3;
const THRUST_LEAN = -0.2;
const THRUST_WINDUP_HIPS = -0.04;
const THRUST_WINDUP_LEAN = 0.12;
const FLUNG_WRIST = v3(-0.15, -0.65, -0.25);
const ELBOW_FLUNG = -0.2;
const FAR_HIP_FIST = v3(-0.2, -0.14, 0.0);

/** The thrust's wind-up, which pulls the hips back before each hit. */
function windUp(beats: number): number {
  return Math.max(
    ...THRUST_BEATS.map((at) =>
      beats >= at - THRUST_WINDUP && beats < at
        ? hump((beats - (at - THRUST_WINDUP)) / THRUST_WINDUP)
        : 0,
    ),
  );
}

/** The wave dies away over the last quarter beat before the thrusts. */
const WAVE_FADE_BEATS = 0.25;
const WAVE_PERIOD_BEATS = 1;
const THRUST_ATTACK = 0.25;
const FLING_ATTACK = 0.25;
const FLING_DECAY = 0.75;
const THRUST_HEAD_BACK = -0.02;
const WINDUP_KNEE_DIP = 0.01;
const WAVE_GRIP_ELBOW = 0.6;
const FLUNG_HAND_CLOSURE = 0.2;
const WAVE_BACK_HEEL = 0.35;
/** Past this much of a thrust he grins. */
const THRUST_FACE_AT = 0.4;

function waveAt(beats: number): DanceShot {
  const waving = 1 - ramp(beats, WAVE_END - WAVE_FADE_BEATS, WAVE_END);
  const segment = (lag: number): number => Math.sin(cycle(beats, WAVE_PERIOD_BEATS, -lag)) * waving;
  const thrust = Math.max(
    ...THRUST_BEATS.map((at) => hit(beats, at, THRUST_ATTACK, THRUST_RECOVER)),
  );
  const wound = windUp(beats);
  const fling = Math.max(...THRUST_BEATS.map((at) => hit(beats, at, FLING_ATTACK, FLING_DECAY)));
  const leftHand = lerpV(FAR_HIP_FIST, FLUNG_WRIST, fling);
  const params = withChannels(NEUTRAL, {
    travel: WAVE_TRAVEL,
    headForward: WAVE_HEAD * segment(0) + THRUST_HEAD_BACK * thrust,
    // The chest only ever rolls forward of where it holds: his hand is fixed
    // on the pole, and an arm's length is all the room he has to pull back.
    chestZ:
      WAVE_CHEST * (0.5 + 0.5 * segment(WAVE_LAG)) -
      WAVE_HIP * segment(WAVE_LAG * 2) * WAVE_CHEST_HOLD,
    lean:
      WAVE_LEAN_BACK +
      WAVE_LEAN_SWAY * segment(WAVE_LAG) +
      THRUST_LEAN * thrust +
      THRUST_WINDUP_LEAN * wound,
    hipZ: WAVE_HIP * segment(WAVE_LAG * 2) + THRUST_HIPS * thrust + THRUST_WINDUP_HIPS * wound,
    hipPitch: WAVE_TUCK * segment(WAVE_LAG * 2) + THRUST_TUCK * thrust,
    hipDrop: SOFT_KNEES + WAVE_KNEE * (0.5 + 0.5 * segment(WAVE_LAG * 3)) + WINDUP_KNEE_DIP * wound,
    chestUp: breath(beats),
    headNod: THRUST_HEAD_BACK * thrust,
    rGrip: 1,
    rGripHeight: WAVE_GRIP_HEIGHT,
    rClosed: 1,
    rElbowY: WAVE_GRIP_ELBOW,
    lWristX: leftHand.x,
    lWristY: leftHand.y,
    lWristZ: leftHand.z,
    lElbowY: lerp(ELBOW_ON_HIP, ELBOW_FLUNG, fling),
    lClosed: lerp(1, FLUNG_HAND_CLOSURE, fling),
    rFootX: WAVE_FRONT_FOOT,
    rFootDepth: WAVE_FOOT_DEPTH,
    lFootX: WAVE_BACK_FOOT,
    lFootDepth: -WAVE_FOOT_DEPTH,
    lHeel: WAVE_BACK_HEEL,
  });
  return {
    params,
    view: 'side',
    mirrored: false,
    face: thrust > THRUST_FACE_AT ? GRIN : SMUG,
    look: AHEAD,
  };
}

// ── Strut: away, a look back, and home ───────────────────────────────────────

/** Three short steps out, heel to toe, and two home. */
/**
 * Three short steps out and two home. He walks off to the viewer's left, so
 * the last step out lands his left foot outside his right: turned away, his
 * feet are uncrossed under him.
 */
/**
 * Four steps out and three home, half a beat each. He walks off to the
 * viewer's left, so the last step out lands his left foot outside his right:
 * turned away, his feet are uncrossed under him.
 */
const STRUT_OUT_STEPS: Readonly<Record<Side, readonly FootStep[]>> = {
  right: [
    { lift: 0, land: 0.45, from: WAVE_FRONT_FOOT, to: 0 },
    { lift: 0.95, land: 1.5, from: 0, to: -0.36 },
  ],
  left: [
    { lift: 0.5, land: 0.9, from: WAVE_BACK_FOOT, to: -0.18 },
    { lift: 1.625, land: 2.0625, from: -0.18, to: -0.48 },
  ],
};
const STRUT_HOME_STEPS: Readonly<Record<Side, readonly FootStep[]>> = {
  left: [
    { lift: 4.125, land: 4.5, from: -0.48, to: -0.3 },
    { lift: 4.9, land: 5.5, from: -0.3, to: 0.02 },
  ],
  right: [{ lift: 4.5, land: 4.9, from: -0.36, to: -0.12 }],
};
const STRUT_TURN_AWAY_AT = 2.125;
const STRUT_SINK_FROM = 1.75;
/** A strut steps long, so the hips sit lower than his standing height. */
const STRUT_KNEES = -0.02;
/**
 * How much of the hips' travel glides evenly rather than following the feet:
 * all of it would leave a trailing leg short of reach on the long steps.
 */
const STRUT_GLIDE = 0.5;
/** Feet closer than this need no dip; past it the hips sink this share of the extra. */
const STRIDE_FREE = 0.12;
const STRIDE_DIP = 0.35;
/** Turned away for the look back, he sinks into his knees to shake. */
const SHAKE_KNEES = 0.035;
const STRUT_TURN_HOME_AT = 4.125;
const STRUT_SWAY_ROLL = 0.12;
const STRUT_SWAY_SHIFT = 0.025;
const STRUT_ARM_SWING = 0.18;
const STRUT_FOOT_DEPTH = 0.02;
/** On the balls of his feet; a swinging foot points its toe. */
const STRUT_HEEL = 0.15;
const STRUT_SWING_HEEL = 0.45;
const SHAKE_PER_BEAT = 1;
/** The shoulders hold while the hips shake: the isolation is what reads. */
const SHAKE_CHEST_HOLD = 0.9;
const SHAKE_SHIFT = 0.08;
const SHAKE_ROLL = 0.22;
/** Looking back, his head turns out over his shoulder, clear of the back of his neck. */
const LOOK_BACK_HEAD_OUT = 0.11;
/** His shoulders turn a little toward the look, so the head turns with the body, not alone. */
const LOOK_BACK_TWIST = 0.3;
const LOOK_BACK_HIP_HAND = v3(0.24, -0.16, -0.02);
const LOOK_BACK_THIGH_HAND = v3(0.25, -0.04, -0.03);

const STRUT_ARM_PERIOD_BEATS = 2;
/** His hand slides from hip to thigh over the look back, starting half a beat into it. */
const LOOK_BACK_SLIDE_DELAY = 0.5;
/** The look back eases off over the half beat before he turns for home. */
const LOOK_BACK_FADE_BEATS = 0.5;
const LOOK_BACK_SLIDE_END_EARLY = 0.25;
const STRUT_SINK_BEATS = 0.375;
const STRUT_SHOULDER_ROLL = 0.04;
const STRUT_LEAN = -0.1;
/** Chest up, proud, through the whole strut. */
const STRUT_CHEST_LIFT = 0.01;
const LOOK_BACK_ELBOW = 0.1;
const LOOK_BACK_HAND_CLOSURE = 0.2;

function strutAt(beats: number): DanceShot {
  const home = beats >= STRUT_TURN_HOME_AT;
  const away = beats >= STRUT_TURN_AWAY_AT && !home;
  const steps = home ? STRUT_HOME_STEPS : STRUT_OUT_STEPS;
  const right = stepAt(beats, steps.right, steps.right[0].from);
  const left = stepAt(beats, steps.left, steps.left[0].from);
  // The hips glide between where his feet start and where they finish, rather
  // than tracking the feet step by step: following the feet, the body surges
  // on each swing and stalls on each plant.
  const first = Math.min(steps.right[0].lift, steps.left[0].lift);
  const last = Math.max(...[...steps.right, ...steps.left].map((step) => step.land));
  const startX = (steps.right[0].from + steps.left[0].from) / 2;
  const endX = (stepAt(last, steps.right, 0).x + stepAt(last, steps.left, 0).x) / 2;
  const glide = lerp(startX, endX, ramp(beats, first, last));
  const travel = lerp((right.x + left.x) / 2, glide, STRUT_GLIDE);
  // His hips sink only as far as a wide stride needs: the legs reach, and the
  // strut stays tall over a planted foot.
  const strideDip = STRIDE_DIP * Math.max(0, Math.abs(right.x - left.x) - STRIDE_FREE);
  // The hips sway over whichever foot is down.
  const overRight = (left.rise - right.rise) / STEP_RISE;
  const swing = Math.sin(cycle(beats, STRUT_ARM_PERIOD_BEATS));
  // Everything the look back does fades in after the turn away and out before
  // the turn home, so neither pivot carries a pose change of its own.
  const look =
    ramp(beats, STRUT_SINK_FROM, STRUT_TURN_AWAY_AT + STRUT_SINK_BEATS) *
    (1 - ramp(beats, STRUT_TURN_HOME_AT - LOOK_BACK_FADE_BEATS, STRUT_TURN_HOME_AT));
  const shake = look * Math.sin(cycle(beats - STRUT_TURN_AWAY_AT, 1 / SHAKE_PER_BEAT));
  const slide = ramp(
    beats,
    STRUT_TURN_AWAY_AT + LOOK_BACK_SLIDE_DELAY,
    STRUT_TURN_HOME_AT - LOOK_BACK_SLIDE_END_EARLY,
  );
  const lookHand = lerpV(LOOK_BACK_HIP_HAND, LOOK_BACK_THIGH_HAND, slide);
  const swingingHand = v3(
    NEUTRAL.rWristX,
    NEUTRAL.rWristY,
    NEUTRAL.rWristZ + STRUT_ARM_SWING * swing * (1 - look),
  );
  const rightHand = lerpV(swingingHand, lookHand, look);
  const params = withChannels(NEUTRAL, {
    travel,
    hipX: STRUT_SWAY_SHIFT * overRight + SHAKE_SHIFT * shake,
    chestX: -SHAKE_SHIFT * shake * SHAKE_CHEST_HOLD,
    headTilt: LOOK_BACK_HEAD_OUT * look,
    twist: LOOK_BACK_TWIST * look,
    hipRoll: -STRUT_SWAY_ROLL * overRight - SHAKE_ROLL * shake,
    roll: STRUT_SHOULDER_ROLL * overRight,
    lean: STRUT_LEAN,
    hipDrop: STRUT_KNEES + SHAKE_KNEES * look + strideDip,
    chestUp: breath(beats) + STRUT_CHEST_LIFT,
    rWristX: rightHand.x,
    rWristY: rightHand.y,
    rWristZ: rightHand.z,
    rElbowY: lerp(ELBOW_HANGING, LOOK_BACK_ELBOW, look),
    rClosed: lerp(RELAXED_HAND_CLOSURE, LOOK_BACK_HAND_CLOSURE, look),
    lWristZ: NEUTRAL.lWristZ - STRUT_ARM_SWING * swing * (1 - look),
    rFootX: right.x,
    rFootLift: right.rise,
    rFootDepth: STRUT_FOOT_DEPTH,
    rHeel: STRUT_HEEL + STRUT_SWING_HEEL * (right.rise / STEP_RISE),
    lFootX: left.x,
    lFootLift: left.rise,
    lFootDepth: -STRUT_FOOT_DEPTH,
    lHeel: STRUT_HEEL + STRUT_SWING_HEEL * (left.rise / STEP_RISE),
  });
  if (away) {
    return {
      params,
      view: 'back',
      mirrored: false,
      face: POUT,
      look: { kind: 'overShoulder', side: 'right' },
    };
  }
  return { params, view: 'side', mirrored: !home, face: SMUG, look: AHEAD };
}

// ── The act ──────────────────────────────────────────────────────────────────

export type MagnumRoutineId = 'tease' | 'pops' | 'grind' | 'poleSlide' | 'wave' | 'strut';

/** A stretch of a routine, in beats, during which a hand must be on the pole. */
export interface PoleContact {
  readonly side: Side;
  readonly fromBeat: number;
  readonly toBeat: number;
}

/** A frame worth reacting to — a hit the room cheers, a pose it whistles at. */
export type MagnumBigMove =
  'bowTieTug' | 'cuffShot' | 'chestPop' | 'flex' | 'poleDrop' | 'hipThrust' | 'lookBack';

export interface BigMoveCue {
  readonly move: MagnumBigMove;
  readonly beat: number;
}

interface Routine {
  readonly id: MagnumRoutineId;
  readonly phrases: number;
  readonly at: (beats: number) => DanceShot;
  readonly poleContacts: readonly PoleContact[];
  readonly bigMoves: readonly BigMoveCue[];
}

/**
 * The act in order; the last routine hands back to the first. The pole
 * contacts are authored here, beside the routines, and the gates hold each
 * routine's hands to them.
 */
const ROUTINES: readonly Routine[] = [
  {
    id: 'tease',
    phrases: 2,
    at: teaseAt,
    poleContacts: [{ side: 'left', fromBeat: 0.25, toBeat: 2 }],
    bigMoves: [
      ...BOW_TUG_BEATS.map((beat): BigMoveCue => ({ move: 'bowTieTug', beat })),
      { move: 'cuffShot', beat: CUFF_SHOOT_AT },
    ],
  },
  {
    id: 'pops',
    phrases: 2,
    at: popsAt,
    poleContacts: [],
    bigMoves: [
      ...POP_BEATS.map((beat): BigMoveCue => ({ move: 'chestPop', beat })),
      { move: 'flex', beat: FLEX_AT },
    ],
  },
  {
    id: 'grind',
    phrases: 2,
    at: grindAt,
    poleContacts: [],
    bigMoves: [],
  },
  {
    id: 'poleSlide',
    phrases: 2,
    at: poleSlideAt,
    poleContacts: [{ side: 'left', fromBeat: 0, toBeat: 3.25 }],
    bigMoves: [{ move: 'poleDrop', beat: SLIDE_DOWN.to }],
  },
  {
    id: 'wave',
    phrases: 2,
    at: waveAt,
    poleContacts: [{ side: 'right', fromBeat: 0, toBeat: 3.25 }],
    bigMoves: THRUST_BEATS.map((beat): BigMoveCue => ({ move: 'hipThrust', beat })),
  },
  {
    id: 'strut',
    phrases: 3,
    at: strutAt,
    poleContacts: [],
    bigMoves: [{ move: 'lookBack', beat: STRUT_TURN_AWAY_AT }],
  },
];

/**
 * Frames at the end of each routine spent easing into the next one's first
 * frame: three quarters of a beat, long enough to read as a move rather than
 * a cut, short enough to leave the routine its last accent.
 */
export const MAGNUM_TRANSITION_FRAMES = 6;
/** A foot that has to move during a hand-off is stepped, not slid. */
const TRANSITION_STEP_RISE = 0.05;
const TRANSITION_STEP_FULL = 0.05;

function footDistance(a: DanceParams, b: DanceParams, side: Side): number {
  const c = SIDE_CHANNELS[side];
  return Math.hypot(a[c.footX] - b[c.footX], a[c.footDepth] - b[c.footDepth]);
}

/**
 * Eases one shot into another. A foot that has to move steps rather than
 * slides, and when both have to move they take turns — the one with further
 * to go first — so the hand-off never lifts him off the floor.
 */
function handOff(from: DanceShot, to: DanceShot, t: number): DanceShot {
  const eased = easeInOut(t);
  const blended: Record<Channel, number> = { ...blendParams(from.params, to.params, eased) };
  const distance = (side: Side): number => footDistance(from.params, to.params, side);
  const first: Side = distance('right') >= distance('left') ? 'right' : 'left';
  for (const side of ['right', 'left'] as const) {
    const c = SIDE_CHANNELS[side];
    const moved = clamp01(distance(side) / TRANSITION_STEP_FULL);
    if (moved <= 0) continue;
    const own = clamp01(side === first ? t * 2 : t * 2 - 1);
    const stepped = easeInOut(own);
    blended[c.footX] = lerp(from.params[c.footX], to.params[c.footX], stepped);
    blended[c.footDepth] = lerp(from.params[c.footDepth], to.params[c.footDepth], stepped);
    blended[c.footLift] += TRANSITION_STEP_RISE * moved * hump(own);
  }
  const discrete = eased < 0.5 ? from : to;
  return { ...discrete, params: blended };
}

/** One sixteen-frame phrase of the act, the unit a row is baked from. */
export interface MagnumPhrase {
  readonly routine: MagnumRoutineId;
  /** 0 for the routine's first phrase. */
  readonly index: number;
  readonly state: string;
}

export function magnumPhraseState(routine: MagnumRoutineId, index: number): string {
  return `dance_${routine}_${index + 1}`;
}

/** Every phrase of the act, in the order it plays. */
export const MAGNUM_PHRASES: readonly MagnumPhrase[] = ROUTINES.flatMap((routine) =>
  Array.from({ length: routine.phrases }, (_unused, index) => ({
    routine: routine.id,
    index,
    state: magnumPhraseState(routine.id, index),
  })),
);

/** Frames in one pass through the whole act. */
export const MAGNUM_ACT_FRAMES = MAGNUM_PHRASES.length * MAGNUM_PHRASE_FRAMES;

function routineOf(id: MagnumRoutineId): { routine: Routine; next: Routine } {
  const at = ROUTINES.findIndex((routine) => routine.id === id);
  if (at < 0) throw new Error(`magnum has no routine "${id}"`);
  return { routine: ROUTINES[at], next: ROUTINES[(at + 1) % ROUTINES.length] };
}

/** A routine's shot at a time, with the head's slow drift laid over it. */
function shotAt(routine: Routine, beats: number): DanceShot {
  const shot = routine.at(beats);
  return {
    ...shot,
    params: withChannels(shot.params, { headTilt: shot.params.headTilt + drift(beats) }),
  };
}

/** The shot a phrase paints on one of its frames, hand-offs included. */
export function magnumDanceShot(phrase: MagnumPhrase, frame: number): DanceShot {
  const { routine, next } = routineOf(phrase.routine);
  const routineFrame = phrase.index * MAGNUM_PHRASE_FRAMES + frame;
  const routineFrames = routine.phrases * MAGNUM_PHRASE_FRAMES;
  const own = shotAt(routine, routineFrame / MAGNUM_FRAMES_PER_BEAT);
  const handOffFrom = routineFrames - MAGNUM_TRANSITION_FRAMES;
  if (routineFrame < handOffFrom) return own;
  const t = (routineFrame - handOffFrom + 1) / (MAGNUM_TRANSITION_FRAMES + 1);
  // The next routine is already running as it takes over, so the hand-off
  // ends at its own pace rather than easing to a stop on its first frame.
  const intoNext = (routineFrame - routineFrames) / MAGNUM_FRAMES_PER_BEAT;
  return handOff(own, shotAt(next, intoNext), t);
}

/** The pole contacts of the act, as frames of the act from its first. */
export interface ActPoleContact {
  readonly side: Side;
  readonly fromFrame: number;
  /** Inclusive. */
  readonly toFrame: number;
}

function routineStartFrame(id: MagnumRoutineId): number {
  let frame = 0;
  for (const routine of ROUTINES) {
    if (routine.id === id) return frame;
    frame += routine.phrases * MAGNUM_PHRASE_FRAMES;
  }
  throw new Error(`magnum has no routine "${id}"`);
}

/** Every authored pole contact of the act, in act frames. */
export function magnumPoleContacts(): readonly ActPoleContact[] {
  return ROUTINES.flatMap((routine) =>
    routine.poleContacts.map((contact) => {
      const start = routineStartFrame(routine.id);
      return {
        side: contact.side,
        fromFrame: start + Math.ceil(contact.fromBeat * MAGNUM_FRAMES_PER_BEAT),
        toFrame: start + Math.floor(contact.toBeat * MAGNUM_FRAMES_PER_BEAT),
      };
    }),
  );
}

/** A big move as the act frame it lands on, for a stage to cue a cheer or a sound. */
export interface ActBigMove {
  readonly move: MagnumBigMove;
  readonly frame: number;
}

export function magnumBigMoves(): readonly ActBigMove[] {
  return ROUTINES.flatMap((routine) =>
    routine.bigMoves.map((cue) => ({
      move: cue.move,
      frame: routineStartFrame(routine.id) + Math.round(cue.beat * MAGNUM_FRAMES_PER_BEAT),
    })),
  );
}

/**
 * Feet in no frame of the act leave the floor except by a step. A step is the
 * only thing that lifts a foot, so a frame where both are up is never
 * authored; the gates hold every frame to it.
 */
export const MAGNUM_AIRBORNE_FRAMES: ReadonlySet<number> = new Set<number>();

// ── Shots to poses ───────────────────────────────────────────────────────────

/** Past this much grip a hand is on the pole and points through it. */
const GRIPPING = 0.5;

/** The way an elbow points for a given vertical lean of its pole: out, and back a little. */
const ELBOW_POLE_BACK = -0.3;

function footInFigure(
  view: MagnumView,
  mirrored: boolean,
  x: number,
  depth: number,
  lift: number,
): V3 {
  const across = x / MAGNUM_BODY_SCALE;
  const toward = depth / MAGNUM_BODY_SCALE;
  const up = -lift / MAGNUM_BODY_SCALE;
  if (view === 'front') return v3(-across, up, toward);
  if (view === 'back') return v3(across, up, -toward);
  return v3(toward, up, mirrored ? -across : across);
}

/** The pose a shot paints. */
export function magnumDancePose(shot: DanceShot): MagnumPose {
  const p = shot.params;
  const rest = restPose();
  const body: MagnumPose = {
    ...rest,
    pelvis: v3(p.hipX, -(HIP_HEIGHT - p.hipDrop), p.hipZ),
    lean: p.lean,
    twist: p.twist,
    roll: p.roll,
    chestShift: v3(p.chestX, -p.chestUp, p.chestZ),
    hipRoll: p.hipRoll,
    hipPitch: p.hipPitch,
    headNod: p.headNod,
    headTilt: p.headTilt,
    headForward: p.headForward,
    headLook: shot.look,
    face: shot.face,
    offset: { x: p.travel, y: 0 },
    mirrored: shot.mirrored,
  };
  const legOf = (side: Side): LegPose => {
    const c = SIDE_CHANNELS[side];
    const relative = p[c.footX] - p.travel;
    const ball = footInFigure(shot.view, shot.mirrored, relative, p[c.footDepth], p[c.footLift]);
    return { ball, heelLift: p[c.heel] };
  };
  const armOf = (side: Side): ArmPose => {
    const c = SIDE_CHANNELS[side];
    const onBody = chestPoint(body, v3(p[c.wristX], p[c.wristY], p[c.wristZ]));
    const pole = poleInFigure(shot.view, shot.mirrored, p.travel, p[c.gripHeight]);
    // The fist closes round the pole, so the wrist stops short of it by half a fist.
    const shoulder = shoulderJoint(body, side);
    const onPole = sub(pole, scale3(unit3(sub(pole, shoulder)), MAGNUM_FIST_MIDDLE));
    return {
      kind: 'reach',
      wrist: lerpV(onBody, onPole, clamp01(p[c.grip])),
      pole: v3(sideSign(side), p[c.elbowY], ELBOW_POLE_BACK),
    };
  };
  // A gripping hand points straight on through the pole, so its fist closes
  // round the pole's axis rather than beside it.
  const handOf = (side: Side): HandPose => {
    const c = SIDE_CHANNELS[side];
    if (p[c.grip] < GRIPPING) return { closed: p[c.closed], point: null };
    const pole = poleInFigure(shot.view, shot.mirrored, p.travel, p[c.gripHeight]);
    return { closed: p[c.closed], point: sub(pole, shoulderJoint(body, side)) };
  };
  return {
    ...body,
    arms: { right: armOf('right'), left: armOf('left') },
    hands: { right: handOf('right'), left: handOf('left') },
    legs: { right: legOf('right'), left: legOf('left') },
  };
}
