import type { StatName } from '../../../Player';
import { ALL_STATS } from '../../../Player';
import {
  ITEM_DEF,
  crawlerHasSection,
  equipAddressOfKey,
  isItemId,
  isWearable,
  itemFitsSubSlot,
  subSlotsOf,
  wearerAllows,
  wearerOf,
} from '../defs/ItemDefs';
import { traitScore } from '../../../gear/traits';
import type {
  EquipSlot,
  FairyElement,
  InventoryItem,
  ItemId,
  ResistanceType,
  SubSlotId,
  WearableItem,
} from '../defs/ItemDefs';
import type { CrawlerKind, SkillId } from '../../skills/SkillManager';

/** Callback to locate an item by ID across all storage (bag + hotbar). */
export type ItemFinder = (id: ItemId) => InventoryItem | null;

/**
 * Why the equipped set changed. `restore` is a snapshot or reset replacing the
 * whole set at once, which a listener that sounds a cue should stay quiet for.
 */
export type EquipmentChangeReason = 'equip' | 'unequip' | 'restore';

/** One change to the equipped set, as {@link EquipmentManager.onChange} reports it. */
export interface EquipmentChange {
  readonly reason: EquipmentChangeReason;
  /**
   * The `"Slot:SubSlot"` key that changed; null for a `restore`, which may touch
   * every key. A `move` also empties the key the item came from, which is not reported.
   */
  readonly key: string | null;
  /** What now sits in `key`; null when it was emptied, and for a `restore`. */
  readonly itemId: ItemId | null;
  /** What `key` held before the change; null when it was bare, and for a `restore`. */
  readonly removedItemId: ItemId | null;
}

export type EquipmentListener = (change: EquipmentChange) => void;

/** Summed stat bonuses contributed by everything currently worn. */
export type StatBonuses = Record<StatName, number>;

function emptyStatBonuses(): StatBonuses {
  return { strength: 0, intelligence: 0, constitution: 0, dexterity: 0 };
}

// Weights for `gearScore`, below — chosen so a single resistance or a
// meaningful regen boost reads as roughly as valuable as a few points of a
// raw stat, rather than every field counting for one point flat.
const GEAR_SCORE_STAT_WEIGHT = 1;
const GEAR_SCORE_RESISTANCE_WEIGHT = 3;
const GEAR_SCORE_REGEN_WEIGHT = 10;
const GEAR_SCORE_SKILL_LEVEL_WEIGHT = 2;
/** Per whole step of a weapon's damage multiplier, so a ×1.6 axe outranks a ×1.1 shiv. */
const GEAR_SCORE_WEAPON_MULTIPLIER_WEIGHT = 10;

/**
 * A rough, comparable "how good is this gear" score, used only to decide
 * whether a newly granted item beats what's already worn — never for combat
 * math, which reads each field on its own. Each trait adds its handler's score.
 */
function gearScore(item: InventoryItem): number {
  let score = 0;
  if (item.statBonus) {
    for (const stat of ALL_STATS) score += (item.statBonus[stat] ?? 0) * GEAR_SCORE_STAT_WEIGHT;
  }
  score += (item.resistances?.length ?? 0) * GEAR_SCORE_RESISTANCE_WEIGHT;
  if (item.regenMultiplier !== undefined) {
    score += (item.regenMultiplier - 1) * GEAR_SCORE_REGEN_WEIGHT;
  }
  if (item.skillLevelBonus) {
    for (const bonus of Object.values(item.skillLevelBonus)) {
      score += bonus * GEAR_SCORE_SKILL_LEVEL_WEIGHT;
    }
  }
  if (isItemId(item.id)) {
    const def = ITEM_DEF[item.id];
    for (const trait of def.traits ?? []) score += traitScore(trait);
    const weapon = def.weapon;
    if (weapon !== undefined && weapon.delivery !== 'sling') {
      score += weapon.damageMultiplier * GEAR_SCORE_WEAPON_MULTIPLIER_WEIGHT;
    }
  }
  return score;
}

/**
 * Manages equipment slots and stat bonuses.
 * Equipment is tracked by ItemId, not by physical slot position,
 * so items can be freely moved between bag/hotbar without losing
 * their equipped status.
 */
export class EquipmentManager {
  /**
   * Maps "Slot:SubSlot" key → ItemId of the equipped item.
   * e.g. "Torso:Jacket" → 'lucky_hoodie'.
   *
   * Private so that snapshot restore and the tutorial reset go through
   * {@link replaceAll} / {@link clear} rather than reaching in.
   */
  private readonly equipped = new Map<string, ItemId>();

  private readonly listeners = new Set<EquipmentListener>();
  private changeCount = 0;

  /** Whether a worn piece may not come off right now; see {@link setRemovalLock}. */
  private removalLocked: (id: ItemId) => boolean = () => false;

  constructor(
    private readonly findItem: ItemFinder,
    private readonly ownerKind: CrawlerKind | null = null,
  ) {}

  /** The crawler this equipment belongs to, or null for a wearer of any kind. */
  get kind(): CrawlerKind | null {
    return this.ownerKind;
  }

  /**
   * Equip the given item, optionally into a caller-chosen `"Slot:SubSlot"` key.
   * Records its ID in the equipped map.
   * Returns the previously equipped item in that sub-slot (or null).
   */
  equip(item: InventoryItem, targetKey?: string): InventoryItem | null {
    if (!this.canEquip(item, targetKey)) return null;
    const key = this.resolveSubSlotKey(item, item.equipSlot, item.equipSubSlot, targetKey);
    const prev = this.getEquippedItem(key);
    const removedItemId = this.equipped.get(key) ?? null;
    this.equipped.set(key, item.id);
    this.notify({ reason: 'equip', key, itemId: item.id, removedItemId });
    return prev;
  }

  /**
   * Move `item` from the `fromKey` it is equipped in to `toKey`, reported as
   * the one equip it is rather than a take-off followed by a put-on. Returns
   * the item displaced from `toKey` (or null); does nothing when `fromKey` does
   * not hold `item` or `item` cannot be worn.
   */
  move(item: InventoryItem, fromKey: string, toKey: string): InventoryItem | null {
    if (this.equipped.get(fromKey) !== item.id) return null;
    const displaced = this.equipped.get(toKey);
    if (displaced !== undefined && displaced !== item.id && this.removalLocked(displaced)) {
      return null;
    }
    this.equipped.delete(fromKey);
    if (this.canEquip(item)) return this.equip(item, toKey);
    this.equipped.set(fromKey, item.id);
    return null;
  }

  /**
   * Hears every change to the equipped set, however it was made — the screen,
   * a hotbar draw, the AI, a snapshot restore, a tutorial reset. Returns the
   * unsubscribe.
   */
  onChange(listener: EquipmentListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(change: EquipmentChange): void {
    this.changeCount++;
    for (const listener of this.listeners) listener(change);
  }

  /**
   * Counts every change to the equipped set, so a reader caching something
   * derived from it can tell whether its copy is stale without listening.
   */
  get revision(): number {
    return this.changeCount;
  }

  /**
   * Whether {@link equip} would actually put this item on.
   *
   * Exists because `equip` returns `null` for two opposite outcomes — nothing was
   * displaced, and nothing was worn — and a caller that reads the second as the
   * first announces a change that never happened. Ask this first when a refusal
   * has to be told apart from a quiet success.
   */
  canEquip(item: InventoryItem, targetKey?: string): item is WearableItem {
    if (!isWearable(item)) return false;
    if (this.boundOccupant(item, targetKey) !== null) return false;
    // Same reason as `replaceAll`: bag and hotbar slots are restored verbatim
    // from unvalidated save JSON, so an item carrying a since-retired id can
    // reach here through the ordinary equip path and would then crash
    // `getStatBonuses` on the next stat read.
    if (!isItemId(item.id)) return false;
    if (this.ownerKind !== null && !this.ownerMayWear(item.equipSlot, item.id)) return false;
    // The equipped map is id-keyed, so the same id worn in two trinket slots would
    // make every lookup ambiguous and leave one slot un-unequippable.
    return !this.isEquipped(item.id);
  }

  /**
   * The bound piece putting `item` on (into `targetKey`, when given) would
   * have to displace, or null when the sub-slot it would land in is free or
   * holds something that may come off.
   */
  boundOccupant(item: InventoryItem, targetKey?: string): ItemId | null {
    if (!isWearable(item)) return null;
    const key = this.resolveSubSlotKey(item, item.equipSlot, item.equipSubSlot, targetKey);
    const occupant = this.equipped.get(key);
    if (occupant === undefined || occupant === item.id) return null;
    return this.removalLocked(occupant) ? occupant : null;
  }

  /** Whether this crawler has the section `slot` and may wear `id` at all. */
  private ownerMayWear(slot: EquipSlot, id: ItemId): boolean {
    if (this.ownerKind === null) return true;
    const wearer = wearerOf(id);
    if (wearer === undefined || !wearerAllows(wearer, this.ownerKind)) return false;
    return crawlerHasSection(this.ownerKind, slot);
  }

  /** The sub-slots of `slot` that `item` fits on this crawler. */
  private fittingSubSlots(item: InventoryItem, slot: EquipSlot): readonly SubSlotId[] {
    return subSlotsOf(this.ownerKind, slot).filter((subSlot) => itemFitsSubSlot(item, subSlot));
  }

  /**
   * True when granting `item` would either fill an empty sub-slot it fits, or
   * beat whatever it would otherwise displace — the "new upgrade" badge's test.
   *
   * Mirrors {@link resolveSubSlotKey}'s own placement rule (empty slot first,
   * else the first fitting one) so the item this compares against is the same
   * one `equip` would actually hand back as displaced.
   */
  isUpgradeOverEquipped(item: InventoryItem): boolean {
    if (!isWearable(item) || !this.canEquip(item)) return false;
    const candidates = this.fittingSubSlots(item, item.equipSlot);
    if (candidates.length === 0) return false;
    const hasEmptyCandidate = candidates.some(
      (subSlot) => !this.equipped.has(`${item.equipSlot}:${subSlot}`),
    );
    if (hasEmptyCandidate) return true;
    const wornId = this.equipped.get(`${item.equipSlot}:${candidates[0]}`);
    if (wornId === undefined) return true;
    const worn = this.findItem(wornId);
    if (!worn) return true;
    return gearScore(item) > gearScore(worn);
  }

  /**
   * The `"Slot:SubSlot"` key this item is actually worn in, or null when it is
   * not worn at all.
   *
   * Read out of the equipped map rather than rebuilt from the item's own
   * `equipSlot`/`equipSubSlot`, because a family item declares the family
   * (`Trinket`) and is filed under a member of it (`Trinket 2`). Rebuilding the key
   * from the declaration produces one no slot has ever held, so the item could
   * never be taken off again.
   */
  findEquippedKey(itemId: ItemId): string | null {
    for (const [key, id] of this.equipped) {
      if (id === itemId) return key;
    }
    return null;
  }

  /** Take off whichever slot is holding `itemId`. Returns the item removed. */
  unequipById(itemId: ItemId): InventoryItem | null {
    const key = this.findEquippedKey(itemId);
    if (key === null) return null;
    return this.unequip(key);
  }

  /**
   * Decide which sub-slot an item goes into.
   *
   * A caller-named target is honoured only when the item actually fits it, so a
   * mis-aimed drop lands somewhere valid rather than filing a hat under Shoes.
   * Otherwise an empty matching sub-slot wins, so a second trinket lands beside the
   * first rather than on top of it; the fall-back to the first match preserves
   * the displace-in-place behaviour single-slot items have always had.
   */
  private resolveSubSlotKey(
    item: InventoryItem,
    slot: EquipSlot,
    declaredSubSlot: string,
    targetKey: string | undefined,
  ): string {
    const candidates = this.fittingSubSlots(item, slot);
    if (targetKey !== undefined) {
      const targetSubSlot = candidates.find((subSlot) => `${slot}:${subSlot}` === targetKey);
      if (targetSubSlot !== undefined) return targetKey;
    }
    if (candidates.length === 0) return `${slot}:${declaredSubSlot}`;
    const empty = candidates.find((subSlot) => !this.equipped.has(`${slot}:${subSlot}`));
    return `${slot}:${empty ?? candidates[0]}`;
  }

  /**
   * The `"Slot:SubSlot"` key {@link equip} would put `item` in: `targetKey`
   * when it fits there, else the first empty sub-slot it fits, else the first
   * it fits, whose wearer it would displace.
   */
  keyFor(item: WearableItem, targetKey?: string): string {
    return this.resolveSubSlotKey(item, item.equipSlot, item.equipSubSlot, targetKey);
  }

  /** Equip by looking up an item ID via the item finder. */
  equipById(itemId: ItemId): InventoryItem | null {
    const item = this.findItem(itemId);
    if (!item) return null;
    return this.equip(item);
  }

  /** Unequip the item in the given sub-slot key. Returns the unequipped item. */
  unequip(key: string): InventoryItem | null {
    const prev = this.getEquippedItem(key);
    // Read from the map, not the bag: a held weapon is unequipped exactly when the bag holds none of it.
    const removedItemId = this.equipped.get(key) ?? null;
    if (removedItemId !== null && this.removalLocked(removedItemId)) return null;
    if (!this.equipped.delete(key)) return prev;
    this.notify({ reason: 'unequip', key, itemId: null, removedItemId });
    return prev;
  }

  /**
   * Names the pieces that may not be taken off or displaced right now — a
   * cursed piece while it is bound. `clear` and `replaceAll` ignore it: they
   * reset the whole set rather than take a piece off.
   */
  setRemovalLock(isLocked: (id: ItemId) => boolean): void {
    this.removalLocked = isLocked;
  }

  /** Whether `id` is worn and may not come off right now. */
  isRemovalLocked(id: ItemId): boolean {
    return this.isEquipped(id) && this.removalLocked(id);
  }

  /** Remove every equipped item, leaving the wearer bare. */
  clear(): void {
    this.equipped.clear();
    this.notify({ reason: 'restore', key: null, itemId: null, removedItemId: null });
  }

  /** Serialisable view of the equipped set, for snapshots. */
  entries(): [string, ItemId][] {
    return [...this.equipped.entries()];
  }

  /**
   * Replace the whole equipped set from a snapshot's {@link entries} output.
   *
   * Ids are validated here even though the type claims they are `ItemId`: saves
   * arrive as unvalidated server JSON, and this is the one door they come
   * through. An id retired since the save was written would otherwise sit in the
   * map and crash {@link getStatBonuses} — which runs on every stat read — on
   * the next frame.
   *
   * Keys are validated against this crawler's sub-slots for the same reason: a
   * key written under a since-renamed slot would sit in the map where no doll
   * cell reaches it, giving its bonus forever with no way to take it off. A
   * sub-slot this crawler does not have is dropped too, as is an item that does
   * not fit the sub-slot it was saved under, an item {@link canEquip} would
   * refuse this crawler, and an id already placed.
   */
  replaceAll(entries: ReadonlyArray<readonly [string, ItemId]>): void {
    this.equipped.clear();
    const placed = new Set<ItemId>();
    for (const [key, id] of entries) {
      if (!isItemId(id) || placed.has(id)) continue;
      const address = equipAddressOfKey(this.ownerKind, key);
      if (address === null) continue;
      const def = ITEM_DEF[id];
      if (def.equipSlot !== address.slot || !itemFitsSubSlot(def, address.subSlot)) continue;
      if (!this.ownerMayWear(address.slot, id)) continue;
      this.equipped.set(key, id);
      placed.add(id);
    }
    this.notify({ reason: 'restore', key: null, itemId: null, removedItemId: null });
  }

  /** The item ID equipped in a sub-slot key, or undefined when the slot is bare. */
  getEquippedId(key: string): ItemId | undefined {
    return this.equipped.get(key);
  }

  /**
   * Get the item currently equipped in a sub-slot key ("Slot:SubSlot").
   */
  getEquippedItem(key: string): InventoryItem | null {
    const id = this.equipped.get(key);
    if (id === undefined) return null;
    return this.findItem(id);
  }

  /** True if any item with the given id is currently equipped. */
  hasEquipped(itemId: ItemId): boolean {
    for (const id of this.equipped.values()) {
      if (id === itemId) return true;
    }
    return false;
  }

  /** True if the given item ID is currently equipped in any slot. */
  isEquipped(itemId: ItemId): boolean {
    return this.hasEquipped(itemId);
  }

  /** The id of everything equipped, read straight off the map so it needs no bag lookup. */
  equippedIds(): IterableIterator<ItemId> {
    return this.equipped.values();
  }

  /** Returns all currently equipped items (skipping any that can no longer be found). */
  equippedItems(): InventoryItem[] {
    const items: InventoryItem[] = [];
    for (const id of this.equipped.values()) {
      const item = this.findItem(id);
      if (item) items.push(item);
    }
    return items;
  }

  /**
   * Sum all stat bonuses from currently equipped items.
   *
   * Read straight from `ITEM_DEF` rather than through {@link findItem}, and
   * recomputed rather than memoised. Both choices are about this being on the
   * hot path: every read of a stat — and so of max HP, several times a frame per
   * crawler — lands here. `findItem` linearly scans the bag and hotbar, which is
   * pure waste given `statBonus` is per-definition and never per-instance; and a
   * cache keyed on the equipped map would go stale, because bag and hotbar slots
   * are written directly in several places (save restore, tutorial reset, the
   * AI's `remove_item`). What remains is a loop over a handful of worn items.
   */
  getStatBonuses(): StatBonuses {
    const totals = emptyStatBonuses();
    for (const id of this.equipped.values()) {
      const bonus = ITEM_DEF[id].statBonus;
      if (!bonus) continue;
      for (const stat of ALL_STATS) {
        totals[stat] += bonus[stat] ?? 0;
      }
    }
    return totals;
  }

  /** True when anything worn resists the given damage channel. */
  hasResistance(type: ResistanceType): boolean {
    for (const id of this.equipped.values()) {
      if (ITEM_DEF[id].resistances?.includes(type) === true) return true;
    }
    return false;
  }

  /** True when anything worn makes its wearer immune to the given fairy magic. */
  hasFairyImmunity(element: FairyElement): boolean {
    for (const id of this.equipped.values()) {
      if (ITEM_DEF[id].fairyImmunities?.includes(element) === true) return true;
    }
    return false;
  }

  /** The product of every worn piece's regen multiplier; 1 when nothing worn changes regen. */
  getRegenMultiplier(): number {
    let total = 1;
    for (const id of this.equipped.values()) total *= ITEM_DEF[id].regenMultiplier ?? 1;
    return total;
  }

  /** True when anything worn cancels momentum-based attacks on contact. */
  getCancelsMomentum(): boolean {
    for (const id of this.equipped.values()) {
      if (ITEM_DEF[id].cancelsMomentum === true) return true;
    }
    return false;
  }

  /** Summed effective-level bonus worn gear grants to the given skill. */
  getSkillLevelBonus(id: SkillId): number {
    let total = 0;
    for (const equippedId of this.equipped.values()) {
      total += ITEM_DEF[equippedId].skillLevelBonus?.[id] ?? 0;
    }
    return total;
  }

  /** Summed stat bonus that counts only toward melee damage, not the stat itself. */
  getMeleeOnlyStatBonus(stat: StatName): number {
    let total = 0;
    for (const id of this.equipped.values()) {
      total += ITEM_DEF[id].meleeOnlyStatBonus?.[stat] ?? 0;
    }
    return total;
  }
}
