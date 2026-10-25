/**
 * A cat's lateral-sequence walk, in every view: the footfalls go hind, then
 * the forefoot on the same side, then the other hind and its forefoot, an
 * even quarter cycle apart, and each forepaw lifts just before the hind paw
 * behind it lands in its print. Each paw is planted for most of the cycle and
 * swung forward through the rest, so two or three paws are down at every
 * moment.
 *
 * The body rides the legs rather than bouncing: in profile the back tips
 * nose-up a little over the forelegs' mid-stance and nose-down over the hind
 * legs', and the body rises twice a cycle, an eighth of a cycle after each of
 * those; head-on and from behind the weight shifts
 * onto the planted side and the shoulders or hips roll with it. The head is
 * carried low and held steady against all of it, and the tail is carried in a
 * gentle upward curve.
 *
 * Head-on and from behind the paws are set down nearly one in front of the
 * other on her centreline, the near-single-track walk of a cat.
 */

import {
  type CatPose,
  type PawPose,
  type TailPose,
  clamp01,
  deg,
  easeInOut,
  hump,
  lerp,
  restPose,
  TWO_PI,
} from './catArt';

/** The share of the cycle each paw is planted. */
const DUTY = 0.62;
/**
 * Where in the cycle each paw lands, as a share of it: right hind, right
 * fore, left hind, left fore, a quarter cycle apart — the even four-beat of a
 * walk, two frames apart on an eight-frame row. Each forepaw lifts an eighth
 * of a cycle before the hind paw behind it lands in its print.
 */
const HIND_RIGHT_LANDS = 0;
const FORE_RIGHT_LANDS = 0.25;
const HIND_LEFT_LANDS = 0.5;
const FORE_LEFT_LANDS = 0.75;

/** Where a paw is in its own step: 0 as it lands, through its stance, then its swing. */
function stepCycle(phase: number, lands: number): number {
  const cycle = phase - lands;
  return ((cycle % 1) + 1) % 1;
}

/** The share of its stance a paw is through, and of its swing; null for whichever it is not in. */
function stepParts(cycle: number): { stance: number | null; swing: number | null } {
  if (cycle < DUTY) return { stance: cycle / DUTY, swing: null };
  return { stance: null, swing: (cycle - DUTY) / (1 - DUTY) };
}

// ── Profile ──────────────────────────────────────────────────────────────────

/** Half a stride along the ground, tile units, fore and hind; and the swing's clearance. */
const SIDE_FORE_REACH = 0.1;
const SIDE_HIND_REACH = 0.1;
const SIDE_FORE_LIFT = 0.075;
const SIDE_HIND_LIFT = 0.08;
/**
 * How far a swinging leg folds at the top of its swing, as a share of the
 * painter's full fold: a walking cat clears the ground by a paw's height and
 * no more — folded right up, the leg reads as a gallop's tuck.
 */
const SIDE_SWING_FOLD = 0.55;
/**
 * How far the back rocks nose-up over the forelegs and nose-down over the
 * hind legs. The painter turns the legs with the body, so any more lifts the
 * planted fore or hind pair off the floor together and the walk reads as a
 * bound.
 */
const SIDE_ROCK = deg(1.5);
/** The rise of the whole body twice a cycle, between the forelegs' and the hind legs' vaults. */
const SIDE_BOB = 0.012;
/**
 * How far forward of the pitch's pivot her head rides, tile units: rocking
 * the back by an angle lifts the head by about this times the angle, which
 * the head is lowered by to stay steady.
 */
const SIDE_HEAD_LEVER = 0.41;
/** Her head rides this share of the body's rise; a hunting cat's head barely moves. */
const SIDE_HEAD_BOB_SHARE = 0.7;
/** Her head is carried a little lower than when she stands. */
const SIDE_HEAD_CARRIAGE = 0.08;
/** The forelegs' mid-stance, when her shoulders are highest: its share of the cycle. */
const SHOULDERS_HIGH = FORE_LEFT_LANDS + DUTY / 2 - 1;

/** A paw in profile: back along the ground through its stance, forward and up through its swing. */
function sidePaw(phase: number, lands: number, reach: number, lift: number): PawPose {
  const { stance, swing } = stepParts(stepCycle(phase, lands));
  if (stance !== null) return { dx: lerp(reach, -reach, stance), dy: 0, lift: 0, claw: 0 };
  const t = swing ?? 0;
  const raised = hump(t);
  return {
    dx: lerp(-reach, reach, easeInOut(t)),
    dy: -raised * lift,
    lift: raised * SIDE_SWING_FOLD,
    claw: 0,
  };
}

const SIDE_TAIL: Omit<TailPose, 'phase' | 'flick'> = {
  base: deg(-172),
  curl: 0.55,
  wave: 0.3,
  puff: 0,
  rootX: 0,
  rootY: 0,
  reach: 1,
};
const TAIL_FLICK = 0.05;

const EARS_FORWARD = 0.4;
const WALK_PUPIL = 0.5;
const BLINK_AT = 0.35;
const BLINK_HOLD = 0.06;

function blink(phase: number, at: number): number {
  const distance = Math.abs(((phase - at + 0.5 + 1) % 1) - 0.5);
  return distance < BLINK_HOLD ? clamp01(distance / BLINK_HOLD) : 1;
}

/** Her walk in profile facing +X: near legs are her right. */
export function lateralWalkSide(phase: number): CatPose {
  const angle = phase * TWO_PI;
  const rock = -SIDE_ROCK * Math.cos((phase - SHOULDERS_HIGH) * TWO_PI * 2);
  const bob = -SIDE_BOB * Math.cos((phase - SHOULDERS_HIGH) * TWO_PI * 2 - Math.PI / 2);
  return {
    ...restPose(),
    bob,
    lean: rock,
    headY: SIDE_HEAD_CARRIAGE - bob * SIDE_HEAD_BOB_SHARE - rock * SIDE_HEAD_LEVER,
    headTilt: -rock,
    earL: EARS_FORWARD,
    earR: EARS_FORWARD,
    eyeOpen: blink(phase, BLINK_AT),
    pupil: WALK_PUPIL,
    tail: { ...SIDE_TAIL, phase: angle, flick: TAIL_FLICK * Math.sin(angle) },
    frontR: sidePaw(phase, FORE_RIGHT_LANDS, SIDE_FORE_REACH, SIDE_FORE_LIFT),
    frontL: sidePaw(phase, FORE_LEFT_LANDS, SIDE_FORE_REACH, SIDE_FORE_LIFT),
    hindR: sidePaw(phase, HIND_RIGHT_LANDS, SIDE_HIND_REACH, SIDE_HIND_LIFT),
    hindL: sidePaw(phase, HIND_LEFT_LANDS, SIDE_HIND_REACH, SIDE_HIND_LIFT),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

// ── Toward and away from the camera ──────────────────────────────────────────

/**
 * Head-on a planted paw sits this far in from its rest toward her centreline,
 * tile units: the paws land nearly one in front of the other.
 */
const SINGLE_TRACK_IN = 0.1;
/** Hind paws are set down less far in than the forepaws: her hips are wider than her chest. */
const HIND_TRACK_SHARE = 0.5;
/** A swinging paw rises this far, and comes in from a touch wider, as it is carried forward. */
const AXIAL_FORE_LIFT = 0.12;
const AXIAL_HIND_LIFT = 0.08;
const AXIAL_SWING_WIDEN = 0.02;
/**
 * Coming toward the camera a planted paw drifts up the screen as her body
 * passes over it, and a swung one lands a little nearer the camera; going
 * away, the other way round. Enough of it that the two frames either side of
 * a swing's peak differ by where the paw is, not only by how high.
 */
const AXIAL_STANCE_DRIFT = 0.06;
/**
 * From behind her forepaws are the far pair, mostly hidden by her body: a
 * forepaw lifted as high as it is head-on, or drifting down the screen
 * through its stance, shows as a loose paw below her hind legs. So they lift
 * a little and hold still.
 */
const BACK_FORE_LIFT = 0.04;
/**
 * From behind her hind paws are the near pair: set this far down the screen
 * they stand on her shadow rather than hovering over it.
 */
const BACK_HIND_PAW_DROP = 0.08;
/** Head-on her forepaws are the near pair, set down onto her shadow the same way. */
const FRONT_FOREPAW_DROP = 0.03;

/** How one pair of paws steps in the toward or away walk. */
interface AxialStep {
  readonly drift: number;
  readonly lift: number;
  /** How far up the screen they are set from their rest, tile units; negative sets them lower. */
  readonly rise: number;
  /** The most `lift` a swinging paw reports: how far the painter folds it up under her. */
  readonly fold: number;
}

/**
 * Head-on a swinging forepaw folds no further than this: folded right up it
 * tucks under her chin and the step reads as a raised paw.
 */
const FRONT_FOREPAW_FOLD = 0.5;

/**
 * From behind, her forepaws are set this far up under her chest, out of the
 * gap a lifted hind leg opens: drawn without their legs there, a forepaw
 * showing in that gap reads as a loose paw.
 */
const BACK_FOREPAW_RISE = 0.05;

/**
 * The toward and away rows sample the cycle a little under half a frame off
 * its footfalls. The swings and the weight shift are symmetric about both the
 * footfalls and the swings' peaks, half a frame apart: sampled on either, two
 * neighbouring frames mirror each other and the row holds a pose for two
 * frames — on the peaks at an offset of nothing, at the wrap on a whole half
 * frame. Short of half a frame, every step moves by a similar amount.
 */
const AXIAL_PHASE_OFFSET = 7 / 128;

function raisedBy(paw: PawPose, rise: number): PawPose {
  return { ...paw, dy: paw.dy - rise };
}
/** How far her weight shifts onto the planted side, and how far her shoulders roll with it. */
const AXIAL_SWAY = 0.05;
const AXIAL_ROLL = deg(9);
const AXIAL_BOB = 0.014;
/** Coming toward or going away from the camera her head is carried low, in front of her shoulders. */
const AXIAL_HEAD_CARRIAGE = 0.11;
/** Her head stays over her centreline: it takes back this share of the sway. */
const AXIAL_HEAD_STEADY = 0.85;
/** The head counters this share of the shoulders' roll. */
const AXIAL_HEAD_COUNTER = 0.6;
/** The forepaw that holds her weight is in mid-stance here: right forepaw first. */
const WEIGHT_ON_RIGHT = FORE_RIGHT_LANDS + DUTY / 2;

/**
 * A swinging hind paw reports at most this much `lift`: a hind paw lifted past
 * half is drawn hoisted clear of her flank, the grooming pose, not a step.
 */
const HIND_STEP_LIFT_SHARE = 0.45;

/** A paw head-on or from behind: drifting up the screen through its stance, lifted and carried in through its swing. */
function axialPaw(
  phase: number,
  lands: number,
  side: number,
  drift: number,
  lift: number,
  liftShare = 1,
  trackShare = 1,
): PawPose {
  const { stance, swing } = stepParts(stepCycle(phase, lands));
  const inward = -side * SINGLE_TRACK_IN * trackShare;
  if (stance !== null) {
    return {
      dx: inward,
      dy: lerp(drift / 2, -drift / 2, stance),
      lift: 0,
      claw: 0,
    };
  }
  const t = swing ?? 0;
  const raised = hump(t);
  return {
    dx: inward + side * AXIAL_SWING_WIDEN * raised,
    dy: lerp(-drift / 2, drift / 2, easeInOut(t)) - raised * lift,
    lift: raised * liftShare,
    claw: 0,
  };
}

/** How the tail is carried and swished in one of the toward and away views. */
interface AxialTail {
  readonly carriage: Omit<TailPose, 'phase' | 'flick'>;
  /** How far either side of upright the tail is swung at the end of each swish. */
  readonly swish: number;
  /**
   * The share of the swing its curl takes back toward upright along the tail,
   * so a swung tail bends in a relaxed bow with its tip lifted, not a straight
   * rod pivoting at her rump.
   */
  readonly curlBack: number;
}

/**
 * Toward and away from the camera the tail is carried up from the middle of
 * her rump and swished from side to side once a stride. Upright and still it
 * stands behind her head head-on and over her black back from behind, and
 * either way she reads as tailless; swung out past her flank it shows against
 * the floor, the one place a black tail can be seen.
 *
 * Head-on it is swung out wide and low beside her flank and bowed up from
 * there: drawn up behind her head instead, its tip stands between or beside
 * her ears and reads as a horn or a third ear.
 */
const FRONT_TAIL: AxialTail = {
  carriage: {
    base: deg(-90),
    curl: 0,
    wave: 0.15,
    puff: 0,
    rootX: -0.12,
    rootY: 0.04,
    reach: 1,
  },
  swish: deg(90),
  curlBack: 0.75,
};
const BACK_TAIL: AxialTail = {
  carriage: {
    base: deg(-90),
    curl: 0,
    wave: 0.15,
    puff: 0,
    rootX: -0.16,
    rootY: 0.06,
    reach: 1,
  },
  swish: deg(80),
  curlBack: 0.75,
};
/**
 * Shapes the swish so the tail lingers out at either side and passes quickly
 * through upright, where her body hides it: a sine's even sweep leaves half
 * the row's frames with the tail tucked behind her.
 */
const TAIL_SWISH_DWELL = 0.5;
/**
 * The swish trails her weight by this share of the cycle: the hips carry the
 * tail's root over first and the rest of it follows, as a tail does.
 */
const TAIL_SWISH_LAG = 0.08;
/**
 * The share of her tail's length that shows as it swings through upright:
 * there it points straight back past her, toward the camera from behind and
 * away from it head-on, and drawn at full length it stands up beside her
 * head as a horn or a third ear.
 */
const TAIL_CROSSING_REACH = 0.6;

/**
 * The tail swung against the weight's shift, the counterweight a walking cat
 * carries: over to the side her weight is leaving.
 */
function swishedTail(tail: AxialTail, phase: number): TailPose {
  const shift = weightShift(phase - TAIL_SWISH_LAG);
  const dwelling = Math.sign(shift) * Math.abs(shift) ** TAIL_SWISH_DWELL;
  const swing = -tail.swish * dwelling;
  const angle = phase * TWO_PI;
  return {
    ...tail.carriage,
    base: tail.carriage.base + swing,
    curl: tail.carriage.curl - swing * tail.curlBack,
    reach: lerp(TAIL_CROSSING_REACH, 1, Math.abs(dwelling)),
    phase: angle,
    flick: TAIL_FLICK * Math.sin(angle),
  };
}

/** The weight's shift toward screen right, -1 to 1: onto whichever forepaw is planted. */
function weightShift(phase: number): number {
  return Math.sin((phase - WEIGHT_ON_RIGHT) * TWO_PI + Math.PI / 2);
}

function axialWalk(rowPhase: number, tail: AxialTail, fore: AxialStep, hind: AxialStep): CatPose {
  const phase = rowPhase + AXIAL_PHASE_OFFSET;
  const angle = phase * TWO_PI;
  const shift = weightShift(phase);
  const sway = AXIAL_SWAY * shift;
  const roll = AXIAL_ROLL * shift;
  const bob = -AXIAL_BOB * Math.cos((phase - WEIGHT_ON_RIGHT) * TWO_PI * 2);
  return {
    ...restPose(),
    bob,
    sway,
    lean: roll,
    headX: -sway * AXIAL_HEAD_STEADY,
    headY: AXIAL_HEAD_CARRIAGE - bob * SIDE_HEAD_BOB_SHARE,
    headTilt: -roll * AXIAL_HEAD_COUNTER,
    earL: EARS_FORWARD,
    earR: EARS_FORWARD,
    eyeOpen: blink(phase, BLINK_AT),
    pupil: WALK_PUPIL,
    tail: swishedTail(tail, phase),
    frontR: raisedBy(
      axialPaw(phase, FORE_RIGHT_LANDS, 1, fore.drift, fore.lift, fore.fold),
      fore.rise,
    ),
    frontL: raisedBy(
      axialPaw(phase, FORE_LEFT_LANDS, -1, fore.drift, fore.lift, fore.fold),
      fore.rise,
    ),
    hindR: raisedBy(
      axialPaw(phase, HIND_RIGHT_LANDS, 1, hind.drift, hind.lift, hind.fold, HIND_TRACK_SHARE),
      hind.rise,
    ),
    hindL: raisedBy(
      axialPaw(phase, HIND_LEFT_LANDS, -1, hind.drift, hind.lift, hind.fold, HIND_TRACK_SHARE),
      hind.rise,
    ),
    breathe: Math.sin(angle * 2),
    time: phase,
  };
}

/** Her walk toward the camera. */
export function lateralWalkFront(phase: number): CatPose {
  return axialWalk(
    phase,
    FRONT_TAIL,
    {
      drift: AXIAL_STANCE_DRIFT,
      lift: AXIAL_FORE_LIFT,
      rise: -FRONT_FOREPAW_DROP,
      fold: FRONT_FOREPAW_FOLD,
    },
    { drift: AXIAL_STANCE_DRIFT, lift: AXIAL_HIND_LIFT, rise: 0, fold: HIND_STEP_LIFT_SHARE },
  );
}

/**
 * Her walk away from the camera: the same footfalls seen from behind, where
 * her right is on screen right and her hips roll over the planted hind paw.
 */
export function lateralWalkBack(phase: number): CatPose {
  return axialWalk(
    phase,
    BACK_TAIL,
    { drift: 0, lift: BACK_FORE_LIFT, rise: BACK_FOREPAW_RISE, fold: 1 },
    {
      drift: -AXIAL_STANCE_DRIFT,
      lift: AXIAL_HIND_LIFT,
      rise: -BACK_HIND_PAW_DROP,
      fold: HIND_STEP_LIFT_SHARE,
    },
  );
}
