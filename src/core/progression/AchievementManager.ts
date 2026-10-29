import { buildingDisplayName } from '../../map/buildingIds';
import { ABILITY_DEFS } from '../../abilities/abilityDefs';
import { MAGIC_MISSILE_SPARK_LEVEL } from '../../abilities/magicMissile';
import {
  CHEST_SOURCE_TITLES,
  type PresentationOrigin,
  type RewardPresentation,
} from '../../loot/rewardChest';
import { ITEM_DEF, type ItemId } from '../items/defs/ItemDefs';
import { plainLine } from '../util/plainText';
import type { Rarity } from '../items/defs/rarity';
import type { CrawlerKind } from '../skills/SkillManager';
import {
  AI_ACHIEVEMENTS_MAX,
  RECENT_EVENTS_MAX_CAP,
  aiAchievementKey,
  emptyAchievementCounters,
  isAchievementId,
  parseSerializedAchievements,
  type AIAchievementDef,
  type AIAchievementKey,
  type AchievementCounterId,
  type AchievementId,
  type RecentEvent,
  type SerializedAchievements,
  type SerializedOrigin,
  type SerializedPresentation,
} from './achievementSave';

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
  | { readonly kind: 'companion'; readonly id: 'deinonychus'; readonly to: 'cat' };

/** What an achievement pays: a chest of `rarity`, with any `fixed` rewards added on top. */
export interface AchievementReward {
  readonly rarity: Rarity;
  readonly fixed?: ReadonlyArray<FixedReward>;
}

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

/** Either kind of achievement, as the reward screen and the Achievements page take them. */
export type AwardDef = AchievementDef | AIAchievementDef;

export function isAIAchievementDef(def: AwardDef): def is AIAchievementDef {
  return 'awardedBy' in def;
}

/** What a request to award an AI achievement carries. */
export interface AIAchievementGrant {
  readonly title: string;
  readonly description: string;
  readonly rarity: Rarity;
  readonly awardedBy: string;
}

const MAGIC_MISSILE_NAME = ABILITY_DEFS.magic_missile.name;
const STOMP_NAME = ABILITY_DEFS.seismic_stomp.name;

function dungeonKillsDescription(kills: number): string {
  return `The party has killed ${kills} monsters in the dungeon.`;
}

export const ACHIEVEMENT_DEFS: Readonly<Record<AchievementId, AchievementDef>> = {
  first_kill: {
    id: 'first_kill',
    name: 'First Kill',
    description: 'Kill your first monster.',
    playerType: 'both',
    reward: { rarity: 'Common' },
    tutorialReward: [
      { kind: 'item', id: 'seismic_stomp_tome', quantity: 1, to: 'human' },
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
  bartenders_choice: {
    id: 'bartenders_choice',
    name: "Bartender's Choice",
    description: `Drink a ${ITEM_DEF.catnip_tuna_water.name} in ${buildingDisplayName('taloncrest_nightclub')}.`,
    playerType: 'cat',
    reward: {
      rarity: 'Common',
      fixed: [{ kind: 'item', id: 'lucky_penny', quantity: 1, to: 'cat' }],
    },
  },
  entered_dungeon: {
    id: 'entered_dungeon',
    name: 'The chosen one',
    description: 'Become chosen by the world dominating AI to embark on a journey',
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
    playerType: 'both',
    reward: {
      rarity: 'Common',
      fixed: [
        { kind: 'item', id: 'dynamite', quantity: ACHIEVEMENT_DYNAMITE_STICKS },
        { kind: 'item', id: 'hazard_goggles', quantity: 1, to: 'human' },
      ],
    },
  },
  finish_with_a_blow: {
    id: 'finish_with_a_blow',
    name: 'Finish with a blow',
    description: 'Landed the killing blow on a boss with dynamite.',
    playerType: 'both',
    reward: {
      rarity: 'Uncommon',
      fixed: [
        { kind: 'item', id: 'dynamite', quantity: ACHIEVEMENT_DYNAMITE_STICKS },
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
    reward: { rarity: 'Epic', fixed: [{ kind: 'companion', id: 'deinonychus', to: 'cat' }] },
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

/**
 * A stored presentation with its award looked up again and its title read
 * from the current def or chest source; undefined when it names an AI award
 * the record does not hold.
 */
function restoredPresentation(
  saved: SerializedPresentation,
  aiAwards: ReadonlyMap<AIAchievementKey, AIAchievementDef>,
): RewardPresentation | undefined {
  const { origin, crawler, rarity, rewards } = saved;
  if (origin.kind === 'chest') {
    const title = CHEST_SOURCE_TITLES[origin.source];
    return { origin, title, subtitle: saved.subtitle, crawler, rarity, rewards };
  }
  const award = isAchievementId(origin.id) ? ACHIEVEMENT_DEFS[origin.id] : aiAwards.get(origin.id);
  if (award === undefined) return undefined;
  return {
    origin: { kind: 'award', award },
    title: award.name,
    subtitle: award.description,
    crawler,
    rarity,
    rewards,
  };
}

/** Whether `kind` can earn `def` at all. */
export function crawlerCanEarn(def: AchievementDef, kind: CrawlerKind): boolean {
  return def.playerType === 'both' || def.playerType === kind;
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
  private counters = emptyAchievementCounters();

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

  /** Record a significant event (level-up, boss kill, etc.) for Dave's context. */
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
    this.logRecentEvent(`Awarded "${def.name}" by ${grant.awardedBy}`);
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
   * A manager carrying what {@link serialize} wrote, or undefined when `value`
   * is not exactly that: input is unvalidated JSON from storage or the server,
   * and one entry this build does not know fails the whole record.
   */
  static parse(value: unknown): AchievementManager | undefined {
    const saved = parseSerializedAchievements(value);
    if (saved === undefined) return undefined;
    const aiAwardsByKey = new Map(saved.aiAchievements.map((def) => [def.id, def] as const));
    const presentations: RewardPresentation[] = [];
    for (const stored of saved.presentations) {
      const presentation = restoredPresentation(stored, aiAwardsByKey);
      if (presentation === undefined) return undefined;
      presentations.push(presentation);
    }
    const manager = new AchievementManager();
    manager.unlocked = new Set(saved.unlocked);
    manager.aiAwards = aiAwardsByKey;
    manager.presentations = presentations;
    manager.recentEvents = saved.recentEvents;
    manager.menuUnseen = saved.menuUnseen;
    manager.counters = saved.counters;
    return manager;
  }

  /**
   * A manager carrying a record {@link serialize} wrote, or one {@link parse}
   * accepted and re-serialized. `parse` accepts everything `serialize` writes,
   * so this throws only on a hand-built record no save can hold.
   */
  static fromSerialized(saved: SerializedAchievements): AchievementManager {
    const manager = AchievementManager.parse(saved);
    if (manager === undefined) throw new Error('Achievements record failed validation');
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
