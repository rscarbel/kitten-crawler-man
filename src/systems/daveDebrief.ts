/**
 * What Dave says in the safe room behind a boss the party has just killed.
 * Pure logic: the scene supplies the state, this decides the pages and the `!`.
 */

import type { Inventory } from '../core/items/inventory/Inventory';
import {
  ITEM_DEF,
  isItemId,
  itemFitsSubSlot,
  subSlotsOf,
  type InventoryItem,
  type ItemId,
  type WearableItem,
} from '../core/items/defs/ItemDefs';
import { traitScore, type GearTraitKind } from '../gear/traits';
import { crawlerDisplayName } from '../characters/characters';
import { crawlerPronouns } from '../characters/crawlerPronouns';
import { type CrawlerKind } from '../core/skills/SkillManager';
import type { KeyFragmentSystem } from './keys/KeyFragmentSystem';
import {
  DAVE_DEBRIEF_CONGRATS,
  DAVE_DEBRIEF_GEAR_CLOSING,
  DAVE_KEY_PROGRESS,
  type DaveKeyProgress,
  daveDebriefGearFirstSentence,
  daveDebriefGearMoreSentence,
  daveSpokenPages,
} from '../dialog/scripts/dave';
import type { DialogLine } from '../dialog/line';
import { ALL_DEBRIEF_BOSS_TYPES, type DebriefBossType } from '../core/mobs/debriefBossTypes';

/**
 * A later gauntlet kill retires this boss's debrief, so only the newest exit room
 * raises a `!` about gear.
 */
export function isSupersededDebrief(
  bossType: DebriefBossType,
  defeatedBossTypes: ReadonlySet<string>,
): boolean {
  const laterBosses = ALL_DEBRIEF_BOSS_TYPES.slice(ALL_DEBRIEF_BOSS_TYPES.indexOf(bossType) + 1);
  return laterBosses.some((later) => defeatedBossTypes.has(later));
}

const CRAWLER_ORDER: ReadonlyArray<CrawlerKind> = ['human', 'cat'];

/** Item names are long and the dialog box is short on phones. */
export const MAX_ITEMS_PER_DEBRIEF_PAGE = 3;

export interface UnwornItem {
  readonly id: ItemId;
  readonly name: string;
  readonly owner: CrawlerKind;
}

/**
 * What the debrief reads of the floor's key: whether the party has seen its
 * stairwell key whole. A type the key ring itself does not satisfy, since the
 * ring calls the key whole the moment its last piece is claimed, before the
 * forge ceremony has shown the player.
 */
export type DebriefKeyReader = Pick<KeyFragmentSystem, 'stairwellKeyKnownWhole'>;

export interface DebriefState {
  readonly unworn: ReadonlyArray<UnwornItem>;
  readonly key: DebriefKeyReader;
}

function keyProgress(key: DebriefKeyReader): DaveKeyProgress {
  return key.stairwellKeyKnownWhole() ? 'whole' : 'partial';
}

export interface DebriefMemory {
  readonly congratulated: boolean;
  /** Whether he has given his word on the floor's key behind this boss. */
  readonly keyNoted: boolean;
  /** Cumulative, so re-unequipping an item he already named is not news. */
  readonly namedItemIds: ReadonlyArray<ItemId>;
}

export type DaveDebriefCheckpoint = Partial<Record<DebriefBossType, DebriefMemory>>;

export const EMPTY_DEBRIEF_MEMORY: DebriefMemory = {
  congratulated: false,
  keyNoted: false,
  namedItemIds: [],
};

function summedStatBonus(item: InventoryItem): number {
  let total = 0;
  for (const value of Object.values(item.statBonus ?? {})) total += value;
  return total;
}

function keepsEveryBonus(
  worn: Partial<Record<string, number>> | undefined,
  candidate: Partial<Record<string, number>> | undefined,
): boolean {
  for (const [key, value] of Object.entries(worn ?? {})) {
    if ((candidate?.[key] ?? 0) < (value ?? 0)) return false;
  }
  return true;
}

const NEUTRAL_REGEN_MULTIPLIER = 1;

/** Each trait kind `id` carries, with the summed score of its traits of that kind. */
function traitScoresByKind(id: ItemId): Map<GearTraitKind, number> {
  const scores = new Map<GearTraitKind, number>();
  if (!isItemId(id)) return scores;
  for (const trait of ITEM_DEF[id].traits ?? []) {
    scores.set(trait.kind, (scores.get(trait.kind) ?? 0) + traitScore(trait));
  }
  return scores;
}

/** Whether `candidate` carries every trait kind `worn` does, each worth at least as much. */
function keepsEveryTrait(worn: ItemId, candidate: ItemId): boolean {
  const candidateScores = traitScoresByKind(candidate);
  for (const [kind, score] of traitScoresByKind(worn)) {
    const kept = candidateScores.get(kind);
    if (kept === undefined || kept < score) return false;
  }
  return true;
}

/**
 * More total stats and nothing the worn piece does given up. Deliberately
 * conservative: sidegrades are the player's call, so the worst case is silence.
 */
export function isStrictUpgrade(candidate: InventoryItem, worn: InventoryItem): boolean {
  if (summedStatBonus(candidate) <= summedStatBonus(worn)) return false;

  const candidateResistances = candidate.resistances ?? [];
  if (!(worn.resistances ?? []).every((type) => candidateResistances.includes(type))) return false;
  if (
    (candidate.regenMultiplier ?? NEUTRAL_REGEN_MULTIPLIER) <
    (worn.regenMultiplier ?? NEUTRAL_REGEN_MULTIPLIER)
  ) {
    return false;
  }
  if (worn.cancelsMomentum === true && candidate.cancelsMomentum !== true) return false;
  if (!keepsEveryTrait(worn.id, candidate.id)) return false;
  if (!keepsEveryBonus(worn.skillLevelBonus, candidate.skillLevelBonus)) return false;
  return keepsEveryBonus(worn.meleeOnlyStatBonus, candidate.meleeOnlyStatBonus);
}

function isWorthWearing(item: WearableItem, inventory: Inventory): boolean {
  const family = subSlotsOf(inventory.equipment.kind, item.equipSlot).filter((subSlot) =>
    itemFitsSubSlot(item, subSlot),
  );
  return family.some((subSlot) => {
    const worn = inventory.equipment.getEquippedItem(`${item.equipSlot}:${subSlot}`);
    return worn === null || isStrictUpgrade(item, worn);
  });
}

/** Wearable, unworn, and not a downgrade. */
export function unwornGear(owner: CrawlerKind, inventory: Inventory): UnwornItem[] {
  const found: UnwornItem[] = [];
  const seen = new Set<ItemId>();
  for (const item of [...inventory.bag.slots, ...inventory.actionBar.slots]) {
    if (item === null || seen.has(item.id)) continue;
    seen.add(item.id);
    // A weapon is drawn from the hotbar, so one not in hand is not gear left unworn.
    if (item.type === 'weapon') continue;
    if (!inventory.equipment.canEquip(item)) continue;
    if (!isWorthWearing(item, inventory)) continue;
    found.push({ id: item.id, name: item.name, owner });
  }
  return found;
}

function unnamedItems(memory: DebriefMemory, state: DebriefState): UnwornItem[] {
  return state.unworn.filter((item) => !memory.namedItemIds.includes(item.id));
}

interface DebriefSections {
  readonly congratulations: boolean;
  readonly keyNote: boolean;
  readonly gear: boolean;
}

/**
 * Gear repeats only when something is new: the crown may stay unworn forever,
 * and re-reading it would block the floor advice for good.
 */
function sectionsFor(memory: DebriefMemory, state: DebriefState): DebriefSections {
  return {
    congratulations: !memory.congratulated,
    keyNote: !memory.keyNoted,
    gear: unnamedItems(memory, state).length > 0,
  };
}

/** The `!`: cleared by hearing him out, not by acting on it, so it cannot nag forever. */
export function debriefHasNews(memory: DebriefMemory, state: DebriefState): boolean {
  const sections = sectionsFor(memory, state);
  return sections.congratulations || sections.keyNote || sections.gear;
}

/** One page of the debrief: what it says, and what hearing it records. */
export interface DebriefPage {
  readonly text: string;
  /** Whether this page is his congratulations. */
  readonly congratulates: boolean;
  /** How far along he says the floor's key is on this page, or null for a page not about it. */
  readonly keyNote: DaveKeyProgress | null;
  /** The items this page names. */
  readonly itemIds: ReadonlyArray<ItemId>;
}

/**
 * What hearing `heard` adds to `memory`. Only pages actually read count, so a
 * talk cut short leaves the rest as news for the next one.
 */
export function rememberDebriefHeard(
  memory: DebriefMemory,
  heard: ReadonlyArray<DebriefPage>,
): DebriefMemory {
  return {
    congratulated: memory.congratulated || heard.some((page) => page.congratulates),
    keyNoted: memory.keyNoted || heard.some((page) => page.keyNote !== null),
    namedItemIds: [...new Set([...memory.namedItemIds, ...heard.flatMap((page) => page.itemIds)])],
  };
}

export function sameDebriefMemory(a: DebriefMemory, b: DebriefMemory): boolean {
  return (
    a.congratulated === b.congratulated &&
    a.keyNoted === b.keyNoted &&
    a.namedItemIds.length === b.namedItemIds.length &&
    a.namedItemIds.every((id) => b.namedItemIds.includes(id))
  );
}

function itemList(items: ReadonlyArray<UnwornItem>): string {
  const names = items.map((item) => `the ${item.name}`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

interface GearSentence {
  readonly text: string;
  readonly itemIds: ReadonlyArray<ItemId>;
}

function gearSentences(recommendable: ReadonlyArray<UnwornItem>): GearSentence[] {
  const sentences: GearSentence[] = [];
  for (const owner of CRAWLER_ORDER) {
    const own = recommendable.filter((item) => item.owner === owner);
    chunk(own, MAX_ITEMS_PER_DEBRIEF_PAGE).forEach((group, index) => {
      const name = crawlerDisplayName(owner);
      const text =
        index === 0
          ? daveDebriefGearFirstSentence(name, crawlerPronouns(owner).possessive, itemList(group))
          : daveDebriefGearMoreSentence(name, itemList(group));
      sentences.push({ text, itemIds: group.map((item) => item.id) });
    });
  }
  return sentences;
}

function packGearPages(sentences: ReadonlyArray<GearSentence>): GearSentence[] {
  const pages: GearSentence[] = [];
  for (const sentence of sentences) {
    const last = pages.length > 0 ? pages[pages.length - 1] : undefined;
    const fits =
      last !== undefined &&
      last.itemIds.length + sentence.itemIds.length <= MAX_ITEMS_PER_DEBRIEF_PAGE;
    if (last !== undefined && fits) {
      pages[pages.length - 1] = {
        text: `${last.text} ${sentence.text}`,
        itemIds: [...last.itemIds, ...sentence.itemIds],
      };
    } else {
      pages.push(sentence);
    }
  }
  return pages;
}

function gearPages(unworn: ReadonlyArray<UnwornItem>): DebriefPage[] {
  if (unworn.length === 0) return [];

  const pages: DebriefPage[] = packGearPages(gearSentences(unworn)).map((page) => ({
    ...page,
    congratulates: false,
    keyNote: null,
  }));
  // Count-neutral wording: many armour names are plural ("the Hearthguard Boots").
  const closing = DAVE_DEBRIEF_GEAR_CLOSING;
  const lastPage = pages.length > 0 ? pages[pages.length - 1] : undefined;
  // A full page of long names plus the closing overflows a phone's dialog box.
  if (lastPage !== undefined && lastPage.itemIds.length < MAX_ITEMS_PER_DEBRIEF_PAGE) {
    pages[pages.length - 1] = { ...lastPage, text: `${lastPage.text} ${closing}` };
  } else {
    pages.push({ text: closing, congratulates: false, keyNote: null, itemIds: [] });
  }
  return pages;
}

/**
 * Everything he owes the party about `bossType`, page by page: the
 * congratulations once, his word on the floor's key once, then the unworn
 * gear he has not named yet. `null` hands the talk on to the floor advice.
 */
export function debriefPages(
  bossType: DebriefBossType,
  memory: DebriefMemory,
  state: DebriefState,
): ReadonlyArray<DebriefPage> | null {
  const sections = sectionsFor(memory, state);
  const pages: DebriefPage[] = [];
  if (sections.congratulations) {
    for (const text of DAVE_DEBRIEF_CONGRATS[bossType].paragraphs) {
      pages.push({ text, congratulates: true, keyNote: null, itemIds: [] });
    }
  }
  if (sections.keyNote) {
    const progress = keyProgress(state.key);
    for (const text of DAVE_KEY_PROGRESS[progress].paragraphs) {
      pages.push({ text, congratulates: false, keyNote: progress, itemIds: [] });
    }
  }
  if (sections.gear) pages.push(...gearPages(unnamedItems(memory, state)));
  return pages.length === 0 ? null : pages;
}

/** The part of the debrief one talk holds: his line, and the pages in it. */
export interface DebriefTalk {
  readonly line: DialogLine;
  readonly heard: ReadonlyArray<DebriefPage>;
  /** What he said of the floor's key in this talk, or null when it held no word on it. */
  readonly keyNoteSpoken: DaveKeyProgress | null;
}

/**
 * As many of `pages` as fit in `pageBudget` pages of the dialog box, from
 * the first, as one line of his; null when not even the first fits. Each
 * page is measured by `pageCount`, which counts how many boxes it fills.
 */
export function debriefTalk(
  pages: ReadonlyArray<DebriefPage>,
  pageBudget: number,
  pageCount: (line: DialogLine) => number,
): DebriefTalk | null {
  const heard: DebriefPage[] = [];
  let used = 0;
  for (const page of pages) {
    const pageLine = daveSpokenPages([page.text]);
    const cost = pageLine === null ? 0 : pageCount(pageLine);
    if (used + cost > pageBudget) break;
    heard.push(page);
    used += cost;
  }
  const line = daveSpokenPages(heard.map((page) => page.text));
  if (line === null) return null;
  const keyNoteSpoken = heard.find((page) => page.keyNote !== null)?.keyNote ?? null;
  return { line, heard, keyNoteSpoken };
}
