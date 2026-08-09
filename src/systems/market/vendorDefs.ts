/**
 * Every market vendor in the Over City square, as pure data. `MarketSystem`
 * places the stalls and stations the people, `src/sprites/marketStall.ts` draws
 * the carts, and `vendorMenu.ts` turns a def into the priced menu the player
 * browses — so adding a vendor is an edit to `MARKET_VENDORS` alone.
 *
 * Invariant: every `items` entry must reference an existing `ItemId`. This file
 * adds no new items; it only gives the player a place in town to buy the snacks
 * and potions they'd otherwise only find as drops or in the club.
 */

import type { ItemId } from '../../core/ItemDefs';
import type { TownRole } from '../../sprites/person/PersonAppearance';

/** Which stall silhouette and palette `src/sprites/marketStall.ts` draws. */
export type StallStyle = 'produce_cart' | 'tinker_bench' | 'butcher_block' | 'cloth_awning';

/** Drives the little goods drawn on the counter, so a stall looks like what it sells. */
export type GoodsMotif = 'produce' | 'bottles' | 'meat' | 'trinkets';

/**
 * A condition outside the market that decides whether a line is on the counter
 * at all — as opposed to `stock`, which is about how many are left.
 *
 * A gated line is *absent* rather than greyed out: a row reading "Anchor Shard —
 * unavailable" to a player who has never heard of the Anchor is a puzzle piece
 * with no puzzle. The scene answers the condition, since the market has no way
 * to know what the party is carrying or which quests are live.
 */
export type VendorLineGate = 'anchor_shard';

export interface VendorStockLine {
  id: ItemId;
  label: string;
  price: number;
  desc: string;
  /** When set, the line only appears while the scene says this gate is open. */
  gate?: VendorLineGate;
  /**
   * Units available per restock. Omit for an unlimited line — every line ships
   * unlimited today; the counting plumbing exists for future rare goods, not to
   * gate the everyday consumables below.
   */
  stock?: number;
}

export interface VendorDef {
  /** Stable key — used for stock state and for the appearance seed. Never reuse. */
  id: string;
  /** Vendor's own name, e.g. 'Bess Ottoline'. Shown in the panel header. */
  vendorName: string;
  /** Stall name, e.g. "Greengrocer's Cart". Shown as the panel title. */
  stallName: string;
  role: TownRole;
  /** Seed for `generatePersonAppearance`; fixed so a vendor looks the same every visit. */
  appearanceSeed: number;
  style: StallStyle;
  motif: GoodsMotif;
  /** Rotated greeting lines, indexed by how many times the player has browsed. */
  barks: ReadonlyArray<string>;
  items: ReadonlyArray<VendorStockLine>;
  /** Offset in tiles from the square centre for the stall's west tile. */
  placement: { dx: number; dy: number };
}

const HEALTH_POTION_PRICE = 5;
const SPEED_FIZZ_PRICE = 12;
const COOLDOWN_CRISP_PRICE = 15;
const JUGG_JUICE_PRICE = 22;
/** The tinker priced the Anchor's first shard as scrap, and never revised it. */
export const ANCHOR_SHARD_PRICE_COINS = 20;

// The stalls flank the plaza on its west and east sides, on the centre row. Each
// is two tiles wide from its `DX`, with the vendor standing on the row behind it.
// The plaza spans x -8..+8 from centre, so -7 and +6 put both stall tiles and the
// vendor's row on flagstone with a tile of slab still outside them on each side —
// the pair is symmetric about the centre, which +7 was not: it would have put the
// east stall's outer tile on the plaza's last column with the Cross Lane beyond.
const WEST_STALL_DX = -7;
const EAST_STALL_DX = 6;
const STALL_ROW_DY = 0;

// Appearance seeds are hand-picked and far apart so the two vendors don't share
// a face with each other or with the strolling crowd (`TownLifeSystem`).
const GREENGROCER_SEED = 7714;
const TINKER_SEED = 9203;

const GREENGROCER: VendorDef = {
  id: 'greengrocer',
  vendorName: 'Bess Ottoline',
  stallName: "Greengrocer's Cart",
  role: 'farmer',
  appearanceSeed: GREENGROCER_SEED,
  style: 'produce_cart',
  motif: 'produce',
  barks: [
    'Fresh off the fields — a nibble for the road?',
    'Picked this morning, and I do mean this morning.',
    'Back again? Good. The turnips remember you.',
  ],
  items: [
    {
      id: 'cooldown_crisp',
      label: 'Cooldown Crisp',
      price: COOLDOWN_CRISP_PRICE,
      desc: 'Halves ability cooldowns, 25s',
    },
    {
      id: 'jugg_juice',
      label: 'Jugg Juice',
      price: JUGG_JUICE_PRICE,
      desc: '+50% max HP & full heal, 30s',
    },
  ],
  placement: { dx: WEST_STALL_DX, dy: STALL_ROW_DY },
};

/** Stable key for the tinker's stall, so a questline can point at it by name. */
export const TINKER_VENDOR_ID = 'tinker';

const TINKER: VendorDef = {
  id: TINKER_VENDOR_ID,
  vendorName: 'Orlo Pemberwick',
  stallName: "Tinker's Stall",
  role: 'merchant',
  appearanceSeed: TINKER_SEED,
  style: 'tinker_bench',
  motif: 'bottles',
  barks: [
    'Potions, fizz, and odds for the brave.',
    'Everything corked, nothing cursed. Mostly.',
    'You keep buying, I keep brewing. Fair trade.',
  ],
  // The shard leads the counter while its gate is open: the panel draws rows in
  // this order and hands its accept key to the first buyable quest row, so a
  // player sent here for the shard can open the stall and take it without
  // walking past the potions.
  items: [
    {
      id: 'anchor_shard_tinker',
      label: 'Anchor Shard',
      price: ANCHOR_SHARD_PRICE_COINS,
      desc: 'Odd grey wedge. Voss wants it',
      gate: 'anchor_shard',
    },
    {
      id: 'health_potion',
      label: 'Health Potion',
      price: HEALTH_POTION_PRICE,
      desc: 'Restores 50% max HP',
    },
    {
      id: 'speed_fizz',
      label: 'Speed Fizz',
      price: SPEED_FIZZ_PRICE,
      desc: 'Doubles move speed, 25s',
    },
  ],
  placement: { dx: EAST_STALL_DX, dy: STALL_ROW_DY },
};

/** The market's vendors, in placement order. */
export const MARKET_VENDORS: ReadonlyArray<VendorDef> = [GREENGROCER, TINKER];
