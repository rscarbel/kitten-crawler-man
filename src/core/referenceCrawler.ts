/**
 * What an on-schedule crawler of a given party level looks like, as numbers.
 *
 * Pure and side-effect-free so `scripts/verify-difficulty-curve.ts` can price a
 * fight against a real levelled mob without constructing a crawler. Every
 * number comes out of the formulas the crawlers themselves run
 * (`src/core/crawlerFormulas.ts`, `computeDodgeChance`, the magic missile's own
 * stat table), so retuning any of them moves the reference with it.
 *
 * Gear, skills, spell levels and consumables are deliberately left out. The
 * enemy curve must be survivable without them; they are what makes a player
 * feel ahead of it.
 */

import { ALL_STATS, MIN_STAT_VALUE, type StatName } from '../Player';
import type { PlayerDamageType } from '../creatures/Mob';
import { computeDodgeChance } from './dodge';
import { getMagicMissileStats } from '../abilities/magicMissile';
import {
  bareClawDamage,
  bareFistDamage,
  CAT_BASE_CONSTITUTION,
  CAT_BASE_HP_OFFSET,
  CAT_DEXTERITY_PER_LEVEL,
  CAT_LOCKED_STATS,
  CAT_STARTING_DEXTERITY,
  CAT_SWIPE_FRAMES,
  crawlerMaxHp,
  HUMAN_BASE_HP_OFFSET,
  HUMAN_STARTING_DEXTERITY,
  HUMAN_SWING_FRAMES,
  missileDamage,
  STAT_POINTS_PER_LEVEL,
} from './crawlerFormulas';

export type ReferenceCrawler = 'human' | 'cat';

export const REFERENCE_CRAWLERS: readonly ReferenceCrawler[] = ['human', 'cat'];

export const REFERENCE_BUILD_NAMES = [
  'balanced',
  'offense-heavy',
  'defense-heavy',
  'off-stat',
] as const;

/**
 * How a crawler spends her level-up points.
 *
 * `off-stat` is the deliberately weak one: every point into the stat that does
 * least for that crawler's main attack. It exists so the curve gate can insist
 * that a player who spent badly still wins a one-on-one — they should struggle,
 * never be locked out.
 */
export type ReferenceBuild = (typeof REFERENCE_BUILD_NAMES)[number];

/** A share of each level-up point per stat; normalised before use, so only the ratios matter. */
export type StatAllocation = Readonly<Record<StatName, number>>;

/** The spell level a crawler who has never trained her spell casts at. */
const UNTRAINED_SPELL_LEVEL = 1;

/**
 * The builds, per crawler.
 *
 * Weight on a stat the crawler cannot spend into (Donut's constitution and
 * dexterity) is spread evenly over the stats she can, so one table of intents
 * serves both crawlers. The human's main attack is his fist, so his `off-stat`
 * build never buys strength and spreads every point over the three stats that
 * do nothing for it. Donut's attack key
 * claws on three presses in every four (her missile is on cooldown for the
 * rest), so her claws are her main attack and her `off-stat` dumps into
 * intelligence too, which only feeds the one press in four that is a missile.
 */
export const REFERENCE_BUILDS: Readonly<
  Record<ReferenceCrawler, Readonly<Record<ReferenceBuild, StatAllocation>>>
> = {
  human: {
    balanced: { strength: 1, intelligence: 1, constitution: 1, dexterity: 1 },
    'offense-heavy': { strength: 3, intelligence: 0, constitution: 1, dexterity: 1 },
    'defense-heavy': { strength: 1, intelligence: 0, constitution: 2, dexterity: 2 },
    'off-stat': { strength: 0, intelligence: 1, constitution: 1, dexterity: 1 },
  },
  cat: {
    balanced: { strength: 1, intelligence: 1, constitution: 1, dexterity: 1 },
    'offense-heavy': { strength: 3, intelligence: 1, constitution: 1, dexterity: 1 },
    'defense-heavy': { strength: 1, intelligence: 1, constitution: 2, dexterity: 2 },
    'off-stat': { strength: 0, intelligence: 1, constitution: 0, dexterity: 0 },
  },
};

/** One press of the attack key: what it deals, as what, and how long until the next press. */
export interface ReferenceAttack {
  readonly damage: number;
  readonly damageType: PlayerDamageType;
  readonly frames: number;
}

export interface ReferenceStats {
  readonly stats: Readonly<Record<StatName, number>>;
  readonly maxHp: number;
  readonly dodgeChance: number;
  /**
   * The repeating sequence mashing the attack key produces, in order. The human
   * punches every swing; Donut's key fires her missile whenever it is off
   * cooldown and claws with every press in between, exactly as
   * `triggerPlayerAttack` resolves it.
   */
  readonly attackCycle: readonly ReferenceAttack[];
}

function startingStats(crawler: ReferenceCrawler): Record<StatName, number> {
  const stats: Record<StatName, number> = {
    strength: MIN_STAT_VALUE,
    intelligence: MIN_STAT_VALUE,
    constitution: MIN_STAT_VALUE,
    dexterity: MIN_STAT_VALUE,
  };
  if (crawler === 'human') {
    stats.dexterity = HUMAN_STARTING_DEXTERITY;
  } else {
    stats.constitution = CAT_BASE_CONSTITUTION;
    stats.dexterity = CAT_STARTING_DEXTERITY;
  }
  return stats;
}

function canSpendInto(crawler: ReferenceCrawler, stat: StatName): boolean {
  return crawler === 'human' || !CAT_LOCKED_STATS.includes(stat);
}

/** The build's weights with any locked stat's share spread evenly over the spendable ones. */
function spendableWeights(
  crawler: ReferenceCrawler,
  allocation: StatAllocation,
): Record<StatName, number> {
  const spendable = ALL_STATS.filter((stat) => canSpendInto(crawler, stat));
  const lockedWeight = ALL_STATS.filter((stat) => !canSpendInto(crawler, stat)).reduce(
    (sum, stat) => sum + allocation[stat],
    0,
  );
  const redistributed = lockedWeight / spendable.length;
  const weights: Record<StatName, number> = {
    strength: 0,
    intelligence: 0,
    constitution: 0,
    dexterity: 0,
  };
  for (const stat of spendable) weights[stat] = allocation[stat] + redistributed;
  return weights;
}

/**
 * Hands out `points` one at a time, each to the stat furthest behind its share,
 * so the result at every party level is the allocation a player following the
 * build would actually have — never a fractional point.
 */
function allocatePoints(
  weights: Record<StatName, number>,
  points: number,
): Record<StatName, number> {
  const totalWeight = ALL_STATS.reduce((sum, stat) => sum + weights[stat], 0);
  const spent: Record<StatName, number> = {
    strength: 0,
    intelligence: 0,
    constitution: 0,
    dexterity: 0,
  };
  for (let point = 1; point <= points; point++) {
    let neediest: StatName = ALL_STATS[0];
    let largestShortfall = -Infinity;
    for (const stat of ALL_STATS) {
      if (weights[stat] <= 0) continue;
      const owed = (weights[stat] / totalWeight) * point;
      const shortfall = owed - spent[stat];
      if (shortfall > largestShortfall) {
        largestShortfall = shortfall;
        neediest = stat;
      }
    }
    spent[neediest]++;
  }
  return spent;
}

function attackCycleFor(
  crawler: ReferenceCrawler,
  stats: Readonly<Record<StatName, number>>,
): ReferenceAttack[] {
  if (crawler === 'human') {
    return [
      { damage: bareFistDamage(stats.strength), damageType: 'melee', frames: HUMAN_SWING_FRAMES },
    ];
  }
  const spell = getMagicMissileStats(UNTRAINED_SPELL_LEVEL);
  const pressesPerMissile = Math.max(1, Math.ceil(spell.cooldownFrames / CAT_SWIPE_FRAMES));
  const missile: ReferenceAttack = {
    damage: missileDamage(stats.intelligence, spell.damageMultiplier),
    damageType: 'missile',
    frames: CAT_SWIPE_FRAMES,
  };
  const claw: ReferenceAttack = {
    damage: bareClawDamage(stats.strength),
    damageType: 'melee',
    frames: CAT_SWIPE_FRAMES,
  };
  const clawsBetweenMissiles = pressesPerMissile - 1;
  return [missile, ...Array.from({ length: clawsBetweenMissiles }, () => claw)];
}

/**
 * How points are counted: `whole` is the allocation one player following the
 * build actually has, a point at a time; `expected` is the average over every
 * player following it, fractional and smooth. Stat points arrive one at a time,
 * so a single player's fight cost steps down each time a point lands — a
 * trend check wants `expected`, a check on what one fight costs wants `whole`.
 */
export type PointCounting = 'whole' | 'expected';

/** The build's points as a player would hold them after `points` level-ups. */
function spentPoints(
  weights: Record<StatName, number>,
  points: number,
  counting: PointCounting,
): Record<StatName, number> {
  if (counting === 'whole') return allocatePoints(weights, points);
  const totalWeight = ALL_STATS.reduce((sum, stat) => sum + weights[stat], 0);
  return {
    strength: (weights.strength / totalWeight) * points,
    intelligence: (weights.intelligence / totalWeight) * points,
    constitution: (weights.constitution / totalWeight) * points,
    dexterity: (weights.dexterity / totalWeight) * points,
  };
}

/**
 * The crawler a player following `build` has at `partyLevel`, with no gear,
 * skills, trained spells or consumables.
 */
export function referenceStats(
  crawler: ReferenceCrawler,
  build: ReferenceBuild,
  partyLevel: number,
  counting: PointCounting = 'whole',
): ReferenceStats {
  const levelsGained = Math.max(0, partyLevel - 1);
  const points = levelsGained * STAT_POINTS_PER_LEVEL;
  const weights = spendableWeights(crawler, REFERENCE_BUILDS[crawler][build]);
  const spent = spentPoints(weights, points, counting);
  const base = startingStats(crawler);
  const stats: Record<StatName, number> = {
    strength: base.strength + spent.strength,
    intelligence: base.intelligence + spent.intelligence,
    constitution: base.constitution + spent.constitution,
    dexterity: base.dexterity + spent.dexterity,
  };
  if (crawler === 'cat') stats.dexterity += levelsGained * CAT_DEXTERITY_PER_LEVEL;
  const baseHpOffset = crawler === 'human' ? HUMAN_BASE_HP_OFFSET : CAT_BASE_HP_OFFSET;
  return {
    stats,
    maxHp: crawlerMaxHp(baseHpOffset, stats.constitution),
    dodgeChance: computeDodgeChance(stats.dexterity),
    attackCycle: attackCycleFor(crawler, stats),
  };
}
