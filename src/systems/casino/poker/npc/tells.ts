/**
 * Physical tells: small, readable habits a regular shows at the table that
 * correlate with their hand. Which tells a regular has is rolled per run; how
 * one fires from the hand in progress, and what the host should animate when
 * it does, lives here.
 *
 * A tell is evidence, never proof: of the times it shows, its `reliability` is
 * the share that tell the truth, and the rest are misfires, so a player who
 * trusts one blindly still gets burned.
 */

import { type Rng, chance, pick, range, rangeInt } from '../../../../sprites/person/rng';
import { ARCHETYPE_GROUP, type Archetype, type ArchetypeGroup } from './profiles';

export const TELL_KINDS = [
  'think_time',
  'bet_size',
  'chip_fidget',
  'card_recheck',
  'chatter',
  'bet_motion',
] as const;
export type TellKind = (typeof TELL_KINDS)[number];

/**
 * What the regular's hand must be for the tell to be telling the truth. The
 * same kind can be an honest tell for one regular and a reverse tell for
 * another.
 */
export type TellPolarity = 'strength' | 'weakness' | 'drawing';

/** The visible habit itself: which way the regular deviates when the tell fires. */
export type TellSignal =
  | { readonly kind: 'think_time'; readonly pace: 'tank' | 'snap' }
  | { readonly kind: 'bet_size'; readonly size: 'big' | 'small' }
  | { readonly kind: 'chip_fidget' }
  | { readonly kind: 'card_recheck' }
  | { readonly kind: 'chatter'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'bet_motion'; readonly style: 'neat' | 'splash' };

export interface PokerTell {
  readonly signal: TellSignal;
  readonly polarity: TellPolarity;
  /** Share of its firings, in [0.55, 0.9], that match its polarity: the rest are misfires. */
  readonly reliability: number;
}

/** When in a hand a tell can show. */
export type TellMoment = 'acting' | 'betting' | 'waiting' | 'flop_dealt';

export const TELL_MOMENT: Readonly<Record<TellKind, TellMoment>> = {
  think_time: 'acting',
  bet_size: 'betting',
  bet_motion: 'betting',
  chip_fidget: 'waiting',
  chatter: 'waiting',
  card_recheck: 'flop_dealt',
};

/** The hand state a tell reads. Strength is the regular's own made-hand strength in [0, 1]. */
export interface TellHandState {
  readonly madeStrength: number;
  readonly hasDraw: boolean;
  /** Cards are still to come after this street, so a draw can exist at all. */
  readonly drawsPossible: boolean;
  readonly bluffing: boolean;
  /** The flop shows two or more cards of one suit. */
  readonly flopFlushPossible: boolean;
  /** How many of the regular's hole cards share that suit (0–2). */
  readonly holeCardsOfFlushSuit: number;
}

/** What the host shows when a tell fires. */
export type TellCue =
  | { readonly kind: 'think_time'; readonly thinkMultiplier: number }
  | { readonly kind: 'bet_size'; readonly betMultiplier: number }
  | { readonly kind: 'chip_fidget' }
  | { readonly kind: 'card_recheck' }
  | { readonly kind: 'chatter'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'bet_motion'; readonly style: 'neat' | 'splash' };

export interface TellFiring {
  readonly cue: TellCue;
  /** True when the hand really matched the tell's polarity; reported, never shown. */
  readonly truthful: boolean;
}

/** One moment a tell could have shown, and whether its condition held; feeds the base rate. */
export interface TellChance {
  /** Index into the regular's tells. */
  readonly tellIndex: number;
  readonly held: boolean;
}

export const TELL_RELIABILITY_MIN = 0.55;
export const TELL_RELIABILITY_MAX = 0.9;

/** Made-hand strength at or above this reads as "strong" to a tell. */
const STRONG_HAND_AT = 0.7;
/** Made-hand strength at or below this reads as "weak" to a tell. */
const WEAK_HAND_AT = 0.3;

const EVEN_ODDS = 0.5;
const TANK_THINK_MULTIPLIER = 2.4;
const SNAP_THINK_MULTIPLIER = 0.3;
const BIG_BET_MULTIPLIER = 1.6;
const SMALL_BET_MULTIPLIER = 0.6;

interface TellBudget {
  readonly countMin: number;
  readonly countMax: number;
  readonly reliabilityMin: number;
  readonly reliabilityMax: number;
}

/** Fish leak several dependable tells; good regulars leak at most one unreliable one. */
const TELL_BUDGET: Readonly<Record<ArchetypeGroup, TellBudget>> = {
  fish: { countMin: 2, countMax: 3, reliabilityMin: 0.75, reliabilityMax: TELL_RELIABILITY_MAX },
  regular: { countMin: 0, countMax: 1, reliabilityMin: TELL_RELIABILITY_MIN, reliabilityMax: 0.65 },
  middle: { countMin: 1, countMax: 2, reliabilityMin: 0.62, reliabilityMax: 0.8 },
};

/** Polarities that make sense for each kind; a chip fidget never signals a draw. */
const KIND_POLARITIES: Readonly<Record<TellKind, readonly TellPolarity[]>> = {
  think_time: ['strength', 'weakness', 'drawing'],
  bet_size: ['strength', 'weakness'],
  chip_fidget: ['strength', 'weakness'],
  card_recheck: ['strength', 'weakness'],
  chatter: ['strength', 'weakness'],
  bet_motion: ['strength', 'weakness'],
};

function rollSignal(kind: TellKind, rng: Rng): TellSignal {
  switch (kind) {
    case 'think_time':
      return { kind, pace: chance(rng, EVEN_ODDS) ? 'tank' : 'snap' };
    case 'bet_size':
      return { kind, size: chance(rng, EVEN_ODDS) ? 'big' : 'small' };
    case 'chip_fidget':
      return { kind };
    case 'card_recheck':
      return { kind };
    case 'chatter':
      return { kind, direction: chance(rng, EVEN_ODDS) ? 'up' : 'down' };
    case 'bet_motion':
      return { kind, style: chance(rng, EVEN_ODDS) ? 'splash' : 'neat' };
  }
}

/** Rolls a regular's tells for a run: distinct kinds, count and reliability by archetype. */
export function rollTells(archetype: Archetype, rng: Rng): readonly PokerTell[] {
  const budget = TELL_BUDGET[ARCHETYPE_GROUP[archetype]];
  const count = rangeInt(rng, budget.countMin, budget.countMax);
  const kinds = [...TELL_KINDS];
  const tells: PokerTell[] = [];
  for (let i = 0; i < count && kinds.length > 0; i++) {
    const index = Math.min(kinds.length - 1, Math.floor(rng() * kinds.length));
    const [kind] = kinds.splice(index, 1);
    tells.push({
      signal: rollSignal(kind, rng),
      polarity: pick(rng, KIND_POLARITIES[kind]),
      reliability: range(rng, budget.reliabilityMin, budget.reliabilityMax),
    });
  }
  return tells;
}

function polarityHolds(tell: PokerTell, state: TellHandState): boolean {
  if (tell.signal.kind === 'card_recheck') {
    // A recheck asks "was that one of my suit?": a player holding two of the
    // flush suit already knows, so the honest recheck comes from holding one.
    const holdsTwo = state.holeCardsOfFlushSuit >= 2;
    const holdsOne = state.holeCardsOfFlushSuit === 1;
    return tell.polarity === 'strength' ? holdsTwo : holdsOne;
  }
  switch (tell.polarity) {
    case 'strength':
      return state.madeStrength >= STRONG_HAND_AT && !state.bluffing;
    case 'weakness':
      return state.bluffing || state.madeStrength <= WEAK_HAND_AT;
    case 'drawing':
      return state.hasDraw && state.madeStrength < STRONG_HAND_AT;
  }
}

function cueFor(signal: TellSignal): TellCue {
  switch (signal.kind) {
    case 'think_time':
      return {
        kind: 'think_time',
        thinkMultiplier: signal.pace === 'tank' ? TANK_THINK_MULTIPLIER : SNAP_THINK_MULTIPLIER,
      };
    case 'bet_size':
      return {
        kind: 'bet_size',
        betMultiplier: signal.size === 'big' ? BIG_BET_MULTIPLIER : SMALL_BET_MULTIPLIER,
      };
    case 'chip_fidget':
      return { kind: 'chip_fidget' };
    case 'card_recheck':
      return { kind: 'card_recheck' };
    case 'chatter':
      return { kind: 'chatter', direction: signal.direction };
    case 'bet_motion':
      return { kind: 'bet_motion', style: signal.style };
  }
}

/** How often a tell shows when its condition holds, before any cap. */
const FIRE_WHEN_TRUE = 0.7;
/** The prior for a kind × polarity the measured table has no entry for. */
const FALLBACK_CONDITION_RATE = 0.3;

/**
 * How often each tell's condition holds at the moments it can show, which is
 * what a regular assumes until their own hands say otherwise. Measured across
 * every regular over 12 world seeds × 3 tiers × 300 hands; reproduce with
 * `npm run report:poker-tendencies -- --measure-tell-priors --seeds=12`.
 */
export const TELL_CONDITION_PRIOR: Readonly<
  Record<TellKind, Readonly<Partial<Record<TellPolarity, number>>>>
> = {
  think_time: { strength: 0.35, weakness: 0.22, drawing: 0.1 },
  bet_size: { strength: 0.63, weakness: 0.16 },
  chip_fidget: { strength: 0.37, weakness: 0.23 },
  card_recheck: { strength: 0.05, weakness: 0.34 },
  chatter: { strength: 0.35, weakness: 0.24 },
  bet_motion: { strength: 0.7, weakness: 0.19 },
};

/** What a regular assumes about how often `tell`'s condition holds before seeing any hands. */
export function tellConditionPrior(tell: PokerTell): number {
  return TELL_CONDITION_PRIOR[tell.signal.kind][tell.polarity] ?? FALLBACK_CONDITION_RATE;
}
/** How many chances' worth of weight the prior carries against what has been seen. */
const PRIOR_CONDITION_CHANCES = 20;
/** Keeps the misfire rate finite while a condition has never (or always) held. */
const CONDITION_RATE_FLOOR = 0.02;

/** A tell condition's base rate from `held` of `chances`, shrunk toward the prior. */
export function conditionRate(held: number, chances: number, prior: number): number {
  return (held + prior * PRIOR_CONDITION_CHANCES) / (chances + PRIOR_CONDITION_CHANCES);
}

/**
 * Fire chances that make `reliability` the share of firings that are
 * truthful, given how often the condition holds (`rate`). A rare condition
 * therefore misfires rarely too; when even a certain misfire could not swamp
 * it, the truthful chance is lowered instead so the share still holds.
 */
export function fireChances(
  reliability: number,
  rate: number,
): { readonly whenTrue: number; readonly whenFalse: number } {
  const held = Math.min(1 - CONDITION_RATE_FLOOR, Math.max(CONDITION_RATE_FLOOR, rate));
  const misfireRatio = (held * (1 - reliability)) / ((1 - held) * reliability);
  const whenFalse = FIRE_WHEN_TRUE * misfireRatio;
  if (whenFalse <= 1) return { whenTrue: FIRE_WHEN_TRUE, whenFalse };
  return { whenTrue: 1 / misfireRatio, whenFalse: 1 };
}

/** Whether `tell` can show at `moment` at all; a condition that cannot hold is no chance. */
function tellApplies(tell: PokerTell, moment: TellMoment, state: TellHandState): boolean {
  if (TELL_MOMENT[tell.signal.kind] !== moment) return false;
  if (tell.signal.kind === 'card_recheck') return state.flopFlushPossible;
  if (tell.polarity === 'drawing') return state.drawsPossible;
  return true;
}

/**
 * Whether `tell` shows at `moment`, and what the host should animate if so.
 * `rate` is how often the tell's condition holds for this regular, so that a
 * firing is truthful with the tell's reliability: a tell is evidence, never
 * proof, and never mostly noise.
 */
export function evaluateTell(
  tell: PokerTell,
  moment: TellMoment,
  state: TellHandState,
  rng: Rng,
  rate: number = tellConditionPrior(tell),
): TellFiring | null {
  if (!tellApplies(tell, moment, state)) return null;
  const truthful = polarityHolds(tell, state);
  const chances = fireChances(tell.reliability, rate);
  if (!chance(rng, truthful ? chances.whenTrue : chances.whenFalse)) return null;
  return { cue: cueFor(tell.signal), truthful };
}

/**
 * Every tell of a regular that fires at `moment`, and every chance a tell had
 * (fired or not) so the caller can keep each condition's base rate current.
 * `rates` holds each tell's condition rate by index; missing ones use the measured prior.
 */
export function evaluateTells(
  tells: readonly PokerTell[],
  moment: TellMoment,
  state: TellHandState,
  rng: Rng,
  rates: ReadonlyArray<number> = [],
): { readonly firings: readonly TellFiring[]; readonly chances: readonly TellChance[] } {
  const firings: TellFiring[] = [];
  const chances: TellChance[] = [];
  tells.forEach((tell, tellIndex) => {
    if (!tellApplies(tell, moment, state)) return;
    chances.push({ tellIndex, held: polarityHolds(tell, state) });
    const firing = evaluateTell(
      tell,
      moment,
      state,
      rng,
      rates[tellIndex] ?? tellConditionPrior(tell),
    );
    if (firing !== null) firings.push(firing);
  });
  return { firings, chances };
}

/** How often each tell kind fired, and how often truthfully, for the tendencies report. */
export type TellTally = Readonly<
  Record<TellKind, { readonly fired: number; readonly truthful: number }>
>;

export function emptyTellTally(): TellTally {
  return {
    think_time: { fired: 0, truthful: 0 },
    bet_size: { fired: 0, truthful: 0 },
    chip_fidget: { fired: 0, truthful: 0 },
    card_recheck: { fired: 0, truthful: 0 },
    chatter: { fired: 0, truthful: 0 },
    bet_motion: { fired: 0, truthful: 0 },
  };
}

export function tallyTellFiring(tally: TellTally, firing: TellFiring): TellTally {
  const kind = firing.cue.kind;
  const entry = tally[kind];
  return {
    ...tally,
    [kind]: { fired: entry.fired + 1, truthful: entry.truthful + (firing.truthful ? 1 : 0) },
  };
}
