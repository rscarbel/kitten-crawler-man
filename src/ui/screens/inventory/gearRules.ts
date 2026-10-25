/**
 * The paper doll's rules: where each sub-slot sits, why a piece can't go
 * where it was aimed, what wearing it would change, and the worn-gear totals.
 */

import type { Inventory } from '../../../core/Inventory';
import {
  ALL_FAIRY_ELEMENTS,
  ALL_RESISTANCE_TYPES,
  EQUIP_SLOT_WEARER,
  EQUIP_SUBSLOTS,
  isWearable,
  itemFitsSubSlot,
  wearerAllows,
  wearerOf,
  type EquipSlot,
  type InventoryItem,
  type ResistanceType,
} from '../../../core/ItemDefs';
import type { CrawlerKind } from '../../../core/SkillManager';
import { ALL_STATS, type StatName } from '../../../Player';
import { asPercent, fairyImmunityLine } from '../../itemEffectLines';

/** Head to foot, which is the order the doll's sections stack. */
export const EQUIP_SLOT_ORDER = [
  'Head',
  'Mouth',
  'Torso',
  'Legs',
  'Hands',
  'Hand',
  'Feet',
] as const satisfies readonly EquipSlot[];

/** What the doll titles each section. The held sections read as what they hold, not as body parts. */
export const DOLL_SECTION_LABELS: Readonly<Record<EquipSlot, string>> = {
  Head: 'Head',
  Mouth: 'In Mouth',
  Torso: 'Torso',
  Legs: 'Legs',
  Hands: 'Hands',
  Hand: 'In Hand',
  Feet: 'Feet',
};

export interface DollSlot {
  /** The `"Slot:SubSlot"` key the equipment map is keyed on. */
  readonly key: string;
  readonly slot: EquipSlot;
  readonly subSlot: string;
}

export interface DollSection {
  readonly slot: EquipSlot;
  readonly cells: readonly DollSlot[];
}

const ALL_DOLL_SECTIONS: readonly DollSection[] = EQUIP_SLOT_ORDER.map((slot) => ({
  slot,
  cells: EQUIP_SUBSLOTS[slot].map((subSlot) => ({ key: `${slot}:${subSlot}`, slot, subSlot })),
}));

/**
 * Every sub-slot a crawler of `kind` has, head to foot, in the order the doll
 * lays them out: the human's doll has hands to hold with, the cat's a mouth.
 */
export function dollSectionsFor(kind: CrawlerKind): readonly DollSection[] {
  return ALL_DOLL_SECTIONS.filter((section) => wearerAllows(EQUIP_SLOT_WEARER[section.slot], kind));
}

/** The most cells one doll section holds (hands and feet). */
export const DOLL_MAX_SECTION_CELLS = Math.max(
  ...ALL_DOLL_SECTIONS.map((section) => section.cells.length),
);

const TOE_RING = /^Toe Ring (\d+)$/;

/** A sub-slot name short enough to sit inside an empty cell. */
export function shortSubSlotLabel(subSlot: string): string {
  const toe = TOE_RING.exec(subSlot);
  if (toe !== null) return `Toe ${toe[1]}`;
  if (subSlot === 'Knee Pads') return 'Knees';
  return subSlot;
}

export function keySlot(key: string): string {
  return key.split(':')[0] ?? '';
}

export function keySubSlot(key: string): string {
  return key.split(':')[1] ?? '';
}

const CRAWLER_LABELS: Readonly<Record<CrawlerKind, string>> = { human: 'Human', cat: 'Cat' };

export const NOT_WEARABLE_REFUSAL = "That isn't something you can wear.";
export const WRONG_SLOT_REFUSAL = "That doesn't go there.";
export const ALREADY_WORN_REFUSAL = "That's already being worn.";

/** Why `item` cannot sit in `targetKey`, or null when it fits there. Says nothing about whether it is worn. */
export function slotFitRefusal(item: InventoryItem, targetKey: string): string | null {
  if (!isWearable(item)) return NOT_WEARABLE_REFUSAL;
  if (item.equipSlot !== keySlot(targetKey)) return WRONG_SLOT_REFUSAL;
  if (!itemFitsSubSlot(item, keySubSlot(targetKey))) return WRONG_SLOT_REFUSAL;
  return null;
}

/** Why `item` cannot be put on (into `targetKey`, when given), or null when it can. */
export function equipRefusal(
  item: InventoryItem,
  targetKey: string | null,
  inventory: Inventory,
): string | null {
  if (!isWearable(item)) return NOT_WEARABLE_REFUSAL;
  if (targetKey !== null) {
    const fitRefusal = slotFitRefusal(item, targetKey);
    if (fitRefusal !== null) return fitRefusal;
  }
  if (inventory.hasEquipped(item.id)) return ALREADY_WORN_REFUSAL;
  const ownerKind = inventory.equipment.kind;
  // Read before the guard: `canEquip` is a type predicate, so its false branch
  // narrows the item to `never`.
  const wearer = wearerOf(item.id);
  if (!inventory.equipment.canEquip(item)) {
    if (wearer === undefined) return NOT_WEARABLE_REFUSAL;
    if (wearer !== 'both') return `Only the ${CRAWLER_LABELS[wearer]} can wear that.`;
    if (ownerKind !== null) return `The ${CRAWLER_LABELS[ownerKind]} has nowhere to hold that.`;
    return NOT_WEARABLE_REFUSAL;
  }
  return null;
}

export interface StatDelta {
  readonly stat: StatName;
  readonly delta: number;
}

export const STAT_LABELS: Readonly<Record<StatName, string>> = {
  strength: 'Strength',
  intelligence: 'Intelligence',
  constitution: 'Constitution',
  dexterity: 'Dexterity',
};

export const STAT_ABBREVIATIONS: Readonly<Record<StatName, string>> = {
  strength: 'STR',
  intelligence: 'INT',
  constitution: 'CON',
  dexterity: 'DEX',
};

function statOf(item: InventoryItem | null, stat: StatName): number {
  return item?.statBonus?.[stat] ?? 0;
}

/**
 * What putting on `item` would do to each stat, against whatever it would
 * displace from the sub-slot it would go in. Empty for anything not wearable
 * or already worn.
 */
export function armorDeltas(
  item: InventoryItem,
  inventory: Inventory,
  targetKey: string | null,
): StatDelta[] {
  if (!isWearable(item) || inventory.hasEquipped(item.id)) return [];
  const key = inventory.equipment.keyFor(item, targetKey ?? undefined);
  const displaced = inventory.getEquippedItem(key);
  return ALL_STATS.flatMap((stat) => {
    const delta = statOf(item, stat) - statOf(displaced, stat);
    return delta === 0 ? [] : [{ stat, delta }];
  });
}

const RESISTANCE_NAMES: Readonly<Record<ResistanceType, string>> = {
  poison: 'Poison',
  ice: 'Ice',
  piercing: 'Piercing',
};

/**
 * The worn-gear summary: real totals from the equipment aggregators rather
 * than a merge of per-item lines, because two items that each reflect 10%
 * reflect 20% together.
 */
export function wornGearSummary(inventory: Inventory): string[] {
  const lines: string[] = [];
  const equipment = inventory.equipment;
  const resisted = ALL_RESISTANCE_TYPES.filter((type) => equipment.hasResistance(type)).map(
    (type) => RESISTANCE_NAMES[type],
  );
  if (resisted.length > 0) lines.push(`Resists ${resisted.join(', ')}`);
  const fairyImmunity = fairyImmunityLine(
    ALL_FAIRY_ELEMENTS.filter((element) => equipment.hasFairyImmunity(element)),
  );
  if (fairyImmunity !== null) lines.push(fairyImmunity);
  const reflect = equipment.getDamageReflectPct();
  if (reflect > 0) lines.push(`Reflects ${asPercent(reflect)}% of melee damage`);
  const stun = equipment.getStunOnHitChance();
  if (stun > 0) lines.push(`${asPercent(stun)}% stun on hit`);
  if (equipment.getCancelsMomentum()) lines.push('Momentum attacks cannot touch you');
  return lines;
}

/** Whether `item` belongs in the doll cell `key`, for the Character tab's "what fits here?" filter. */
export function fitsDollSlot(item: InventoryItem, key: string): boolean {
  return isWearable(item) && slotFitRefusal(item, key) === null;
}

/** The section and sub-slot an item goes in, e.g. `Hands · Ring`. */
export function equipSlotLabel(item: InventoryItem): string | null {
  if (!isWearable(item)) return null;
  return `${DOLL_SECTION_LABELS[item.equipSlot]} · ${item.equipSubSlot}`;
}
