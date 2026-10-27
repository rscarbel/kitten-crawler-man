/**
 * Every market vendor in the Taloncrest square, as pure data. `MarketSystem`
 * places the stalls and stations the people, `src/sprites/marketStall.ts` draws
 * the carts, and `vendorMenu.ts` turns a def into the priced menu the player
 * browses. What a stall sells and how it prices lives in its `SHOPS` entry
 * (`src/economy/shops.ts`), keyed by the vendor's `id`; this file only says
 * who stands behind it, what the cart looks like and where it goes.
 */

import type { GearFreeShopId } from './vendorMenu';
import type { ShopId } from '../../economy/shops';
import type { TownRole } from '../../sprites/person/PersonAppearance';
import type { CrowdSpecies } from '../townSpecies';

/** Which stall silhouette and palette `src/sprites/marketStall.ts` draws. */
export type StallStyle = 'produce_cart' | 'tinker_bench' | 'butcher_block' | 'cloth_awning';

/** Drives the little goods drawn on the counter, so a stall looks like what it sells. */
export type GoodsMotif = 'produce' | 'bottles' | 'meat' | 'trinkets';

export interface VendorDef {
  /**
   * The stall's `SHOPS` entry: its catalog, its pricing and its key in the
   * shared stock record. A stall sells no gear, so it is never asked whether
   * the party already owns a piece.
   */
  id: GearFreeShopId;
  /** Vendor's own name, e.g. 'Bess Ottoline'. Shown in the panel header. */
  vendorName: string;
  /** Stall name, e.g. "Greengrocer's Cart". Shown as the panel title. */
  stallName: string;
  role: TownRole;
  species: CrowdSpecies;
  /** Seed for `generatePersonAppearance`; fixed so a vendor looks the same every visit. */
  appearanceSeed: number;
  style: StallStyle;
  motif: GoodsMotif;
  /** Rotated greeting lines, indexed by how many times the player has browsed. */
  barks: ReadonlyArray<string>;
  /** Offset in tiles from the square centre for the stall's west tile. */
  placement: { dx: number; dy: number };
}

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
  species: 'hawkfolk',
  appearanceSeed: GREENGROCER_SEED,
  style: 'produce_cart',
  motif: 'produce',
  barks: [
    'Fresh off the fields — a nibble for the road?',
    'Picked this morning, and I do mean this morning.',
    'Back again? Good. The turnips remember you.',
    'Orlo over there sells the shine, I sell the substance. We do fine off each other.',
  ],
  placement: { dx: WEST_STALL_DX, dy: STALL_ROW_DY },
};

/** Stable key for the tinker's stall, so a questline can point at it by name. */
export const TINKER_VENDOR_ID = 'tinker' as const satisfies ShopId;

const TINKER: VendorDef = {
  id: TINKER_VENDOR_ID,
  vendorName: 'Orlo Pemberwick',
  stallName: "Tinker's Stall",
  role: 'merchant',
  species: 'human',
  appearanceSeed: TINKER_SEED,
  style: 'tinker_bench',
  motif: 'bottles',
  barks: [
    'Potions, fizz, and odds for the brave.',
    'Everything corked, nothing cursed. Mostly.',
    'You keep buying, I keep brewing. Fair trade.',
    'Bess sells you breakfast, I sell you the rest of the trip. Between us you’re covered.',
  ],
  placement: { dx: EAST_STALL_DX, dy: STALL_ROW_DY },
};

/** The market's vendors, in placement order. */
export const MARKET_VENDORS: ReadonlyArray<VendorDef> = [GREENGROCER, TINKER];
