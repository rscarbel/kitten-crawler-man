/**
 * How a shop's stock moves its price, as a small set of named curves shops
 * share. A shop picks one in `shops.ts` and may override it per category.
 *
 * Stock is measured against the line's normal stock (`CatalogLine.normalStock`;
 * 0 for an `'unlimited'` line or an item the shop does not list):
 *
 *  - **Below normal** (a limited line bought down), the price climbs linearly:
 *    `1 + scarcityMarkup × (1 − current / normal)`, so half gone is half the
 *    markup. Unlimited lines never get scarce.
 *  - **Above normal** (the player sold units in), the price falls linearly to
 *    a floor: `max(glutFloor, 1 − glutDropPerUnit × (current − normal))`.
 *  - **At normal**, exactly 1.
 */

/** One shop's answer to "how much does having more or less of this change its price?" */
export interface StockCurve {
  /** Markup reached as a limited line approaches empty: the last unit costs base × (1 + scarcityMarkup). */
  readonly scarcityMarkup: number;
  /** Multiplier lost per unit held above normal. */
  readonly glutDropPerUnit: number;
  /** The glut multiplier never goes below this. */
  readonly glutFloor: number;
}

/**
 * A street-corner counter with limited storage: a few units of the same food
 * or potion in a row and it is visibly overstocked, so the price falls off
 * fast and hits a low floor.
 */
export const STREET: StockCurve = { scarcityMarkup: 0.25, glutDropPerUnit: 0.12, glutFloor: 0.3 };

/** A gentle, general-purpose curve: selling a stack matters, but never craters the price. */
export const MODERATE: StockCurve = { scarcityMarkup: 0.25, glutDropPerUnit: 0.05, glutFloor: 0.4 };

/**
 * A shop with the room and the clientele to absorb a lot of one thing before
 * it feels overstocked: premium goods bought a unit at a time by a small,
 * steady crowd. Rare enough that the last one on the shelf is dear.
 */
export const PREMIUM: StockCurve = { scarcityMarkup: 0.5, glutDropPerUnit: 0.02, glutFloor: 0.6 };

/**
 * A village shop at the end of a long supply line: it gluts like a general
 * store, but a shelf running out costs half as much again by its last unit,
 * because the next cart is a long way off.
 */
export const FRONTIER: StockCurve = { scarcityMarkup: 0.5, glutDropPerUnit: 0.05, glutFloor: 0.4 };

/** {@link FRONTIER}'s scarcity on {@link STREET}'s glut, for a village shop's fast-turnover food and potions. */
export const FRONTIER_STREET: StockCurve = {
  scarcityMarkup: 0.5,
  glutDropPerUnit: 0.12,
  glutFloor: 0.3,
};
