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

import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import type { ItemCategory } from './itemPrices';
import {
  FRONTIER,
  FRONTIER_STREET,
  MODERATE,
  PREMIUM,
  STREET,
  type StockCurve,
} from './stockCurves';
import { buildingDisplayName, type BuildingId } from '../map/buildingIds';

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
  /** The row's name at this counter: the item's own name, or a shop's brand for it (the apothecary's "Marsh Poultice"). */
  readonly label: string;
  /** The line under the offer's name: what it does, in the counter's own words. */
  readonly desc: string;
  /** Sold as a pack of this many, at `bundleDiscount` off the unit price; null for a single unit. */
  readonly bundle: CatalogBundle | null;
  /** Only on the counter while the scene says this gate is open (the Tinker's Anchor shard); null for an always-stocked line. */
  readonly gate: VendorLineGate | null;
}

/** One counter's whole pricing personality and what it sells. */
export interface ShopDef {
  /**
   * The counter's title. A shop that is its building's own counter is titled
   * by the building's sign, so the two cannot drift apart.
   */
  readonly title: { readonly building: BuildingId } | { readonly name: string };
  /** Multiplies every price at this counter, buying and selling. 1 = sells at base. */
  readonly markup: number;
  /** Specialty taste: replaces `markup` for a whole category. Applies to both what it charges and what it pays. */
  readonly categoryMarkup: Partial<Record<ItemCategory, number>>;
  /** Replaces both of the above for one item. */
  readonly itemMarkup: Partial<Record<ItemId, number>>;
  /** The categories this shop specialises in: it buys these back at SPECIALTY_BUYBACK instead of DEFAULT_BUYBACK. */
  readonly specialties: readonly ItemCategory[];
  /** How stock moves price at this counter. */
  readonly stockCurve: StockCurve;
  /** Replaces `stockCurve` for a category, for a shop that turns food over faster than gear. */
  readonly categoryStockCurve: Partial<Record<ItemCategory, StockCurve>>;
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
    title: { building: 'taloncrest_general_store' },
    markup: 1,
    categoryMarkup: {},
    itemMarkup: {},
    specialties: [],
    stockCurve: MODERATE,
    categoryStockCurve: { food: STREET, potion: STREET, armor: PREMIUM, tool: PREMIUM },
    buysFromPlayer: true,
    catalog: [
      {
        item: 'health_potion',
        normalStock: 'unlimited',
        desc: 'Restores 50% max HP',
        label: 'Health Potion',
        bundle: null,
        gate: null,
      },
      {
        item: 'dynamite',
        normalStock: 'unlimited',
        desc: 'Throw for AoE damage',
        label: 'Dynamite',
        bundle: null,
        gate: null,
      },
      {
        item: 'smoke_bomb',
        normalStock: 'unlimited',
        desc: 'Throw for a cloud enemies lose you in',
        label: 'Smoke Bomb',
        bundle: null,
        gate: null,
      },
      {
        item: 'scroll_of_entanglement',
        normalStock: 'unlimited',
        desc: 'Roots hold nearby enemies',
        label: 'Scroll of Entanglement',
        bundle: null,
        gate: null,
      },
      {
        item: 'quest_tuna_tin',
        normalStock: 'unlimited',
        desc: 'Tuna in oil. A cat will do a great deal for one',
        label: 'Tinned Tuna',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * Bess Ottoline's cart in the square: high volume, low margin, so selling
   * food or drink here in bulk craters the price the way it would at any
   * street vendor. She wants food back more than anything else.
   */
  greengrocer: {
    title: { name: "Greengrocer's Cart" },
    markup: 1,
    specialties: ['food'],
    categoryMarkup: {},
    itemMarkup: {},
    stockCurve: MODERATE,
    categoryStockCurve: { food: STREET, potion: STREET },
    buysFromPlayer: true,
    catalog: [
      {
        item: 'cooldown_crisp',
        normalStock: 'unlimited',
        desc: 'Halves ability cooldowns, 25s',
        label: 'Cooldown Crisp',
        bundle: null,
        gate: null,
      },
      {
        item: 'jugg_juice',
        normalStock: 'unlimited',
        desc: '+50% max HP & full heal, 30s',
        label: 'Jugg Juice',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * Orlo Pemberwick's bench: potions, fizz and odds and ends, no specialty.
   * He priced the Anchor's first shard as scrap, and never revised it.
   */
  tinker: {
    title: { name: "Tinker's Stall" },
    markup: 1,
    categoryMarkup: {},
    itemMarkup: {},
    specialties: [],
    stockCurve: MODERATE,
    categoryStockCurve: {},
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
        bundle: null,
      },
      {
        item: 'health_potion',
        normalStock: 'unlimited',
        desc: 'Restores 50% max HP',
        label: 'Health Potion',
        bundle: null,
        gate: null,
      },
      {
        item: 'speed_fizz',
        normalStock: 'unlimited',
        desc: 'Doubles move speed, 25s',
        label: 'Speed Fizz',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * The Cloak & Dagger's bar pours at a premium: its regulars pay club
   * prices, not street prices, and its small, curated pour list barely moves
   * with stock. The house special is poured at cost, because it is what
   * brings members to the bar. It buys bottles back only at the ordinary
   * rate: a bar that marks potions up this far and paid a specialist's share
   * on top would pay more for a potion than any other counter charges for it.
   */
  club_bar: {
    title: { name: 'The Bar' },
    markup: 1.15,
    categoryMarkup: { potion: 1.67, food: 1.67 },
    itemMarkup: {
      catnip_tuna_water: 1,
      jugg_juice: 1.36,
      /**
       * Not on the pour list, so the bar values a health potion at what it is
       * worth, not at its pour markup, and never pays more for one than Fen's
       * cheaper poultice costs.
       */
      health_potion: 1,
    },
    specialties: [],
    stockCurve: PREMIUM,
    categoryStockCurve: {},
    buysFromPlayer: true,
    // The house special leads the board, because that is what a house special is.
    catalog: [
      {
        item: 'catnip_tuna_water',
        normalStock: 'unlimited',
        desc: 'The house special, for the cat. Served in the tin',
        label: 'Catnip Infused Tuna Water',
        bundle: null,
        gate: null,
      },
      {
        item: 'speed_fizz',
        normalStock: 'unlimited',
        desc: 'Double move speed, 25s',
        label: 'Speed Fizz',
        bundle: null,
        gate: null,
      },
      {
        item: 'cooldown_crisp',
        normalStock: 'unlimited',
        desc: 'Halve ability cooldowns, 25s',
        label: 'Cooldown Crisp',
        bundle: null,
        gate: null,
      },
      {
        item: 'jugg_juice',
        normalStock: 'unlimited',
        desc: '+50% max HP & full heal, 30s',
        label: 'Jugg Juice',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * The club's gear rack: club-exclusive equipment otherwise only won off
   * dangerous foes, sold at what it is worth to members who don't haggle.
   * Everything here is rare enough that holding a couple of units barely
   * moves the price, and the last one on the shelf is dear.
   */
  club_market: {
    title: { name: 'The Market' },
    markup: 1,
    categoryMarkup: {},
    itemMarkup: {
      /** A charm for the tables, sold to gamblers by people who know what gamblers pay. */
      lucky_penny: 2.5,
    },
    specialties: [],
    stockCurve: PREMIUM,
    categoryStockCurve: {},
    buysFromPlayer: true,
    catalog: [
      {
        item: 'stat_boost_potion',
        normalStock: 1,
        desc: '+2-4 points to a random stat, permanent',
        label: 'Stat Boost',
        bundle: null,
        gate: null,
      },
      {
        item: 'lucky_penny',
        normalStock: 1,
        label: ITEM_DEF.lucky_penny.name,
        desc: 'A little extra coin from every kill and chest',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * The town's drinking houses, for the one thing on their boards that is an
   * item rather than a round: Speed Fizz, opened and downed at the bar. They
   * buy nothing back; the rounds themselves are services.
   */
  pub: {
    title: { name: 'The Tavern' },
    markup: 1,
    itemMarkup: {
      /** Poured on the spot rather than sold sealed to carry off, so it goes for a little under the stalls' price. */
      speed_fizz: 0.83,
    },
    categoryMarkup: {},
    specialties: [],
    stockCurve: MODERATE,
    categoryStockCurve: {},
    buysFromPlayer: false,
    catalog: [
      {
        item: 'speed_fizz',
        normalStock: 'unlimited',
        desc: 'Not a drink, really. Move speed x2, 25s',
        label: 'Speed Fizz',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * The Barracks quartermaster: worn kit, reissued at what it is worth. She
   * wants armour and weapons back more than anything else on a crawler, and a
   * stack of them barely moves her price.
   */
  armoury: {
    title: { name: 'The Quartermaster' },
    markup: 1,
    specialties: ['armor', 'weapon'],
    categoryMarkup: {},
    itemMarkup: {},
    stockCurve: PREMIUM,
    categoryStockCurve: {},
    buysFromPlayer: true,
    // Cheapest first, which is also weakest first: a crawler reading down the
    // board sees the price climbing with the protection rather than having to
    // work it out from four stat lines.
    catalog: [
      {
        item: 'hearthguard_cap',
        normalStock: 'unlimited',
        desc: 'Padded wool, garrison brown. +2 Health',
        label: ITEM_DEF.hearthguard_cap.name,
        bundle: null,
        gate: null,
      },
      {
        item: 'hearthguard_bracers',
        normalStock: 'unlimited',
        desc: 'Boiled leather on the blocking arm. +1 Melee',
        label: ITEM_DEF.hearthguard_bracers.name,
        bundle: null,
        gate: null,
      },
      {
        item: 'hearthguard_boots',
        normalStock: 'unlimited',
        desc: 'Hard-soled and broken in. +1 Evasiveness',
        label: ITEM_DEF.hearthguard_boots.name,
        bundle: null,
        gate: null,
      },
      {
        item: 'nimble_bangle',
        normalStock: 'unlimited',
        desc: 'A thin copper band. +1 Evasiveness',
        label: ITEM_DEF.nimble_bangle.name,
        bundle: null,
        gate: null,
      },
      {
        item: 'hearthguard_quilted_vest',
        normalStock: 'unlimited',
        desc: 'Quilted through, in every size. +4 Health',
        label: ITEM_DEF.hearthguard_quilted_vest.name,
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * Herb & Remedy: Fen makes up a small, careful batch, so her shelf gluts a
   * little faster than the General Store's, and she pays best for potions.
   */
  apothecary: {
    title: { building: 'taloncrest_apothecary' },
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
    categoryMarkup: {},
    stockCurve: MODERATE,
    categoryStockCurve: {},
    buysFromPlayer: true,
    catalog: [
      {
        item: 'health_potion',
        normalStock: 3,
        label: 'Marsh Poultice',
        desc: 'A health potion, cheap',
        bundle: null,
        gate: null,
      },
      {
        item: 'jugg_juice',
        normalStock: 'unlimited',
        label: 'Ruin-Root Tonic',
        desc: 'Jugg Juice, ground here rather than poured at the club',
        bundle: null,
        gate: null,
      },
    ],
  },

  /**
   * Steve's yard sells the dynamite he clears stumps with, at the General
   * Store's price rather than under it: the walk out here is worth it for the
   * three-stick bundle, not for a cheaper single stick, which would retire the
   * store's line.
   */
  crafting_house: {
    title: { building: 'taloncrest_crafting_house' },
    markup: 1,
    categoryMarkup: {},
    itemMarkup: {},
    specialties: [],
    stockCurve: MODERATE,
    categoryStockCurve: {},
    buysFromPlayer: true,
    catalog: [
      {
        item: 'dynamite',
        normalStock: 'unlimited',
        label: 'Stick of Dynamite',
        desc: 'Dynamite, at yard prices',
        bundle: null,
        gate: null,
      },
      {
        item: 'dynamite',
        normalStock: 'unlimited',
        label: 'Bundle of Three',
        desc: '3 sticks, for people clearing something large',
        bundle: { quantity: 3, bundleDiscount: 0.13 },
        gate: null,
      },
    ],
  },

  /**
   * Miller's Farm feeds a lot of mouths on purpose, so food sold here is
   * worth more per unit than at a street vendor's cart, and a big stack
   * barely moves the price before it is absorbed.
   */
  mill_farm: {
    title: { building: 'taloncrest_mill_farm' },
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
        bundle: null,
        gate: null,
      },
    ],
  },
  /**
   * Vetch's Nibnose Trading Post: a little of everything at the far end of a
   * long supply line, in small lots. A shelf that runs down gets dear fast,
   * because the next cart is a long way off.
   */
  trading_post: {
    title: { building: 'briar_hollow_store' },
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
    specialties: [],
    stockCurve: FRONTIER,
    categoryStockCurve: { food: FRONTIER_STREET, potion: FRONTIER_STREET },
    buysFromPlayer: true,
    catalog: [
      {
        item: 'health_potion',
        normalStock: 5,
        desc: 'Restores 50% max HP',
        label: 'Health Potion',
        bundle: null,
        gate: null,
      },
      {
        item: 'dynamite',
        normalStock: 4,
        desc: 'Throw for AoE damage',
        label: 'Dynamite',
        bundle: null,
        gate: null,
      },
      {
        item: 'rope',
        normalStock: 10,
        desc: 'Strong processed rope for trebuchets and snare traps',
        label: 'Rope',
        bundle: null,
        gate: null,
      },
      {
        item: 'wood_board',
        normalStock: 20,
        desc: 'Processed timber for walls, repairs, trebuchets and snares',
        label: 'Boards of Wood',
        bundle: null,
        gate: null,
      },
      {
        item: 'stone',
        normalStock: 20,
        desc: 'Usable stone, cut from the rocks outside the wall',
        label: 'Stone',
        bundle: null,
        gate: null,
      },
      {
        item: 'hamburger',
        normalStock: 3,
        desc: 'Sent over from Pipkin a few at a time',
        label: 'Hamburger',
        bundle: null,
        gate: null,
      },
    ],
  },
  /**
   * Pipkin's Cookhouse feeds the whole garrison: food at the town's price, a
   * kitchen that never runs out, and a cook who takes food back at a good rate
   * and barely notices a stack of it.
   */
  cookhouse: {
    title: { building: 'briar_hollow_cookhouse' },
    markup: 1,
    specialties: ['food'],
    categoryMarkup: {},
    itemMarkup: {},
    stockCurve: MODERATE,
    categoryStockCurve: { food: PREMIUM },
    buysFromPlayer: true,
    catalog: [
      {
        item: 'hamburger',
        normalStock: 'unlimited',
        desc: 'Fresh meat, a hot pan, bread, and enough seasoning to make it worth chewing',
        label: 'Hamburger',
        bundle: null,
        gate: null,
      },
      {
        item: 'hollow_stew',
        normalStock: 'unlimited',
        desc: 'Filling stew. Heals you the same way a health potion does',
        label: 'Hollow Stew',
        bundle: null,
        gate: null,
      },
    ],
  },
} as const satisfies Record<string, ShopDef>;

export type ShopId = keyof typeof SHOPS;

/** A shop's entry, widened to `ShopDef` so its literal-typed fields read uniformly across shops. */
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
  return lines.find((line) => line.bundle === null) ?? lines[0];
}

/** The units one row hands over: a bundle's quantity, or one for a single-unit line. */
export function catalogLineUnits(line: CatalogLine): number {
  return line.bundle === null ? 1 : line.bundle.quantity;
}

/** The title over a shop's counter. */
export function shopTitle(def: ShopDef): string {
  return 'building' in def.title ? buildingDisplayName(def.title.building) : def.title.name;
}
