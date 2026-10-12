/**
 * What Deuce's body is doing in each `DealerState`, as a pose sampled from a
 * millisecond clock. The painters only draw poses; every timing decision is
 * here.
 *
 * Coordinates are the portrait's: the origin is the near edge of the felt
 * under his belly, one unit is the portrait's width, +y runs down toward the
 * player. "Right" and "left" are Deuce's own, so his right hand is on the
 * viewer's left.
 */

import { easeInOut, hump, lerp, type Pt } from '../carlArt';
import { type Grip } from './grip';
import { type HandPose, RESTING_HAND } from './hand';
import { type DeuceExpression } from './head';
import { lerpPt, pt } from './paint';

/**
 * What Deuce is doing. Driven by the table phase plus the settled outcome, so
 * the portrait always reflects the hand in front of it.
 */
export type DealerState =
  'idle' | 'dealing' | 'flipping' | 'waiting_on_player' | 'concede' | 'smug' | 'impressed' | 'bust';

export interface ArmPose {
  elbow: Pt;
  wrist: Pt;
  /** Direction the hand points, wrist to knuckles. */
  handAngle: number;
  hand: HandPose;
  thumbSide: 1 | -1;
  grip: Grip;
  /** A raised arm crosses in front of the face and is painted after the head. */
  overHead: boolean;
}

export interface DealtCard {
  /** Where the card is once it has left the hand; null while it is still held. */
  free: { centre: Pt; angle: number; alpha: number } | null;
  /** 0 back up, 1 face up; the card turns over between. */
  flip: number;
}

export interface DeucePose {
  /** Vertical breath offset of everything above the felt. */
  breath: number;
  /** Shoulders lifted, in units — the shrug. */
  shrug: number;
  headTilt: number;
  headShift: Pt;
  expression: DeuceExpression;
  rightArm: ArmPose;
  leftArm: ArmPose;
  card: DealtCard | null;
  /** The squared deck lies on the felt rather than in his hand. */
  deckOnFelt: boolean;
  /**
   * How far the panel's own gaze hint (which hand is live) may steer his eyes,
   * 0 to 1. A state that is watching something particular — the card in his
   * fingers, the player's face — keeps its own gaze.
   */
  panelGazeShare: number;
}

const TWO_PI = Math.PI * 2;

/** A slow, even breath — a dealer at rest, not a figure vibrating in place. */
const BREATH_PERIOD_MS = 5200;
const BREATH_AMOUNT = 0.006;

const BLINK_CYCLE_MS = 4700;
const BLINK_MS = 140;
const LIDS_SHUT = 0;

/** One full deal: thumb the top card off, carry it out, let it go, come back. */
export const DEAL_PERIOD_MS = 1600;
const DEAL_PICK_END = 0.16;
const DEAL_CARRY_END = 0.52;
const DEAL_RELEASE_END = 0.66;

/** The hole card is lifted, turned over and laid down on this loop. */
const FLIP_PERIOD_MS = 1800;
const FLIP_LIFT_END = 0.2;
const FLIP_TURN_END = 0.55;
const FLIP_HOLD_END = 0.8;

/**
 * Squaring the deck is a thing a dealer does now and then. It fires for a
 * short beat out of a long cycle, so between hands Deuce is mostly still.
 */
const SQUARE_CYCLE_MS = 9000;
const SQUARE_ACTIVE_MS = 1300;

/** Fingers drummed on the felt while the player thinks: one roll, then stillness. */
const DRUM_CYCLE_MS = 3800;
const DRUM_ROLL_MS = 720;
const DRUM_LIFT = 0.55;
const LITTLE_FINGER = 3;
/** Each finger starts its lift this share of the roll after the one before it. */
const DRUM_STAGGER = 0.2;
/** How much of the roll one finger's lift lasts. */
const DRUM_FINGER_SHARE = 0.35;

/** The tip of the visor when the player hits a blackjack: up, hold, and a slow settle. */
const SALUTE_CYCLE_MS = 3200;
const SALUTE_RISE_END = 0.25;
const SALUTE_HOLD_END = 0.75;
/** He lowers the hand only partway before the next tip, so the salute lingers. */
const SALUTE_SETTLE = 0.15;
/** Past this far up the hand has turned palm-out at the brim. */
const SALUTE_TURN_AT = 0.4;
const SALUTE_ELBOW = pt(-0.5, -0.36);
const SALUTE_WRIST = pt(-0.34, -0.74);
const SALUTE_HAND_ANGLE = -0.78;
const SALUTE_HEAD_TILT = -0.06;
const SALUTE_HEAD_DROP = 0.012;

/** His natural, heavy-lidded look. */
const NEUTRAL: DeuceExpression = {
  lidOpen: 1,
  browRaise: 0,
  browSkew: 0,
  mouthCurve: 0,
  mouthOpen: 0,
  smirk: 0,
  lookX: 0,
  lookY: 0,
};

// ── Arm placements ───────────────────────────────────────────────────────────

const RIGHT_ELBOW_REST = pt(-0.43, 0.03);
const RIGHT_WRIST_REST = pt(-0.27, 0.14);
const RIGHT_HAND_REST_ANGLE = 0.42;

const LEFT_ELBOW_REST = pt(0.43, 0.03);
const LEFT_WRIST_REST = pt(0.24, 0.12);
const LEFT_HAND_ANGLE = Math.PI - 0.62;

/** The deck sits in his left palm; dealing reaches the right hand across to it. */
const RIGHT_WRIST_AT_DECK = pt(0.03, 0.06);
const RIGHT_ELBOW_AT_DECK = pt(-0.3, 0.0);
const RIGHT_HAND_AT_DECK_ANGLE = 0.25;
const RIGHT_WRIST_DEALT = pt(-0.2, 0.24);
const RIGHT_ELBOW_DEALT = pt(-0.44, 0.06);
const RIGHT_HAND_DEALT_ANGLE = 1.05;
/** After release the card keeps sliding toward the player and out of frame. */
const CARD_SLIDE_TO = pt(-0.34, 0.62);
const CARD_RELEASE_AT = pt(-0.13, 0.33);
const DEALT_CARD_ANGLE = 0.5;
/** How far a released card fades as it slides off toward the player. */
const DEALT_CARD_FADE = 0.3;
const DEALING_HEAD_TILT = -0.03;
/** His eyes follow the card from the deck (screen right) out to the player's spot. */
const DEALING_LOOK_AT_DECK = 0.4;
const DEALING_LOOK_AT_SPOT = -0.5;
const DEALING_LOOK_DOWN = 0.8;

/** Squaring reaches the deck in the first part of its beat and holds there. */
const SQUARE_REACH_RATE = 1.6;
/** Squaring swaps to the over-the-deck hand once it is most of the way there. */
const SQUARE_HAND_SWAP_AT = 0.5;
const RIGHT_WRIST_SQUARING = pt(0.05, 0.03);
const RIGHT_HAND_SQUARING_ANGLE = 0.15;

const FLIP_ELBOW = pt(-0.42, -0.02);
const FLIP_WRIST = pt(-0.16, 0.05);
const FLIP_HAND_ANGLE = 0.2;
const FLIP_HEAD_TILT = 0.02;

const OPEN_HAND_ELBOW = pt(-0.44, 0.02);
const OPEN_HAND_WRIST = pt(-0.22, 0.13);
const OFFERING_HAND_ANGLE = 1.2;
const SHRUG_HAND_ANGLE = 1.45;
const SHRUG_ELBOW = pt(0.47, 0);
const SHRUG_WRIST = pt(0.27, 0.12);
const SHRUG_LIFT = 0.045;

const WAITING_HEAD_TILT = 0.03;
const CONCEDE_HEAD_TILT = 0.05;
const SMUG_HEAD_TILT = -0.05;
/** Chin up: the head rises a touch as it tips back. */
const SMUG_HEAD_SHIFT = pt(0, -0.008);
const BUST_HEAD_TILT = 0.07;
const BUST_HEAD_SHIFT = pt(0, 0.01);

/** Brows knit a little over a card he cannot see yet. */
const FLIPPING_FACE: Partial<DeuceExpression> = { browRaise: -0.15, lookX: -0.3, lookY: 0.7 };
const WAITING_FACE: Partial<DeuceExpression> = { lookY: 1, browRaise: 0.1 };
/** A rueful half smile: fair enough, you got me. */
const CONCEDE_FACE: Partial<DeuceExpression> = { mouthCurve: 0.35, smirk: 0.3, browRaise: 0.35 };
const CONCEDE_LIDS = 0.95;
/** One brow up, lids low, a one-sided smirk. */
const SMUG_FACE: Partial<DeuceExpression> = {
  browSkew: 0.55,
  mouthCurve: 0.15,
  smirk: 0.9,
  lookX: 0.3,
};
const SMUG_LIDS = 0.62;
/** Brows high, eyes wide, a grin: the house tips its hat. */
const IMPRESSED_FACE: Partial<DeuceExpression> = {
  lidOpen: 1.3,
  browRaise: 0.9,
  mouthCurve: 0.7,
  mouthOpen: 0.25,
};
/** Caught out: brows up and tilted, corners down, mouth dropped. */
const BUST_FACE: Partial<DeuceExpression> = {
  browRaise: 0.7,
  browSkew: -0.2,
  mouthCurve: -0.55,
  mouthOpen: 0.35,
};
const BUST_LIDS = 1.15;

/** Between hands his eyes wander to whichever hand the panel says is live. */
const IDLE_PANEL_GAZE_SHARE = 0.6;
/** Conceding, he glances at the winning hand but mostly meets the player's eye. */
const CONCEDE_PANEL_GAZE_SHARE = 0.3;

/** Thumb and finger pinch on a dealt card: fingers under, thumb on top. */
export const PINCH_HAND: HandPose = {
  view: 'back',
  curls: [0.28, 0.34, 0.72, 0.85],
  spread: 0.12,
  thumbOut: -0.12,
  thumbBend: 0.2,
};

/** The deck hand: palm up, fingers wrapped over the deck's outer edge, thumb along the inner. */
export const DECK_HAND: HandPose = {
  view: 'palm',
  curls: [0.66, 0.68, 0.72, 0.78],
  spread: 0.05,
  thumbOut: 0.05,
  thumbBend: -0.05,
};

/** Fingers over the deck's far edge, squaring it. */
const SQUARING_HAND: HandPose = {
  view: 'back',
  curls: [0.45, 0.45, 0.5, 0.55],
  spread: 0.05,
  thumbOut: 0.55,
  thumbBend: 0.25,
};

const OPEN_PALM: HandPose = {
  view: 'palm',
  curls: [0.12, 0.1, 0.14, 0.2],
  spread: 0.55,
  thumbOut: 0.75,
  thumbBend: 0,
};

/** Fingers together and straight at the brim; thumb tucked against the index. */
const SALUTE_HAND: HandPose = {
  view: 'palm',
  curls: [0.05, 0.05, 0.08, 0.12],
  spread: 0,
  thumbOut: 0.2,
  thumbBend: 0.2,
};

function deckArm(): ArmPose {
  return {
    elbow: LEFT_ELBOW_REST,
    wrist: LEFT_WRIST_REST,
    handAngle: LEFT_HAND_ANGLE,
    hand: DECK_HAND,
    thumbSide: 1,
    grip: 'deck',
    overHead: false,
  };
}

function restingRightArm(hand: HandPose): ArmPose {
  return {
    elbow: RIGHT_ELBOW_REST,
    wrist: RIGHT_WRIST_REST,
    handAngle: RIGHT_HAND_REST_ANGLE,
    hand,
    thumbSide: 1,
    grip: 'none',
    overHead: false,
  };
}

// ── Clocks ───────────────────────────────────────────────────────────────────

function cycle(phaseMs: number, periodMs: number): number {
  const t = (phaseMs % periodMs) / periodMs;
  return t < 0 ? t + 1 : t;
}

function breathAt(phaseMs: number): number {
  return Math.sin(cycle(phaseMs, BREATH_PERIOD_MS) * TWO_PI) * BREATH_AMOUNT;
}

function lidsAt(phaseMs: number, open: number): number {
  return phaseMs % BLINK_CYCLE_MS < BLINK_MS ? LIDS_SHUT : open;
}

/** One finger after another lifting and dropping, little finger first. */
function drummingHand(phaseMs: number): HandPose {
  const intoCycle = phaseMs % DRUM_CYCLE_MS;
  const base = RESTING_HAND.curls;
  if (intoCycle >= DRUM_ROLL_MS) return RESTING_HAND;
  const roll = intoCycle / DRUM_ROLL_MS;
  const lift = (finger: number): number => {
    const start = (LITTLE_FINGER - finger) * DRUM_STAGGER;
    return hump((roll - start) / DRUM_FINGER_SHARE) * DRUM_LIFT;
  };
  return {
    ...RESTING_HAND,
    curls: [base[0] + lift(0), base[1] + lift(1), base[2] + lift(2), base[3] + lift(3)],
  };
}

/** 0 at rest, rising to 1 while the right hand squares the deck. */
function squaringAt(phaseMs: number): number {
  const intoCycle = phaseMs % SQUARE_CYCLE_MS;
  if (intoCycle >= SQUARE_ACTIVE_MS) return 0;
  return hump(intoCycle / SQUARE_ACTIVE_MS);
}

function squaringRightArm(phaseMs: number, restHand: HandPose): ArmPose {
  const amount = squaringAt(phaseMs);
  if (amount === 0) return restingRightArm(restHand);
  const reach = easeInOut(Math.min(1, amount * SQUARE_REACH_RATE));
  return {
    elbow: lerpPt(RIGHT_ELBOW_REST, RIGHT_ELBOW_AT_DECK, reach),
    wrist: lerpPt(RIGHT_WRIST_REST, RIGHT_WRIST_SQUARING, reach),
    handAngle: lerp(RIGHT_HAND_REST_ANGLE, RIGHT_HAND_SQUARING_ANGLE, reach),
    hand: reach > SQUARE_HAND_SWAP_AT ? SQUARING_HAND : restHand,
    thumbSide: 1,
    grip: 'none',
    overHead: false,
  };
}

/** Where a deal is in its cycle, shared by the portrait and the figure on the club floor. */
export interface DealBeat {
  /** 0 hand at the deck, 1 hand out over the player's spot. */
  reach: number;
  /** The card is pinched in the hand. */
  holding: boolean;
  /** Once let go, 0→1 as the card slides on toward the player; null otherwise. */
  slide: number | null;
}

export function dealBeatAt(phaseMs: number): DealBeat {
  const t = cycle(phaseMs, DEAL_PERIOD_MS);
  if (t < DEAL_PICK_END) return { reach: 0, holding: true, slide: null };
  if (t < DEAL_CARRY_END) {
    return {
      reach: easeInOut((t - DEAL_PICK_END) / (DEAL_CARRY_END - DEAL_PICK_END)),
      holding: true,
      slide: null,
    };
  }
  if (t < DEAL_RELEASE_END) {
    return {
      reach: 1,
      holding: false,
      slide: easeInOut((t - DEAL_CARRY_END) / (DEAL_RELEASE_END - DEAL_CARRY_END)),
    };
  }
  return {
    reach: 1 - easeInOut((t - DEAL_RELEASE_END) / (1 - DEAL_RELEASE_END)),
    holding: false,
    slide: null,
  };
}

/** The hand just after it lets a card go: fingers straightening out of the pinch. */
export const OPEN_PALM_BACK: HandPose = {
  view: 'back',
  curls: [0.2, 0.22, 0.28, 0.34],
  spread: 0.35,
  thumbOut: 0.5,
  thumbBend: 0,
};

function dealingPose(phaseMs: number, base: DeucePose): DeucePose {
  const beat = dealBeatAt(phaseMs);
  const slide = beat.slide;
  let card: DealtCard | null = null;
  if (beat.holding) card = { free: null, flip: 0 };
  else if (slide !== null) {
    card = {
      free: {
        centre: lerpPt(CARD_RELEASE_AT, CARD_SLIDE_TO, slide),
        angle: DEALT_CARD_ANGLE,
        alpha: 1 - slide * DEALT_CARD_FADE,
      },
      flip: 0,
    };
  }
  const hand = beat.holding ? PINCH_HAND : slide !== null ? OPEN_PALM_BACK : RESTING_HAND;
  const reach = beat.reach;
  return {
    ...base,
    headTilt: DEALING_HEAD_TILT,
    expression: {
      ...base.expression,
      lookX: lerp(DEALING_LOOK_AT_DECK, DEALING_LOOK_AT_SPOT, reach),
      lookY: DEALING_LOOK_DOWN,
    },
    rightArm: {
      elbow: lerpPt(RIGHT_ELBOW_AT_DECK, RIGHT_ELBOW_DEALT, reach),
      wrist: lerpPt(RIGHT_WRIST_AT_DECK, RIGHT_WRIST_DEALT, reach),
      handAngle: lerp(RIGHT_HAND_AT_DECK_ANGLE, RIGHT_HAND_DEALT_ANGLE, reach),
      hand,
      thumbSide: 1,
      grip: beat.holding ? 'card' : 'none',
      overHead: false,
    },
    card,
  };
}

/** A phase run through three beats: rise over [0, riseEnd), hold, then fall to `settle`. */
function riseHoldFall(t: number, riseEnd: number, holdEnd: number, settle: number): number {
  if (t < riseEnd) return easeInOut(t / riseEnd);
  if (t < holdEnd) return 1;
  return 1 - easeInOut((t - holdEnd) / (1 - holdEnd)) * settle;
}

function flippingPose(phaseMs: number, base: DeucePose): DeucePose {
  const t = cycle(phaseMs, FLIP_PERIOD_MS);
  const lift = riseHoldFall(t, FLIP_LIFT_END, FLIP_HOLD_END, 1);
  const turnThrough = (t - FLIP_LIFT_END) / (FLIP_TURN_END - FLIP_LIFT_END);
  const flip = t < FLIP_LIFT_END ? 0 : easeInOut(Math.min(1, turnThrough));
  return {
    ...base,
    headTilt: FLIP_HEAD_TILT,
    expression: { ...base.expression, ...FLIPPING_FACE },
    rightArm: {
      elbow: lerpPt(RIGHT_ELBOW_REST, FLIP_ELBOW, lift),
      wrist: lerpPt(RIGHT_WRIST_REST, FLIP_WRIST, lift),
      handAngle: lerp(RIGHT_HAND_REST_ANGLE, FLIP_HAND_ANGLE, lift),
      hand: PINCH_HAND,
      thumbSide: 1,
      grip: 'flip',
      overHead: false,
    },
    card: { free: null, flip },
  };
}

function salutePose(phaseMs: number, base: DeucePose): DeucePose {
  const t = cycle(phaseMs, SALUTE_CYCLE_MS);
  const up = riseHoldFall(t, SALUTE_RISE_END, SALUTE_HOLD_END, SALUTE_SETTLE);
  const atBrim = up > SALUTE_TURN_AT;
  return {
    ...base,
    headTilt: lerp(0, SALUTE_HEAD_TILT, up),
    headShift: pt(0, lerp(0, SALUTE_HEAD_DROP, up)),
    expression: { ...base.expression, ...IMPRESSED_FACE },
    rightArm: {
      elbow: lerpPt(RIGHT_ELBOW_REST, SALUTE_ELBOW, up),
      wrist: lerpPt(RIGHT_WRIST_REST, SALUTE_WRIST, up),
      handAngle: lerp(RIGHT_HAND_REST_ANGLE, SALUTE_HAND_ANGLE, up),
      hand: atBrim ? SALUTE_HAND : RESTING_HAND,
      // Palm-down on the felt the thumb is inboard; turned palm-out at the brim it crosses over.
      thumbSide: atBrim ? -1 : 1,
      grip: 'none',
      overHead: atBrim,
    },
  };
}

/** His right hand turned palm-up toward the player. */
function openRightArm(angle: number): ArmPose {
  return {
    elbow: OPEN_HAND_ELBOW,
    wrist: OPEN_HAND_WRIST,
    handAngle: angle,
    hand: OPEN_PALM,
    thumbSide: -1,
    grip: 'none',
    overHead: false,
  };
}

/** Samples Deuce's pose for `state` at `phaseMs`. */
export function deucePoseAt(state: DealerState, phaseMs: number): DeucePose {
  const base: DeucePose = {
    breath: breathAt(phaseMs),
    shrug: 0,
    headTilt: 0,
    headShift: pt(0, 0),
    expression: { ...NEUTRAL, lidOpen: lidsAt(phaseMs, NEUTRAL.lidOpen) },
    rightArm: restingRightArm(RESTING_HAND),
    leftArm: deckArm(),
    card: null,
    deckOnFelt: false,
    panelGazeShare: 0,
  };

  switch (state) {
    case 'dealing':
      return dealingPose(phaseMs, base);
    case 'flipping':
      return flippingPose(phaseMs, base);
    case 'waiting_on_player':
      return {
        ...base,
        headTilt: WAITING_HEAD_TILT,
        expression: { ...base.expression, ...WAITING_FACE },
        rightArm: squaringRightArm(phaseMs, drummingHand(phaseMs)),
      };
    case 'concede':
      return {
        ...base,
        headTilt: CONCEDE_HEAD_TILT,
        expression: { ...base.expression, ...CONCEDE_FACE, lidOpen: lidsAt(phaseMs, CONCEDE_LIDS) },
        rightArm: openRightArm(OFFERING_HAND_ANGLE),
        panelGazeShare: CONCEDE_PANEL_GAZE_SHARE,
      };
    case 'smug':
      return {
        ...base,
        headTilt: SMUG_HEAD_TILT,
        headShift: SMUG_HEAD_SHIFT,
        expression: { ...base.expression, ...SMUG_FACE, lidOpen: lidsAt(phaseMs, SMUG_LIDS) },
        rightArm: restingRightArm(drummingHand(phaseMs)),
      };
    case 'impressed':
      return salutePose(phaseMs, base);
    case 'bust':
      // The shrug: both palms up, the deck set down between them.
      return {
        ...base,
        shrug: SHRUG_LIFT,
        headTilt: BUST_HEAD_TILT,
        headShift: BUST_HEAD_SHIFT,
        expression: { ...base.expression, ...BUST_FACE, lidOpen: lidsAt(phaseMs, BUST_LIDS) },
        rightArm: openRightArm(SHRUG_HAND_ANGLE),
        leftArm: {
          elbow: SHRUG_ELBOW,
          wrist: SHRUG_WRIST,
          handAngle: Math.PI - SHRUG_HAND_ANGLE,
          hand: OPEN_PALM,
          thumbSide: 1,
          grip: 'none',
          overHead: false,
        },
        deckOnFelt: true,
      };
    case 'idle':
      return {
        ...base,
        rightArm: squaringRightArm(phaseMs, RESTING_HAND),
        panelGazeShare: IDLE_PANEL_GAZE_SHARE,
      };
  }
}
