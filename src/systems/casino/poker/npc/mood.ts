/**
 * A seated regular's mood for this session: tilt, streaks and fatigue. Mood
 * adjusts the profile a decision reads through `effectiveProfile`; it never
 * changes the rolled personality, and it is forgotten when the regular stands up.
 */

import { POKER_TIER_IDS, type PokerTierId } from '../pokerStakes';
import { type Archetype, type PokerProfile, clampUnit } from './profiles';
import type { RegularId } from './regularIds';

/** Who a tilted regular is gunning for: a seat, and who sat in it when they got stung. */
export interface TiltTarget {
  readonly seat: number;
  readonly occupant: 'player' | RegularId;
}

export interface Mood {
  /** 0 calm to 1 fully on tilt. */
  readonly tilt: number;
  /** Consecutive hands won. */
  readonly heater: number;
  /** Consecutive hands folded before the flop. */
  readonly cardDead: number;
  readonly handsThisSession: number;
  readonly target: TiltTarget | null;
}

export const CALM_MOOD: Mood = {
  tilt: 0,
  heater: 0,
  cardDead: 0,
  handsThisSession: 0,
  target: null,
};

/** What happened to one regular in one finished hand. */
export interface HandOutcome {
  /** Chips won minus chips put in, in big blinds. */
  readonly netBigBlinds: number;
  readonly wonPot: boolean;
  readonly voluntarilyPlayed: boolean;
  /**
   * Their equity at the moment the last of their money went in, when they lost
   * an all-in or a showdown; null otherwise.
   */
  readonly lostWithEquity: number | null;
  /** They folded and the winner then showed a bluff. */
  readonly shownBluff: boolean;
  /** The seat that took the pot from them, if anyone did. */
  readonly beatenBy: TiltTarget | null;
}

/** Losing with this much equity when the money went in counts as a bad beat. */
export const BAD_BEAT_EQUITY = 0.7;
export const BIG_LOSS_BIG_BLINDS = 25;
const BAD_BEAT_TILT = 0.5;
const BIG_LOSS_TILT = 0.3;
const SHOWN_BLUFF_TILT = 0.35;
/** A fully recovering regular sheds this share of their tilt each calm hand. */
const TILT_DECAY_AT_FULL_RECOVERY = 0.35;
/** Below this the regular has cooled off and stops hunting whoever stung them. */
const TILT_TARGET_FORGOTTEN_BELOW = 0.15;

export function moodAfterHand(mood: Mood, outcome: HandOutcome, profile: PokerProfile): Mood {
  const badBeat = outcome.lostWithEquity !== null && outcome.lostWithEquity >= BAD_BEAT_EQUITY;
  const bigLoss = outcome.netBigBlinds <= -BIG_LOSS_BIG_BLINDS;
  let tiltGain = 0;
  if (badBeat) tiltGain += BAD_BEAT_TILT;
  if (bigLoss) tiltGain += BIG_LOSS_TILT;
  if (outcome.shownBluff) tiltGain += SHOWN_BLUFF_TILT;

  const stung = tiltGain > 0;
  const decayed = mood.tilt * (1 - profile.tiltRecovery * TILT_DECAY_AT_FULL_RECOVERY);
  const tilt = clampUnit(stung ? mood.tilt + tiltGain * profile.tiltProne : decayed);

  const stingTarget = stung ? outcome.beatenBy : null;
  const target = stingTarget ?? (tilt < TILT_TARGET_FORGOTTEN_BELOW ? null : mood.target);

  const lostPlayedHand = outcome.voluntarilyPlayed && !outcome.wonPot;
  return {
    tilt,
    heater: outcome.wonPot ? mood.heater + 1 : lostPlayedHand ? 0 : mood.heater,
    cardDead: outcome.voluntarilyPlayed ? 0 : mood.cardDead + 1,
    handsThisSession: mood.handsThisSession + 1,
    target,
  };
}

/** Tilt at which a regular's banter and plate visibly change. */
export const TILTED_AT = 0.5;

export function isTilted(mood: Mood): boolean {
  return mood.tilt >= TILTED_AT;
}

/** The table situation `effectiveProfile` adjusts for. */
export interface MoodContext {
  readonly archetype: Archetype;
  readonly stackBigBlinds: number;
  readonly tier: PokerTierId;
  /** Net chips this session, in big blinds. */
  readonly sessionNetBigBlinds: number;
  /** The regular is facing the seat they are tilted against. */
  readonly facingTarget: boolean;
}

/**
 * A profile with mood applied, plus the two switches a decision needs that a
 * stored profile never carries.
 */
export type EffectiveProfile = PokerProfile & {
  /** Short-stacked: shove or fold before the flop, nothing in between. */
  readonly pushFold: boolean;
  /** Extra randomness mixed into each choice, in [0, 1]. */
  readonly decisionNoise: number;
};

const TILT_VPIP_GAIN = 0.25;
const TILT_AGGRESSION_GAIN = 0.3;
const TILT_BLUFF_GAIN = 0.3;
const TILT_POT_ODDS_LOSS = 0.4;
const TILT_FOLD_TO_CBET_LOSS = 0.3;
/** A tilted regular widens again, on top of tilt, against whoever stung them. */
const TILT_TARGET_VPIP_GAIN = 0.15;
const TILT_TARGET_AGGRESSION_GAIN = 0.15;
/** Tilt beyond which bet sizing stops following the regular's usual style. */
const TILT_ERRATIC_SIZING_AT = 0.6;

export const PUSH_FOLD_BELOW_BIG_BLINDS = 15;
const DEEP_STACK_BIG_BLINDS = 80;
const WINNING_SESSION_BIG_BLINDS = 20;
/** A loose player sitting deep on a win plays "with the house's money". */
const LOOSE_PLAYER_VPIP_AT = 0.3;
const HOUSE_MONEY_VPIP_GAIN = 0.08;
const HOUSE_MONEY_BLUFF_GAIN = 0.05;
/** A rock sitting deep on a win tightens to protect it. */
const ROCK_PROTECT_WIN_VPIP_SCALE = 0.8;

export const HEATER_HANDS = 3;
const HEATER_AGGRESSION_GAIN = 0.12;
export const CARD_DEAD_HANDS = 8;
const CARD_DEAD_VPIP_GAIN = 0.12;
const IMPATIENT_ARCHETYPES: ReadonlySet<Archetype> = new Set(['recreational', 'maniac']);

export const FATIGUE_ONSET_HANDS = 40;
const FATIGUE_NOISE_PER_HAND = 0.004;
const FATIGUE_NOISE_MAX = 0.15;
const FATIGUE_POT_ODDS_LOSS = 0.08;
const BASE_DECISION_NOISE = 0.05;

/** At the top tier, a regular with full `stakesFear` cuts their looseness by this share. */
const STAKES_FEAR_VPIP_CUT = 0.4;
const STAKES_FEAR_AGGRESSION_CUT = 0.4;
const STAKES_FEAR_BLUFF_CUT = 0.6;

function tierPressure(tier: PokerTierId): number {
  const highest = POKER_TIER_IDS.length - 1;
  return POKER_TIER_IDS.indexOf(tier) / highest;
}

export function effectiveProfile(
  profile: PokerProfile,
  mood: Mood,
  context: MoodContext,
): EffectiveProfile {
  let vpip = profile.vpip;
  let aggression = profile.aggression;
  let bluff = profile.bluff;
  let potOddsSkill = profile.potOddsSkill;
  let foldToCbet = profile.foldToCbet;
  let sizing = profile.sizing;

  const tilt = mood.tilt;
  vpip += tilt * TILT_VPIP_GAIN;
  aggression += tilt * TILT_AGGRESSION_GAIN;
  bluff += tilt * TILT_BLUFF_GAIN;
  potOddsSkill -= tilt * TILT_POT_ODDS_LOSS;
  foldToCbet -= tilt * TILT_FOLD_TO_CBET_LOSS;
  if (tilt >= TILT_ERRATIC_SIZING_AT) sizing = 'erratic';
  if (context.facingTarget) {
    vpip += tilt * TILT_TARGET_VPIP_GAIN;
    aggression += tilt * TILT_TARGET_AGGRESSION_GAIN;
  }

  const deepAndWinning =
    context.stackBigBlinds >= DEEP_STACK_BIG_BLINDS &&
    context.sessionNetBigBlinds >= WINNING_SESSION_BIG_BLINDS;
  if (deepAndWinning && context.archetype === 'rock') {
    vpip *= ROCK_PROTECT_WIN_VPIP_SCALE;
  } else if (deepAndWinning && profile.vpip >= LOOSE_PLAYER_VPIP_AT) {
    vpip += HOUSE_MONEY_VPIP_GAIN;
    bluff += HOUSE_MONEY_BLUFF_GAIN;
  }

  if (mood.heater >= HEATER_HANDS) aggression += HEATER_AGGRESSION_GAIN;
  if (mood.cardDead >= CARD_DEAD_HANDS && IMPATIENT_ARCHETYPES.has(context.archetype)) {
    vpip += CARD_DEAD_VPIP_GAIN;
  }

  const handsPastFatigue = Math.max(0, mood.handsThisSession - FATIGUE_ONSET_HANDS);
  const fatigueNoise = Math.min(FATIGUE_NOISE_MAX, handsPastFatigue * FATIGUE_NOISE_PER_HAND);
  if (handsPastFatigue > 0) potOddsSkill -= FATIGUE_POT_ODDS_LOSS;

  const fear = profile.stakesFear * tierPressure(context.tier);
  vpip *= 1 - fear * STAKES_FEAR_VPIP_CUT;
  aggression *= 1 - fear * STAKES_FEAR_AGGRESSION_CUT;
  bluff *= 1 - fear * STAKES_FEAR_BLUFF_CUT;

  const finalVpip = clampUnit(vpip);
  return {
    ...profile,
    vpip: finalVpip,
    pfr: Math.min(profile.pfr, finalVpip),
    aggression: clampUnit(aggression),
    bluff: clampUnit(bluff),
    potOddsSkill: clampUnit(potOddsSkill),
    foldToCbet: clampUnit(foldToCbet),
    sizing,
    pushFold: context.stackBigBlinds < PUSH_FOLD_BELOW_BIG_BLINDS,
    decisionNoise: clampUnit(BASE_DECISION_NOISE + fatigueNoise),
  };
}
