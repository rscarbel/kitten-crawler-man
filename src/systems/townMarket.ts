/**
 * Stock lists for the Over City's market stalls. Pure data: the stalls are placed
 * and rendered by `TownPropSystem`, the buying happens in `MarketStallPanel`, and
 * this module just says what each cart sells. Everything on offer is an existing
 * snack-themed consumable (`ItemDefs`), so no new item plumbing is involved — the
 * stalls simply give the player a place to buy them in town instead of only
 * finding them as drops or in the club.
 */

import type { ItemId } from '../core/ItemDefs';

export interface StallItem {
  id: ItemId;
  label: string;
  price: number;
  desc: string;
}

export interface StallStock {
  title: string;
  vendorBark: string;
  items: ReadonlyArray<StallItem>;
}

const HEALTH_POTION_PRICE = 5;
const SPEED_FIZZ_PRICE = 12;
const COOLDOWN_CRISP_PRICE = 15;
const JUGG_JUICE_PRICE = 22;

const GREENGROCER: StallStock = {
  title: "Greengrocer's Cart",
  vendorBark: 'Fresh off the fields — a nibble for the road?',
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
};

const TINKER: StallStock = {
  title: "Tinker's Stall",
  vendorBark: 'Potions, fizz, and odds for the brave.',
  items: [
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
};

/** The stall stocks, in placement order (west stall, east stall). */
export const MARKET_STALLS: ReadonlyArray<StallStock> = [GREENGROCER, TINKER];
