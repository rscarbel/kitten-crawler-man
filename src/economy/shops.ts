/**
 * Every counter that sells items to the player or buys them back, with all of
 * its pricing in one object: its markups, its specialties, its stock curve and
 * its catalog.
 *
 * A catalog line has no price. What a shop charges is always the item's base
 * price (`itemPrices.ts`) times the shop's markup times its stock multiplier,
 * so a shop that sells something dearer says so with `markup`,
 * `categoryMarkup` or `itemMarkup`, and that shows up in the price breakdown
 * with the shop's name on it. What it pays is that price, quoted at the stock
 * it will hold after taking the unit, times its buyback fraction (`pricing.ts`).
 *
 * Stock moves price in both directions and every shelf restocks toward its
 * normal level at one global rate (see `shopStock.ts`), so a shop has no
 * restock setting of its own.
 *
 * To change how one shop prices, edit its entry here; to change what an item
 * is worth everywhere, edit `ITEM_PRICES`. Check with `npm run report:prices`
 * (`-- --shop <id>` or `-- --item <id>` to narrow it), or in game with
 * `?prices`.
 */

import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import type { ItemCategory } from './itemPrices';
import {
  FRONTIER,
  FRONTIER_STREET,
  MODERATE,
  PREMIUM,
  STREET,
  type StockCurve,
} from './stockCurves';

/**
 * A condition outside the shop that decides whether a line is on the counter
 * at all, as opposed to stock, which is about how many are left.
 *
 * A gated line is absent rather than greyed out: a row reading "Anchor Shard —
 * unavailable" to a player who has never heard of the Anchor is a puzzle piece
 * with no puzzle. The scene answers the condition, since the shop has no way
 * to know what the party is carrying or which quests are live.
 */
export type VendorLineGate = 'anchor_shard';

/** A pack of several units sold as one row, at a discount off the unit price. */
export interface CatalogBundle {
  readonly quantity: number;
  /** Fraction off `quantity` × the unit price, e.g. 0.1 for ten percent off. */
  readonly bundleDiscount: number;
}

/** One row a shop sells. */
export interface CatalogLine {
  readonly item: ItemId;
  /**
   * The stock level the shop considers normal. 'unlimited' never runs out and
   * never gets scarce. Every line for the same item at one shop shares one
   * stock count, so a bundle line normally repeats its single line's figure.
   */
  readonly normalStock: number | 'unlimited';
  /** Shown instead of the item's name, for a shop that brands its own (the apothecary's "Marsh Poultice"). */
  readonly label?: string;
  readonly desc?: string;
  /** Sold as a pack of this many, at `bundleDiscount` off the unit price. */
  readonly bundle?: CatalogBundle;
  /** Only on the counter while the scene says this gate is open (the Tinker's Anchor shard). */
  readonly gate?: VendorLineGate;
}

/** One counter's whole pricing personality and what it sells. */
export interface ShopDef {
  readonly name: string;
  /** Multiplies every price at this counter, buying and selling. 1 = sells at base. */
  readonly markup: number;
  /** Specialty taste: replaces `markup` for a whole category. Applies to both what it charges and what it pays. */
  readonly categoryMarkup?: Partial<Record<ItemCategory, number>>;
  /** Replaces both of the above for one item. */
  readonly itemMarkup?: Partial<Record<ItemId, number>>;
  /** The categories this shop specialises in: it buys these back at SPECIALTY_BUYBACK instead of DEFAULT_BUYBACK. */
  readonly specialties?: readonly ItemCategory[];
  /** How stock moves price at this counter. */
  readonly stockCurve: StockCurve;
  /** Replaces `stockCurve` for a category, for a shop that turns food over faster than gear. */
  readonly categoryStockCurve?: Partial<Record<ItemCategory, StockCurve>>;
  /** Whether it has a Sell tab at all. */
  readonly buysFromPlayer: boolean;
  readonly catalog: readonly CatalogLine[];
}

export const SHOPS = {
  /**
   * The town General Store: every food and potion in it turns over
   * constantly, so a player who dumps a stack on the counter tanks its price
   * almost immediately. Armour and gear barely move.
   */
  general_store: {
    name: 'General Store',
    markup: 1,
    stockCurve: MODERATE,
    categoryStockCurve: { food: STREET, potion: STREET, armor: PREMIUM, tool: PREMIUM },
    buysFromPlayer: true,
    catalog: [
      { item: 'health_potion', normalStock: 'unlimited', desc: 'Restores 50% max HP' },
      { item: 'goblin_dynamite', normalStock: 'unlimited', desc: 'Throw for AoE damage' },
      { item: 'scroll_of_confusing_fog', normalStock: 'unlimited', desc: 'Blinds nearby enemies' },
    ],
  },

  /**
   * Bess Ottoline's cart in the square: high volume, low margin, so selling
   * food or drink here in bulk craters the price the way it would at any
   * street vendor. She wants food back more than anything else.
   */
  greengrocer: {
    name: "Greengrocer's Cart",
    markup: 1,
    specialties: ['food'],
    stockCurve: MODERATE,
    categoryStockCurve: { food: STREET, potion: STREET },
    buysFromPlayer: true,
    catalog: [
      { item: 'cooldown_crisp', normalStock: 'unlimited', desc: 'Halves ability cooldowns, 25s' },
      { item: 'jugg_juice', normalStock: 'unlimited', desc: '+50% max HP & full heal, 30s' },
    ],
  },

  /**
   * Orlo Pemberwick's bench: potions, fizz and odds and ends, no specialty.
   * He priced the Anchor's first shard as scrap, and never revised it.
   */
  tinker: {
    name: "Tinker's Stall",
    markup: 1,
    stockCurve: MODERATE,
    buysFromPlayer: true,
    // The shard leads the counter while its gate is open: the panel draws rows
    // in catalog order and hands its accept key to the first buyable quest row,
    // so a player sent here for the shard can take it without walking past the
    // potions.
    catalog: [
      {
        item: 'anchor_shard_tinker',
        normalStock: 'unlimited',
        label: 'Anchor Shard',
        desc: 'Odd grey wedge. Voss wants it',
        gate: 'anchor_shard',
      },
      { item: 'health_potion', normalStock: 'unlimited', desc: 'Restores 50% max HP' },
      { item: 'speed_fizz', normalStock: 'unlimited', desc: 'Doubles move speed, 25s' },
    ],
  },

  /**
   * The Desperado Club's bar pours at a premium: its regulars pay club
   * prices, not street prices, and its small, curated pour list barely moves
   * with stock. The house special is poured at cost, because it is what
   * brings members to the bar. It buys bottles back only at the ordinary
   * rate: a bar that marks potions up this far and paid a specialist's share
   * on top would pay more for a potion than any other counter charges for it.
   */
  club_bar: {
    name: 'The Bar',
    markup: 1.15,
    categoryMarkup: { potion: 1.67, food: 1.67 },
    itemMarkup: {
      dirty_shirley: 1,
      jugg_juice: 1.36,
      /**
       * Not on the pour list, so the bar values a health potion at what it is
       * worth, not at its pour markup, and never pays more for one than Fen's
       * cheaper poultice costs.
       */
      health_potion: 1,
    },
    stockCurve: PREMIUM,
    buysFromPlayer: true,
    // The house special leads the board, because that is what a house special is.
    catalog: [
      {
        item: 'dirty_shirley',
        normalStock: 'unlimited',
        desc: 'The house special. Ask for it dirty',
      },
      { item: 'speed_fizz', normalStock: 'unlimited', desc: 'Double move speed, 25s' },
      { item: 'cooldown_crisp', normalStock: 'unlimited', desc: 'Halve ability cooldowns, 25s' },
      { item: 'jugg_juice', normalStock: 'unlimited', desc: '+50% max HP & full heal, 30s' },
    ],
  },

  /**
   * The club's gear rack: club-exclusive equipment otherwise only won off
   * dangerous foes, sold at what it is worth to members who don't haggle.
   * Everything here is rare enough that holding a couple of units barely
   * moves the price, and the last one on the shelf is dear.
   */
  club_market: {
    name: 'The Market',
    markup: 1,
    stockCurve: PREMIUM,
    buysFromPlayer: true,
    catalog: [
      {
        item: 'stat_boost_potion',
        normalStock: 1,
        desc: '+2-4 to a random stat, permanent',
      },
      {
        item: 'trollskin_shirt',
        normalStock: 'unlimited',
        label: 'Trollskin Shirt',
        desc: '+3 CON, 2.5x regen, negates melee debuffs',
      },
      {
        item: 'enchanted_crown_sepsis_whore',
        normalStock: 'unlimited',
        label: 'Crown of the Sepsis Whore',
        desc: '+5 INT, attacks can inflict Sepsis',
      },
    ],
  },

  /**
   * The town's drinking houses, for the one thing on their boards that is an
   * item rather than a round: Speed Fizz, opened and downed at the bar. They
   * buy nothing back; the rounds themselves are services.
   */
  pub: {
    name: 'The Tavern',
    markup: 1,
    itemMarkup: {
      /** Poured on the spot rather than sold sealed to carry off, so it goes for a little under the stalls' price. */
      speed_fizz: 0.83,
    },
    stockCurve: MODERATE,
    buysFromPlayer: false,
    catalog: [
      {
        item: 'speed_fizz',
        normalStock: 'unlimited',
        desc: 'Not a drink, really. Move speed x2, 25s',
      },
    ],
  },

  /**
   * The Barracks quartermaster: worn kit, reissued at what it is worth. She
   * wants armour and weapons back more than anything else on a crawler, and a
   * stack of them barely moves her price.
   */
  armoury: {
    name: 'The Quartermaster',
    markup: 1,
    specialties: ['armor', 'weapon'],
    stockCurve: PREMIUM,
    buysFromPlayer: true,
    // Cheapest first, which is also weakest first: a crawler reading down the
    // board sees the price climbing with the protection rather than having to
    // work it out from four stat lines.
    catalog: [
      {
        item: 'issue_kettle_helm',
        normalStock: 'unlimited',
        desc: 'Iron, wide brim, one dent. +1 Constitution',
      },
      {
        item: 'riveted_bracers',
        normalStock: 'unlimited',
        desc: 'Boiled leather on the blocking arm. +1 Strength',
      },
      {
        item: 'padded_gambeson',
        normalStock: 'unlimited',
        desc: 'Twenty layers, quilted through. +2 Constitution',
      },
      {
        item: 'marching_boots',
        normalStock: 'unlimited',
        desc: 'Hobnailed and already broken in. +1 Dexterity',
      },
      {
        item: 'bracelet_of_dex',
        normalStock: 'unlimited',
        desc: 'An agility boosting accessory equipped on the front leg. +2 Dexterity',
      },
    ],
  },

  /**
   * Herb & Remedy: Fen makes up a small, careful batch, so her shelf gluts a
   * little faster than the General Store's, and she pays best for potions.
   */
  apothecary: {
    name: 'Herb & Remedy',
    markup: 1,
    itemMarkup: {
      /**
       * Her poultice undercuts the General Store's potion only on the first
       * unit of a batch; the scarcity curve lifts the next ones to the store's
       * price, and only three are made up at a time, so the store's unlimited
       * line still has a reason to exist.
       */
      health_potion: 0.8,
      /** The ruin-root tonic is Jugg Juice ground by hand, at an apothecary's margin. */
      jugg_juice: 1.18,
    },
    specialties: ['potion'],
    stockCurve: MODERATE,
    buysFromPlayer: true,
    catalog: [
      {
        item: 'health_potion',
        normalStock: 3,
        label: 'Marsh Poultice',
        desc: 'A health potion, cheap',
      },
      {
        item: 'jugg_juice',
        normalStock: 'unlimited',
        label: 'Ruin-Root Tonic',
        desc: 'Jugg Juice, ground here rather than poured at the club',
      },
    ],
  },

  /**
   * Brann's yard sells the dynamite he clears stumps with, at the General
   * Store's price rather than under it: the walk out here is worth it for the
   * three-stick bundle, not for a cheaper single stick, which would retire the
   * store's line.
   */
  cartwright: {
    name: "Cartwright's Workshop",
    markup: 1,
    stockCurve: MODERATE,
    buysFromPlayer: true,
    catalog: [
      {
        item: 'goblin_dynamite',
        normalStock: 'unlimited',
        label: 'Stick of Dynamite',
        desc: 'Goblin Dynamite, at yard prices',
      },
      {
        item: 'goblin_dynamite',
        normalStock: 'unlimited',
        label: 'Bundle of Three',
        desc: '3 sticks, for people clearing something large',
        bundle: { quantity: 3, bundleDiscount: 0.13 },
      },
    ],
  },

  /**
   * Miller's Farm feeds a lot of mouths on purpose, so food sold here is
   * worth more per unit than at a street vendor's cart, and a big stack
   * barely moves the price before it is absorbed.
   */
  millers_farm: {
    name: "Miller's Farm",
    markup: 1,
    categoryMarkup: { food: 1.25 },
    itemMarkup: {
      /** Under the club bar's pour, because Marta bakes them rather than importing them, but over the cart's. */
      cooldown_crisp: 1.33,
    },
    specialties: ['food'],
    stockCurve: MODERATE,
    categoryStockCurve: { food: PREMIUM },
    buysFromPlayer: true,
    catalog: [
      {
        item: 'cooldown_crisp',
        normalStock: 'unlimited',
        label: 'Bag of Crisps',
        desc: 'Cooldown Crisps, off the tray rather than off the bar',
      },
    ],
  },
  /**
   * Vetch's Nibnose Trading Post: a little of everything at the far end of a
   * long supply line, in small lots. A shelf that runs down gets dear fast,
   * because the next cart is a long way off.
   */
  trading_post: {
    name: 'Nibnose Trading Post',
    /** A village carries its goods a long way, so everything the town also sells costs a tenth more here. */
    markup: 1.1,
    /**
     * Construction materials sell at base, which is already dearer than Fenna
     * turning a party's own wood into them, so gathering stays the cheap way.
     */
    categoryMarkup: { resource: 1 },
    itemMarkup: {
      /** Burgers resold from Pipkin's kitchen, cold, at a quarter over what he charges. */
      hamburger: 1.25,
      /** Half again over base, so buying stone never undercuts the party breaking its own rocks. */
      stone: 1.5,
    },
    stockCurve: FRONTIER,
    categoryStockCurve: { food: FRONTIER_STREET, potion: FRONTIER_STREET },
    buysFromPlayer: true,
    catalog: [
      { item: 'health_potion', normalStock: 5 },
      { item: 'goblin_dynamite', normalStock: 4 },
      { item: 'rope', normalStock: 10 },
      { item: 'wood_board', normalStock: 20 },
      { item: 'stone', normalStock: 20 },
      { item: 'hamburger', normalStock: 3 },
    ],
  },
  /**
   * Pipkin's Cookhouse feeds the whole garrison: food at the town's price, a
   * kitchen that never runs out, and a cook who takes food back at a good rate
   * and barely notices a stack of it.
   */
  cookhouse: {
    name: "Pipkin's Cookhouse",
    markup: 1,
    specialties: ['food'],
    stockCurve: MODERATE,
    categoryStockCurve: { food: PREMIUM },
    buysFromPlayer: true,
    catalog: [
      { item: 'hamburger', normalStock: 'unlimited' },
      { item: 'hollow_stew', normalStock: 'unlimited' },
    ],
  },
} as const satisfies Record<string, ShopDef>;

export type ShopId = keyof typeof SHOPS;

/** A shop's entry, widened to `ShopDef` so optional fields read uniformly across shops. */
export function shopDef(shop: ShopId): ShopDef {
  return SHOPS[shop];
}

/** Narrows a stored key fragment back to a shop that still exists. */
export function isShopId(value: string): value is ShopId {
  return Object.keys(SHOPS).includes(value);
}

/**
 * The line that sets an item's normal stock and is priced one unit at a time:
 * the first line for it that is not a bundle, else its first line, else
 * undefined when the shop does not list the item.
 */
export function primaryCatalogLine(shop: ShopId, item: ItemId): CatalogLine | undefined {
  const lines = shopDef(shop).catalog.filter((line) => line.item === item);
  return lines.find((line) => line.bundle === undefined) ?? lines[0];
}

/** The units one row hands over: a bundle's quantity, else one. */
export function catalogLineUnits(line: CatalogLine): number {
  return line.bundle?.quantity ?? 1;
}

/** The name a row shows: the shop's own label for it, else the item's name. */
export function catalogLineLabel(line: CatalogLine): string {
  return line.label ?? ITEM_DEF[line.item].name;
}
