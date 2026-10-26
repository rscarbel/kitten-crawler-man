import { ABILITY_DEFS } from '../../abilities/abilityDefs';
import { MAGIC_MISSILE_SPARK_LEVEL } from '../../abilities/magicMissile';
import { displayNameOf } from '../../ai/AIChatFeed';
import {
  CHEST_SOURCE_TITLES,
  type ChestSource,
  type GrantedLine,
  type PresentationOrigin,
  type RewardPresentation,
} from '../../loot/rewardChest';
import { ITEM_DEF, isItemId, type ItemId } from '../items/defs/ItemDefs';
import { isRecord } from '../util/guards';
import { plainLine } from '../util/plainText';
import { isRarity, type Rarity } from '../items/defs/rarity';
import type { CrawlerKind } from '../skills/SkillManager';

const RECENT_EVENTS_MAX_CAP = 20;
/** Sticks of dynamite each explosives achievement hands over. */
const ACHIEVEMENT_DYNAMITE_STICKS = 5;
const EVENT_TIMESTAMP_MILLISECONDS_DIVISOR = 1000;
/** Health potions each crawler's first tutorial kill pays. */
export const TUTORIAL_REWARD_POTIONS = 10;
/** Enemies one attack must kill for Wrecking Ball. */
export const MULTIKILL_ACHIEVEMENT_THRESHOLD = 8;
/** Enemies one stick of dynamite must kill for Two Birds, One Stick. */
export const DYNAMITE_MULTIKILL_THRESHOLD = 2;
/** Dungeon kills the party needs for each rung of the kill ladder. */
export const DUNGEON_KILLS_WARMING_UP = 50;
export const DUNGEON_KILLS_SOMETHING_HATCHED = 200;
export const DUNGEON_KILLS_BODY_COUNT = 500;
export const DUNGEON_KILLS_A_THOUSAND_CUTS = 1000;
/** Kills the cat must land on enemies that had not noticed her, for Night Shift. */
export const NIGHT_SHIFT_UNSEEN_KILLS = 15;
/** Kills a crawler's relic must land for Hands-Free. */
export const HANDS_FREE_RELIC_KILLS = 25;
/** Bosses the party must kill unhurt for Not a Scratch. */
const NOT_A_SCRATCH_FLAWLESS_BOSSES = 1;
/**
 * The most AI-authored achievements one crawler keeps. Each floor allows
 * only a few, so a run never reaches it; it bounds what a tampered save can
 * make the game hold.
 */
export const AI_ACHIEVEMENTS_MAX = 200;
export const AI_ACHIEVEMENT_TITLE_MAX_CHARS = 60;
export const AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS = 160;
const AI_ACHIEVEMENT_AWARDER_MAX_CHARS = 40;
/**
 * The most unseen reward presentations one crawler keeps. Each is shown and
 * dropped as soon as the screen is free, so play never reaches it; it bounds
 * what a tampered save can make the game hold.
 */
const PRESENTATIONS_MAX = 100;
const PRESENTATION_TEXT_MAX_CHARS = 200;

export interface RecentEvent {
  label: string;
  timestamp: number;
}

export type AchievementId =
  | 'first_kill'
  | 'boss_slayer'
  | 'up_close'
  | 'safe_haven'
  | 'magic_touch'
  | 'quest_defend_npc'
  | 'disaster_averted'
  | 'out_before_the_fall'
  | 'members_only'
  | 'on_retainer'
  | 'casino_jackpot'
  | 'entourage'
  | 'bartenders_choice'
  | 'down_the_hatch'
  | 'spark_to_flame'
  | 'flat_out'
  | 'wrecking_ball'
  | 'pecking_order'
  | 'two_birds_one_stick'
  | 'finish_with_a_blow'
  | 'dungeon_kills_50'
  | 'dungeon_kills_200'
  | 'dungeon_kills_500'
  | 'dungeon_kills_1000'
  | 'not_a_scratch'
  | 'dressed_for_the_occasion'
  | 'night_shift'
  | 'hands_free';

export type PlayerTarget = CrawlerKind | 'both';

/**
 * Which crawler a fixed reward goes to: one of them by name, or whichever is
 * the active one when it is paid. Absent, it goes to the crawler unlocking.
 */
export type RewardRecipient = CrawlerKind | 'active';

/** Something an achievement always pays, on top of its chest's rolled contents. */
export type FixedReward =
  | {
      readonly kind: 'item';
      readonly id: ItemId;
      readonly quantity: number;
      readonly to?: RewardRecipient;
    }
  | { readonly kind: 'companion'; readonly id: 'mongo'; readonly to: 'cat' };

/** What an achievement pays: a chest of `rarity`, with any `fixed` rewards added on top. */
export interface AchievementReward {
  readonly rarity: Rarity;
  readonly fixed?: ReadonlyArray<FixedReward>;
}

const ACHIEVEMENT_COUNTER_IDS = [
  'dungeonKills',
  'flawlessBossKills',
  'unseenKills',
  'relicKills',
] as const;

/**
 * The tallies the progress achievements count toward. A party counter is kept
 * once, on the human's manager, and read by both crawlers; a crawler counter
 * is kept on each crawler's own.
 */
export type AchievementCounterId = (typeof ACHIEVEMENT_COUNTER_IDS)[number];

export const ACHIEVEMENT_COUNTER_SCOPE: Readonly<
  Record<AchievementCounterId, 'party' | 'crawler'>
> = {
  dungeonKills: 'party',
  flawlessBossKills: 'party',
  unseenKills: 'crawler',
  relicKills: 'crawler',
};

export interface AchievementDef {
  readonly id: AchievementId;
  readonly name: string;
  readonly description: string;
  /** Which crawler(s) can earn this achievement; "both" means each earns their own chest. */
  readonly playerType: PlayerTarget;
  readonly reward: AchievementReward;
  /**
   * What the chest holds instead when the achievement is earned in the
   * tutorial: only these, with no roll, so the tutorial hands over exactly
   * the kit it goes on to teach.
   */
  readonly tutorialReward?: ReadonlyArray<FixedReward>;
  /** The tally this achievement unlocks at, shown as a meter on the Achievements page. */
  readonly progress?: { readonly counter: AchievementCounterId; readonly target: number };
}

/** An AI achievement's identity: its title, folded so that re-wordings of case and spacing match. */
export type AIAchievementKey = `ai:${string}`;

/**
 * An achievement the show's AI wrote on the spot: its own title, description
 * and chest rarity. Kept beside the built-in ones and shown through the same
 * reward screen and Achievements page.
 */
export interface AIAchievementDef {
  readonly id: AIAchievementKey;
  readonly name: string;
  readonly description: string;
  readonly rarity: Rarity;
  /** The character who awarded it. */
  readonly awardedBy: string;
  /** Wall-clock milliseconds of the award. */
  readonly awardedAt: number;
}

/** Either kind of achievement, as the reward screen and the Achievements page take them. */
export type AwardDef = AchievementDef | AIAchievementDef;

export function isAIAchievementDef(def: AwardDef): def is AIAchievementDef {
  return 'awardedBy' in def;
}

/** The key an AI achievement titled `title` is stored and deduplicated under. */
export function aiAchievementKey(title: string): AIAchievementKey {
  return `ai:${plainLine(title).toLowerCase()}`;
}

function isAIAchievementKey(value: unknown): value is AIAchievementKey {
  return typeof value === 'string' && value.startsWith('ai:');
}

/** What a request to award an AI achievement carries. */
export interface AIAchievementGrant {
  readonly title: string;
  readonly description: string;
  readonly rarity: Rarity;
  readonly awardedBy: string;
}

const MAGIC_MISSILE_NAME = ABILITY_DEFS.magic_missile.name;
const STOMP_NAME = ABILITY_DEFS.smush.name;

function dungeonKillsDescription(kills: number): string {
  return `The party has killed ${kills} monsters in the dungeon.`;
}

export const ACHIEVEMENT_DEFS: Readonly<Record<AchievementId, AchievementDef>> = {
  first_kill: {
    id: 'first_kill',
    name: 'Off the Mark',
    description: 'Kill your first monster.',
    playerType: 'both',
    reward: { rarity: 'Common' },
    tutorialReward: [
      { kind: 'item', id: 'smush_tome', quantity: 1, to: 'human' },
      { kind: 'item', id: 'health_potion', quantity: TUTORIAL_REWARD_POTIONS, to: 'human' },
      { kind: 'item', id: 'lucky_hoodie', quantity: 1, to: 'human' },
      { kind: 'item', id: 'health_potion', quantity: TUTORIAL_REWARD_POTIONS, to: 'cat' },
    ],
  },
  boss_slayer: {
    id: 'boss_slayer',
    name: 'Boss Slayer',
    description: 'Vanquish a dungeon boss.',
    playerType: 'both',
    reward: { rarity: 'Common' },
  },
  up_close: {
    id: 'up_close',
    name: 'Up Close and Personal',
    description: 'Kill an enemy in melee.',
    playerType: 'human',
    reward: { rarity: 'Common' },
  },
  safe_haven: {
    id: 'safe_haven',
    name: 'Safe Haven',
    description: 'Find and enter the safe room.',
    playerType: 'both',
    reward: { rarity: 'Common' },
  },
  magic_touch: {
    id: 'magic_touch',
    name: 'Magic Touch',
    description: `Eliminate an enemy with ${MAGIC_MISSILE_NAME}.`,
    playerType: 'cat',
    reward: { rarity: 'Common' },
  },
  quest_defend_npc: {
    id: 'quest_defend_npc',
    name: 'Guardian Angel',
    description: 'Successfully defend the Goblin Mother and reunite her with her child.',
    playerType: 'both',
    reward: {
      rarity: 'Uncommon',
      fixed: [
        { kind: 'item', id: 'sun_locket', quantity: 1, to: 'human' },
        { kind: 'item', id: 'moon_locket', quantity: 1, to: 'cat' },
      ],
    },
  },
  disaster_averted: {
    id: 'disaster_averted',
    name: 'Disaster Averted',
    description: 'Stop the catastrophe before it levels the city.',
    playerType: 'both',
    reward: {
      rarity: 'Rare',
      fixed: [{ kind: 'item', id: 'hourglass_charm', quantity: 1, to: 'cat' }],
    },
  },
  out_before_the_fall: {
    id: 'out_before_the_fall',
    name: 'Out Before the Fall',
    description: 'Escape the city before the countdown runs out.',
    playerType: 'both',
    reward: { rarity: 'Legendary' },
  },
  members_only: {
    id: 'members_only',
    name: 'Members Only',
    description: 'Earn a membership to the club.',
    playerType: 'both',
    reward: { rarity: 'Common' },
  },
  on_retainer: {
    id: 'on_retainer',
    name: 'On Retainer',
    description: 'Sign your first mercenary contract.',
    playerType: 'both',
    reward: { rarity: 'Uncommon' },
  },
  casino_jackpot: {
    id: 'casino_jackpot',
    name: 'High Roller',
    description: 'Hit a natural blackjack on the top-tier table.',
    playerType: 'both',
    reward: {
      rarity: 'Uncommon',
      fixed: [{ kind: 'item', id: 'gilded_monocle', quantity: 1, to: 'active' }],
    },
  },
  entourage: {
    id: 'entourage',
    name: 'Entourage',
    description: 'Hire a pair of bodyguards to follow you around the club.',
    playerType: 'both',
    reward: { rarity: 'Common' },
  },
  bartenders_choice: {
    id: 'bartenders_choice',
    name: "Bartender's Choice",
    description: `Drink a ${ITEM_DEF.dirty_shirley.name} at the club bar.`,
    playerType: 'both',
    reward: {
      rarity: 'Common',
      fixed: [{ kind: 'item', id: 'lucky_penny', quantity: 1, to: 'active' }],
    },
  },
  down_the_hatch: {
    id: 'down_the_hatch',
    name: 'Down the Hatch',
    description: 'Descend into the dungeon for the first time.',
    playerType: 'both',
    reward: {
      rarity: 'Common',
      fixed: [
        { kind: 'item', id: 'scrappers_wraps', quantity: 1, to: 'human' },
        { kind: 'item', id: 'velvet_harness', quantity: 1, to: 'cat' },
      ],
    },
  },
  spark_to_flame: {
    id: 'spark_to_flame',
    name: 'Spark to Flame',
    description: `Raise ${MAGIC_MISSILE_NAME} to level ${MAGIC_MISSILE_SPARK_LEVEL}.`,
    playerType: 'cat',
    reward: { rarity: 'Uncommon', fixed: [{ kind: 'item', id: 'stargazers_cap', quantity: 1 }] },
  },
  flat_out: {
    id: 'flat_out',
    name: 'Flat Out',
    description: `Kill a goblin with ${STOMP_NAME}.`,
    playerType: 'human',
    reward: { rarity: 'Common', fixed: [{ kind: 'item', id: 'hobnail_boots', quantity: 1 }] },
  },
  wrecking_ball: {
    id: 'wrecking_ball',
    name: 'Wrecking Ball',
    description: `Kill ${MULTIKILL_ACHIEVEMENT_THRESHOLD} enemies with a single attack.`,
    playerType: 'human',
    reward: { rarity: 'Uncommon', fixed: [{ kind: 'item', id: 'riot_kneeguards', quantity: 1 }] },
  },
  pecking_order: {
    id: 'pecking_order',
    name: 'Pecking Order',
    description: 'Defeat Big Rooster and every bird in his flock.',
    playerType: 'human',
    reward: {
      rarity: 'Uncommon',
      fixed: [{ kind: 'item', id: 'iron_knuckle_gauntlet', quantity: 1 }],
    },
  },
  two_birds_one_stick: {
    id: 'two_birds_one_stick',
    name: 'Two Birds, One Stick',
    description: `Kill ${DYNAMITE_MULTIKILL_THRESHOLD} or more enemies with one stick of dynamite.`,
    playerType: 'human',
    reward: {
      rarity: 'Common',
      fixed: [
        { kind: 'item', id: 'goblin_dynamite', quantity: ACHIEVEMENT_DYNAMITE_STICKS },
        { kind: 'item', id: 'hazard_goggles', quantity: 1 },
      ],
    },
  },
  finish_with_a_blow: {
    id: 'finish_with_a_blow',
    name: 'Finish with a blow',
    description: 'Landed the killing blow on a boss with dynamite.',
    playerType: 'human',
    reward: {
      rarity: 'Uncommon',
      fixed: [
        { kind: 'item', id: 'goblin_dynamite', quantity: ACHIEVEMENT_DYNAMITE_STICKS },
        { kind: 'item', id: 'explosives_handling_tome', quantity: 1 },
      ],
    },
  },
  dungeon_kills_50: {
    id: 'dungeon_kills_50',
    name: 'Warming Up',
    description: dungeonKillsDescription(DUNGEON_KILLS_WARMING_UP),
    playerType: 'both',
    reward: { rarity: 'Uncommon' },
    progress: { counter: 'dungeonKills', target: DUNGEON_KILLS_WARMING_UP },
  },
  dungeon_kills_200: {
    id: 'dungeon_kills_200',
    name: 'Something Hatched',
    description: dungeonKillsDescription(DUNGEON_KILLS_SOMETHING_HATCHED),
    playerType: 'both',
    reward: { rarity: 'Epic', fixed: [{ kind: 'companion', id: 'mongo', to: 'cat' }] },
    progress: { counter: 'dungeonKills', target: DUNGEON_KILLS_SOMETHING_HATCHED },
  },
  dungeon_kills_500: {
    id: 'dungeon_kills_500',
    name: 'Body Count',
    description: dungeonKillsDescription(DUNGEON_KILLS_BODY_COUNT),
    playerType: 'both',
    reward: {
      rarity: 'Epic',
      fixed: [{ kind: 'item', id: 'sunsteel_talons', quantity: 1, to: 'cat' }],
    },
    progress: { counter: 'dungeonKills', target: DUNGEON_KILLS_BODY_COUNT },
  },
  dungeon_kills_1000: {
    id: 'dungeon_kills_1000',
    name: 'A Thousand Cuts',
    description: dungeonKillsDescription(DUNGEON_KILLS_A_THOUSAND_CUTS),
    playerType: 'both',
    reward: {
      rarity: 'Legendary',
      fixed: [{ kind: 'item', id: 'the_last_word', quantity: 1, to: 'human' }],
    },
    progress: { counter: 'dungeonKills', target: DUNGEON_KILLS_A_THOUSAND_CUTS },
  },
  not_a_scratch: {
    id: 'not_a_scratch',
    name: 'Not a Scratch',
    description:
      'Kill a boss without either crawler taking any damage from the moment the fight starts.',
    playerType: 'both',
    reward: {
      rarity: 'Epic',
      fixed: [{ kind: 'item', id: 'halo_of_the_ninth_life', quantity: 1, to: 'cat' }],
    },
    progress: { counter: 'flawlessBossKills', target: NOT_A_SCRATCH_FLAWLESS_BOSSES },
  },
  dressed_for_the_occasion: {
    id: 'dressed_for_the_occasion',
    name: 'Dressed for the Occasion',
    description: 'Complete a gear set.',
    playerType: 'both',
    reward: { rarity: 'Rare' },
  },
  night_shift: {
    id: 'night_shift',
    name: 'Night Shift',
    description: `Kill ${NIGHT_SHIFT_UNSEEN_KILLS} enemies that had not noticed you.`,
    playerType: 'cat',
    reward: { rarity: 'Rare', fixed: [{ kind: 'item', id: 'prowler_hood', quantity: 1 }] },
    progress: { counter: 'unseenKills', target: NIGHT_SHIFT_UNSEEN_KILLS },
  },
  hands_free: {
    id: 'hands_free',
    name: 'Hands-Free',
    description: `Land ${HANDS_FREE_RELIC_KILLS} kills with a relic.`,
    playerType: 'both',
    reward: { rarity: 'Epic' },
    progress: { counter: 'relicKills', target: HANDS_FREE_RELIC_KILLS },
  },
};

export function isAchievementId(s: string): s is AchievementId {
  return s in ACHIEVEMENT_DEFS;
}

function isAchievementIdValue(value: unknown): value is AchievementId {
  return typeof value === 'string' && isAchievementId(value);
}

/** Whether `kind` can earn `def` at all. */
export function crawlerCanEarn(def: AchievementDef, kind: CrawlerKind): boolean {
  return def.playerType === 'both' || def.playerType === kind;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCrawlerKind(value: unknown): value is CrawlerKind {
  return value === 'human' || value === 'cat';
}

/** Read off the complete title record, so every source a chest can have is accepted on load. */
function isChestSource(value: unknown): value is ChestSource {
  return typeof value === 'string' && Object.keys(CHEST_SOURCE_TITLES).includes(value);
}

function parseRecentEvent(value: unknown): RecentEvent | undefined {
  if (!isRecord(value)) return undefined;
  const { label, timestamp } = value;
  if (typeof label !== 'string' || !isFiniteNumber(timestamp)) return undefined;
  return { label, timestamp };
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = plainLine(value);
  if (line.length === 0 || line.length > maxChars) return undefined;
  return line;
}

function parseAIAchievement(value: unknown): AIAchievementDef | undefined {
  if (!isRecord(value)) return undefined;
  const name = boundedText(value.name, AI_ACHIEVEMENT_TITLE_MAX_CHARS);
  const description = boundedText(value.description, AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS);
  const awardedBy = boundedText(value.awardedBy, AI_ACHIEVEMENT_AWARDER_MAX_CHARS);
  const { rarity, awardedAt } = value;
  if (name === undefined || description === undefined || awardedBy === undefined) return undefined;
  if (!isRarity(rarity)) return undefined;
  return {
    id: aiAchievementKey(name),
    name,
    description,
    rarity,
    awardedBy,
    awardedAt: isFiniteNumber(awardedAt) ? awardedAt : 0,
  };
}

function wholeCount(value: unknown): number | undefined {
  if (!isFiniteNumber(value) || value < 1) return undefined;
  return Math.floor(value);
}

function parseGrantedLine(value: unknown): GrantedLine | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, id } = value;
  if (kind === 'coins') {
    const amount = wholeCount(value.amount);
    return amount === undefined ? undefined : { kind, amount };
  }
  if (kind === 'companion') return id === 'mongo' ? { kind, id } : undefined;
  if (typeof id !== 'string' || !isItemId(id)) return undefined;
  if (kind === 'item') {
    const quantity = wholeCount(value.quantity);
    return quantity === undefined ? undefined : { kind, id, quantity };
  }
  if (kind === 'duplicate') {
    const coins = wholeCount(value.coins);
    return coins === undefined ? undefined : { kind, id, coins };
  }
  return undefined;
}

/** Where a saved presentation came from: an award by id, or a chest by its source. */
type SerializedOrigin =
  | { readonly kind: 'award'; readonly id: AchievementId | AIAchievementKey }
  | { readonly kind: 'chest'; readonly source: ChestSource };

/**
 * A presentation as a save stores it. The award is kept by id, and its title
 * and subtitle are read back from the def on load, so a reworded achievement
 * shows its current text; a chest no achievement earned keeps its source's
 * current title and the subtitle it was given.
 */
interface SerializedPresentation {
  readonly origin: SerializedOrigin;
  readonly title: string;
  readonly subtitle: string;
  readonly crawler: CrawlerKind;
  readonly rarity: Rarity;
  readonly rewards: readonly GrantedLine[];
}

function serializeOrigin(origin: PresentationOrigin): SerializedOrigin {
  return origin.kind === 'award'
    ? { kind: 'award', id: origin.award.id }
    : { kind: 'chest', source: origin.source };
}

function serializePresentation(presentation: RewardPresentation): SerializedPresentation {
  return {
    origin: serializeOrigin(presentation.origin),
    title: presentation.title,
    subtitle: presentation.subtitle,
    crawler: presentation.crawler,
    rarity: presentation.rarity,
    rewards: presentation.rewards.map((line) => ({ ...line })),
  };
}

function textOrEmpty(value: unknown): string | undefined {
  if (value === '') return '';
  return boundedText(value, PRESENTATION_TEXT_MAX_CHARS);
}

/** A saved origin read back, the award looked up again; undefined for one no longer known. */
function parseOrigin(
  value: unknown,
  aiAwards: ReadonlyMap<AIAchievementKey, AIAchievementDef>,
): PresentationOrigin | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'chest') {
    return isChestSource(value.source) ? { kind: 'chest', source: value.source } : undefined;
  }
  if (value.kind !== 'award') return undefined;
  const { id } = value;
  if (isAchievementIdValue(id)) return { kind: 'award', award: ACHIEVEMENT_DEFS[id] };
  if (!isAIAchievementKey(id)) return undefined;
  const award = aiAwards.get(id);
  return award === undefined ? undefined : { kind: 'award', award };
}

function parsePresentation(
  value: unknown,
  aiAwards: ReadonlyMap<AIAchievementKey, AIAchievementDef>,
): RewardPresentation | undefined {
  if (!isRecord(value)) return undefined;
  const { crawler, rarity } = value;
  const subtitle = textOrEmpty(value.subtitle);
  if (subtitle === undefined) return undefined;
  if (!isCrawlerKind(crawler) || !isRarity(rarity)) return undefined;
  const origin = parseOrigin(value.origin, aiAwards);
  if (origin === undefined) return undefined;
  const rewards = arrayOrEmpty(value.rewards)
    .map(parseGrantedLine)
    .filter((line) => line !== undefined);
  if (origin.kind === 'award') {
    const { award } = origin;
    return { origin, title: award.name, subtitle: award.description, crawler, rarity, rewards };
  }
  const title = CHEST_SOURCE_TITLES[origin.source];
  return { origin, title, subtitle, crawler, rarity, rewards };
}

function emptyCounters(): Record<AchievementCounterId, number> {
  return { dungeonKills: 0, flawlessBossKills: 0, unseenKills: 0, relicKills: 0 };
}

function parseCounters(value: unknown): Record<AchievementCounterId, number> {
  const counters = emptyCounters();
  if (!isRecord(value)) return counters;
  for (const id of ACHIEVEMENT_COUNTER_IDS) {
    const count = value[id];
    if (isFiniteNumber(count)) counters[id] = Math.max(0, Math.floor(count));
  }
  return counters;
}

/**
 * One crawler's achievements as a save stores them. The unseen reward
 * presentations are kept, so a save made just after an award still shows it;
 * everything in them is already paid.
 */
export interface SerializedAchievements {
  unlocked: AchievementId[];
  presentations: SerializedPresentation[];
  recentEvents: RecentEvent[];
  menuUnseen: number;
  counters: Record<AchievementCounterId, number>;
  aiAchievements: AIAchievementDef[];
}

export class AchievementManager {
  private unlocked = new Set<AchievementId>();
  /** The AI's achievements by key, in the order they were awarded. */
  private aiAwards = new Map<AIAchievementKey, AIAchievementDef>();
  /** Paid awards the reward screen has not shown yet, oldest first. */
  private presentations: RewardPresentation[] = [];
  /** Rolling log of recent significant events (capped at 20, newest first). */
  private recentEvents: RecentEvent[] = [];
  private menuUnseen = 0;
  private counters = emptyCounters();

  /** Paid awards waiting for the reward screen. */
  get presentationCount(): number {
    return this.presentations.length;
  }

  /** Puts a paid award at the back of the reward screen's queue. */
  queuePresentation(presentation: RewardPresentation): void {
    this.presentations.push(presentation);
  }

  /** The award the reward screen shows next, left in the queue. */
  peekPresentation(): RewardPresentation | null {
    return this.presentations[0] ?? null;
  }

  /** The award the reward screen shows next, taken off the queue. */
  takePresentation(): RewardPresentation | null {
    return this.presentations.shift() ?? null;
  }

  /**
   * Achievements unlocked since the player last opened the Achievements tab:
   * the pause menu's badge, which reading the tab clears.
   */
  get menuUnseenCount(): number {
    return this.menuUnseen;
  }

  /** Zero the pause-menu badge (call when the player opens the Achievements tab). */
  markMenuSeen(): void {
    this.menuUnseen = 0;
  }

  /**
   * Marks an achievement unlocked and returns its def, or null when it was
   * already unlocked (each achievement is one-time). Records only: the
   * scene's `AchievementAwards` pays it, so unlocks go through that.
   */
  recordUnlock(id: AchievementId): AchievementDef | null {
    if (this.unlocked.has(id)) return null;
    this.unlocked.add(id);
    const def = ACHIEVEMENT_DEFS[id];
    this.menuUnseen++;
    this.logRecentEvent(`Unlocked "${def.name}"`);
    return def;
  }

  /** The tally `counter` holds on this manager. */
  counter(id: AchievementCounterId): number {
    return this.counters[id];
  }

  /** Adds one to `counter` and returns the new tally. */
  advanceCounter(id: AchievementCounterId): number {
    this.counters[id] += 1;
    return this.counters[id];
  }

  /** Record a significant event (level-up, boss kill, etc.) for Mordecai's context. */
  logRecentEvent(label: string): void {
    this.recentEvents.unshift({ label, timestamp: Date.now() });
    if (this.recentEvents.length > RECENT_EVENTS_MAX_CAP) this.recentEvents.pop();
  }

  /** Return the N most recent events with elapsed time in seconds. */
  getTopRecentEvents(n: number): Array<{ label: string; secondsAgo: number }> {
    const now = Date.now();
    return this.recentEvents.slice(0, n).map((e) => ({
      label: e.label,
      secondsAgo: Math.floor((now - e.timestamp) / EVENT_TIMESTAMP_MILLISECONDS_DIVISOR),
    }));
  }

  isUnlocked(id: AchievementId): boolean {
    return this.unlocked.has(id);
  }

  /** Whether an AI achievement with this title (ignoring case and spacing) is already held. */
  hasAIAchievement(title: string): boolean {
    return this.aiAwards.has(aiAchievementKey(title));
  }

  /** The AI's achievements, oldest first. */
  aiAchievements(): readonly AIAchievementDef[] {
    return [...this.aiAwards.values()];
  }

  /**
   * Files an achievement the AI wrote and returns it. Null when this crawler
   * already holds one by that title, or holds as many as
   * {@link AI_ACHIEVEMENTS_MAX}. Records only: `AchievementAwards` pays it.
   */
  recordAIAchievement(grant: AIAchievementGrant): AIAchievementDef | null {
    const id = aiAchievementKey(grant.title);
    if (this.aiAwards.has(id) || this.aiAwards.size >= AI_ACHIEVEMENTS_MAX) return null;
    const def: AIAchievementDef = {
      id,
      name: plainLine(grant.title),
      description: plainLine(grant.description),
      rarity: grant.rarity,
      awardedBy: grant.awardedBy,
      awardedAt: Date.now(),
    };
    this.aiAwards.set(id, def);
    this.menuUnseen++;
    this.logRecentEvent(`Awarded "${def.name}" by ${displayNameOf(grant.awardedBy)}`);
    return def;
  }

  /** Returns all achievement defs paired with their unlock status, in definition order. */
  getAllAchievements(): Array<{ def: AchievementDef; unlocked: boolean }> {
    return Object.keys(ACHIEVEMENT_DEFS)
      .filter(isAchievementId)
      .map((id) => ({
        def: ACHIEVEMENT_DEFS[id],
        unlocked: this.unlocked.has(id),
      }));
  }

  /** Return a deep clone of this manager (used to snapshot state at floor entry). */
  clone(): AchievementManager {
    const copy = new AchievementManager();
    copy.restoreFrom(this);
    return copy;
  }

  serialize(): SerializedAchievements {
    return {
      unlocked: [...this.unlocked],
      presentations: this.presentations.map(serializePresentation),
      recentEvents: this.recentEvents.map((event) => ({ ...event })),
      menuUnseen: this.menuUnseen,
      counters: { ...this.counters },
      aiAchievements: [...this.aiAwards.values()].map((def) => ({ ...def })),
    };
  }

  /**
   * A manager carrying what {@link serialize} wrote, or a fresh one when the
   * save has none. The input is unvalidated JSON from storage or the server, so
   * every entry is re-screened: one naming an achievement this build no longer
   * has is dropped rather than failing the whole restore.
   */
  static fromSerialized(value: unknown): AchievementManager {
    const manager = new AchievementManager();
    if (!isRecord(value)) return manager;
    manager.unlocked = new Set(arrayOrEmpty(value.unlocked).filter(isAchievementIdValue));
    const aiAwards = arrayOrEmpty(value.aiAchievements)
      .map(parseAIAchievement)
      .filter((def) => def !== undefined)
      .slice(0, AI_ACHIEVEMENTS_MAX);
    manager.aiAwards = new Map(aiAwards.map((def) => [def.id, def] as const));
    manager.presentations = arrayOrEmpty(value.presentations)
      .map((entry) => parsePresentation(entry, manager.aiAwards))
      .filter((presentation) => presentation !== undefined)
      .slice(0, PRESENTATIONS_MAX);
    manager.recentEvents = arrayOrEmpty(value.recentEvents)
      .map(parseRecentEvent)
      .filter((event) => event !== undefined)
      .slice(0, RECENT_EVENTS_MAX_CAP);
    manager.menuUnseen = isFiniteNumber(value.menuUnseen) ? Math.max(0, value.menuUnseen) : 0;
    manager.counters = parseCounters(value.counters);
    return manager;
  }

  /**
   * Overwrite this manager's state in place from a clone (e.g. rewinding to a
   * checkpoint). In place rather than swapping the reference, because other
   * systems (`AchievementUISystem`) hold this exact instance.
   */
  restoreFrom(other: AchievementManager): void {
    this.unlocked = new Set(other.unlocked);
    this.aiAwards = new Map([...other.aiAwards].map(([key, def]) => [key, { ...def }] as const));
    this.presentations = [...other.presentations];
    this.recentEvents = other.recentEvents.map((e) => ({ ...e }));
    this.menuUnseen = other.menuUnseen;
    this.counters = { ...other.counters };
  }
}

/** Both crawlers' achievement managers, as a reader of party-wide progress needs them. */
export interface PartyAchievements {
  readonly human: AchievementManager;
  readonly cat: AchievementManager;
}

/** The manager that keeps `counter` for `crawler`: the human's for a party tally. */
export function counterKeeper(
  party: PartyAchievements,
  crawler: CrawlerKind,
  counter: AchievementCounterId,
): AchievementManager {
  return ACHIEVEMENT_COUNTER_SCOPE[counter] === 'party' ? party.human : party[crawler];
}

/**
 * How far `crawler` is toward a progress achievement, for its meter on the
 * Achievements page; null for one that has no tally. `current` is capped at
 * `target`, so an unlocked achievement reads full.
 */
export function achievementProgress(
  party: PartyAchievements,
  crawler: CrawlerKind,
  id: AchievementId,
): { readonly current: number; readonly target: number } | null {
  const progress = ACHIEVEMENT_DEFS[id].progress;
  if (progress === undefined) return null;
  const tally = counterKeeper(party, crawler, progress.counter).counter(progress.counter);
  return { current: Math.min(tally, progress.target), target: progress.target };
}
