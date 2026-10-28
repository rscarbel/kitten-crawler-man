/**
 * The challenges the AI may set, as data. The model never writes the
 * rules: it picks a template and fills its bounded parameters (how many, what
 * creature, how long), and `AIChallengeSystem` interprets each template's
 * fixed rule set against the floor's events.
 *
 * Fairness: a challenge only ever puts a reward chest at stake. It never stops the
 * crawlers doing anything — drinking a potion during a no-potion challenge
 * just fails it — so the worst a challenge can cost is the reward and a
 * taunt.
 */

import { crawlerName } from '../../characters/characters';
import type { Rarity } from '../../core/items/defs/rarity';

export const CHALLENGE_TEMPLATE_IDS = [
  'slay',
  'slay_untouched',
  'untouched',
  'belle_finishes',
  'no_potion_until_boss',
  'stairwell_dash',
] as const;
export type ChallengeTemplateId = (typeof CHALLENGE_TEMPLATE_IDS)[number];

export const CHALLENGE_MIN_SECONDS = 20;
export const CHALLENGE_MAX_SECONDS = 300;
export const CHALLENGE_DEFAULT_SECONDS = 90;
export const CHALLENGE_MIN_COUNT = 1;
export const CHALLENGE_MAX_COUNT = 8;
export const CHALLENGE_DEFAULT_COUNT = 3;
/** A kill challenge allows at least this long per kill asked for. */
export const CHALLENGE_MIN_SECONDS_PER_KILL = 8;
/**
 * A stairwell dash allows at least this long per tile of straight-line
 * distance: about three times the walk, since corridors wind.
 */
export const STAIRWELL_DASH_SECONDS_PER_TILE = 0.6;
/** Within this many tiles of a stairwell tile counts as reaching it, before its prompt can take the screen. */
export const STAIRWELL_REACH_TILES = 1;
/** The mob filter that matches any hostile. */
export const ANY_MOB = 'any';

/** What a challenge is won by. */
export type ChallengeGoal = 'kills' | 'survive' | 'bossDefeated' | 'stairwell';

/** One template's fixed rules, which the challenge system interprets. */
export interface ChallengeRules {
  readonly goal: ChallengeGoal;
  /** The clock runs out on it; an untimed challenge lasts until its goal or the floor's end. */
  readonly timed: boolean;
  /** `count` and `mob_type` mean something for it. */
  readonly countsKills: boolean;
  /** Whose kills count toward the goal. */
  readonly killer: 'party' | 'cat';
  /** A matching kill by the other crawler fails it; a kill no crawler made (a companion's, a hazard's) never counts. */
  readonly failOnOtherKiller: boolean;
  /** Any HP lost by either crawler fails it. */
  readonly failOnDamage: boolean;
  /** Drinking a healing potion fails it. */
  readonly failOnPotion: boolean;
}

export interface ChallengeTemplate {
  readonly id: ChallengeTemplateId;
  /** For the tool description: what it asks, and which parameters it reads. */
  readonly summary: string;
  readonly rules: ChallengeRules;
}

const KILL_RULES: ChallengeRules = {
  goal: 'kills',
  timed: true,
  countsKills: true,
  killer: 'party',
  failOnOtherKiller: false,
  failOnDamage: false,
  failOnPotion: false,
};

export const CHALLENGE_TEMPLATES: Readonly<Record<ChallengeTemplateId, ChallengeTemplate>> = {
  slay: {
    id: 'slay',
    summary: 'slay: kill `count` of `mob_type` within `seconds`.',
    rules: KILL_RULES,
  },
  slay_untouched: {
    id: 'slay_untouched',
    summary:
      'slay_untouched: kill `count` of `mob_type` within `seconds` without either crawler losing HP.',
    rules: { ...KILL_RULES, failOnDamage: true },
  },
  untouched: {
    id: 'untouched',
    summary: 'untouched: neither crawler loses any HP for `seconds`.',
    rules: { ...KILL_RULES, goal: 'survive', countsKills: false, failOnDamage: true },
  },
  belle_finishes: {
    id: 'belle_finishes',
    summary: `belle_finishes: ${crawlerName('cat')} lands the killing blow on \`count\` of \`mob_type\` within \`seconds\`; a matching kill by ${crawlerName('human')} fails it (companions’ and hazards’ kills do not count either way).`,
    rules: { ...KILL_RULES, killer: 'cat', failOnOtherKiller: true },
  },
  no_potion_until_boss: {
    id: 'no_potion_until_boss',
    summary:
      'no_potion_until_boss: no healing potion until the floor’s boss dies. Untimed; needs a living boss.',
    rules: {
      ...KILL_RULES,
      goal: 'bossDefeated',
      timed: false,
      countsKills: false,
      failOnPotion: true,
    },
  },
  stairwell_dash: {
    id: 'stairwell_dash',
    summary: 'stairwell_dash: reach the floor’s stairwell within `seconds`.',
    rules: { ...KILL_RULES, goal: 'stairwell', countsKills: false },
  },
};

/** A challenge as the AI set it, already validated. */
export interface ChallengeSpec {
  readonly template: ChallengeTemplateId;
  readonly title: string;
  readonly count: number;
  /** A spawn type key, or {@link ANY_MOB}. */
  readonly mobType: string;
  readonly seconds: number;
  readonly rewardRarity: Rarity;
  /** The line the offer card shows; may be empty. */
  readonly pitch: string;
  /** Shown to the player, loudly, when the challenge is failed. */
  readonly taunt: string;
  readonly offeredBy: string;
}

/** What every challenge event says about the challenge it is about. */
export interface ChallengeSummary {
  readonly challengeId: string;
  readonly title: string;
  readonly template: ChallengeTemplateId;
  readonly objective: string;
  readonly rewardRarity: Rarity;
  readonly offeredBy: string;
}

function mobWords(spec: ChallengeSpec): string {
  const plural = spec.count === 1 ? '' : 's';
  if (spec.mobType === ANY_MOB) return spec.count === 1 ? 'an enemy' : `${spec.count} enemies`;
  const name = spec.mobType.replace(/_/g, ' ');
  return spec.count === 1 ? `a ${name}` : `${spec.count} ${name}${plural}`;
}

/** The challenge's objective in one line, as the offer, the band and the events phrase it. */
export function challengeObjective(spec: ChallengeSpec): string {
  const seconds = `${spec.seconds}s`;
  switch (spec.template) {
    case 'slay':
      return `Kill ${mobWords(spec)} within ${seconds}`;
    case 'slay_untouched':
      return `Kill ${mobWords(spec)} within ${seconds} without taking damage`;
    case 'untouched':
      return `Take no damage for ${seconds}`;
    case 'belle_finishes':
      return `Let ${crawlerName('cat')} land the killing blow on ${mobWords(spec)} within ${seconds}`;
    case 'no_potion_until_boss':
      return 'Drink no healing potion until the boss is dead';
    case 'stairwell_dash':
      return `Reach the stairwell within ${seconds}`;
  }
}

/** The shortest a stairwell dash may be from `distanceTiles` away. */
export function minStairwellDashSeconds(distanceTiles: number): number {
  return Math.max(
    CHALLENGE_MIN_SECONDS,
    Math.ceil(distanceTiles * STAIRWELL_DASH_SECONDS_PER_TILE),
  );
}

/** Whether a mob of spawn type `typeKey` counts for a challenge filtered to `mobType`. */
export function mobMatches(mobType: string, typeKey: string | null): boolean {
  return mobType === ANY_MOB || typeKey === mobType;
}
