/**
 * Turns an item's `baseValue` (`src/core/ItemDefs.ts`) into what a specific
 * shop actually pays or charges for it right now.
 *
 * Three things stack multiplicatively on top of the base value:
 *  - the shop's own `generalMultiplier` (a bar marks everything up; a fence
 *    marks everything down),
 *  - an optional per-category or per-item multiplier (a farmer pays more for
 *    food than a street vendor does),
 *  - a saturation factor driven by how many units the shop currently holds —
 *    the more of a thing it's carrying (usually because the player just sold
 *    it a pile of them), the less the next one is worth.
 *
 * `ShopSystem` is the only current consumer: it owns one `MarketStock` per
 * shop and reads `heldFor` off it to find `unitsHeld` before pricing a row.
 */

import { ITEM_DEF, canSellItemId, type InventoryItem, type ItemId } from '../../core/ItemDefs';

/**
 * A coarse grouping used only for pricing — how a shop's profile decides "food
 * is worth more to me" or "I barely want your junk tools" without listing
 * every item id. Not the same axis as `InventoryItem.type`: food and potions
 * are both `'consumable'` there but price very differently here.
 */
export type ItemCategory =
  'potion' | 'food' | 'armor' | 'weapon' | 'tool' | 'resource' | 'tome' | 'misc';

const TOME_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'magic_missile_tome',
  'smush_tome',
  'explosives_handling_tome',
  'skill_book_cockroach',
  'skill_book_cat_reflexes',
  'skill_book_pugilism',
  'skill_book_iron_stomach',
  'skill_book_night_vision',
]);

const RESOURCE_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'wood',
  'stone',
  'wood_board',
  'rope',
]);

/** Which pricing bucket an item falls into. Pure function of the item def, never of who's asking. */
export function categoryOf(id: ItemId): ItemCategory {
  const def = ITEM_DEF[id];
  if (TOME_ITEM_IDS.has(id)) return 'tome';
  if (RESOURCE_ITEM_IDS.has(id)) return 'resource';
  if (def.type === 'armor') return 'armor';
  if (def.type === 'weapon') return 'weapon';
  if (def.type === 'tool') return 'tool';
  if (def.edible === true) return 'food';
  if (def.drinkable === true) return 'potion';
  return 'misc';
}

/**
 * How a shop's price on a line falls as it holds more units of it. The price
 * multiplier is `max(floor, 1 - dropPerUnit * unitsHeld)` — a straight line
 * down to a floor, rather than an exponential decay, so a shop's own numbers
 * ("drops to half by 10 units, never below a quarter") read directly off the
 * two fields.
 */
export interface SaturationCurve {
  /** Price multiplier lost per unit the shop holds. */
  readonly dropPerUnit: number;
  /** The multiplier saturation can never push the price below. */
  readonly floor: number;
}

/** A shop that doesn't saturate at all: every unit prices the same. */
export const NO_SATURATION: SaturationCurve = { dropPerUnit: 0, floor: 1 };

/** A shop's whole pricing personality: markup, per-category taste, and how fast each category saturates. */
export interface ShopPricingProfile {
  /** Applied to every line before any category or item override. */
  readonly generalMultiplier: number;
  /** Overrides `generalMultiplier` for a whole category, e.g. a farmer paying more for food. */
  readonly categoryMultipliers?: Partial<Record<ItemCategory, number>>;
  /** Overrides both of the above for one specific item. */
  readonly itemMultipliers?: Partial<Record<ItemId, number>>;
  /** The saturation curve used when a category has no override below. */
  readonly saturation: SaturationCurve;
  /** Overrides `saturation` for a category — the street vendor's food saturates fast, the farmer's slowly. */
  readonly categorySaturation?: Partial<Record<ItemCategory, SaturationCurve>>;
  /**
   * Units a held-stock line recovers per `ShopSystem.update()` tick (60/s
   * while that shop's interior is the active scene) — how fast a price the
   * player tanked by selling climbs back toward normal.
   */
  readonly heldStockRecoveryPerTick: number;
}

/** A shop with no opinions: 1x everywhere, no saturation, no recovery. Only for a line no profile bothers to price. */
export const NEUTRAL_PRICING_PROFILE: ShopPricingProfile = {
  generalMultiplier: 1,
  saturation: NO_SATURATION,
  heldStockRecoveryPerTick: 0,
};

function multiplierFor(profile: ShopPricingProfile, id: ItemId, category: ItemCategory): number {
  const itemOverride = profile.itemMultipliers?.[id];
  if (itemOverride !== undefined) return itemOverride;
  const categoryOverride = profile.categoryMultipliers?.[category];
  if (categoryOverride !== undefined) return categoryOverride;
  return profile.generalMultiplier;
}

function saturationFor(profile: ShopPricingProfile, category: ItemCategory): SaturationCurve {
  return profile.categorySaturation?.[category] ?? profile.saturation;
}

function saturationMultiplier(curve: SaturationCurve, unitsHeld: number): number {
  return Math.max(curve.floor, 1 - curve.dropPerUnit * unitsHeld);
}

/** The saturation multiplier alone, for a caller pricing off its own catalog number rather than `baseValue`. */
export function saturationFactor(
  profile: ShopPricingProfile,
  id: ItemId,
  unitsHeld: number,
): number {
  return saturationMultiplier(saturationFor(profile, categoryOf(id)), unitsHeld);
}

export const MIN_PRICE_COINS = 1;

/**
 * What this shop currently charges to sell the player one unit of `id`.
 *
 * When the shop already lists `id` on its buy catalog, pass that line's own
 * price as `catalogPrice` — it's priced off that number (still scaled by
 * saturation) rather than recomputed from `baseValue`, so a catalog line's
 * price never drifts from what `ShopSystem`'s buy screen already shows for
 * it. Only an item the shop has *no* catalog line for (something the player
 * is selling that this counter never stocked) falls back to `baseValue`.
 */
export function shopBuyPrice(
  id: ItemId,
  profile: ShopPricingProfile,
  unitsHeld: number,
  catalogPrice?: number,
): number {
  const satMult = saturationFactor(profile, id, unitsHeld);
  if (catalogPrice !== undefined)
    return Math.max(MIN_PRICE_COINS, Math.round(catalogPrice * satMult));
  const category = categoryOf(id);
  const raw = ITEM_DEF[id].baseValue * multiplierFor(profile, id, category) * satMult;
  return Math.max(MIN_PRICE_COINS, Math.round(raw));
}

/** A sell price is always exactly half of what the shop would charge to buy the item back right now. */
export const SELL_PRICE_FRACTION = 0.5;

/** What this shop currently pays the player for one unit of `id`, at the current stock level. See `shopBuyPrice` for `catalogPrice`. */
export function shopSellPrice(
  id: ItemId,
  profile: ShopPricingProfile,
  unitsHeld: number,
  catalogPrice?: number,
): number {
  return Math.max(
    MIN_PRICE_COINS,
    Math.round(shopBuyPrice(id, profile, unitsHeld, catalogPrice) * SELL_PRICE_FRACTION),
  );
}

/** Whether this shop's counter deals in `id` at all, as opposed to whether the player happens to be holding one. */
export function shopWillBuy(item: Pick<InventoryItem, 'id'>): boolean {
  return canSellItemId(item.id);
}
