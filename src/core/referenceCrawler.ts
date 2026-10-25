/**
 * What an on-schedule crawler of a given party level looks like, as numbers.
 *
 * Pure and side-effect-free so a fight against a real levelled mob can be
 * priced headlessly without constructing a crawler. Every
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

type ReferenceCrawler = 'human' | 'cat';

export const REFERENCE_CRAWLERS: readonly ReferenceCrawler[] = ['human', 'cat'];

/** The spell level a crawler who has never trained her spell casts at. */
const UNTRAINED_SPELL_LEVEL = 1;

/** One press of the attack key: what it deals, as what, and how long until the next press. */
export interface ReferenceAttack {
  readonly damage: number;
  readonly damageType: PlayerDamageType;
  readonly frames: number;
}

interface ReferenceStats {
  readonly stats: Readonly<Record<StatName, number>>;
  readonly maxHp: number;
  readonly dodgeChance: number;
  /**
   * The repeating sequence mashing the attack key produces, in order. The human
   * punches every swing; the cat's key fires her missile whenever it is off
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

/**
 * Every level-up point spread evenly, in turn, over the stats the crawler can
 * spend into, so the result at every party level is the allocation a player
 * spending evenly would actually have — never a fractional point.
 */
function spentPoints(crawler: ReferenceCrawler, points: number): Record<StatName, number> {
  const spendable = ALL_STATS.filter((stat) => canSpendInto(crawler, stat));
  const spent: Record<StatName, number> = {
    strength: 0,
    intelligence: 0,
    constitution: 0,
    dexterity: 0,
  };
  for (let point = 0; point < points; point++) spent[spendable[point % spendable.length]]++;
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
 * The crawler a player who spreads her points evenly has at `partyLevel`, with
 * no gear, skills, trained spells or consumables.
 */
export function referenceStats(crawler: ReferenceCrawler, partyLevel: number): ReferenceStats {
  const levelsGained = Math.max(0, partyLevel - 1);
  const points = levelsGained * STAT_POINTS_PER_LEVEL;
  const spent = spentPoints(crawler, points);
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

/**
 * The max HP of an on-schedule human crawler at `partyLevel`: the
 * yardstick a blow sized as a share of a crawler's health is measured against.
 * The human rather than the cat because her constitution never grows, so her max HP
 * says nothing about how far into the run the party is.
 */
export function onCurveCrawlerMaxHp(partyLevel: number): number {
  return referenceStats('human', partyLevel).maxHp;
}
