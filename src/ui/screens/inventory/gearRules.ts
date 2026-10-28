/**
 * The paper doll's rules: where each sub-slot sits, why a piece can't go
 * where it was aimed, what wearing it would change, and the worn-gear totals.
 */

import type { Inventory } from '../../../core/items/inventory/Inventory';
import {
  ALL_FAIRY_ELEMENTS,
  ALL_RESISTANCE_TYPES,
  EQUIP_SLOTS,
  EQUIP_SUBSLOTS,
  equipAddressOfKey,
  isWearable,
  itemFitsSubSlot,
  subSlotsOf,
  wearerOf,
  type EquipSlot,
  type InventoryItem,
  type SubSlotId,
} from '../../../core/items/defs/ItemDefs';
import { SKILL_IDS, type CrawlerKind } from '../../../core/skills/SkillManager';
import { gearModifiers, itemTraits, type GearWearer } from '../../../gear/gearHooks';
import { describeTrait } from '../../../gear/traits';
import { ALL_STATS, type StatId } from '../../../core/party/stats';
import {
  CANCELS_MOMENTUM_LINE,
  fairyImmunityLine,
  meleeOnlyStatLine,
  RESISTANCE_LABELS,
  regenLine,
  setProgressLines,
  skillBonusLine,
} from '../../itemEffectLines';

/** What the doll titles each section. */
export const DOLL_SECTION_LABELS: Readonly<Record<EquipSlot, string>> = {
  Weapon: 'Weapon',
  Head: 'Head',
  Torso: 'Torso',
  Legs: 'Legs',
  Hands: 'Hands',
  Feet: 'Feet',
  Trinkets: 'Trinkets',
};

export interface DollSlot {
  /** The `"Slot:SubSlot"` key the equipment map is keyed on. */
  readonly key: string;
  readonly slot: EquipSlot;
  readonly subSlot: SubSlotId;
}

export interface DollSection {
  readonly slot: EquipSlot;
  readonly cells: readonly DollSlot[];
}

/** Every sub-slot a crawler of `kind` has, in the order the doll lays them out. */
export function dollSectionsFor(kind: CrawlerKind): readonly DollSection[] {
  // `EQUIP_SLOTS` runs what a crawler fights with first, then head to foot.
  return EQUIP_SLOTS.flatMap((slot) => {
    const cells = subSlotsOf(kind, slot).map((subSlot) => ({
      key: `${slot}:${subSlot}`,
      slot,
      subSlot,
    }));
    return cells.length === 0 ? [] : [{ slot, cells }];
  });
}

/**
 * The most cells one doll section holds on either crawler. Every doll is laid
 * out to this width, so the two crawlers' dolls line up when the screen swaps.
 */
export const DOLL_MAX_SECTION_CELLS = Math.max(
  ...Object.values(EQUIP_SUBSLOTS).flatMap((sections) =>
    EQUIP_SLOTS.map((slot) => sections[slot]?.length ?? 0),
  ),
);

const CRAWLER_LABELS: Readonly<Record<CrawlerKind, string>> = { human: 'Human', cat: 'Cat' };

export const NOT_WEARABLE_REFUSAL = "That isn't something you can wear.";
export const WRONG_SLOT_REFUSAL = "That doesn't go there.";
export const ALREADY_WORN_REFUSAL = "That's already being worn.";
export const BOUND_SLOT_REFUSAL = "What's there is cursed. It won't come off until a safe room.";
export const BOUND_PIECE_REFUSAL = "It's cursed. It won't come off until a safe room.";

/** Why `item` cannot sit in `targetKey`, or null when it fits there. Says nothing about whether it is worn. */
export function slotFitRefusal(item: InventoryItem, targetKey: string): string | null {
  if (!isWearable(item)) return NOT_WEARABLE_REFUSAL;
  const address = equipAddressOfKey(null, targetKey);
  if (item.equipSlot !== address?.slot) return WRONG_SLOT_REFUSAL;
  if (!itemFitsSubSlot(item, address.subSlot)) return WRONG_SLOT_REFUSAL;
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
  if (inventory.equipment.boundOccupant(item, targetKey ?? undefined) !== null) {
    return BOUND_SLOT_REFUSAL;
  }
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
  readonly stat: StatId;
  readonly delta: number;
}

function statOf(item: InventoryItem | null, stat: StatId): number {
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

/**
 * The worn-gear summary: real totals from the equipment aggregators rather
 * than a merge of per-item lines, because two items that each reflect 10%
 * reflect 20% together. Traits with no total read as their own line, once.
 */
export function wornGearSummary(wearer: GearWearer): string[] {
  const lines: string[] = [];
  const equipment = wearer.inventory.equipment;
  const resisted = ALL_RESISTANCE_TYPES.filter((type) => equipment.hasResistance(type)).map(
    (type) => RESISTANCE_LABELS[type],
  );
  if (resisted.length > 0) lines.push(`Resists ${resisted.join(', ')}`);
  const fairyImmunity = fairyImmunityLine(
    ALL_FAIRY_ELEMENTS.filter((element) => equipment.hasFairyImmunity(element)),
  );
  if (fairyImmunity !== null) lines.push(fairyImmunity);
  const regen = regenLine(equipment.getRegenMultiplier());
  if (regen !== null) lines.push(regen);
  for (const id of SKILL_IDS) {
    const bonus = equipment.getSkillLevelBonus(id);
    if (bonus > 0) lines.push(skillBonusLine(id, bonus));
  }
  for (const stat of ALL_STATS) {
    const bonus = equipment.getMeleeOnlyStatBonus(stat);
    if (bonus > 0) lines.push(meleeOnlyStatLine(stat, bonus));
  }
  const thorns = gearModifiers(wearer).thornsShare;
  if (thorns > 0) lines.push(describeTrait({ kind: 'thorns', share: thorns }));
  if (equipment.getCancelsMomentum()) lines.push(CANCELS_MOMENTUM_LINE);
  const traitLines = new Set<string>();
  for (const id of equipment.equippedIds()) {
    for (const trait of itemTraits(id, wearer.gear.of(id).awakened)) {
      if (trait.kind !== 'thorns') traitLines.add(describeTrait(trait));
    }
  }
  lines.push(...traitLines);
  lines.push(...setProgressLines([...equipment.equippedIds()]));
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
