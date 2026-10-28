/**
 * What an on-schedule crawler of a given party level looks like, as numbers.
 *
 * Pure and side-effect-free so a fight against a real levelled mob can be
 * priced headlessly without constructing a crawler. Every
 * number comes out of the formulas the crawlers themselves run
 * (`src/core/party/crawlerFormulas.ts`, `computeDodgeChance`, the magic missile's own
 * stat table), so retuning any of them moves the reference with it.
 *
 * Gear, skills, spell levels and consumables are deliberately left out. The
 * enemy curve must be survivable without them; they are what makes a player
 * feel ahead of it.
 */

import { STARTING_STATS, STAT_GAIN_PER_POINT, zeroStats, type StatId } from './stats';
import type { PlayerDamageType } from '../../creatures/Mob';
import { computeDodgeChance } from '../combat/dodge';
import { getMagicMissileStats } from '../../abilities/magicMissile';
import {
  bareClawDamage,
  bareFistDamage,
  CAT_BASE_HP_OFFSET,
  CAT_SWIPE_FRAMES,
  crawlerMaxHp,
  HUMAN_BASE_HP_OFFSET,
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
  readonly stats: Readonly<Record<StatId, number>>;
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

/**
 * The stats an on-curve player spreads her points over, in the order she
 * spends them. The curve every levelled enemy is priced against was fitted to
 * these allocations, so they stay fixed whatever order the stat sheet lists
 * stats in: the human splits his between his blow, his magic, his health and
 * his footwork; the cat puts hers into her claws and her missile.
 */
const ON_CURVE_SPEND_ORDER = {
  human: ['melee', 'magic', 'health', 'evasiveness'],
  cat: ['melee', 'magic'],
} as const satisfies Record<ReferenceCrawler, readonly StatId[]>;

/**
 * Every level-up point spread evenly, in turn, over the crawler's on-curve
 * spend order, so the result at every party level is the allocation a player
 * spending evenly would actually have — never a fractional point.
 */
function spentStats(crawler: ReferenceCrawler, points: number): Record<StatId, number> {
  const order: readonly StatId[] = ON_CURVE_SPEND_ORDER[crawler];
  const spent = zeroStats();
  for (let point = 0; point < points; point++) {
    const stat = order[point % order.length];
    spent[stat] += STAT_GAIN_PER_POINT[stat][crawler];
  }
  return spent;
}

function attackCycleFor(
  crawler: ReferenceCrawler,
  stats: Readonly<Record<StatId, number>>,
): ReferenceAttack[] {
  if (crawler === 'human') {
    return [
      { damage: bareFistDamage(stats.melee), damageType: 'melee', frames: HUMAN_SWING_FRAMES },
    ];
  }
  const spell = getMagicMissileStats(UNTRAINED_SPELL_LEVEL);
  const pressesPerMissile = Math.max(1, Math.ceil(spell.cooldownFrames / CAT_SWIPE_FRAMES));
  const missile: ReferenceAttack = {
    damage: missileDamage(stats.magic, spell.damageMultiplier),
    damageType: 'missile',
    frames: CAT_SWIPE_FRAMES,
  };
  const claw: ReferenceAttack = {
    damage: bareClawDamage(stats.melee),
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
  const spent = spentStats(crawler, points);
  const base = STARTING_STATS[crawler];
  const stats: Record<StatId, number> = {
    health: base.health + spent.health,
    melee: base.melee + spent.melee,
    magic: base.magic + spent.magic,
    evasiveness: base.evasiveness + spent.evasiveness,
    ranged: base.ranged + spent.ranged,
    explosivesHandling: base.explosivesHandling + spent.explosivesHandling,
  };
  const baseHpOffset = crawler === 'human' ? HUMAN_BASE_HP_OFFSET : CAT_BASE_HP_OFFSET;
  return {
    stats,
    maxHp: crawlerMaxHp(baseHpOffset, stats.health),
    dodgeChance: computeDodgeChance(crawler, stats.evasiveness),
    attackCycle: attackCycleFor(crawler, stats),
  };
}

/**
 * The max HP of an on-schedule human crawler at `partyLevel`: the
 * yardstick a blow sized as a share of a crawler's health is measured against.
 * The human rather than the cat because her on-curve allocation leaves her
 * health where it started, so her max HP says nothing about how far into the
 * run the party is.
 */
export function onCurveCrawlerMaxHp(partyLevel: number): number {
  return referenceStats('human', partyLevel).maxHp;
}
