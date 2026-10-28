/**
 * Who each regular is as a poker player in this run, rolled from the world
 * seed: archetype, every profile parameter, bet sizing, voice, tells, tier
 * preferences and buy-in habit.
 *
 * The roll is pure and recomputed on every visit instead of saved, so it
 * survives saves, loads and death rewinds by construction. It draws only from
 * its own streams, never `Math.random` or the floor-layout world random, so
 * nothing else in the run can shift it. Each regular, and each field of each
 * regular, reads its own sub-stream keyed by name: adding a regular or a
 * parameter leaves every other value where it was.
 */

import { type Rng, mulberry32, pick, range, subSeed } from '../../../../sprites/person/rng';
import type { PokerTierId } from '../pokerStakes';
import { NPC_SEAT_COUNT } from '../PokerTable';
import {
  ARCHETYPES,
  ARCHETYPE_PRESETS,
  type Archetype,
  BANTER_SET_IDS,
  type Band,
  EXTRA_ARCHETYPE_WEIGHTS,
  type PokerProfile,
  SIZING_STYLES,
  type SizingStyle,
  type SizingWeights,
  type UnitParameter,
} from './profiles';
import { mapRegulars } from './regulars';
import { REGULAR_IDS, type RegularId } from './regularIds';
import { type PokerTell, rollTells } from './tells';

export const POKER_PERSONALITY_SALT = 0x504f4b52;

/** The seed for the `?poker` preview and harness rooms, where no overworld exists. */
export const POKER_DEV_SEED = 0x0c4a5d1e;

export interface PokerPersonality {
  readonly regularId: RegularId;
  readonly archetype: Archetype;
  readonly profile: PokerProfile;
  readonly tells: readonly PokerTell[];
  /** How keen the regular is on each table, multiplied into table selection. */
  readonly tierPreference: Readonly<Record<PokerTierId, number>>;
}

export type PokerPersonalities = Readonly<Record<RegularId, PokerPersonality>>;

const EXTRA_ARCHETYPE_COUNT = REGULAR_IDS.length - ARCHETYPES.length;
const TIER_PREFERENCE_MIN = 0.5;
const TIER_PREFERENCE_MAX = 1.5;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A stable 32-bit key for a name (FNV-1a), so a sub-stream never depends on list order. */
function nameKey(name: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

function namedStream(seed: number, name: string): Rng {
  return mulberry32(subSeed(seed, nameKey(name)));
}

function weightedPick<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T | null {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]?.[0] ?? null;
}

function shuffled<T>(items: ReadonlyArray<T>, rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Every archetype once, plus extras at real-table frequencies, dealt across the roster. */
function rollArchetypes(rootSeed: number): Record<RegularId, Archetype> {
  const rng = namedStream(rootSeed, 'archetypes');
  const extraWeights = ARCHETYPES.map(
    (archetype) => [archetype, EXTRA_ARCHETYPE_WEIGHTS[archetype]] as const,
  );
  const pool: Archetype[] = [...ARCHETYPES];
  for (let i = 0; i < EXTRA_ARCHETYPE_COUNT; i++) {
    pool.push(weightedPick(rng, extraWeights) ?? 'recreational');
  }
  const dealt = shuffled(pool, rng);
  return mapRegulars((id) => dealt[REGULAR_IDS.indexOf(id)] ?? 'recreational');
}

function drawBand(rng: Rng, band: Band): number {
  return range(rng, band.min, band.max);
}

function rollSizing(rng: Rng, weights: SizingWeights): SizingStyle {
  const entries = SIZING_STYLES.map((style) => [style, weights[style] ?? 0] as const);
  return weightedPick(rng, entries) ?? 'standard';
}

/** A low end from the lower half of the archetype's bounds and a high end from the upper half. */
function rollBuyIn(rng: Rng, bounds: Band): Band {
  const middle = (bounds.min + bounds.max) / 2;
  return {
    min: Math.round(range(rng, bounds.min, middle)),
    max: Math.round(range(rng, middle, bounds.max)),
  };
}

function rollProfile(regularSeed: number, archetype: Archetype): PokerProfile {
  const preset = ARCHETYPE_PRESETS[archetype];
  const draw = (parameter: UnitParameter): number =>
    drawBand(namedStream(regularSeed, parameter), preset.bands[parameter]);
  const vpip = draw('vpip');
  return {
    vpip,
    pfr: Math.min(draw('pfr'), vpip),
    limp: draw('limp'),
    threeBet: draw('threeBet'),
    foldToThreeBet: draw('foldToThreeBet'),
    stealFromLatePosition: draw('stealFromLatePosition'),
    positionAwareness: draw('positionAwareness'),
    cbet: draw('cbet'),
    foldToCbet: draw('foldToCbet'),
    aggression: draw('aggression'),
    bluff: draw('bluff'),
    semiBluff: draw('semiBluff'),
    checkRaise: draw('checkRaise'),
    slowplay: draw('slowplay'),
    stickiness: draw('stickiness'),
    drawChasing: draw('drawChasing'),
    potOddsSkill: draw('potOddsSkill'),
    boardAwareness: draw('boardAwareness'),
    rangeReading: draw('rangeReading'),
    thinkJitter: draw('thinkJitter'),
    showsLosers: draw('showsLosers'),
    showsBluffs: draw('showsBluffs'),
    tiltProne: draw('tiltProne'),
    tiltRecovery: draw('tiltRecovery'),
    hitAndRun: draw('hitAndRun'),
    rebuyWillingness: draw('rebuyWillingness'),
    stakesFear: draw('stakesFear'),
    chattiness: draw('chattiness'),
    needle: draw('needle'),
    sizing: rollSizing(namedStream(regularSeed, 'sizing'), preset.sizing),
    thinkBaseMs: Math.round(drawBand(namedStream(regularSeed, 'thinkBaseMs'), preset.thinkBaseMs)),
    buyInBigBlinds: rollBuyIn(namedStream(regularSeed, 'buyInBigBlinds'), preset.buyInBigBlinds),
    banterSet: pick(namedStream(regularSeed, 'banterSet'), BANTER_SET_IDS),
  };
}

function rollTierPreference(regularSeed: number): Record<PokerTierId, number> {
  const preference = (tier: PokerTierId): number =>
    range(namedStream(regularSeed, `tier:${tier}`), TIER_PREFERENCE_MIN, TIER_PREFERENCE_MAX);
  return {
    penny: preference('penny'),
    card_room: preference('card_room'),
    high_rollers: preference('high_rollers'),
  };
}

/** Rolls every regular's personality for a run. Same seed, same people, every time. */
export function rollPokerPersonalities(worldSeed: number): PokerPersonalities {
  const rootSeed = subSeed(worldSeed, POKER_PERSONALITY_SALT);
  const archetypes = rollArchetypes(rootSeed);
  return mapRegulars((regularId) => {
    const regularSeed = subSeed(rootSeed, nameKey(regularId));
    const archetype = archetypes[regularId];
    return {
      regularId,
      archetype,
      profile: rollProfile(regularSeed, archetype),
      tells: rollTells(archetype, namedStream(regularSeed, 'tells')),
      tierPreference: rollTierPreference(regularSeed),
    };
  });
}

const MAX_PER_ARCHETYPE = 2;
export const LOOSE_VPIP_AT = 0.4;
export const TIGHT_VPIP_AT = 0.2;
const PENNY_SOFT_PLAYERS_REQUIRED = 2;

const SOFT_ARCHETYPES: ReadonlySet<Archetype> = new Set([
  'recreational',
  'calling_station',
  'old_timer',
]);
const STRONG_ARCHETYPES: ReadonlySet<Archetype> = new Set(['tag_reg', 'lag']);

/**
 * How likely each archetype is to be at each table. The penny table is mostly
 * people here for fun, the card room a mix, and the high rollers mostly strong
 * regulars plus the odd whale (a maniac or a recreational with deep pockets).
 */
const TIER_FLAVOUR: Readonly<Record<PokerTierId, Readonly<Record<Archetype, number>>>> = {
  penny: {
    rock: 1,
    tag_reg: 0.4,
    lag: 0.4,
    calling_station: 3,
    maniac: 1,
    recreational: 3,
    short_stacker: 1,
    trapper: 0.5,
    scared_money: 1.5,
    old_timer: 3,
  },
  card_room: {
    rock: 1.2,
    tag_reg: 1.2,
    lag: 1,
    calling_station: 1.5,
    maniac: 0.8,
    recreational: 1.5,
    short_stacker: 1,
    trapper: 1,
    scared_money: 1,
    old_timer: 1.2,
  },
  high_rollers: {
    rock: 0.6,
    tag_reg: 3,
    lag: 3,
    calling_station: 0.5,
    maniac: 1.5,
    recreational: 0.8,
    short_stacker: 1,
    trapper: 2,
    scared_money: 0.4,
    old_timer: 0.4,
  },
};

function seatWeight(personality: PokerPersonality, tier: PokerTierId): number {
  return personality.tierPreference[tier] * TIER_FLAVOUR[tier][personality.archetype];
}

/** How strictly a candidate table is held to the rules, loosened only when nobody fits. */
type Strictness = 'full' | 'mix' | 'cap' | 'none';
const STRICTNESS_ORDER: readonly Strictness[] = ['full', 'mix', 'cap', 'none'];

function tableFits(
  table: readonly PokerPersonality[],
  tier: PokerTierId,
  strictness: Strictness,
): boolean {
  if (strictness === 'none') return true;
  const perArchetype = new Map<Archetype, number>();
  for (const seat of table) {
    perArchetype.set(seat.archetype, (perArchetype.get(seat.archetype) ?? 0) + 1);
  }
  if ([...perArchetype.values()].some((count) => count > MAX_PER_ARCHETYPE)) return false;
  if (strictness === 'cap') return true;
  const hasLoose = table.some((seat) => seat.profile.vpip >= LOOSE_VPIP_AT);
  const hasTight = table.some((seat) => seat.profile.vpip <= TIGHT_VPIP_AT);
  if (!hasLoose || !hasTight) return false;
  if (strictness === 'mix') return true;
  if (tier === 'high_rollers') return table.some((seat) => STRONG_ARCHETYPES.has(seat.archetype));
  if (tier === 'penny') {
    const soft = table.filter((seat) => SOFT_ARCHETYPES.has(seat.archetype)).length;
    return soft >= PENNY_SOFT_PLAYERS_REQUIRED;
  }
  return true;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  const result: T[][] = [];
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      result.push([items[i], ...rest]);
    }
  }
  return result;
}

/**
 * The five regulars at the table when the player sits down at `tier`.
 *
 * Every valid five-seat table is weighed by the product of its members' tier
 * weights and one is drawn, so selection follows the tier's flavour while
 * always meeting the table rules: at most two of an archetype, at least one
 * loose and one tight player, a strong regular at the high rollers' table and
 * two soft players at the penny table.
 *
 * Every regular is eligible: a new game is a fresh night at the table.
 */
export function selectTable(
  personalities: PokerPersonalities,
  tier: PokerTierId,
  rng: Rng,
): readonly RegularId[] {
  const pool = REGULAR_IDS.map((id) => personalities[id]);
  const tables = combinations(pool, NPC_SEAT_COUNT);
  for (const strictness of STRICTNESS_ORDER) {
    const fitting = tables.filter((table) => tableFits(table, tier, strictness));
    const weighted = fitting.map(
      (table) =>
        [table, table.reduce((product, seat) => product * seatWeight(seat, tier), 1)] as const,
    );
    const chosen = weightedPick(rng, weighted);
    if (chosen !== null) return chosen.map((seat) => seat.regularId);
  }
  return pool.slice(0, NPC_SEAT_COUNT).map((seat) => seat.regularId);
}

/** A trait shows when a parameter passes a threshold, or by a custom measure; > 0 means it applies. */
type BioTrait = { readonly phrase: string } & (
  | { readonly parameter: UnitParameter; readonly above: number }
  | { readonly parameter: UnitParameter; readonly below: number }
  | { readonly strength: (profile: PokerProfile) => number }
);

function traitStrength(trait: BioTrait, profile: PokerProfile): number {
  if ('strength' in trait) return trait.strength(profile);
  if ('above' in trait) return (profile[trait.parameter] - trait.above) / (1 - trait.above);
  return (trait.below - profile[trait.parameter]) / trait.below;
}

const PASSIVE_CALLER_VPIP = 0.35;
const PASSIVE_CALLER_RAISE_SHARE = 0.2;
const SHORT_BUY_IN_BIG_BLINDS = 30;
const DEEP_BUY_IN_BIG_BLINDS = 90;

/**
 * Phrase fragments built from the rolled play style. They describe habits a
 * player would notice over twenty hands, never a tell: spotting those is the
 * player's job.
 */
const BIO_TRAITS: readonly BioTrait[] = [
  { phrase: 'Plays nearly every hand', parameter: 'vpip', above: 0.42 },
  { phrase: 'Waits a long time for a good hand', parameter: 'vpip', below: 0.16 },
  {
    phrase: 'Would rather call than raise',
    strength: (profile) =>
      profile.vpip >= PASSIVE_CALLER_VPIP
        ? (PASSIVE_CALLER_RAISE_SHARE - profile.pfr / profile.vpip) / PASSIVE_CALLER_RAISE_SHARE
        : 0,
  },
  { phrase: 'Bets hard and often', parameter: 'aggression', above: 0.75 },
  { phrase: 'Rarely bets first', parameter: 'aggression', below: 0.2 },
  { phrase: "Can't let a draw go", parameter: 'drawChasing', above: 0.6 },
  { phrase: 'Hates to fold a pair', parameter: 'stickiness', above: 0.7 },
  { phrase: 'Gives up when the betting gets serious', parameter: 'foldToCbet', above: 0.6 },
  { phrase: 'Will bet with absolutely nothing', parameter: 'bluff', above: 0.35 },
  { phrase: 'Never seems to be bluffing', parameter: 'bluff', below: 0.04 },
  { phrase: 'Likes to sit quietly on a big hand', parameter: 'slowplay', above: 0.5 },
  { phrase: 'Check-raises when you least want it', parameter: 'checkRaise', above: 0.28 },
  {
    phrase: 'Steals the blinds whenever it is folded round',
    parameter: 'stealFromLatePosition',
    above: 0.6,
  },
  { phrase: 'Knows the odds cold', parameter: 'potOddsSkill', above: 0.82 },
  { phrase: 'Limps into everything', parameter: 'limp', above: 0.85 },
  { phrase: 'Leaves the moment they are ahead', parameter: 'hitAndRun', above: 0.5 },
  { phrase: 'Takes a bad beat badly', parameter: 'tiltProne', above: 0.45 },
  { phrase: 'Gets jumpy when the stakes climb', parameter: 'stakesFear', above: 0.6 },
  { phrase: 'Loves to needle the table', parameter: 'needle', above: 0.45 },
  { phrase: 'Never stops talking', parameter: 'chattiness', above: 0.75 },
  {
    phrase: 'Sits down short and stays short',
    strength: (profile) =>
      (SHORT_BUY_IN_BIG_BLINDS - profile.buyInBigBlinds.max) / SHORT_BUY_IN_BIG_BLINDS,
  },
  {
    phrase: 'Brings a mountain of chips',
    strength: (profile) =>
      (profile.buyInBigBlinds.max - DEEP_BUY_IN_BIG_BLINDS) / DEEP_BUY_IN_BIG_BLINDS,
  },
];

const BIO_TRAIT_COUNT = 3;
const QUIET_BIO = 'Keeps their cards and their thoughts to themselves.';

/** A regular's habits in a line, from the strongest few of their rolled traits: the seat card's settled read. */
export function buildRegularBio(personality: PokerPersonality): string {
  const shown = BIO_TRAITS.map((trait) => ({
    phrase: trait.phrase,
    strength: traitStrength(trait, personality.profile),
  }))
    .filter((trait) => trait.strength > 0)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, BIO_TRAIT_COUNT);
  if (shown.length === 0) return QUIET_BIO;
  return shown.map((trait) => `${trait.phrase}.`).join(' ');
}
