/**
 * The three working houses of the town: the wheelwright, the mill and
 * Wendell's farm.
 *
 * None of them is a shop in the way the plaza is a shop. Each sells the one
 * thing the people who live there actually have — Steve has explosives because
 * he clears stumps, Marta has food because she is the reason the town eats, and
 * Wendell has a hayloft. They are priced against the plaza's versions so no
 * homestead becomes the strictly better place to buy anything; the goods live
 * on `SHOPS.crafting_house` and `SHOPS.mill_farm` (each price is the item's base
 * in `ITEM_PRICES` times that shop's markup), the
 * hayloft and the hot plate in `SERVICE_PRICES`.
 *
 * Pure data + effect application; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { Player } from '../Player';
import {
  offerUnless,
  type ShopMenu,
  type ShopRow,
  type ShopPurchaseHandler,
} from '../ui/screens/shop/shopSession';
import { hostByline, type ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';
import { SERVICE_PRICES } from '../economy/servicePrices';
import { SHOPS, type ShopId } from '../economy/shops';
import type { ShopStock } from '../economy/shopStock';
import { catalogLineRow, findCatalogLine, handOverCatalogLine } from './market/vendorMenu';
import { buildingDisplayName } from '../map/buildingIds';

// -- Cartwright's Workshop --------------------------------------------------

const CRAFTING_HOUSE_SHOP = 'crafting_house' as const satisfies ShopId;

const CARTWRIGHT_BARKS: ReadonlyArray<string> = [
  'Stumps, mostly. I am not going to pretend that is all you want it for.',
  'Goblin-made, which is why it hisses. Do not argue with the hissing.',
  'Buy it, carry it out of my yard, and light it somewhere that is not my yard.',
];

const CARTWRIGHT_LINES: ReadonlyArray<string> = [
  'Short fuse on that one. Shorter than you would like.',
  'Mind the damp. Damp is the only thing that stops it and it does not stop it reliably.',
  'Do not run with it. I have seen where that ends and I had to rebuild the fence.',
];

export function buildCartwrightMenu(
  turn: number,
  host: ResidentHost | null,
  stock: ShopStock,
): ShopMenu {
  return {
    title: buildingDisplayName('taloncrest_crafting_house'),
    bark: host?.line ?? rotateLine(CARTWRIGHT_BARKS, turn),
    byline: hostByline(host),
    emblem: null,
    options: SHOPS.crafting_house.catalog.map((line) =>
      catalogLineRow(CRAFTING_HOUSE_SHOP, line, stock),
    ),
  };
}

export function sellCartwrightGoods(turn: number, stock: ShopStock): ShopPurchaseHandler {
  return (option, buyer) => {
    const line = findCatalogLine(CRAFTING_HOUSE_SHOP, option.key);
    if (line === undefined || !handOverCatalogLine(CRAFTING_HOUSE_SHOP, line, stock, buyer)) {
      return { ok: false, line: 'Steve shrugs at the bench.' };
    }
    return { ok: true, line: rotateLine(CARTWRIGHT_LINES, turn) };
  };
}

// -- Miller's Farm ----------------------------------------------------------

const MILL_FARM_SHOP = 'mill_farm' as const satisfies ShopId;
/** Fraction of max HP a plate off Marta's table puts back. */
const HOT_PLATE_HEAL_FRACTION = 0.25;

const HOT_PLATE_KEY = 'hot_plate';

const MILLER_BARKS: ReadonlyArray<string> = [
  'Sit down before you ask me anything. You are swaying.',
  'Flour, bread, and the crisps the club charges a fortune for. Same batch.',
  'I feed a garrison. I can certainly feed one crawler.',
];

const MILLER_LINES: ReadonlyArray<string> = [
  'Eat it here. I am not having you drop it in the ruins.',
  'There. That is what a person is supposed to feel like.',
  'Come back when you are hungry rather than when you are dying.',
];

export function buildMillerMenu(
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
  stock: ShopStock,
): ShopMenu {
  const plate: ShopRow = {
    key: HOT_PLATE_KEY,
    label: 'A Hot Plate',
    desc: 'Bread, dripping and whatever is in the pot. Mends a little',
    art: { kind: 'service', service: 'hot_plate' },
    offer: offerUnless(buyer.hp >= buyer.maxHp ? 'Unhurt' : null, {
      kind: 'coins',
      coins: SERVICE_PRICES.mill_farm.hot_plate,
    }),
    questErrand: false,
  };

  return {
    title: buildingDisplayName('taloncrest_mill_farm'),
    bark: host?.line ?? rotateLine(MILLER_BARKS, turn),
    byline: hostByline(host),
    emblem: null,
    options: [
      plate,
      ...SHOPS.mill_farm.catalog.map((line) => catalogLineRow(MILL_FARM_SHOP, line, stock)),
    ],
  };
}

export function serveMillerGoods(turn: number, stock: ShopStock): ShopPurchaseHandler {
  return (option, buyer) => {
    if (option.key === HOT_PLATE_KEY) {
      // Re-checked rather than trusting the menu's `Unhurt`: the guard the
      // player's coin depends on should not live in the UI alone.
      if (buyer.hp >= buyer.maxHp) {
        return { ok: false, line: 'Sit down when you actually need it.' };
      }
      const healed = buyer.hp + Math.round(buyer.maxHp * HOT_PLATE_HEAL_FRACTION);
      buyer.hp = Math.min(buyer.maxHp, healed);
      return { ok: true, line: rotateLine(MILLER_LINES, turn) };
    }
    const line = findCatalogLine(MILL_FARM_SHOP, option.key);
    if (line === undefined || !handOverCatalogLine(MILL_FARM_SHOP, line, stock, buyer)) {
      return { ok: false, line: 'Marta wipes her hands and waits.' };
    }
    return { ok: true, line: 'Straight off the tray. Do not let them go soft.' };
  };
}

// -- Plumbline Farm ---------------------------------------------------------

/** A loft is not an inn: it mends most of you, and it will not touch what ails you. */
const HAYLOFT_HEAL_FRACTION = 0.6;

const HAYLOFT_KEY = 'hayloft';

const HAYLOFT_BARKS: ReadonlyArray<string> = [
  'The loft is dry and the ladder is sound. I built both, so I can vouch for them personally.',
  'You can sleep here. I would not sleep out there and I have a wall.',
  'Ten coins and you may lie down. It was built to hold a winter of hay, and at present it has nothing better to do.',
];

const HAYLOFT_LINES: ReadonlyArray<string> = [
  'Straw in your hair. Leave it, it suits you.',
  'Not a sound from the loft for an hour. I shall take that as a compliment to the joists.',
  'You slept through the milking hour. So, as it happens, did I; there was nothing to milk.',
];

export function buildPlumblineFarmMenu(
  party: ReadonlyArray<Player>,
  turn: number,
  host: ResidentHost | null,
): ShopMenu {
  const unhurt = party.every((member) => member.hp >= member.maxHp);
  const loft: ShopRow = {
    key: HAYLOFT_KEY,
    label: 'An hour in the loft',
    desc: 'Mends most of you both. Does not touch poison or drink',
    art: { kind: 'service', service: 'hayloft' },
    offer: offerUnless(unhurt ? 'Unhurt' : null, {
      kind: 'coins',
      coins: SERVICE_PRICES.builder_farm.hayloft,
    }),
    questErrand: false,
  };

  return {
    title: buildingDisplayName('taloncrest_builder_farm'),
    bark: host?.line ?? rotateLine(HAYLOFT_BARKS, turn),
    byline: hostByline(host),
    emblem: null,
    options: [loft],
  };
}

export function servePlumblineFarmRest(
  party: ReadonlyArray<Player>,
  turn: number,
): ShopPurchaseHandler {
  return (option) => {
    if (option.key !== HAYLOFT_KEY) return { ok: false, line: 'Wendell scratches his head.' };
    // Same reason as the mill's plate: the refusal is the handler's job too.
    if (party.every((member) => member.hp >= member.maxHp)) {
      return { ok: false, line: 'Neither of you needs it. Keep your coin.' };
    }
    for (const member of party) {
      const healed = member.hp + Math.round(member.maxHp * HAYLOFT_HEAL_FRACTION);
      member.hp = Math.min(member.maxHp, healed);
    }
    return { ok: true, line: rotateLine(HAYLOFT_LINES, turn) };
  };
}
