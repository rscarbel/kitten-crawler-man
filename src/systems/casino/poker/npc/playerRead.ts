/**
 * What one seat has observed about another's play: how often they enter pots,
 * raise, bet versus call, reach showdown, and get caught bluffing.
 *
 * Counts are recency-weighted: every new hand first shrinks the old counts, so
 * a read reflects the last few dozen hands rather than the whole history, and
 * a player can change their image. Every rate is shrunk toward the population
 * average by a fixed prior, so a handful of hands never reads as a strong image.
 *
 * A read is plain JSON (numbers only) because the regulars' reads of the
 * player are saved with the run.
 */

export interface PlayerRead {
  /** Hands dealt with both seats at the table, never decayed. */
  readonly handsSeen: number;
  readonly hands: number;
  readonly vpipHands: number;
  readonly pfrHands: number;
  readonly aggressiveActions: number;
  readonly passiveActions: number;
  readonly sawFlop: number;
  readonly wentToShowdown: number;
  readonly showdownsShown: number;
  readonly bluffsShown: number;
}

export const EMPTY_PLAYER_READ: PlayerRead = {
  handsSeen: 0,
  hands: 0,
  vpipHands: 0,
  pfrHands: 0,
  aggressiveActions: 0,
  passiveActions: 0,
  sawFlop: 0,
  wentToShowdown: 0,
  showdownsShown: 0,
  bluffsShown: 0,
};

/** One hand of the observed seat, as the observer saw it. */
export interface HandObservation {
  readonly voluntarilyPutMoneyIn: boolean;
  readonly raisedPreflop: boolean;
  /** Bets and raises across every street. */
  readonly aggressiveActions: number;
  readonly calls: number;
  readonly sawFlop: boolean;
  readonly wentToShowdown: boolean;
  /** They turned their cards face up at showdown. */
  readonly showedCards: boolean;
  /** They showed a hand that was betting with little or nothing. */
  readonly showedBluff: boolean;
}

/** Each hand keeps this share of the weight of everything seen before it. */
const PER_HAND_RETENTION = 0.98;
/** A visit away from the table fades the read further, the way memory does. */
const PER_VISIT_RETENTION = 0.7;

export function observeHand(read: PlayerRead, hand: HandObservation): PlayerRead {
  const keep = (count: number): number => count * PER_HAND_RETENTION;
  return {
    handsSeen: read.handsSeen + 1,
    hands: keep(read.hands) + 1,
    vpipHands: keep(read.vpipHands) + (hand.voluntarilyPutMoneyIn ? 1 : 0),
    pfrHands: keep(read.pfrHands) + (hand.raisedPreflop ? 1 : 0),
    aggressiveActions: keep(read.aggressiveActions) + hand.aggressiveActions,
    passiveActions: keep(read.passiveActions) + hand.calls,
    sawFlop: keep(read.sawFlop) + (hand.sawFlop ? 1 : 0),
    wentToShowdown: keep(read.wentToShowdown) + (hand.wentToShowdown ? 1 : 0),
    showdownsShown: keep(read.showdownsShown) + (hand.showedCards ? 1 : 0),
    bluffsShown: keep(read.bluffsShown) + (hand.showedBluff ? 1 : 0),
  };
}

/** Fades a read between visits; the raw hands-seen count is kept. */
export function fadeReadBetweenVisits(read: PlayerRead): PlayerRead {
  const fade = (count: number): number => count * PER_VISIT_RETENTION;
  return {
    handsSeen: read.handsSeen,
    hands: fade(read.hands),
    vpipHands: fade(read.vpipHands),
    pfrHands: fade(read.pfrHands),
    aggressiveActions: fade(read.aggressiveActions),
    passiveActions: fade(read.passiveActions),
    sawFlop: fade(read.sawFlop),
    wentToShowdown: fade(read.wentToShowdown),
    showdownsShown: fade(read.showdownsShown),
    bluffsShown: fade(read.bluffsShown),
  };
}

/** A typical six-handed table's averages, which an unseen player is assumed to match. */
export const POPULATION_VPIP = 0.28;
export const POPULATION_PFR = 0.14;
export const POPULATION_AGGRESSION_FACTOR = 1.5;
export const POPULATION_WTSD = 0.28;
export const POPULATION_BLUFF_SHARE = 0.15;
/** How many hands' worth of the population average every rate starts with. */
const PRIOR_HANDS = 12;
const PRIOR_ACTIONS = 10;
const PRIOR_SHOWDOWNS = 4;

function shrunk(count: number, sample: number, average: number, prior: number): number {
  return (count + average * prior) / (sample + prior);
}

export function observedVpip(read: PlayerRead): number {
  return shrunk(read.vpipHands, read.hands, POPULATION_VPIP, PRIOR_HANDS);
}

export function observedPfr(read: PlayerRead): number {
  return shrunk(read.pfrHands, read.hands, POPULATION_PFR, PRIOR_HANDS);
}

/** Bets and raises per call. */
export function observedAggressionFactor(read: PlayerRead): number {
  const priorPassive = PRIOR_ACTIONS / (1 + POPULATION_AGGRESSION_FACTOR);
  const priorAggressive = PRIOR_ACTIONS - priorPassive;
  return (read.aggressiveActions + priorAggressive) / (read.passiveActions + priorPassive);
}

/** Share of flops seen that went on to showdown. */
export function observedWentToShowdown(read: PlayerRead): number {
  return shrunk(read.wentToShowdown, read.sawFlop, POPULATION_WTSD, PRIOR_HANDS);
}

/** Share of shown hands that were bluffs. */
export function observedBluffShare(read: PlayerRead): number {
  return shrunk(read.bluffsShown, read.showdownsShown, POPULATION_BLUFF_SHARE, PRIOR_SHOWDOWNS);
}

/** 0 with no recent hands, approaching 1 as the recency-weighted sample fills up. */
export function readConfidence(read: PlayerRead): number {
  return read.hands / (read.hands + PRIOR_HANDS);
}

export type RaiseTendency = 'often' | 'sometimes' | 'rarely';

/** Of the pots a player enters, raising this share or more reads as raising often. */
const RAISES_OFTEN_SHARE = 0.6;
const RAISES_RARELY_SHARE = 0.25;

/** The figures the seat-info popover shows; never the hidden archetype. */
export interface ReadSummary {
  readonly handsSeen: number;
  /** Whole percent of hands played. */
  readonly playsPercent: number;
  readonly raises: RaiseTendency;
  /** Bluffs seen at showdown, rounded from the recency-weighted count. */
  readonly bluffsSeen: number;
}

const PERCENT = 100;

export function summarizeRead(read: PlayerRead): ReadSummary {
  const vpip = observedVpip(read);
  const raiseShare = vpip > 0 ? observedPfr(read) / vpip : 0;
  const raises: RaiseTendency =
    raiseShare >= RAISES_OFTEN_SHARE
      ? 'often'
      : raiseShare <= RAISES_RARELY_SHARE
        ? 'rarely'
        : 'sometimes';
  return {
    handsSeen: read.handsSeen,
    playsPercent: Math.round(vpip * PERCENT),
    raises,
    bluffsSeen: Math.round(read.bluffsShown),
  };
}

/** How a regular sizes up the player, for adaptation. Each is a lean in [-1, 1]. */
export interface PlayerImage {
  /** Positive: plays more hands than average; negative: tighter. */
  readonly looseness: number;
  /** Positive: bluffs more often than average. */
  readonly bluffiness: number;
  /** Positive: raises only with strong hands (enters often, raises seldom). */
  readonly valueHeavy: number;
}

function lean(observed: number, average: number): number {
  return Math.max(-1, Math.min(1, (observed - average) / average));
}

/** The player's image scaled by how much the regular has actually seen. */
export function playerImage(read: PlayerRead): PlayerImage {
  const confidence = readConfidence(read);
  const vpip = observedVpip(read);
  const pfrShare = vpip > 0 ? observedPfr(read) / vpip : 0;
  const populationPfrShare = POPULATION_PFR / POPULATION_VPIP;
  return {
    looseness: lean(vpip, POPULATION_VPIP) * confidence,
    bluffiness: lean(observedBluffShare(read), POPULATION_BLUFF_SHARE) * confidence,
    valueHeavy: -lean(pfrShare, populationPfrShare) * confidence,
  };
}
