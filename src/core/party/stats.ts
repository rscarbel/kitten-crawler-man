/**
 * The crawlers' stat sheet as data: which stats exist, what each is called,
 * what one level-up point buys each crawler, and where each crawler starts.
 *
 * Every table here is a `Record` over {@link StatId}, so a stat cannot be added
 * without every crawler, label and gain being decided for it.
 */

import { crawlerDisplayName } from '../../characters/characters';
import { ITEM_DEF, wearerAllows } from '../items/defs/ItemDefs';
import type { WeaponDelivery } from '../items/equipment/weapons';
import type { CrawlerKind } from '../skills/SkillManager';
import { DODGE_SOFT_LIMIT } from '../combat/dodge';
import {
  DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL,
  HEALTH_HP_PER_POINT,
  MIN_STAT_VALUE,
  RANGED_RANGE_PER_POINT_TILES,
} from './crawlerFormulas';

/** Every stat a crawler carries, in the order every stat list shows them. */
export const ALL_STATS = [
  'health',
  'melee',
  'magic',
  'evasiveness',
  'ranged',
  'explosivesHandling',
] as const;
export type StatId = (typeof ALL_STATS)[number];

/**
 * What one banked level-up point adds to a stat, per crawler. The human is the
 * sturdier of the two and Belle the harder to hit, so health and evasiveness
 * grow at different rates for each.
 */
export const STAT_GAIN_PER_POINT = {
  health: { human: 2, cat: 1 },
  melee: { human: 1, cat: 1 },
  magic: { human: 1, cat: 1 },
  evasiveness: { human: 1, cat: 2 },
  ranged: { human: 1, cat: 1 },
  explosivesHandling: { human: 1, cat: 1 },
} as const satisfies Record<StatId, Record<CrawlerKind, number>>;

/**
 * Each crawler's stats on a fresh run. Chosen so starting max HP, damage and
 * dodge match what each crawler has always started with: the human 10 HP and about a
 * 10% dodge, Belle 6 HP and about a 28% dodge.
 */
export const STARTING_STATS = {
  human: {
    health: 2,
    melee: MIN_STAT_VALUE,
    magic: MIN_STAT_VALUE,
    evasiveness: 8,
    ranged: MIN_STAT_VALUE,
    explosivesHandling: MIN_STAT_VALUE,
  },
  cat: {
    health: 2,
    melee: MIN_STAT_VALUE,
    magic: MIN_STAT_VALUE,
    evasiveness: 19,
    ranged: MIN_STAT_VALUE,
    explosivesHandling: MIN_STAT_VALUE,
  },
} as const satisfies Record<CrawlerKind, Record<StatId, number>>;

/** The stat each way of dealing damage grows with. */
export const DELIVERY_STAT = {
  melee: 'melee',
  claw: 'melee',
  sling: 'ranged',
  spell: 'magic',
  thrownExplosive: 'explosivesHandling',
} as const satisfies Record<WeaponDelivery, StatId>;

/** Whether `crawler` can wield any weapon that grows with `stat`. */
function wieldsWeaponScalingWith(crawler: CrawlerKind, stat: StatId): boolean {
  return Object.values(ITEM_DEF).some((def) => {
    if (def.weapon === undefined) return false;
    return wearerAllows(def.wearer, crawler) && DELIVERY_STAT[def.weapon.delivery] === stat;
  });
}

const PERCENT = 100;

function perPoint(gain: number, what: string): string {
  return `+${gain} ${what} per point.`;
}

/** Everything the stat sheet shows about one stat. */
export interface StatDef {
  readonly label: string;
  /** Short code the level-up flash and the stat pills use. */
  readonly code: string;
  readonly description: string;
  /** What one point does for `crawler`, worked out from the live rules. */
  readonly effectLine: (crawler: CrawlerKind) => string;
}

export const STAT_DEFS = {
  health: {
    label: 'Health',
    code: 'HLT',
    description: 'Toughen up.',
    effectLine: (crawler) =>
      perPoint(STAT_GAIN_PER_POINT.health[crawler] * HEALTH_HP_PER_POINT, 'maximum HP'),
  },
  melee: {
    label: 'Melee',
    code: 'MEL',
    description: 'Hit harder up close.',
    effectLine: (crawler) =>
      perPoint(
        STAT_GAIN_PER_POINT.melee[crawler],
        crawler === 'human' ? 'damage to punches, weapons and stomps' : 'damage to claw swipes',
      ),
  },
  magic: {
    label: 'Magic',
    code: 'MAG',
    description: 'Think bigger.',
    effectLine: (crawler) =>
      `${perPoint(STAT_GAIN_PER_POINT.magic[crawler], 'Magic')} Stronger spells, and magic-resistant gear resists more.`,
  },
  evasiveness: {
    label: 'Evasiveness',
    code: 'EVA',
    description: 'Stay untouched.',
    effectLine: (crawler) =>
      `${perPoint(STAT_GAIN_PER_POINT.evasiveness[crawler], 'Evasiveness')} Dodge chance climbs toward ${Math.round(DODGE_SOFT_LIMIT[crawler] * PERCENT)}%.`,
  },
  ranged: {
    label: 'Ranged',
    code: 'RNG',
    description: 'Aim true.',
    effectLine: (crawler) =>
      wieldsWeaponScalingWith(crawler, 'ranged')
        ? `${perPoint(STAT_GAIN_PER_POINT.ranged[crawler], 'Ranged')} Sling stones hit harder and fly +${RANGED_RANGE_PER_POINT_TILES} tiles further.`
        : `${crawlerDisplayName(crawler)} has no ranged weapon yet.`,
  },
  explosivesHandling: {
    label: 'Explosives Handling',
    code: 'EXP',
    description: 'Bigger booms.',
    effectLine: (crawler) =>
      `${perPoint(STAT_GAIN_PER_POINT.explosivesHandling[crawler], 'Explosives Handling')} +${Math.round(DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL * PERCENT)}% blast damage to enemies and a longer throw each.`,
  },
} as const satisfies Record<StatId, StatDef>;

/** A full stat sheet with every stat at zero, for sums that start from nothing. */
export function zeroStats(): Record<StatId, number> {
  return {
    health: 0,
    melee: 0,
    magic: 0,
    evasiveness: 0,
    ranged: 0,
    explosivesHandling: 0,
  };
}
