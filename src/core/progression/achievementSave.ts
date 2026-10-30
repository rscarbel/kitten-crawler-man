/**
 * One crawler's achievements as a save stores them, and the check that a
 * stored record is one this build writes. Ids and plain values only: the
 * achievements' names, rewards and the manager that pays them are
 * `AchievementManager.ts`, which builds on what this accepts.
 */

import { isItemId, type ItemId } from '../items/defs/ItemDefs';
import { isRarity, type Rarity } from '../items/defs/rarity';
import type { CrawlerKind } from '../skills/SkillManager';
import { isFiniteNumber, isRecord, parseEvery } from '../util/guards';
import { plainLine } from '../util/plainText';

const ACHIEVEMENT_IDS = [
  'first_kill',
  'boss_slayer',
  'up_close',
  'safe_haven',
  'magic_touch',
  'quest_defend_npc',
  'on_retainer',
  'casino_jackpot',
  'bartenders_choice',
  'entered_dungeon',
  'spark_to_flame',
  'flat_out',
  'wrecking_ball',
  'pecking_order',
  'two_birds_one_stick',
  'finish_with_a_blow',
  'dungeon_kills_50',
  'dungeon_kills_200',
  'dungeon_kills_500',
  'dungeon_kills_1000',
  'not_a_scratch',
  'dressed_for_the_occasion',
  'night_shift',
  'hands_free',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export function isAchievementId(s: string): s is AchievementId {
  return ACHIEVEMENT_IDS.some((id) => id === s);
}

function isAchievementIdValue(value: unknown): value is AchievementId {
  return typeof value === 'string' && isAchievementId(value);
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

/** The most recent events one crawler's log keeps. */
export const RECENT_EVENTS_MAX_CAP = 20;

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
 * The longest title or subtitle a saved reward presentation may hold: above
 * every achievement's and AI award's own, and a bound on what a tampered save
 * can make the game keep.
 */
const PRESENTATION_TEXT_MAX_CHARS = 200;

/**
 * The longest recent-event label a save may hold: above every label the game
 * writes (an AI award's title and awarder included), and a bound on what a
 * tampered save can make the game keep and hand to the AI.
 */
const RECENT_EVENT_LABEL_MAX_CHARS = 200;

export interface RecentEvent {
  label: string;
  timestamp: number;
}

/** An AI achievement's identity: its title, folded so that re-wordings of case and spacing match. */
export type AIAchievementKey = `ai:${string}`;

/**
 * An achievement the AI wrote on the spot: its own title, description
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

/** The key an AI achievement titled `title` is stored and deduplicated under. */
export function aiAchievementKey(title: string): AIAchievementKey {
  return `ai:${plainLine(title).toLowerCase()}`;
}

function isAIAchievementKey(value: unknown): value is AIAchievementKey {
  return typeof value === 'string' && value.startsWith('ai:');
}

/**
 * One thing an award has already put into a crawler's bag or purse. The
 * reward screen only pictures these; it never grants anything itself.
 */
export type GrantedLine =
  | { readonly kind: 'item'; readonly id: ItemId; readonly quantity: number }
  | { readonly kind: 'coins'; readonly amount: number }
  | { readonly kind: 'companion'; readonly id: 'deinonychus' }
  /** A rolled piece of gear the party already owned, paid out at its sell price. */
  | { readonly kind: 'duplicate'; readonly id: ItemId; readonly coins: number };

/** Where a chest that is not an achievement can come from, each named on its header. */
const CHEST_SOURCES = ['caroline', 'challenge', 'wheel', 'bossRepeat', 'quest'] as const;

/** Where a chest that is not an achievement came from. */
export type ChestSource = (typeof CHEST_SOURCES)[number];

function isChestSource(value: unknown): value is ChestSource {
  return CHEST_SOURCES.some((source) => source === value);
}

/** Where a saved presentation came from: an award by id, or a chest by its source. */
export type SerializedOrigin =
  | { readonly kind: 'award'; readonly id: AchievementId | AIAchievementKey }
  | { readonly kind: 'chest'; readonly source: ChestSource };

/**
 * A presentation as a save stores it. The award is kept by id, and its title
 * and subtitle are read back from the def on load, so a reworded achievement
 * shows its current text; a chest no achievement earned keeps its source's
 * current title and the subtitle it was given.
 */
export interface SerializedPresentation {
  readonly origin: SerializedOrigin;
  readonly title: string;
  readonly subtitle: string;
  readonly crawler: CrawlerKind;
  readonly rarity: Rarity;
  readonly rewards: readonly GrantedLine[];
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

function isCrawlerKind(value: unknown): value is CrawlerKind {
  return value === 'human' || value === 'cat';
}

function parseRecentEvent(value: unknown): RecentEvent | undefined {
  if (!isRecord(value)) return undefined;
  const { label, timestamp } = value;
  if (!isFiniteNumber(timestamp)) return undefined;
  const boundedLabel = textWithin(label, RECENT_EVENT_LABEL_MAX_CHARS);
  return boundedLabel === undefined ? undefined : { label: boundedLabel, timestamp };
}

/**
 * Every entry of a saved list parsed, or undefined when the list is missing,
 * longer than `max`, or holds one entry that fails.
 */
function parseBoundedList<T>(
  value: unknown,
  max: number,
  parseEntry: (entry: unknown) => T | undefined,
): T[] | undefined {
  const parsed = parseEvery(value, parseEntry);
  return parsed === undefined || parsed.length > max ? undefined : parsed;
}

/** Saved AI text, which was flattened to one plain line before it was ever written. */
function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (plainLine(value) !== value) return undefined;
  if (value.length === 0 || value.length > maxChars) return undefined;
  return value;
}

function parseAIAchievement(value: unknown): AIAchievementDef | undefined {
  if (!isRecord(value)) return undefined;
  const name = boundedText(value.name, AI_ACHIEVEMENT_TITLE_MAX_CHARS);
  const description = boundedText(value.description, AI_ACHIEVEMENT_DESCRIPTION_MAX_CHARS);
  const awardedBy = boundedText(value.awardedBy, AI_ACHIEVEMENT_AWARDER_MAX_CHARS);
  const { rarity, awardedAt } = value;
  if (name === undefined || description === undefined || awardedBy === undefined) return undefined;
  if (!isRarity(rarity) || !isFiniteNumber(awardedAt)) return undefined;
  return { id: aiAchievementKey(name), name, description, rarity, awardedBy, awardedAt };
}

function wholeCount(value: unknown): number | undefined {
  const isPositiveWhole = typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
  return isPositiveWhole ? value : undefined;
}

function parseGrantedLine(value: unknown): GrantedLine | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, id } = value;
  if (kind === 'coins') {
    const amount = wholeCount(value.amount);
    return amount === undefined ? undefined : { kind, amount };
  }
  if (kind === 'companion') return id === 'deinonychus' ? { kind, id } : undefined;
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

/** A string no longer than `maxChars`, empty allowed; for text kept but never read back. */
function textWithin(value: unknown, maxChars: number): string | undefined {
  return typeof value === 'string' && value.length <= maxChars ? value : undefined;
}

function textOrEmpty(value: unknown): string | undefined {
  if (value === '') return '';
  return boundedText(value, PRESENTATION_TEXT_MAX_CHARS);
}

/** A saved origin, or undefined for one naming an award this build or this record does not hold. */
function parseOrigin(
  value: unknown,
  aiAwardKeys: ReadonlySet<AIAchievementKey>,
): SerializedOrigin | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'chest') {
    return isChestSource(value.source) ? { kind: 'chest', source: value.source } : undefined;
  }
  if (value.kind !== 'award') return undefined;
  const { id } = value;
  if (isAchievementIdValue(id)) return { kind: 'award', id };
  if (!isAIAchievementKey(id) || !aiAwardKeys.has(id)) return undefined;
  return { kind: 'award', id };
}

function parsePresentation(
  value: unknown,
  aiAwardKeys: ReadonlySet<AIAchievementKey>,
): SerializedPresentation | undefined {
  if (!isRecord(value)) return undefined;
  const { crawler, rarity } = value;
  if (!isCrawlerKind(crawler) || !isRarity(rarity)) return undefined;
  const origin = parseOrigin(value.origin, aiAwardKeys);
  if (origin === undefined) return undefined;
  const rewards = parseEvery(value.rewards, parseGrantedLine);
  const title = textWithin(value.title, PRESENTATION_TEXT_MAX_CHARS);
  // An award's subtitle is read back from its def on load; only a chest's own is kept.
  const subtitle =
    origin.kind === 'chest'
      ? textOrEmpty(value.subtitle)
      : textWithin(value.subtitle, PRESENTATION_TEXT_MAX_CHARS);
  if (rewards === undefined || title === undefined || subtitle === undefined) {
    return undefined;
  }
  return { origin, title, subtitle, crawler, rarity, rewards };
}

/** Every counter at zero. */
export function emptyAchievementCounters(): Record<AchievementCounterId, number> {
  return { dungeonKills: 0, flawlessBossKills: 0, unseenKills: 0, relicKills: 0 };
}

function parseCounters(value: unknown): Record<AchievementCounterId, number> | undefined {
  if (!isRecord(value)) return undefined;
  const counters = emptyAchievementCounters();
  for (const id of ACHIEVEMENT_COUNTER_IDS) {
    const count = value[id];
    if (!isFiniteNumber(count) || count < 0 || !Number.isInteger(count)) return undefined;
    counters[id] = count;
  }
  return counters;
}

/**
 * A stored achievements record, or undefined when it is not exactly what
 * `AchievementManager.serialize` writes: input is unvalidated JSON from
 * storage or the server, and one entry this build does not know fails the
 * whole record.
 */
export function parseSerializedAchievements(value: unknown): SerializedAchievements | undefined {
  if (!isRecord(value)) return undefined;
  const unlocked = parseEvery(value.unlocked, (id) => (isAchievementIdValue(id) ? id : undefined));
  const aiAchievements = parseBoundedList(
    value.aiAchievements,
    AI_ACHIEVEMENTS_MAX,
    parseAIAchievement,
  );
  if (unlocked === undefined || aiAchievements === undefined) return undefined;
  const aiAwardKeys = new Set(aiAchievements.map((def) => def.id));
  // Unbounded: every queued chest is already paid and waits for the player
  // to open it, so a cap would either refuse the save or lose rewards.
  const presentations = parseEvery(value.presentations, (entry) =>
    parsePresentation(entry, aiAwardKeys),
  );
  const recentEvents = parseBoundedList(
    value.recentEvents,
    RECENT_EVENTS_MAX_CAP,
    parseRecentEvent,
  );
  const counters = parseCounters(value.counters);
  const { menuUnseen } = value;
  if (
    presentations === undefined ||
    recentEvents === undefined ||
    counters === undefined ||
    !isFiniteNumber(menuUnseen) ||
    menuUnseen < 0
  ) {
    return undefined;
  }
  return { unlocked, presentations, recentEvents, menuUnseen, counters, aiAchievements };
}
