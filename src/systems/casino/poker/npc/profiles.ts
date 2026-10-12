/**
 * How a Texas Hold'em regular plays, as numbers, and the ten archetype presets
 * those numbers are drawn from.
 *
 * A preset is a band per parameter rather than one value: two regulars who roll
 * the same archetype in a run still play noticeably differently, while both
 * keep the archetype's signature (a rock still enters about one pot in eight).
 */

export const ARCHETYPES = [
  'rock',
  'tag_reg',
  'lag',
  'calling_station',
  'maniac',
  'recreational',
  'short_stacker',
  'trapper',
  'scared_money',
  'old_timer',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const SIZING_STYLES = ['standard', 'min', 'pot', 'overbet', 'erratic'] as const;
export type SizingStyle = (typeof SIZING_STYLES)[number];

/**
 * A regular's voice at the table. Rolled independently of archetype, so how a
 * regular talks never gives away how they play.
 */
export const BANTER_SET_IDS = [
  'grumbler',
  'charmer',
  'braggart',
  'fretter',
  'deadpan',
  'philosopher',
] as const;
export type BanterSetId = (typeof BANTER_SET_IDS)[number];

/** Every profile parameter that is a probability or tendency in [0, 1]. */
export const UNIT_PARAMETERS = [
  'vpip',
  'pfr',
  'limp',
  'threeBet',
  'foldToThreeBet',
  'stealFromLatePosition',
  'positionAwareness',
  'cbet',
  'foldToCbet',
  'aggression',
  'bluff',
  'semiBluff',
  'checkRaise',
  'slowplay',
  'stickiness',
  'drawChasing',
  'potOddsSkill',
  'boardAwareness',
  'rangeReading',
  'thinkJitter',
  'showsLosers',
  'showsBluffs',
  'tiltProne',
  'tiltRecovery',
  'hitAndRun',
  'rebuyWillingness',
  'stakesFear',
  'chattiness',
  'needle',
] as const;
export type UnitParameter = (typeof UNIT_PARAMETERS)[number];

/** An inclusive numeric range a parameter is drawn from. */
export interface Band {
  readonly min: number;
  readonly max: number;
}

/**
 * One regular's play style for a run.
 *
 * Unit fields, all in [0, 1]:
 * - `vpip` is the share of all hands they voluntarily put money in before the flop.
 * - `pfr` is the share of all hands they raise before the flop, so it never exceeds `vpip`.
 * - `limp` is how often an entered, unraised pot is called rather than raised.
 * - `aggression` is bet/raise versus check/call holding the same hand.
 * - `potOddsSkill` 0 judges by "do I have something"; 1 compares equity to pot odds properly.
 * - `thinkJitter` is the spread of think time as a fraction of `thinkBaseMs`.
 * - `stakesFear` plays tighter and more passively the higher the tier.
 */
export type PokerProfile = Readonly<Record<UnitParameter, number>> & {
  readonly sizing: SizingStyle;
  readonly thinkBaseMs: number;
  /** The stack, in big blinds, this regular sits down or rebuys with. */
  readonly buyInBigBlinds: Band;
  readonly banterSet: BanterSetId;
};

/** Relative weights; a style absent from the map is never rolled for that archetype. */
export type SizingWeights = Partial<Record<SizingStyle, number>>;

export interface ArchetypePreset {
  readonly bands: Readonly<Record<UnitParameter, Band>>;
  readonly thinkBaseMs: Band;
  /** The outer bounds a rolled buy-in range must sit inside. */
  readonly buyInBigBlinds: Band;
  readonly sizing: SizingWeights;
}

/** Which tell budget an archetype gets: fish leak a lot, strong regulars barely at all. */
export type ArchetypeGroup = 'fish' | 'regular' | 'middle';

export const ARCHETYPE_GROUP: Readonly<Record<Archetype, ArchetypeGroup>> = {
  rock: 'middle',
  tag_reg: 'regular',
  lag: 'regular',
  calling_station: 'fish',
  maniac: 'middle',
  recreational: 'fish',
  short_stacker: 'middle',
  trapper: 'regular',
  scared_money: 'middle',
  old_timer: 'fish',
};

/**
 * How often each archetype turns up at a real low-to-mid stakes table. Only the
 * four extra seats of a run's roster are drawn with these; every archetype is
 * already present once.
 */
export const EXTRA_ARCHETYPE_WEIGHTS: Readonly<Record<Archetype, number>> = {
  rock: 4,
  tag_reg: 4,
  lag: 2,
  calling_station: 5,
  maniac: 1,
  recreational: 5,
  short_stacker: 1.5,
  trapper: 1,
  scared_money: 2,
  old_timer: 2,
};

export const ARCHETYPE_PRESETS: Readonly<Record<Archetype, ArchetypePreset>> = {
  rock: {
    bands: {
      vpip: { min: 0.1, max: 0.14 },
      pfr: { min: 0.07, max: 0.1 },
      limp: { min: 0.05, max: 0.15 },
      threeBet: { min: 0.02, max: 0.04 },
      foldToThreeBet: { min: 0.7, max: 0.85 },
      stealFromLatePosition: { min: 0.08, max: 0.18 },
      positionAwareness: { min: 0.25, max: 0.45 },
      cbet: { min: 0.5, max: 0.65 },
      foldToCbet: { min: 0.55, max: 0.7 },
      aggression: { min: 0.35, max: 0.5 },
      bluff: { min: 0, max: 0.02 },
      semiBluff: { min: 0.05, max: 0.15 },
      checkRaise: { min: 0.03, max: 0.08 },
      slowplay: { min: 0.1, max: 0.2 },
      stickiness: { min: 0.15, max: 0.3 },
      drawChasing: { min: 0.05, max: 0.15 },
      potOddsSkill: { min: 0.5, max: 0.7 },
      boardAwareness: { min: 0.6, max: 0.8 },
      rangeReading: { min: 0.3, max: 0.5 },
      thinkJitter: { min: 0.15, max: 0.3 },
      showsLosers: { min: 0.05, max: 0.15 },
      showsBluffs: { min: 0, max: 0.05 },
      tiltProne: { min: 0.05, max: 0.2 },
      tiltRecovery: { min: 0.6, max: 0.85 },
      hitAndRun: { min: 0.4, max: 0.6 },
      rebuyWillingness: { min: 0.5, max: 0.7 },
      stakesFear: { min: 0.2, max: 0.4 },
      chattiness: { min: 0.1, max: 0.3 },
      needle: { min: 0, max: 0.1 },
    },
    thinkBaseMs: { min: 1400, max: 2000 },
    buyInBigBlinds: { min: 40, max: 60 },
    sizing: { standard: 4, min: 2, pot: 1 },
  },
  tag_reg: {
    bands: {
      vpip: { min: 0.2, max: 0.25 },
      pfr: { min: 0.16, max: 0.2 },
      limp: { min: 0, max: 0.05 },
      threeBet: { min: 0.06, max: 0.09 },
      foldToThreeBet: { min: 0.45, max: 0.6 },
      stealFromLatePosition: { min: 0.35, max: 0.5 },
      positionAwareness: { min: 0.75, max: 0.95 },
      cbet: { min: 0.6, max: 0.75 },
      foldToCbet: { min: 0.4, max: 0.5 },
      aggression: { min: 0.6, max: 0.75 },
      bluff: { min: 0.12, max: 0.22 },
      semiBluff: { min: 0.45, max: 0.6 },
      checkRaise: { min: 0.08, max: 0.15 },
      slowplay: { min: 0.1, max: 0.2 },
      stickiness: { min: 0.35, max: 0.5 },
      drawChasing: { min: 0.1, max: 0.2 },
      potOddsSkill: { min: 0.8, max: 0.95 },
      boardAwareness: { min: 0.8, max: 0.95 },
      rangeReading: { min: 0.7, max: 0.9 },
      thinkJitter: { min: 0.2, max: 0.35 },
      showsLosers: { min: 0, max: 0.08 },
      showsBluffs: { min: 0.02, max: 0.1 },
      tiltProne: { min: 0.1, max: 0.3 },
      tiltRecovery: { min: 0.6, max: 0.85 },
      hitAndRun: { min: 0.05, max: 0.2 },
      rebuyWillingness: { min: 0.7, max: 0.9 },
      stakesFear: { min: 0, max: 0.15 },
      chattiness: { min: 0.15, max: 0.35 },
      needle: { min: 0.05, max: 0.25 },
    },
    thinkBaseMs: { min: 1100, max: 1600 },
    buyInBigBlinds: { min: 50, max: 80 },
    sizing: { standard: 6, pot: 1, overbet: 1 },
  },
  lag: {
    bands: {
      vpip: { min: 0.29, max: 0.35 },
      pfr: { min: 0.23, max: 0.28 },
      limp: { min: 0, max: 0.05 },
      threeBet: { min: 0.1, max: 0.15 },
      foldToThreeBet: { min: 0.3, max: 0.45 },
      stealFromLatePosition: { min: 0.55, max: 0.7 },
      positionAwareness: { min: 0.7, max: 0.9 },
      cbet: { min: 0.7, max: 0.85 },
      foldToCbet: { min: 0.3, max: 0.42 },
      aggression: { min: 0.72, max: 0.85 },
      bluff: { min: 0.25, max: 0.38 },
      semiBluff: { min: 0.6, max: 0.75 },
      checkRaise: { min: 0.12, max: 0.2 },
      slowplay: { min: 0.08, max: 0.15 },
      stickiness: { min: 0.35, max: 0.5 },
      drawChasing: { min: 0.2, max: 0.3 },
      potOddsSkill: { min: 0.7, max: 0.88 },
      boardAwareness: { min: 0.75, max: 0.9 },
      rangeReading: { min: 0.6, max: 0.85 },
      thinkJitter: { min: 0.2, max: 0.4 },
      showsLosers: { min: 0.05, max: 0.15 },
      showsBluffs: { min: 0.15, max: 0.35 },
      tiltProne: { min: 0.2, max: 0.45 },
      tiltRecovery: { min: 0.45, max: 0.7 },
      hitAndRun: { min: 0.05, max: 0.15 },
      rebuyWillingness: { min: 0.75, max: 0.95 },
      stakesFear: { min: 0, max: 0.1 },
      chattiness: { min: 0.3, max: 0.55 },
      needle: { min: 0.25, max: 0.5 },
    },
    thinkBaseMs: { min: 900, max: 1400 },
    buyInBigBlinds: { min: 50, max: 90 },
    sizing: { standard: 3, pot: 3, overbet: 2 },
  },
  calling_station: {
    bands: {
      vpip: { min: 0.45, max: 0.55 },
      pfr: { min: 0.03, max: 0.07 },
      limp: { min: 0.75, max: 0.9 },
      threeBet: { min: 0, max: 0.02 },
      foldToThreeBet: { min: 0.15, max: 0.3 },
      stealFromLatePosition: { min: 0.05, max: 0.12 },
      positionAwareness: { min: 0, max: 0.15 },
      cbet: { min: 0.2, max: 0.35 },
      foldToCbet: { min: 0.1, max: 0.22 },
      aggression: { min: 0.08, max: 0.18 },
      bluff: { min: 0.02, max: 0.06 },
      semiBluff: { min: 0.05, max: 0.12 },
      checkRaise: { min: 0.02, max: 0.05 },
      slowplay: { min: 0.25, max: 0.4 },
      stickiness: { min: 0.85, max: 0.97 },
      drawChasing: { min: 0.8, max: 0.95 },
      potOddsSkill: { min: 0.05, max: 0.2 },
      boardAwareness: { min: 0.1, max: 0.3 },
      rangeReading: { min: 0.05, max: 0.2 },
      thinkJitter: { min: 0.3, max: 0.5 },
      showsLosers: { min: 0.4, max: 0.7 },
      showsBluffs: { min: 0.3, max: 0.6 },
      tiltProne: { min: 0.25, max: 0.5 },
      tiltRecovery: { min: 0.4, max: 0.65 },
      hitAndRun: { min: 0.15, max: 0.3 },
      rebuyWillingness: { min: 0.75, max: 0.95 },
      stakesFear: { min: 0.1, max: 0.3 },
      chattiness: { min: 0.4, max: 0.7 },
      needle: { min: 0.05, max: 0.2 },
    },
    thinkBaseMs: { min: 1300, max: 2000 },
    buyInBigBlinds: { min: 35, max: 60 },
    sizing: { min: 4, standard: 2, erratic: 1 },
  },
  maniac: {
    bands: {
      vpip: { min: 0.55, max: 0.66 },
      pfr: { min: 0.4, max: 0.5 },
      limp: { min: 0, max: 0.08 },
      threeBet: { min: 0.18, max: 0.28 },
      foldToThreeBet: { min: 0.1, max: 0.25 },
      stealFromLatePosition: { min: 0.7, max: 0.9 },
      positionAwareness: { min: 0.1, max: 0.3 },
      cbet: { min: 0.85, max: 0.97 },
      foldToCbet: { min: 0.2, max: 0.35 },
      aggression: { min: 0.85, max: 0.97 },
      bluff: { min: 0.45, max: 0.65 },
      semiBluff: { min: 0.75, max: 0.9 },
      checkRaise: { min: 0.15, max: 0.3 },
      slowplay: { min: 0, max: 0.08 },
      stickiness: { min: 0.45, max: 0.65 },
      drawChasing: { min: 0.5, max: 0.7 },
      potOddsSkill: { min: 0.2, max: 0.4 },
      boardAwareness: { min: 0.3, max: 0.5 },
      rangeReading: { min: 0.15, max: 0.35 },
      thinkJitter: { min: 0.3, max: 0.6 },
      showsLosers: { min: 0.3, max: 0.6 },
      showsBluffs: { min: 0.5, max: 0.85 },
      tiltProne: { min: 0.5, max: 0.8 },
      tiltRecovery: { min: 0.25, max: 0.45 },
      hitAndRun: { min: 0, max: 0.1 },
      rebuyWillingness: { min: 0.85, max: 1 },
      stakesFear: { min: 0, max: 0.08 },
      chattiness: { min: 0.55, max: 0.85 },
      needle: { min: 0.5, max: 0.85 },
    },
    thinkBaseMs: { min: 600, max: 1000 },
    buyInBigBlinds: { min: 60, max: 130 },
    sizing: { overbet: 4, pot: 3, erratic: 3 },
  },
  recreational: {
    bands: {
      vpip: { min: 0.4, max: 0.52 },
      pfr: { min: 0.08, max: 0.14 },
      limp: { min: 0.55, max: 0.75 },
      threeBet: { min: 0.02, max: 0.05 },
      foldToThreeBet: { min: 0.35, max: 0.55 },
      stealFromLatePosition: { min: 0.1, max: 0.2 },
      positionAwareness: { min: 0.05, max: 0.25 },
      cbet: { min: 0.35, max: 0.5 },
      foldToCbet: { min: 0.3, max: 0.45 },
      aggression: { min: 0.25, max: 0.4 },
      bluff: { min: 0.06, max: 0.14 },
      semiBluff: { min: 0.15, max: 0.3 },
      checkRaise: { min: 0.03, max: 0.08 },
      slowplay: { min: 0.15, max: 0.3 },
      stickiness: { min: 0.55, max: 0.75 },
      drawChasing: { min: 0.65, max: 0.85 },
      potOddsSkill: { min: 0.1, max: 0.3 },
      boardAwareness: { min: 0.25, max: 0.45 },
      rangeReading: { min: 0.1, max: 0.25 },
      thinkJitter: { min: 0.3, max: 0.5 },
      showsLosers: { min: 0.4, max: 0.75 },
      showsBluffs: { min: 0.4, max: 0.75 },
      tiltProne: { min: 0.2, max: 0.45 },
      tiltRecovery: { min: 0.5, max: 0.75 },
      hitAndRun: { min: 0.45, max: 0.7 },
      rebuyWillingness: { min: 0.45, max: 0.75 },
      stakesFear: { min: 0.2, max: 0.45 },
      chattiness: { min: 0.6, max: 0.9 },
      needle: { min: 0.1, max: 0.3 },
    },
    thinkBaseMs: { min: 1000, max: 1700 },
    buyInBigBlinds: { min: 40, max: 60 },
    sizing: { standard: 3, min: 2, pot: 1, erratic: 2 },
  },
  short_stacker: {
    bands: {
      vpip: { min: 0.14, max: 0.2 },
      pfr: { min: 0.12, max: 0.17 },
      limp: { min: 0, max: 0.05 },
      threeBet: { min: 0.06, max: 0.1 },
      foldToThreeBet: { min: 0.3, max: 0.5 },
      stealFromLatePosition: { min: 0.3, max: 0.45 },
      positionAwareness: { min: 0.5, max: 0.75 },
      cbet: { min: 0.6, max: 0.75 },
      foldToCbet: { min: 0.35, max: 0.5 },
      aggression: { min: 0.65, max: 0.8 },
      bluff: { min: 0.05, max: 0.12 },
      semiBluff: { min: 0.35, max: 0.5 },
      checkRaise: { min: 0.05, max: 0.1 },
      slowplay: { min: 0.03, max: 0.1 },
      stickiness: { min: 0.35, max: 0.5 },
      drawChasing: { min: 0.1, max: 0.2 },
      potOddsSkill: { min: 0.6, max: 0.8 },
      boardAwareness: { min: 0.55, max: 0.75 },
      rangeReading: { min: 0.4, max: 0.6 },
      thinkJitter: { min: 0.15, max: 0.3 },
      showsLosers: { min: 0.05, max: 0.2 },
      showsBluffs: { min: 0.05, max: 0.15 },
      tiltProne: { min: 0.15, max: 0.35 },
      tiltRecovery: { min: 0.55, max: 0.8 },
      hitAndRun: { min: 0.35, max: 0.6 },
      rebuyWillingness: { min: 0.85, max: 1 },
      stakesFear: { min: 0.05, max: 0.2 },
      chattiness: { min: 0.1, max: 0.3 },
      needle: { min: 0.05, max: 0.2 },
    },
    thinkBaseMs: { min: 800, max: 1300 },
    buyInBigBlinds: { min: 20, max: 30 },
    sizing: { standard: 3, pot: 2 },
  },
  trapper: {
    bands: {
      vpip: { min: 0.2, max: 0.27 },
      pfr: { min: 0.1, max: 0.15 },
      limp: { min: 0.15, max: 0.3 },
      threeBet: { min: 0.03, max: 0.06 },
      foldToThreeBet: { min: 0.4, max: 0.55 },
      stealFromLatePosition: { min: 0.2, max: 0.35 },
      positionAwareness: { min: 0.65, max: 0.85 },
      cbet: { min: 0.35, max: 0.5 },
      foldToCbet: { min: 0.35, max: 0.5 },
      aggression: { min: 0.4, max: 0.55 },
      bluff: { min: 0.08, max: 0.15 },
      semiBluff: { min: 0.25, max: 0.4 },
      checkRaise: { min: 0.3, max: 0.45 },
      slowplay: { min: 0.6, max: 0.8 },
      stickiness: { min: 0.45, max: 0.6 },
      drawChasing: { min: 0.15, max: 0.25 },
      potOddsSkill: { min: 0.65, max: 0.85 },
      boardAwareness: { min: 0.7, max: 0.9 },
      rangeReading: { min: 0.55, max: 0.75 },
      thinkJitter: { min: 0.25, max: 0.45 },
      showsLosers: { min: 0, max: 0.1 },
      showsBluffs: { min: 0.05, max: 0.15 },
      tiltProne: { min: 0.1, max: 0.3 },
      tiltRecovery: { min: 0.55, max: 0.8 },
      hitAndRun: { min: 0.1, max: 0.25 },
      rebuyWillingness: { min: 0.6, max: 0.85 },
      stakesFear: { min: 0.05, max: 0.2 },
      chattiness: { min: 0.1, max: 0.3 },
      needle: { min: 0.15, max: 0.35 },
    },
    thinkBaseMs: { min: 1300, max: 1900 },
    buyInBigBlinds: { min: 45, max: 70 },
    sizing: { standard: 3, min: 2, overbet: 1 },
  },
  scared_money: {
    bands: {
      vpip: { min: 0.14, max: 0.2 },
      pfr: { min: 0.05, max: 0.09 },
      limp: { min: 0.35, max: 0.55 },
      threeBet: { min: 0.01, max: 0.03 },
      foldToThreeBet: { min: 0.75, max: 0.9 },
      stealFromLatePosition: { min: 0.05, max: 0.12 },
      positionAwareness: { min: 0.2, max: 0.4 },
      cbet: { min: 0.3, max: 0.45 },
      foldToCbet: { min: 0.6, max: 0.8 },
      aggression: { min: 0.15, max: 0.3 },
      bluff: { min: 0.01, max: 0.05 },
      semiBluff: { min: 0.05, max: 0.12 },
      checkRaise: { min: 0.02, max: 0.05 },
      slowplay: { min: 0.05, max: 0.12 },
      stickiness: { min: 0.15, max: 0.3 },
      drawChasing: { min: 0.15, max: 0.3 },
      potOddsSkill: { min: 0.35, max: 0.55 },
      boardAwareness: { min: 0.55, max: 0.75 },
      rangeReading: { min: 0.2, max: 0.4 },
      thinkJitter: { min: 0.35, max: 0.6 },
      showsLosers: { min: 0.05, max: 0.2 },
      showsBluffs: { min: 0.1, max: 0.3 },
      tiltProne: { min: 0.3, max: 0.55 },
      tiltRecovery: { min: 0.4, max: 0.6 },
      hitAndRun: { min: 0.5, max: 0.75 },
      rebuyWillingness: { min: 0.2, max: 0.45 },
      stakesFear: { min: 0.65, max: 0.9 },
      chattiness: { min: 0.15, max: 0.4 },
      needle: { min: 0, max: 0.08 },
    },
    thinkBaseMs: { min: 1600, max: 2400 },
    buyInBigBlinds: { min: 30, max: 50 },
    sizing: { min: 4, standard: 3 },
  },
  old_timer: {
    bands: {
      vpip: { min: 0.42, max: 0.52 },
      pfr: { min: 0.02, max: 0.05 },
      limp: { min: 0.9, max: 0.99 },
      threeBet: { min: 0, max: 0.02 },
      foldToThreeBet: { min: 0.4, max: 0.6 },
      stealFromLatePosition: { min: 0.02, max: 0.08 },
      positionAwareness: { min: 0, max: 0.15 },
      cbet: { min: 0.15, max: 0.3 },
      foldToCbet: { min: 0.3, max: 0.45 },
      aggression: { min: 0.08, max: 0.2 },
      bluff: { min: 0, max: 0.03 },
      semiBluff: { min: 0.03, max: 0.08 },
      checkRaise: { min: 0.02, max: 0.06 },
      slowplay: { min: 0.35, max: 0.55 },
      stickiness: { min: 0.6, max: 0.8 },
      drawChasing: { min: 0.55, max: 0.75 },
      potOddsSkill: { min: 0.2, max: 0.4 },
      boardAwareness: { min: 0.45, max: 0.65 },
      rangeReading: { min: 0.15, max: 0.3 },
      thinkJitter: { min: 0.25, max: 0.45 },
      showsLosers: { min: 0.5, max: 0.85 },
      showsBluffs: { min: 0.2, max: 0.5 },
      tiltProne: { min: 0.02, max: 0.15 },
      tiltRecovery: { min: 0.75, max: 0.95 },
      hitAndRun: { min: 0.1, max: 0.25 },
      rebuyWillingness: { min: 0.55, max: 0.8 },
      stakesFear: { min: 0.15, max: 0.35 },
      chattiness: { min: 0.75, max: 0.97 },
      needle: { min: 0, max: 0.1 },
    },
    thinkBaseMs: { min: 2200, max: 3200 },
    buyInBigBlinds: { min: 40, max: 55 },
    sizing: { min: 3, standard: 3 },
  },
};

/** Clamps a tendency to the unit interval. */
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
