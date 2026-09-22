/**
 * What Mordecai says in the safe room behind a boss the party has just killed.
 * Pure logic: the scene supplies the state, this decides the pages and the `!`.
 */

import type { Inventory } from '../core/Inventory';
import {
  EQUIP_SUBSLOTS,
  itemFitsSubSlot,
  type InventoryItem,
  type ItemId,
  type WearableItem,
} from '../core/ItemDefs';
import type { CrawlerKind } from '../core/SkillManager';

/** In the order the spine meets them; {@link isSupersededDebrief} relies on it. */
const DEBRIEF_BOSS_TYPES = ['the_hoarder', 'juicer', 'krakaren_clone'] as const;

export type DebriefBossType = (typeof DEBRIEF_BOSS_TYPES)[number];

export const ALL_DEBRIEF_BOSS_TYPES: ReadonlyArray<DebriefBossType> = DEBRIEF_BOSS_TYPES;

export function debriefBossType(bossType: string | undefined): DebriefBossType | null {
  if (bossType === undefined) return null;
  for (const id of DEBRIEF_BOSS_TYPES) {
    if (id === bossType) return id;
  }
  return null;
}

/**
 * A later gauntlet kill retires this boss's debrief, so only the newest exit room
 * raises a `!` about boxes and gear.
 */
export function isSupersededDebrief(
  bossType: DebriefBossType,
  defeatedBossTypes: ReadonlySet<string>,
): boolean {
  const laterBosses = DEBRIEF_BOSS_TYPES.slice(DEBRIEF_BOSS_TYPES.indexOf(bossType) + 1);
  return laterBosses.some((later) => defeatedBossTypes.has(later));
}

/** Must match each mob's `displayName`; `verify:mordecai-debrief` checks it. */
export const BOSS_DISPLAY_NAMES = {
  the_hoarder: 'The Hoarder',
  juicer: 'The Juicer',
  krakaren_clone: 'Krakaren Clone',
} as const satisfies Record<DebriefBossType, string>;

export const CRAWLER_NAMES = {
  human: 'Carl',
  cat: 'Donut',
} as const satisfies Record<CrawlerKind, string>;

const CRAWLER_POSSESSIVES = {
  human: 'his',
  cat: 'her',
} as const satisfies Record<CrawlerKind, string>;

const CRAWLER_ORDER: ReadonlyArray<CrawlerKind> = ['human', 'cat'];

/**
 * He never tells Donut to wear the crown by name. It still counts as unworn gear
 * for the `!`; only the wording changes.
 */
const UNRECOMMENDED_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'enchanted_crown_sepsis_whore',
]);

/** Item names are long and the dialog box is short on phones. */
export const MAX_ITEMS_PER_DEBRIEF_PAGE = 3;

export interface UnwornItem {
  readonly id: ItemId;
  readonly name: string;
  readonly owner: CrawlerKind;
}

export interface BoxCounts {
  readonly human: number;
  readonly cat: number;
}

export interface DebriefState {
  readonly pendingBoxes: BoxCounts;
  readonly unworn: ReadonlyArray<UnwornItem>;
}

export interface DebriefMemory {
  readonly congratulated: boolean;
  /** Cumulative, so re-unequipping an item he already named is not news. */
  readonly namedItemIds: ReadonlyArray<ItemId>;
  readonly boxCountsAtLastTalk: BoxCounts;
}

export type MordecaiDebriefCheckpoint = Partial<Record<DebriefBossType, DebriefMemory>>;

export const EMPTY_DEBRIEF_MEMORY: DebriefMemory = {
  congratulated: false,
  namedItemIds: [],
  boxCountsAtLastTalk: { human: 0, cat: 0 },
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

/**
 * Effects keyed by id elsewhere (the gauntlet's iron punch, the crown's sepsis
 * proc), invisible to `isStrictUpgrade`.
 */
const ID_KEYED_EFFECT_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'grull_war_gauntlet',
  'enchanted_crown_sepsis_whore',
]);

const NEUTRAL_REGEN_MULTIPLIER = 1;

/**
 * More total stats and nothing the worn piece does given up. Deliberately
 * conservative: sidegrades are the player's call, so the worst case is silence.
 */
export function isStrictUpgrade(candidate: InventoryItem, worn: InventoryItem): boolean {
  if (ID_KEYED_EFFECT_ITEM_IDS.has(worn.id)) return false;
  if (summedStatBonus(candidate) <= summedStatBonus(worn)) return false;

  const candidateResistances = candidate.resistances ?? [];
  if (!(worn.resistances ?? []).every((type) => candidateResistances.includes(type))) return false;
  if (worn.abilityId !== undefined && candidate.abilityId !== worn.abilityId) return false;
  if (
    (candidate.regenMultiplier ?? NEUTRAL_REGEN_MULTIPLIER) <
    (worn.regenMultiplier ?? NEUTRAL_REGEN_MULTIPLIER)
  ) {
    return false;
  }
  if ((candidate.damageReflectPct ?? 0) < (worn.damageReflectPct ?? 0)) return false;
  if (worn.cancelsMomentum === true && candidate.cancelsMomentum !== true) return false;
  if ((candidate.stunOnHitChance ?? 0) < (worn.stunOnHitChance ?? 0)) return false;
  if (!keepsEveryBonus(worn.skillLevelBonus, candidate.skillLevelBonus)) return false;
  return keepsEveryBonus(worn.meleeOnlyStatBonus, candidate.meleeOnlyStatBonus);
}

function isWorthWearing(item: WearableItem, inventory: Inventory): boolean {
  const family = EQUIP_SUBSLOTS[item.equipSlot].filter((subSlot) => itemFitsSubSlot(item, subSlot));
  return family.some((subSlot) => {
    const worn = inventory.equipment.getEquippedItem(`${item.equipSlot}:${subSlot}`);
    return worn === null || isStrictUpgrade(item, worn);
  });
}

/** Wearable, unworn, and not a downgrade. The crown skips the downgrade filter. */
export function unwornGear(owner: CrawlerKind, inventory: Inventory): UnwornItem[] {
  const found: UnwornItem[] = [];
  const seen = new Set<ItemId>();
  for (const item of [...inventory.bag.slots, ...inventory.actionBar.slots]) {
    if (item === null || seen.has(item.id)) continue;
    seen.add(item.id);
    if (!inventory.equipment.canEquip(item)) continue;
    const hushed = isHushed({ id: item.id, owner });
    if (!hushed && !isWorthWearing(item, inventory)) continue;
    found.push({ id: item.id, name: item.name, owner });
  }
  return found;
}

function isHushed(item: Pick<UnwornItem, 'id' | 'owner'>): boolean {
  return item.owner === 'cat' && UNRECOMMENDED_ITEM_IDS.has(item.id);
}

function totalBoxes(boxes: BoxCounts): number {
  return boxes.human + boxes.cat;
}

function unnamedItems(memory: DebriefMemory, state: DebriefState): UnwornItem[] {
  return state.unworn.filter((item) => !memory.namedItemIds.includes(item.id));
}

interface DebriefSections {
  readonly congratulations: boolean;
  readonly boxes: boolean;
  readonly gear: boolean;
}

/**
 * Gear waits for every box to be opened, since boxes hold gear. Unlike boxes it
 * repeats only when something is new: the crown may stay unworn forever, and
 * re-reading it would block the floor advice for good.
 */
function sectionsFor(memory: DebriefMemory, state: DebriefState): DebriefSections {
  const boxes = totalBoxes(state.pendingBoxes) > 0;
  return {
    congratulations: !memory.congratulated,
    boxes,
    gear: !boxes && unnamedItems(memory, state).length > 0,
  };
}

function hasNewBoxes(memory: DebriefMemory, state: DebriefState): boolean {
  return (
    state.pendingBoxes.human > memory.boxCountsAtLastTalk.human ||
    state.pendingBoxes.cat > memory.boxCountsAtLastTalk.cat
  );
}

/** The `!`: cleared by hearing him out, not by acting on it, so it cannot nag forever. */
export function debriefHasNews(memory: DebriefMemory, state: DebriefState): boolean {
  const sections = sectionsFor(memory, state);
  return (
    sections.congratulations || (sections.boxes && hasNewBoxes(memory, state)) || sections.gear
  );
}

/** Only gear actually read out counts as named; gear held back behind boxes stays news. */
export function rememberDebriefSpoken(memory: DebriefMemory, state: DebriefState): DebriefMemory {
  const sections = sectionsFor(memory, state);
  const spokenIds = sections.gear ? state.unworn.map((item) => item.id) : [];
  return {
    congratulated: true,
    namedItemIds: [...new Set([...memory.namedItemIds, ...spokenIds])],
    boxCountsAtLastTalk: state.pendingBoxes,
  };
}

export function sameDebriefMemory(a: DebriefMemory, b: DebriefMemory): boolean {
  return (
    a.congratulated === b.congratulated &&
    a.namedItemIds.length === b.namedItemIds.length &&
    a.namedItemIds.every((id) => b.namedItemIds.includes(id)) &&
    a.boxCountsAtLastTalk.human === b.boxCountsAtLastTalk.human &&
    a.boxCountsAtLastTalk.cat === b.boxCountsAtLastTalk.cat
  );
}

/**
 * Call whenever the memory is read. Without it, opening three boxes and earning
 * one more reads as fewer than he last saw rather than one new box. Counts, not
 * ids, because box ids restart each session and would collide with a save.
 */
export function reconcileDebriefMemory(memory: DebriefMemory, boxes: BoxCounts): DebriefMemory {
  const human = Math.min(memory.boxCountsAtLastTalk.human, boxes.human);
  const cat = Math.min(memory.boxCountsAtLastTalk.cat, boxes.cat);
  if (human === memory.boxCountsAtLastTalk.human && cat === memory.boxCountsAtLastTalk.cat) {
    return memory;
  }
  return { ...memory, boxCountsAtLastTalk: { human, cat } };
}

const CONGRATULATIONS = {
  the_hoarder: [
    "So. The Hoarder is dead, and the two of you aren't. I'll admit I had my doubts.",
    "Don't let it go to your heads. She was a neighborhood boss. The dungeon noticed all the same, and the dungeon doesn't reward being noticed.",
  ],
  juicer: [
    "The Juicer is dead. I'll admit I had my doubts about that one. He had help, and you still walked out.",
    "Don't let it go to your heads. The dungeon noticed, and the dungeon doesn't reward being noticed. If either of you is still carrying that poison, sit down for a while.",
  ],
  krakaren_clone: [
    "You killed the Krakaren Clone. I'll admit I had my doubts. That was no neighborhood nuisance.",
    "It was only a copy. I'd keep that to yourselves if you ever meet anyone who remembers the original. And don't let it go to your heads. The dungeon noticed, and the dungeon doesn't reward being noticed.",
  ],
} as const satisfies Record<DebriefBossType, ReadonlyArray<string>>;

const WHERE_BOXES_OPEN = "They're under Achievements in the menu.";

function boxesPage(boxes: BoxCounts): string {
  if (boxes.human > 0 && boxes.cat > 0) {
    return `You both have loot boxes you haven't opened. You're in a safe room. This is the one place you can open them, so open them. ${WHERE_BOXES_OPEN}`;
  }
  const owner: CrawlerKind = boxes.human > 0 ? 'human' : 'cat';
  const count = boxes[owner];
  const sittingOn = count === 1 ? 'an unopened loot box' : 'unopened loot boxes';
  const pronoun = count === 1 ? 'it' : 'them';
  return `${CRAWLER_NAMES[owner]}, you're sitting on ${sittingOn}. Open ${pronoun} while you're somewhere nothing can kill you. ${WHERE_BOXES_OPEN}`;
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
  readonly itemCount: number;
}

function gearSentences(recommendable: ReadonlyArray<UnwornItem>): GearSentence[] {
  const sentences: GearSentence[] = [];
  for (const owner of CRAWLER_ORDER) {
    const own = recommendable.filter((item) => item.owner === owner);
    chunk(own, MAX_ITEMS_PER_DEBRIEF_PAGE).forEach((group, index) => {
      const name = CRAWLER_NAMES[owner];
      const text =
        index === 0
          ? `${name} has ${itemList(group)} in ${CRAWLER_POSSESSIVES[owner]} bag.`
          : `${name} is also carrying ${itemList(group)}.`;
      sentences.push({ text, itemCount: group.length });
    });
  }
  return sentences;
}

function packGearPages(sentences: ReadonlyArray<GearSentence>): GearSentence[] {
  const pages: GearSentence[] = [];
  for (const sentence of sentences) {
    const last = pages.length > 0 ? pages[pages.length - 1] : undefined;
    if (last !== undefined && last.itemCount + sentence.itemCount <= MAX_ITEMS_PER_DEBRIEF_PAGE) {
      pages[pages.length - 1] = {
        text: `${last.text} ${sentence.text}`,
        itemCount: last.itemCount + sentence.itemCount,
      };
    } else {
      pages.push(sentence);
    }
  }
  return pages;
}

export const HUSHED_ONLY_LINE = 'Donut, it looks like you have some unequipped items in your bag.';
const HUSHED_ALSO_LINE = "Donut, there's something else unworn in your bag as well.";

function gearPages(unworn: ReadonlyArray<UnwornItem>): string[] {
  const recommendable = unworn.filter((item) => !isHushed(item));
  const hasHushed = recommendable.length < unworn.length;

  if (recommendable.length === 0) return hasHushed ? [HUSHED_ONLY_LINE] : [];

  const packed = packGearPages(gearSentences(recommendable));
  // Count-neutral wording: many armour names are plural ("the Marching Boots").
  const closing =
    "Wear what you're carrying. The stat boosts are the point. Gear in a bag does nothing for anyone.";
  const tail = hasHushed ? `${closing} ${HUSHED_ALSO_LINE}` : closing;

  const pages = packed.map((page) => page.text);
  const lastPage = packed.length > 0 ? packed[packed.length - 1] : undefined;
  // A full page of long names plus the closing overflows a phone's dialog box.
  if (lastPage !== undefined && lastPage.itemCount < MAX_ITEMS_PER_DEBRIEF_PAGE) {
    pages[pages.length - 1] = `${lastPage.text} ${tail}`;
  } else {
    pages.push(tail);
  }
  return pages;
}

/** `null` hands the talk on to the floor advice. */
export function debriefPages(
  bossType: DebriefBossType,
  memory: DebriefMemory,
  state: DebriefState,
): ReadonlyArray<string> | null {
  const sections = sectionsFor(memory, state);
  const pages: string[] = [];
  if (sections.congratulations) pages.push(...CONGRATULATIONS[bossType]);
  if (sections.boxes) pages.push(boxesPage(state.pendingBoxes));
  if (sections.gear) pages.push(...gearPages(state.unworn));
  return pages.length === 0 ? null : pages;
}
