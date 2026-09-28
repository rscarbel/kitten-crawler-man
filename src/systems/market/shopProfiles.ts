/**
 * One `ShopPricingProfile` per `ShopSystem`-backed counter in the game — the
 * General Store built fresh in every town, and the Desperado Club's bar and
 * gear rack. Each profile is the shop's whole pricing personality: how much it
 * marks goods up, which categories it especially wants or doesn't, and how
 * fast holding a lot of something drives its price down.
 */

import type { ItemCategory, SaturationCurve, ShopPricingProfile } from './shopPricing';

/** A gentle, general-purpose saturation: selling a stack matters, but never craters the price. */
const MODERATE_SATURATION: SaturationCurve = { dropPerUnit: 0.05, floor: 0.4 };

/**
 * A street-corner counter with limited storage: a few units of the same food
 * or potion in a row and it's visibly overstocked, so the price falls off
 * fast and hits a low floor.
 */
const FAST_SATURATION: SaturationCurve = { dropPerUnit: 0.12, floor: 0.3 };

/**
 * A shop with the room and the clientele to absorb a lot of one thing before
 * it feels overstocked — premium goods bought a unit at a time by a small,
 * steady crowd.
 */
const SLOW_SATURATION: SaturationCurve = { dropPerUnit: 0.02, floor: 0.6 };

/** `ShopSystem.update()` runs once per rendered frame. */
const TICKS_PER_SECOND = 60;
const GENERAL_STORE_RECOVERY_SECONDS_PER_UNIT = 25;
const CLUB_RECOVERY_SECONDS_PER_UNIT = 45;

/** No shop lets a sold-back item recover its price in under several seconds, or a sell-then-rebuy loop is free money. */
const GENERAL_STORE_RECOVERY_PER_TICK =
  1 / (TICKS_PER_SECOND * GENERAL_STORE_RECOVERY_SECONDS_PER_UNIT);
const CLUB_RECOVERY_PER_TICK = 1 / (TICKS_PER_SECOND * CLUB_RECOVERY_SECONDS_PER_UNIT);

/**
 * The town General Store — every food and potion in it turns over constantly,
 * so a player who dumps a stack of jerky on the counter tanks its price
 * almost immediately (a street vendor selling in volume). Armor and gear
 * barely move, so those categories saturate slowly.
 */
export const GENERAL_STORE_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  saturation: MODERATE_SATURATION,
  categorySaturation: {
    food: FAST_SATURATION,
    potion: FAST_SATURATION,
    armor: SLOW_SATURATION,
    tool: SLOW_SATURATION,
  },
  heldStockRecoveryPerTick: GENERAL_STORE_RECOVERY_PER_TICK,
};

const CLUB_BAR_CATEGORY_MULTIPLIERS: Partial<Record<ItemCategory, number>> = {
  potion: 1.3,
  food: 1.3,
};

/**
 * The Desperado bar pours at a premium — its regulars pay club prices, not
 * street prices — and its small, curated pour list barely saturates: it can
 * carry a case of your dynamite... except the bar's own list never sells that,
 * so in practice this is potions and the house drink.
 */
export const CLUB_BAR_PRICING: ShopPricingProfile = {
  generalMultiplier: 1.15,
  categoryMultipliers: CLUB_BAR_CATEGORY_MULTIPLIERS,
  saturation: SLOW_SATURATION,
  heldStockRecoveryPerTick: CLUB_RECOVERY_PER_TICK,
};

/**
 * The club's gear rack: exclusive armor and one-off consumables sold at a
 * steep markup, to members who don't haggle. Everything here is rare enough
 * that holding even a couple of units barely moves the price.
 */
export const CLUB_MARKET_PRICING: ShopPricingProfile = {
  generalMultiplier: 1.4,
  saturation: SLOW_SATURATION,
  heldStockRecoveryPerTick: CLUB_RECOVERY_PER_TICK,
};

const TOWN_SERVICE_RECOVERY_SECONDS_PER_UNIT = 30;
const TOWN_SERVICE_RECOVERY_PER_TICK =
  1 / (TICKS_PER_SECOND * TOWN_SERVICE_RECOVERY_SECONDS_PER_UNIT);

/**
 * A specialty stall that mostly turns over food and drink fast — the plaza's
 * Greengrocer and the club market's opposite number: high volume, low margin
 * per unit, so selling in bulk here craters the price the way it would for
 * any street vendor.
 */
export const STREET_VENDOR_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  saturation: MODERATE_SATURATION,
  categorySaturation: { food: FAST_SATURATION, potion: FAST_SATURATION },
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};

/** A general-goods merchant stall — the Tinker's bench, Cartwright's yard: odds and ends, no specialty. */
export const MERCHANT_STALL_PRICING: ShopPricingProfile = {
  generalMultiplier: 1.05,
  saturation: MODERATE_SATURATION,
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};

const ARMOURY_CATEGORY_MULTIPLIERS: Partial<Record<ItemCategory, number>> = {
  armor: 1.1,
  weapon: 1.1,
};

/** The quartermaster's counter: worn kit, reissued — she wants armor and weapons back more than anything else on a crawler. */
export const ARMOURY_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  categoryMultipliers: ARMOURY_CATEGORY_MULTIPLIERS,
  saturation: SLOW_SATURATION,
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};

const APOTHECARY_CATEGORY_MULTIPLIERS: Partial<Record<ItemCategory, number>> = { potion: 1.1 };

/** Herb & Remedy: a small, careful batch, so it saturates a little faster than the General Store's shelf of the same bottle. */
export const APOTHECARY_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  categoryMultipliers: APOTHECARY_CATEGORY_MULTIPLIERS,
  saturation: MODERATE_SATURATION,
  categorySaturation: { potion: MODERATE_SATURATION },
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};

const FARMER_CATEGORY_MULTIPLIERS: Partial<Record<ItemCategory, number>> = { food: 1.25 };

/**
 * The farmer's rate: Miller's Farm and Pipkin's kitchen both feed a lot of
 * mouths on purpose, so — the brief's own example — food sold here is worth
 * more per unit than at a street vendor's cart, and a big stack barely moves
 * the price at all before it's absorbed.
 */
export const FARMER_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  categoryMultipliers: FARMER_CATEGORY_MULTIPLIERS,
  saturation: MODERATE_SATURATION,
  categorySaturation: { food: SLOW_SATURATION },
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};

/** Vetch's Nibnose Trading Post: a frontier general store, priced the same shape as the town's own. */
export const TRADING_POST_PRICING: ShopPricingProfile = {
  generalMultiplier: 1,
  saturation: MODERATE_SATURATION,
  categorySaturation: { food: FAST_SATURATION, potion: FAST_SATURATION },
  heldStockRecoveryPerTick: TOWN_SERVICE_RECOVERY_PER_TICK,
};
