/**
 * One regular's choice at their turn: a legal action, how long they appear to
 * think about it, and any tells that show while they do.
 *
 * The pipeline reads the spot (price, pot odds, stacks, position, the action so
 * far), judges the hand (a starting-hand percentile before the flop; after it,
 * equity against the ranges the regular puts each opponent on, blended with a
 * naive "what have I got" score for players who cannot see the board), maps
 * that onto weighted candidate actions from the profile's tendencies, samples
 * one, sizes it, times it, and clamps it to the legal set last.
 *
 * Pure: the same inputs and the same `Rng` stream give the same decision.
 */

import type { Card } from '../../Deck';
import { isLegal, passiveAction, type LegalActions, type PokerAction } from '../bettingRound';
import {
  HEADS_UP_SEATS,
  type PokerDecision,
  type PokerDecisionContext,
  type SeatView,
} from '../PokerTable';
import { smallestChip } from '../pokerStakes';
import type { Rng } from '../../../../sprites/person/rng';
import { naiveMadeHandScore, readDraws, type DrawRead } from './boardRead';
import { boardStrengthPercentiles, handStrengthNow } from './combos';
import { EQUITY_ITERATIONS, equityVsRanges } from './equity';
import type { EffectiveProfile, Mood } from './mood';
import { playerImage, type PlayerImage, type PlayerRead } from './playerRead';
import { preflopStrength, preflopTopFraction } from './preflop';
import type { Archetype } from './profiles';
import { listAt } from './listAt';
import { estimateRange, lineOf, type PerceivedTendencies } from './ranges';
import {
  evaluateTells,
  type PokerTell,
  type TellChance,
  type TellCue,
  type TellFiring,
  type TellHandState,
} from './tells';

/** Why the regular chose what they did; never shown, read by reports and seat bookkeeping. */
export type DecisionIntent = 'fold' | 'check' | 'call' | 'value' | 'bluff' | 'semi_bluff' | 'shove';

export interface NpcDecision extends PokerDecision {
  /** What the host shows while the seat thinks and acts. */
  readonly cues: ReadonlyArray<TellCue>;
  /** The same tells with whether each fired truthfully, for reports only. */
  readonly tellFirings: ReadonlyArray<TellFiring>;
  readonly intent: DecisionIntent;
  /** The strength the regular believed they had, in [0, 1]. */
  readonly perceivedStrength: number;
  /** The hand's real strength against one random hand right now, in [0, 1]. */
  readonly handStrength: number;
  /** Every chance a tell had to show, for the caller's base-rate bookkeeping. */
  readonly tellChances: ReadonlyArray<TellChance>;
}

export interface DecideOptions {
  readonly archetype: Archetype;
  readonly tells: ReadonlyArray<PokerTell>;
  /** How loose the regular believes each seat plays, indexed by seat. */
  readonly opponents: ReadonlyArray<PerceivedTendencies>;
  readonly equityIterations?: number;
  /** How often each tell's condition holds for this regular, by tell index; missing uses the prior. */
  readonly tellConditionRates?: ReadonlyArray<number>;
}

/** What an unknown seat is assumed to play like: a typical six-handed table. */
export const TYPICAL_TENDENCIES: PerceivedTendencies = { vpip: 0.28, pfr: 0.14 };

// ── Shared shape ────────────────────────────────────────────────────────────

type Choice = 'fold' | 'check' | 'call' | 'raise' | 'shove';

interface Weighted {
  readonly choice: Choice;
  readonly weight: number;
  readonly intent: DecisionIntent;
}

interface Plan {
  readonly options: ReadonlyArray<Weighted>;
  /** 0 for an obvious decision, 1 for a coin flip; slows the regular down. */
  readonly difficulty: number;
  /** Fraction of the pot a bet or raise aims for, before style and tells. */
  readonly sizeFraction: number;
}

/** Softness of the edge between "in range" and "out of range", in starting-hand share. */
const RANGE_EDGE = 0.02;
/** Softness of postflop continue decisions, in units of equity margin. */
const CONTINUE_EDGE = 0.07;

function logistic(x: number, softness: number): number {
  return 1 / (1 + Math.exp(-x / softness));
}

function inRange(width: number, topFraction: number): number {
  return logistic(width - topFraction, RANGE_EDGE);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 1 - Π(1 - p): the chance at least one of several independent reasons fires. */
function anyOf(...chances: number[]): number {
  return 1 - chances.reduce((rest, p) => rest * (1 - clampUnit(p)), 1);
}

function difficultyOf(probability: number): number {
  return 1 - Math.abs(2 * probability - 1);
}

// ── Gather ──────────────────────────────────────────────────────────────────

interface Spot {
  readonly me: SeatView;
  readonly bigBlind: number;
  readonly potOdds: number;
  readonly liveOpponents: ReadonlyArray<SeatView>;
  readonly stackBigBlinds: number;
  readonly currentPrice: number;
  readonly preflopRaises: number;
  readonly limpers: number;
  readonly preflopAggressor: number | null;
  readonly streetAggressor: number | null;
  readonly checkedThisStreet: boolean;
  readonly raisedPreflopMyself: boolean;
  readonly inPosition: boolean;
}

/** Postflop acting order by distance from the button: the small blind acts first, the button last. */
function postflopOrder(positionFromButton: number, seatCount: number): number {
  return (positionFromButton + seatCount - 1) % seatCount;
}

function gather(context: PokerDecisionContext): Spot {
  const me = context.seats[context.seat];
  const bigBlind = context.stakes.bigBlind;
  const liveOpponents = context.seats.filter(
    (seat) => seat.seat !== context.seat && seat.inHand && !seat.folded,
  );
  const currentPrice = Math.max(...context.seats.map((seat) => seat.streetBet));
  const preflop = context.history.filter((record) => record.street === 'preflop');
  const preflopAggressive = preflop.filter((record) => record.aggressive);
  const street = context.history.filter((record) => record.street === context.street);
  const streetAggressive = street.filter((record) => record.aggressive);
  const seatCount = context.seats.length;
  const myOrder = postflopOrder(context.positionFromButton, seatCount);
  return {
    me,
    bigBlind,
    potOdds: context.toCall > 0 ? context.toCall / (context.pot + context.toCall) : 0,
    liveOpponents,
    stackBigBlinds: (me.stack + me.streetBet) / bigBlind,
    currentPrice,
    preflopRaises: preflopAggressive.length,
    limpers: preflop.filter((record) => record.kind === 'call').length,
    preflopAggressor: listAt(preflopAggressive, -1)?.seat ?? null,
    streetAggressor: listAt(streetAggressive, -1)?.seat ?? null,
    checkedThisStreet: street.some(
      (record) => record.seat === context.seat && record.kind === 'check',
    ),
    raisedPreflopMyself: preflopAggressive.some((record) => record.seat === context.seat),
    inPosition: liveOpponents.every(
      (seat) => postflopOrder(seat.positionFromButton, seatCount) < myOrder,
    ),
  };
}

// ── Adaptation ──────────────────────────────────────────────────────────────

/** Only regulars who actually read opponents adjust to the player; fish never adapt. */
const ADAPT_MIN_RANGE_READING = 0.5;
const ADAPT_CALL_DOWN = 0.12;
const ADAPT_FOLD_MORE = 0.12;
const ADAPT_STEAL_WIDTH = 0.15;

interface Adaptation {
  /** Added to the postflop continue score: positive calls lighter. */
  readonly continueShift: number;
  /** Added to preflop continuing widths against a raise. */
  readonly callWidthScale: number;
  /** Extra steal width when the player sits in a blind. */
  readonly stealWidth: number;
}

const NO_ADAPTATION: Adaptation = { continueShift: 0, callWidthScale: 1, stealWidth: 0 };

function adapt(
  context: PokerDecisionContext,
  spot: Spot,
  profile: EffectiveProfile,
  image: PlayerImage,
): Adaptation {
  if (profile.rangeReading < ADAPT_MIN_RANGE_READING) return NO_ADAPTATION;
  const aggressor = spot.streetAggressor;
  const playerBetInto = aggressor !== null && listAt(context.seats, aggressor)?.isPlayer === true;
  const bluffs = Math.max(0, image.bluffiness);
  const onlyValue = Math.max(0, image.valueHeavy);
  const playerInBlind = context.seats.some(
    (seat) =>
      seat.isPlayer &&
      seat.inHand &&
      !seat.folded &&
      BLIND_POSITIONS.has(seatPosition(seat.positionFromButton, seatsDealtIn(context))),
  );
  return {
    continueShift: playerBetInto ? bluffs * ADAPT_CALL_DOWN - onlyValue * ADAPT_FOLD_MORE : 0,
    callWidthScale: playerBetInto ? 1 + bluffs * ADAPT_CALL_DOWN - onlyValue * ADAPT_FOLD_MORE : 1,
    stealWidth: playerInBlind ? Math.max(0, -image.looseness) * ADAPT_STEAL_WIDTH : 0,
  };
}

// ── Preflop ─────────────────────────────────────────────────────────────────

export const SEAT_POSITIONS = [
  'button',
  'small_blind',
  'big_blind',
  'under_the_gun',
  'middle',
  'cutoff',
] as const;
export type SeatPosition = (typeof SEAT_POSITIONS)[number];

const SMALL_BLIND_POSITION = 1;
const BIG_BLIND_POSITION = 2;
/** The last seat before the button. */
const CUTOFF_FROM_BUTTON = 1;
/** The seat before the cutoff; anything earlier is under the gun. */
const MIDDLE_FROM_BUTTON = 2;

/**
 * The seat's name at a table dealt `seatsDealt` seats, from its clockwise
 * distance from the button counted over seats dealt in. Heads-up the button
 * is also the small blind, so the other seat is the big blind; with three or
 * more the blinds follow the button and the late seats are named from the
 * button backwards, so a short table has a cutoff before it has an under the gun.
 */
export function seatPosition(positionFromButton: number, seatsDealt: number): SeatPosition {
  if (positionFromButton === 0) return 'button';
  if (seatsDealt <= HEADS_UP_SEATS) return 'big_blind';
  if (positionFromButton === SMALL_BLIND_POSITION) return 'small_blind';
  if (positionFromButton === BIG_BLIND_POSITION) return 'big_blind';
  const beforeButton = seatsDealt - positionFromButton;
  if (beforeButton === CUTOFF_FROM_BUTTON) return 'cutoff';
  if (beforeButton === MIDDLE_FROM_BUTTON) return 'middle';
  return 'under_the_gun';
}

function seatsDealtIn(context: PokerDecisionContext): number {
  return context.seats.filter((seat) => seat.inHand).length;
}

function positionOfSeat(context: PokerDecisionContext): SeatPosition {
  return seatPosition(context.positionFromButton, seatsDealtIn(context));
}

const BLIND_POSITIONS: ReadonlySet<SeatPosition> = new Set<SeatPosition>([
  'small_blind',
  'big_blind',
]);

/** How much wider (above 1) or tighter a fully position-aware regular plays from each seat. */
const POSITION_WIDTH: Readonly<Record<SeatPosition, number>> = {
  button: 1.45,
  small_blind: 1,
  big_blind: 1.05,
  under_the_gun: 0.6,
  middle: 0.8,
  cutoff: 1.15,
};
/**
 * Unopened pots are where most hands are entered, so the entering width runs a
 * little above the target VPIP to make up for the spots facing a raise, where
 * a regular enters far less often.
 */
const UNOPENED_WIDTH_SCALE = 1.12;
/** At full steal tendency a regular opens this share of hands when folded to in late position. */
const STEAL_WIDTH_AT_FULL = 0.5;
const STEALING_POSITIONS: ReadonlySet<SeatPosition> = new Set<SeatPosition>([
  'button',
  'small_blind',
  'cutoff',
]);
/** A premium a limp-happy regular may just call with, to trap. */
const PREMIUM_LIMP_SHARE = 0.3;
/** Of a regular's playing range, about this share is good enough to call a raise with. */
const CALL_RAISE_SHARE = 0.55;
const BIG_BLIND_DEFENCE = 1.35;
/** A raise above this many big blinds is a big one, and calls tighten. */
const BIG_PREFLOP_RAISE_BIG_BLINDS = 8;
const BIG_RAISE_CALL_SCALE = 0.7;
const FOUR_BET_WIDTH = 0.025;
const COLD_CONTINUE_SHARE = 0.5;
/** Short stackers play shove-or-fold from here down, everyone else from the mood's threshold. */
const SHORT_STACKER_PUSH_FOLD_BIG_BLINDS = 30;
const PUSH_FOLD_MIN_OPEN_WIDTH = 0.15;
const PUSH_OVER_RAISE_SHARE = 0.45;
const PREFLOP_OPEN_BIG_BLINDS = 2.5;
const PREFLOP_RERAISE_MULTIPLIER = 3;
const PREFLOP_FOUR_BET_MULTIPLIER = 2.3;

function positionScale(profile: EffectiveProfile, position: SeatPosition): number {
  const width = POSITION_WIDTH[position];
  return 1 + profile.positionAwareness * (width - 1);
}

function preflopPlan(
  context: PokerDecisionContext,
  spot: Spot,
  profile: EffectiveProfile,
  archetype: Archetype,
  adaptation: Adaptation,
  topFraction: number,
): Plan {
  const legal = context.legal;
  const position = positionScale(profile, positionOfSeat(context));
  const pushFold =
    profile.pushFold ||
    (archetype === 'short_stacker' && spot.stackBigBlinds <= SHORT_STACKER_PUSH_FOLD_BIG_BLINDS);

  if (pushFold) {
    const width =
      spot.preflopRaises === 0
        ? Math.max(profile.vpip, PUSH_FOLD_MIN_OPEN_WIDTH) * position
        : profile.vpip * PUSH_OVER_RAISE_SHARE;
    const shove = inRange(width, topFraction);
    const passive: Weighted = legal.canCheck
      ? { choice: 'check', weight: 1 - shove, intent: 'check' }
      : { choice: 'fold', weight: 1 - shove, intent: 'fold' };
    return {
      options: [{ choice: 'shove', weight: shove, intent: 'shove' }, passive],
      difficulty: difficultyOf(shove),
      sizeFraction: 1,
    };
  }

  if (spot.preflopRaises === 0) {
    let raiseWidth = profile.pfr * position * UNOPENED_WIDTH_SCALE;
    const enterWidth = profile.vpip * position * UNOPENED_WIDTH_SCALE;
    const foldedToMe = spot.limpers === 0;
    if (foldedToMe && STEALING_POSITIONS.has(positionOfSeat(context))) {
      const steal = profile.stealFromLatePosition * STEAL_WIDTH_AT_FULL + adaptation.stealWidth;
      raiseWidth = Math.max(raiseWidth, Math.min(enterWidth, steal) + adaptation.stealWidth);
    }
    let raise = inRange(raiseWidth, topFraction);
    const enter = Math.max(raise, inRange(enterWidth, topFraction));
    const trap = raise * profile.limp * PREMIUM_LIMP_SHARE;
    raise -= trap;
    if (legal.canCheck) {
      return {
        options: [
          { choice: 'raise', weight: raise, intent: 'value' },
          { choice: 'check', weight: 1 - raise, intent: 'check' },
        ],
        difficulty: difficultyOf(raise),
        sizeFraction: 1,
      };
    }
    return {
      options: [
        { choice: 'raise', weight: raise, intent: 'value' },
        { choice: 'call', weight: enter - raise, intent: 'call' },
        { choice: 'fold', weight: 1 - enter, intent: 'fold' },
      ],
      difficulty: difficultyOf(enter),
      sizeFraction: 1,
    };
  }

  if (spot.preflopRaises === 1) {
    const reRaiseWidth = profile.threeBet * position;
    let callWidth = profile.vpip * CALL_RAISE_SHARE * position * adaptation.callWidthScale;
    if (positionOfSeat(context) === 'big_blind') callWidth *= BIG_BLIND_DEFENCE;
    if (context.toCall > BIG_PREFLOP_RAISE_BIG_BLINDS * spot.bigBlind)
      callWidth *= BIG_RAISE_CALL_SCALE;
    const raise = inRange(reRaiseWidth, topFraction);
    const enter = Math.max(raise, inRange(callWidth, topFraction));
    return {
      options: [
        { choice: 'raise', weight: raise, intent: 'value' },
        { choice: 'call', weight: enter - raise, intent: 'call' },
        { choice: 'fold', weight: 1 - enter, intent: 'fold' },
      ],
      difficulty: difficultyOf(enter),
      sizeFraction: 1,
    };
  }

  const continueWidth = spot.raisedPreflopMyself
    ? profile.pfr * (1 - profile.foldToThreeBet)
    : profile.threeBet * COLD_CONTINUE_SHARE;
  const raise = inRange(FOUR_BET_WIDTH * (1 + profile.aggression), topFraction);
  const enter = Math.max(raise, inRange(continueWidth * adaptation.callWidthScale, topFraction));
  return {
    options: [
      { choice: 'raise', weight: raise, intent: 'value' },
      { choice: 'call', weight: enter - raise, intent: 'call' },
      { choice: 'fold', weight: 1 - enter, intent: 'fold' },
    ],
    difficulty: difficultyOf(enter),
    sizeFraction: 1,
  };
}

/** The "raise to" a regular aims for before the flop, before sizing style. */
function preflopRaiseTarget(spot: Spot): number {
  if (spot.preflopRaises === 0) {
    return spot.bigBlind * (PREFLOP_OPEN_BIG_BLINDS + spot.limpers);
  }
  const multiplier =
    spot.preflopRaises === 1 ? PREFLOP_RERAISE_MULTIPLIER : PREFLOP_FOUR_BET_MULTIPLIER;
  return spot.currentPrice * multiplier;
}

// ── Postflop ────────────────────────────────────────────────────────────────

/** Strength from which a hand bets for value. */
const VALUE_AT = 0.62;
/** Strength of a near-lock, which a slowplayer checks or flat-calls. */
const MONSTER_AT = 0.85;
/** A hand just strong enough to bet for value still bets at this share of the regular's aggression. */
const THIN_VALUE_BET_SHARE = 0.5;
const RAISE_VALUE_AT = 0.78;
const BLUFF_BELOW = 0.4;
/**
 * A continuation bet with nothing is a bluff, so it follows the bluff
 * tendency: from this bluff rate up a regular c-bets air as often as anything
 * else, and a regular who never bluffs only c-bets a hand.
 */
const AIR_CBET_BLUFF_REFERENCE = 0.25;
/** "I have something": a pair or better is what a naive player calls with. */
const NAIVE_CALL_BAR = 0.4;
const STRONG_DRAW_OUTS = 8;
const WEAK_DRAW_OUTS = 4;
const WEAK_DRAW_SHARE = 0.4;
/** Each extra opponent cuts bluffing by this share of the heads-up rate. */
const MULTIWAY_BLUFF_CUT = 0.6;
const IN_POSITION_BLUFF_BOOST = 1.25;
const DRAW_CHASE_WEIGHT = 0.3;
const STICKINESS_WEIGHT = 0.3;
const STICKINESS_NEUTRAL = 0.5;
const FOLD_TO_CBET_WEIGHT = 0.3;
const FOLD_TO_CBET_NEUTRAL = 0.4;
/** A bet this big against the pot is a big one; scared money folds anything short of the nuts. */
const BIG_BET_POT_SHARE = 0.8;
const NUTS_AT = 0.9;
const BIG_BET_FEAR_WEIGHT = 0.3;
const SLOWPLAY_FLAT_SHARE = 0.8;
const SEMI_BLUFF_RAISE_SHARE = 0.4;
const BLUFF_RAISE_SHARE = 0.25;
const VALUE_SIZE_FRACTION = 0.66;
const BLUFF_SIZE_FRACTION = 0.5;
const RAISE_SIZE_FRACTION = 0.75;

interface PostflopRead {
  readonly perceived: number;
  readonly equity: number;
  readonly draws: DrawRead;
  readonly naive: number;
}

function readPostflop(
  context: PokerDecisionContext,
  spot: Spot,
  profile: EffectiveProfile,
  options: DecideOptions,
  rng: Rng,
): PostflopRead {
  const percentiles = boardStrengthPercentiles(context.board);
  const ranges = spot.liveOpponents.map((seat) =>
    estimateRange(
      lineOf(context.history, seat.seat),
      options.opponents[seat.seat] ?? TYPICAL_TENDENCIES,
      profile.rangeReading,
      percentiles,
    ),
  );
  const equity = equityVsRanges(
    context.holeCards,
    context.board,
    ranges,
    rng,
    options.equityIterations ?? EQUITY_ITERATIONS,
  );
  // Multiway equity is diluted by the number of opponents; its per-opponent
  // root is on the same 0–1 scale as a heads-up feel for the hand.
  const perOpponent = equity ** (1 / Math.max(1, spot.liveOpponents.length));
  const naive = naiveMadeHandScore(context.holeCards, context.board);
  const sight = (profile.potOddsSkill + profile.boardAwareness) / 2;
  return {
    perceived: sight * perOpponent + (1 - sight) * naive,
    equity,
    draws: readDraws(context.holeCards, context.board),
    naive,
  };
}

function postflopPlan(
  context: PokerDecisionContext,
  spot: Spot,
  profile: EffectiveProfile,
  adaptation: Adaptation,
  read: PostflopRead,
): Plan {
  const strength = read.perceived;
  const strongDraw = read.draws.outs >= STRONG_DRAW_OUTS;
  const anyDraw = read.draws.outs >= WEAK_DRAW_OUTS;
  const opponents = Math.max(1, spot.liveOpponents.length);
  const bluffScale =
    (1 / (1 + (opponents - 1) * MULTIWAY_BLUFF_CUT)) *
    (spot.inPosition ? IN_POSITION_BLUFF_BOOST : 1);
  const semiBluff = strongDraw
    ? profile.semiBluff
    : anyDraw
      ? profile.semiBluff * WEAK_DRAW_SHARE
      : 0;
  const isBluff = strength < BLUFF_BELOW && !strongDraw;
  const aggressiveIntent: DecisionIntent =
    strength >= VALUE_AT ? 'value' : strongDraw ? 'semi_bluff' : isBluff ? 'bluff' : 'value';

  if (context.toCall === 0) {
    const monsterSlowplay = strength >= MONSTER_AT ? 1 - profile.slowplay : 1;
    const value =
      strength >= VALUE_AT
        ? profile.aggression *
          clampUnit((strength - VALUE_AT) / (MONSTER_AT - VALUE_AT) + THIN_VALUE_BET_SHARE) *
          monsterSlowplay
        : 0;
    const cbetSpot =
      context.street === 'flop' &&
      spot.preflopAggressor === context.seat &&
      spot.streetAggressor === null;
    const airCbetScale = isBluff ? clampUnit(profile.bluff / AIR_CBET_BLUFF_REFERENCE) : 1;
    const cbet = cbetSpot ? profile.cbet * bluffScale * airCbetScale : 0;
    const bluff = isBluff ? profile.bluff * bluffScale : 0;
    const bet = anyOf(value, cbet, semiBluff, bluff);
    return {
      options: [
        { choice: 'raise', weight: bet, intent: aggressiveIntent },
        { choice: 'check', weight: 1 - bet, intent: 'check' },
      ],
      difficulty: difficultyOf(bet),
      sizeFraction: aggressiveIntent === 'value' ? VALUE_SIZE_FRACTION : BLUFF_SIZE_FRACTION,
    };
  }

  const potBeforeBet = Math.max(1, context.pot - context.toCall);
  const betShare = context.toCall / potBeforeBet;
  const skill = profile.potOddsSkill;
  const equityMargin = read.equity - spot.potOdds;
  const naiveMargin = read.naive - NAIVE_CALL_BAR;
  const drawBonus =
    (strongDraw ? 1 : anyDraw ? WEAK_DRAW_SHARE : 0) * profile.drawChasing * DRAW_CHASE_WEIGHT;
  const madeSomething = read.naive >= NAIVE_CALL_BAR;
  const stickiness = madeSomething
    ? (profile.stickiness - STICKINESS_NEUTRAL) * STICKINESS_WEIGHT
    : 0;
  const facingCbet =
    context.street === 'flop' &&
    spot.streetAggressor !== null &&
    spot.streetAggressor === spot.preflopAggressor;
  const cbetFold =
    facingCbet && strength < VALUE_AT
      ? (profile.foldToCbet - FOLD_TO_CBET_NEUTRAL) * FOLD_TO_CBET_WEIGHT
      : 0;
  const bigBetFear =
    betShare >= BIG_BET_POT_SHARE && strength < NUTS_AT
      ? profile.stakesFear * BIG_BET_FEAR_WEIGHT
      : 0;
  const score =
    skill * equityMargin +
    (1 - skill) * naiveMargin +
    drawBonus +
    stickiness -
    cbetFold -
    bigBetFear +
    adaptation.continueShift;
  const proceed = logistic(score, CONTINUE_EDGE);

  const valueRaise =
    strength >= RAISE_VALUE_AT
      ? profile.aggression *
        (strength >= MONSTER_AT ? 1 - profile.slowplay * SLOWPLAY_FLAT_SHARE : 1)
      : 0;
  const checkRaise = spot.checkedThisStreet && strength >= VALUE_AT ? profile.checkRaise : 0;
  const semiRaise = semiBluff * profile.aggression * SEMI_BLUFF_RAISE_SHARE;
  const raiseWhenContinuing = anyOf(valueRaise, checkRaise, semiRaise);
  const bluffRaise = isBluff ? profile.bluff * BLUFF_RAISE_SHARE * bluffScale : 0;

  const raise = proceed * raiseWhenContinuing + (1 - proceed) * bluffRaise;
  const call = proceed * (1 - raiseWhenContinuing);
  const fold = (1 - proceed) * (1 - bluffRaise);
  return {
    options: [
      { choice: 'raise', weight: raise, intent: aggressiveIntent },
      { choice: 'call', weight: call, intent: 'call' },
      { choice: 'fold', weight: fold, intent: 'fold' },
    ],
    difficulty: difficultyOf(proceed),
    sizeFraction: RAISE_SIZE_FRACTION,
  };
}

// ── Sampling, sizing, timing, legality ─────────────────────────────────────

/**
 * Decision noise scales each candidate's weight by up to e^(±noise × this), so
 * a tired regular wobbles between close options without ever picking one
 * their style rules out entirely.
 */
const NOISE_LOG_SPREAD = 3;

function sample(plan: Plan, noise: number, rng: Rng): Weighted {
  const wobbled = plan.options.map((option) => ({
    option,
    weight: Math.max(0, option.weight) * Math.exp(noise * NOISE_LOG_SPREAD * (rng() * 2 - 1)),
  }));
  const total = wobbled.reduce((sum, entry) => sum + entry.weight, 0);
  const share = wobbled.length > 0 ? 1 / wobbled.length : 0;
  const mixed = wobbled.map((entry) => ({
    option: entry.option,
    weight: total > 0 ? entry.weight / total : share,
  }));
  let roll = rng();
  for (const entry of mixed) {
    roll -= entry.weight;
    if (roll < 0) return entry.option;
  }
  return listAt(mixed, -1)?.option ?? { choice: 'check', weight: 1, intent: 'check' };
}

const POT_FRACTION = 1;
const OVERBET_FRACTION = 1.5;
const MIN_STYLE_FRACTION = 0.33;
const STANDARD_SPREAD = 0.1;
const ERRATIC_MIN_FRACTION = 0.25;
const ERRATIC_MAX_FRACTION = 1.75;
/** Committing more than this share of the stack with a strong hand just goes all in. */
const COMMIT_STACK_SHARE = 0.6;

function styledFraction(profile: EffectiveProfile, base: number, rng: Rng): number {
  switch (profile.sizing) {
    case 'standard':
      return base + (rng() * 2 - 1) * STANDARD_SPREAD;
    case 'min':
      return MIN_STYLE_FRACTION;
    case 'pot':
      return POT_FRACTION;
    case 'overbet':
      return OVERBET_FRACTION;
    case 'erratic':
      return ERRATIC_MIN_FRACTION + rng() * (ERRATIC_MAX_FRACTION - ERRATIC_MIN_FRACTION);
  }
}

/**
 * The bet or raise total the sizing style aims at, before any bet-size tell and
 * unrounded; never clamped here. Drawn once per decision, so a tell that scales
 * it scales the same bet rather than a freshly sized one.
 */
function aggressionTarget(
  context: PokerDecisionContext,
  spot: Spot,
  profile: EffectiveProfile,
  plan: Plan,
  rng: Rng,
): number {
  let target: number;
  if (context.street === 'preflop') {
    const standard = preflopRaiseTarget(spot);
    const pot = context.pot + context.toCall;
    switch (profile.sizing) {
      case 'min':
        target = spot.currentPrice + context.minRaiseIncrement;
        break;
      case 'pot':
        target = spot.currentPrice + pot;
        break;
      case 'overbet':
        target = spot.currentPrice + pot * OVERBET_FRACTION;
        break;
      case 'erratic':
        target = spot.currentPrice + pot * styledFraction(profile, POT_FRACTION, rng);
        break;
      case 'standard':
        target = standard;
        break;
    }
  } else {
    const fraction = styledFraction(profile, plan.sizeFraction, rng);
    const pot = context.pot + context.toCall;
    target = spot.currentPrice + pot * fraction;
  }
  return target;
}

/** A target scaled by any bet-size tell, rounded to the tier's smallest chip. */
function toChips(context: PokerDecisionContext, target: number, betMultiplier: number): number {
  const unit = smallestChip(context.tier);
  return Math.round((target * betMultiplier) / unit) * unit;
}

function aggressiveAction(legal: LegalActions, total: number, commit: boolean): PokerAction {
  const range = legal.bet ?? legal.raise;
  if (range === null) return legal.allIn !== null ? { kind: 'all_in' } : passiveAction(legal);
  const reachesStack = total >= range.max;
  if ((commit || reachesStack) && legal.allIn !== null) return { kind: 'all_in' };
  const amount = Math.min(range.max, Math.max(range.min, Math.round(total)));
  return legal.bet !== null ? { kind: 'bet', amount } : { kind: 'raise', amount };
}

/** Maps a desired action onto the legal set: the returned action is always legal. */
export function legalize(desired: PokerAction, legal: LegalActions): PokerAction {
  if (isLegal(desired, legal)) return desired;
  switch (desired.kind) {
    case 'fold':
      return legal.canCheck ? { kind: 'check' } : passiveAction(legal);
    case 'check':
      return legal.canFold ? { kind: 'fold' } : passiveAction(legal);
    case 'call':
      return passiveAction(legal);
    case 'bet':
    case 'raise': {
      const range = legal.bet ?? legal.raise;
      if (range !== null) {
        const amount = Math.min(range.max, Math.max(range.min, Math.round(desired.amount)));
        const fixed: PokerAction =
          legal.bet !== null ? { kind: 'bet', amount } : { kind: 'raise', amount };
        if (isLegal(fixed, legal)) return fixed;
      }
      if (legal.allIn !== null && legal.call === null && !legal.canCheck) return { kind: 'all_in' };
      return passiveAction(legal);
    }
    case 'all_in':
      return passiveAction(legal);
  }
}

const MIN_THINK_MS = 250;
const MAX_THINK_MS = 9000;
const HARD_DECISION_EXTRA = 0.8;
const STACK_RISK_EXTRA = 0.6;
/** Throwing away a bad starting hand takes half a look. */
const QUICK_FOLD_SCALE = 0.5;
/** A tilted regular acts fast and hard. */
const TILT_HASTE = 0.4;

function thinkTime(
  profile: EffectiveProfile,
  mood: Mood,
  plan: Plan,
  action: PokerAction,
  context: PokerDecisionContext,
  chipsAtRisk: number,
  thinkMultiplier: number,
  rng: Rng,
): number {
  const jitter = 1 + profile.thinkJitter * (rng() * 2 - 1);
  const risk = clampUnit(chipsAtRisk / Math.max(1, context.seats[context.seat].stack));
  let ms =
    profile.thinkBaseMs *
    jitter *
    (1 + HARD_DECISION_EXTRA * plan.difficulty) *
    (1 + STACK_RISK_EXTRA * risk);
  if (action.kind === 'fold' && context.street === 'preflop') ms *= QUICK_FOLD_SCALE;
  ms *= 1 - mood.tilt * TILT_HASTE;
  ms *= thinkMultiplier;
  return Math.round(Math.min(MAX_THINK_MS, Math.max(MIN_THINK_MS, ms)));
}

function chipsAdded(action: PokerAction, legal: LegalActions, me: SeatView): number {
  switch (action.kind) {
    case 'fold':
    case 'check':
      return 0;
    case 'call':
      return legal.call ?? 0;
    case 'bet':
    case 'raise':
      return action.amount - me.streetBet;
    case 'all_in':
      return me.stack;
  }
}

function holeOf(context: PokerDecisionContext): readonly [Card, Card] | null {
  const first = listAt(context.holeCards, 0);
  const second = listAt(context.holeCards, 1);
  return first !== undefined && second !== undefined ? [first, second] : null;
}

/** The decision for the seat to act. See the module comment for the pipeline. */
export function decide(
  context: PokerDecisionContext,
  profile: EffectiveProfile,
  mood: Mood,
  read: PlayerRead,
  rng: Rng,
  options: DecideOptions,
): NpcDecision {
  const hole = holeOf(context);
  if (hole === null) {
    return {
      action: passiveAction(context.legal),
      thinkMs: profile.thinkBaseMs,
      cues: [],
      tellFirings: [],
      tellChances: [],
      intent: 'check',
      perceivedStrength: 0,
      handStrength: 0,
    };
  }
  const spot = gather(context);
  const adaptation = adapt(context, spot, profile, playerImage(read));

  const preflop = context.street === 'preflop';
  let plan: Plan;
  let perceived: number;
  let handStrength: number;
  let draws: DrawRead | null = null;
  if (preflop) {
    plan = preflopPlan(
      context,
      spot,
      profile,
      options.archetype,
      adaptation,
      preflopTopFraction(hole[0], hole[1]),
    );
    handStrength = preflopStrength(hole[0], hole[1]);
    perceived = handStrength;
  } else {
    const postflop = readPostflop(context, spot, profile, options, rng);
    plan = postflopPlan(context, spot, profile, adaptation, postflop);
    perceived = postflop.perceived;
    handStrength = handStrengthNow(context.holeCards, context.board);
    draws = postflop.draws;
  }

  const chosen = sample(plan, profile.decisionNoise, rng);
  const tellState: TellHandState = {
    madeStrength: handStrength,
    hasDraw: (draws?.outs ?? 0) >= STRONG_DRAW_OUTS,
    drawsPossible: draws !== null && context.street !== 'river',
    bluffing: chosen.intent === 'bluff',
    flopFlushPossible: false,
    holeCardsOfFlushSuit: 0,
  };
  const rates = options.tellConditionRates ?? [];
  const acting = evaluateTells(options.tells, 'acting', tellState, rng, rates);
  let thinkMultiplier = 1;
  for (const firing of acting.firings) {
    if (firing.cue.kind === 'think_time') thinkMultiplier *= firing.cue.thinkMultiplier;
  }

  const raiseTarget =
    chosen.choice === 'raise' ? aggressionTarget(context, spot, profile, plan, rng) : 0;
  const desiredAction = (betMultiplier: number): PokerAction => {
    switch (chosen.choice) {
      case 'fold':
        return { kind: 'fold' };
      case 'check':
        return { kind: 'check' };
      case 'call':
        return context.legal.call !== null ? { kind: 'call' } : passiveAction(context.legal);
      case 'shove':
        return { kind: 'all_in' };
      case 'raise': {
        const total = toChips(context, raiseTarget, betMultiplier);
        const committed = total - spot.me.streetBet >= spot.me.stack * COMMIT_STACK_SHARE;
        return aggressiveAction(context.legal, total, committed && perceived >= VALUE_AT);
      }
    }
  };
  // A bet tell only has a chance when the chips really go in as a bet or raise:
  // rolled before the action is made legal, a raise clamped into a call would
  // count as a chance the tell had, skewing its measured reliability.
  const raises = (candidate: PokerAction): boolean =>
    candidate.kind !== 'fold' &&
    candidate.kind !== 'check' &&
    candidate.kind !== 'call' &&
    chipsAdded(candidate, context.legal, spot.me) > context.legal.toCall;
  let action = legalize(desiredAction(1), context.legal);
  const betting = raises(action)
    ? evaluateTells(options.tells, 'betting', tellState, rng, rates)
    : { firings: [], chances: [] };
  let betMultiplier = 1;
  for (const firing of betting.firings) {
    if (firing.cue.kind === 'bet_size') betMultiplier *= firing.cue.betMultiplier;
  }
  if (betMultiplier !== 1 && chosen.choice === 'raise') {
    const resized = legalize(desiredAction(betMultiplier), context.legal);
    if (raises(resized)) action = resized;
  }
  const firings = [...acting.firings, ...betting.firings];
  const thinkMs = thinkTime(
    profile,
    mood,
    plan,
    action,
    context,
    chipsAdded(action, context.legal, spot.me),
    thinkMultiplier,
    rng,
  );
  return {
    action,
    thinkMs,
    cues: firings.map((firing) => firing.cue),
    tellFirings: firings,
    tellChances: [...acting.chances, ...betting.chances],
    intent: chosen.intent,
    perceivedStrength: perceived,
    handStrength,
  };
}
