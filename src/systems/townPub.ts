/**
 * The tavern round. Talking to a barkeep opens a short drink menu: a few coins
 * for something served on the spot rather than sold as an item the way the market
 * stalls do. The rounds are services; the one real item on a board, Speed Fizz,
 * is a line in `SHOPS.pub`, priced and stocked like any shop's, and downed at
 * the bar rather than handed over. Pure data + effect application here; the shop screen owns the UI
 * and `BuildingInteriorScene` owns the sounds and the interaction gating.
 *
 * The town's three drinking houses each keep their own board, so the Low Quarter
 * dive, the mead hall and the traveller's inn are told apart by what they serve
 * as well as by who serves it. A house is looked up by its building name — the
 * same `entry.name` key `townServices.ts` and `BUILDING_OCCUPANTS` use — and an
 * unlisted house falls back to the common round.
 */

import { makeDrunk } from '../core/StatusEffect';
import { playDrinkGesture } from '../creatures/humanGestures';
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
import type { ServiceIconId } from '../sprites/art/itemIcons/serviceIcons';
import type { SHOPS, ShopId } from '../economy/shops';
import { buyFromShop, type ShopStock } from '../economy/shopStock';
import { catalogLineRow, findCatalogLine } from './market/vendorMenu';

const PUB_SHOP = 'pub' as const satisfies ShopId;

/** What a serving does to whoever downs it. */
type DrinkEffect = 'drunk' | 'drunk_and_heal' | 'heal' | 'speed';

type PubServiceKey = keyof typeof SERVICE_PRICES.pub;
type PubCatalogItem = (typeof SHOPS.pub.catalog)[number]['item'];

interface Serving {
  readonly effect: DrinkEffect;
  /** Fraction of max HP restored; only read by the healing effects. */
  readonly healFraction?: number;
}

/** A round: a service with a fixed fee, poured and drunk on the spot. */
interface ServiceDrink extends Serving {
  readonly kind: 'service';
  readonly key: PubServiceKey;
  readonly label: string;
  readonly desc: string;
  readonly art: ServiceIconId;
}

/** A real item off the pub's catalog, priced by the shop like any other, but opened and downed at the bar. */
interface CatalogDrink extends Serving {
  readonly kind: 'catalog';
  readonly item: PubCatalogItem;
}

type Drink = ServiceDrink | CatalogDrink;

const BOOZY_MILK_HEAL_FRACTION = 0.25;
/** The Flagon's reserve is stronger drink and a better mend than the common round. */
const GUILD_RESERVE_HEAL_FRACTION = 0.4;
/** The Sleeping Cat's kitchen is the town's cheap mend: food, and no hangover. */
const HONEY_BREAD_HEAL_FRACTION = 0.15;
const STEW_HEAL_FRACTION = 0.35;
const NIGHTCAP_HEAL_FRACTION = 0.5;

const ALE: Drink = {
  kind: 'service',
  key: 'ale',
  art: 'ale',
  label: 'Mug of Ale',
  desc: 'Cheap, warm, and it hits. Drunk for 30s',
  effect: 'drunk',
};

const BOOZY_MILK: Drink = {
  kind: 'service',
  key: 'boozy_milk',
  art: 'boozy_milk',
  label: 'Boozy Milk',
  desc: 'Nutritious. Arguably. Drunk, and it heals',
  effect: 'drunk_and_heal',
  healFraction: BOOZY_MILK_HEAL_FRACTION,
};

const SPEED_FIZZ: Drink = { kind: 'catalog', item: 'speed_fizz', effect: 'speed' };

const MEAD: Drink = {
  kind: 'service',
  key: 'mead',
  art: 'mead',
  label: 'Spiced Mead',
  desc: 'Served in a horn, because of course it is. Drunk for 30s',
  effect: 'drunk',
};

const GUILD_RESERVE: Drink = {
  kind: 'service',
  key: 'guild_reserve',
  art: 'guild_reserve',
  label: 'The Guild Reserve',
  desc: 'Off the high shelf, for people with a table. Drunk, and it mends well',
  effect: 'drunk_and_heal',
  healFraction: GUILD_RESERVE_HEAL_FRACTION,
};

const HONEY_BREAD: Drink = {
  kind: 'service',
  key: 'honey_bread',
  art: 'honey_bread',
  label: 'Honey Bread',
  desc: 'Fresh this morning. A small mend, and cheap',
  effect: 'heal',
  healFraction: HONEY_BREAD_HEAL_FRACTION,
};

const STEW: Drink = {
  kind: 'service',
  key: 'stew',
  art: 'stew',
  label: 'Bowl of Stew',
  desc: 'Hot, thick, and no hangover. Heals',
  effect: 'heal',
  healFraction: STEW_HEAL_FRACTION,
};

const NIGHTCAP: Drink = {
  kind: 'service',
  key: 'nightcap',
  art: 'nightcap',
  label: 'The Sleeping Cat',
  desc: 'Milk, honey, and something that bites. Drunk, and it mends deeply',
  effect: 'drunk_and_heal',
  healFraction: NIGHTCAP_HEAL_FRACTION,
};

/** The common round, for any drinking house without a board of its own. */
const DEFAULT_DRINKS: ReadonlyArray<Drink> = [ALE, BOOZY_MILK, SPEED_FIZZ];

/**
 * Each house's board. The Stump is the dive — cheap, strong, nothing to eat.
 * The Flagon is the respectable mead hall: pricier, and better for it. The
 * Sleeping Cat is a kitchen first, and the only board in town where the mends
 * come as food.
 */
const HOUSE_DRINKS: ReadonlyMap<string, ReadonlyArray<Drink>> = new Map([
  ['The Sunken Stump Pub', [ALE, BOOZY_MILK, SPEED_FIZZ]],
  ['The Horned Flagon', [MEAD, GUILD_RESERVE, SPEED_FIZZ]],
  ['The Sleeping Cat Inn', [HONEY_BREAD, STEW, NIGHTCAP]],
]);

const HOUSE_BARKS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  [
    'The Sunken Stump Pub',
    [
      'Coin on the wood. I do not keep a slate and you would not like the terms.',
      'Ale, milk, or the fizzy one that makes you run into walls. Pick.',
      'Bleed on my bar and you are buying the bar a round.',
    ],
  ],
  [
    'The Horned Flagon',
    [
      'The horn is a deposit, not a gift. Now — what will you have?',
      'We keep a reserve for people who sit down properly. Interested?',
      'Mead first, then whatever it is you actually came in to ask me.',
    ],
  ],
  [
    'The Sleeping Cat Inn',
    [
      'Kitchen is open. You look like you have been living off ration bricks.',
      'Eat first, drink after. House order, and I do enforce it.',
      'Everything on that board puts something back. Sit down.',
    ],
  ],
]);

const BARKEEP_BARKS: ReadonlyArray<string> = [
  'What’ll it be, crawler? Coin first, questions later.',
  'Sit anywhere that isn’t already bleeding. Now — drinking?',
  'You look like you’ve been down a floor or two. Name your poison.',
];

/** A barkeep's greeting, rotated by how many times the player has talked to them. */
function pubServeLine(house: string, turn: number): string {
  return rotateLine(HOUSE_BARKS.get(house) ?? BARKEEP_BARKS, turn);
}

function drinksFor(house: string): ReadonlyArray<Drink> {
  return HOUSE_DRINKS.get(house) ?? DEFAULT_DRINKS;
}

function drinkKey(drink: Drink): string {
  return drink.kind === 'service' ? drink.key : drink.item;
}

/** The row a drink shows, or null for a catalog drink the pub's catalog no longer lists. */
function drinkRow(drink: Drink, stock: ShopStock): ShopRow | null {
  if (drink.kind === 'service') {
    return {
      key: drink.key,
      label: drink.label,
      desc: drink.desc,
      art: { kind: 'service', service: drink.art },
      offer: { status: 'open', cost: { kind: 'coins', coins: SERVICE_PRICES.pub[drink.key] } },
      questErrand: false,
    };
  }
  const line = findCatalogLine(PUB_SHOP, drink.item);
  return line === undefined ? null : catalogLineRow(PUB_SHOP, line, stock);
}

function pourDrink(drink: Drink, player: Player): void {
  player.recordSwallowed();
  // The kitchen's plates are eaten, not drunk: only a drink gets the bottle.
  if (drink.effect !== 'heal') playDrinkGesture(player);
  if (drink.effect === 'speed') {
    player.activateSpeedFizz();
    return;
  }
  if (drink.effect !== 'heal') {
    player.applyStatus(makeDrunk(player.ironStomachTimeScale));
  }
  const fraction = drink.healFraction;
  if (fraction === undefined) return;
  const healed = player.hp + Math.round(player.maxHp * fraction);
  player.hp = Math.min(player.maxHp, healed);
}

/**
 * The board for one drinking house. `host` names the innkeeper when the room
 * has a named one, so the greeting is theirs rather than the generic barkeep's.
 */
export function buildTavernMenu(
  house: string,
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
  stock: ShopStock,
): ShopMenu {
  return {
    title: house,
    bark: host?.line ?? pubServeLine(house, turn),
    byline: hostByline(host),
    emblem: null,
    options: drinksFor(house).flatMap((drink) => {
      const row = drinkRow(drink, stock);
      if (row === null) return [];
      // Food is the only thing on any board whose whole effect is the mend, so
      // it is the only thing that can be bought for nothing. A drink that gets
      // you drunk still does something at full health; a bowl of stew does not.
      if (drink.effect !== 'heal' || buyer.hp < buyer.maxHp || row.offer.status !== 'open') {
        return [row];
      }
      return [{ ...row, offer: offerUnless('Unhurt', row.offer.cost) }];
    }),
  };
}

/**
 * The purchase handler for one house — bound to the same board `buildTavernMenu`
 * showed, so a key can never be served from a different tavern's list.
 */
export function serveDrinkAt(house: string, stock: ShopStock): ShopPurchaseHandler {
  return (option, player) => {
    const drink = drinksFor(house).find((candidate) => drinkKey(candidate) === option.key);
    if (drink === undefined) return { ok: false, line: 'The barkeep shrugs.' };
    // Last line of defence behind the menu's own `Unhurt`, so a stale panel can
    // never take coin for a plate the buyer has no room for.
    if (drink.effect === 'heal' && player.hp >= player.maxHp) {
      return { ok: false, line: 'You have not got the room for it. Come back hungry.' };
    }
    if (drink.kind === 'catalog' && !buyFromShop(stock, PUB_SHOP, drink.item)) {
      return { ok: false, line: 'The barkeep shakes the empty crate.' };
    }
    pourDrink(drink, player);
    return { ok: true, line: `${option.label} — down the hatch!` };
  };
}
