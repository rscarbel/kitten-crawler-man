/**
 * The tavern round. Talking to a barkeep opens a short drink menu: a few coins
 * for something served on the spot rather than sold as an item the way the market
 * stalls do. Pure data + effect application here; `PricedMenuPanel` owns the UI
 * and `BuildingInteriorScene` owns the sounds and the interaction gating.
 *
 * The town's three drinking houses each keep their own board, so the Low Quarter
 * dive, the mead hall and the traveller's inn are told apart by what they serve
 * as well as by who serves it. A house is looked up by its building name — the
 * same `entry.name` key `townServices.ts` and `BUILDING_OCCUPANTS` use — and an
 * unlisted house falls back to the common round.
 */

import { makeDrunk } from '../core/StatusEffect';
import type { Player } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

/** What a serving does to whoever downs it. */
type DrinkEffect = 'drunk' | 'drunk_and_heal' | 'heal' | 'speed';

type Drink = PricedOption & {
  effect: DrinkEffect;
  /** Fraction of max HP restored; only read by the healing effects. */
  healFraction?: number;
};

const ALE_PRICE = 6;
const BOOZY_MILK_PRICE = 14;
const SPEED_FIZZ_PRICE = 10;
const MEAD_PRICE = 12;
const GUILD_RESERVE_PRICE = 22;
const HONEY_BREAD_PRICE = 5;
const STEW_PRICE = 9;
const NIGHTCAP_PRICE = 16;

const BOOZY_MILK_HEAL_FRACTION = 0.25;
/** The Flagon's reserve is stronger drink and a better mend than the common round. */
const GUILD_RESERVE_HEAL_FRACTION = 0.4;
/** The Sleeping Cat's kitchen is the town's cheap mend: food, and no hangover. */
const HONEY_BREAD_HEAL_FRACTION = 0.15;
const STEW_HEAL_FRACTION = 0.35;
const NIGHTCAP_HEAL_FRACTION = 0.5;

const ALE: Drink = {
  key: 'ale',
  label: 'Mug of Ale',
  price: ALE_PRICE,
  desc: 'Cheap, warm, and it hits. Drunk for 30s',
  effect: 'drunk',
};

const BOOZY_MILK: Drink = {
  key: 'boozy_milk',
  label: 'Boozy Milk',
  price: BOOZY_MILK_PRICE,
  desc: 'Nutritious. Arguably. Drunk, and it heals',
  effect: 'drunk_and_heal',
  healFraction: BOOZY_MILK_HEAL_FRACTION,
};

const SPEED_FIZZ: Drink = {
  key: 'speed_fizz',
  label: 'Speed Fizz',
  price: SPEED_FIZZ_PRICE,
  desc: 'Not a drink, really. Move speed x2, 25s',
  effect: 'speed',
};

const MEAD: Drink = {
  key: 'mead',
  label: 'Spiced Mead',
  price: MEAD_PRICE,
  desc: 'Served in a horn, because of course it is. Drunk for 30s',
  effect: 'drunk',
};

const GUILD_RESERVE: Drink = {
  key: 'guild_reserve',
  label: 'The Guild Reserve',
  price: GUILD_RESERVE_PRICE,
  desc: 'Off the high shelf, for people with a table. Drunk, and it mends well',
  effect: 'drunk_and_heal',
  healFraction: GUILD_RESERVE_HEAL_FRACTION,
};

const HONEY_BREAD: Drink = {
  key: 'honey_bread',
  label: 'Honey Bread',
  price: HONEY_BREAD_PRICE,
  desc: 'Fresh this morning. A small mend, and cheap',
  effect: 'heal',
  healFraction: HONEY_BREAD_HEAL_FRACTION,
};

const STEW: Drink = {
  key: 'stew',
  label: 'Bowl of Stew',
  price: STEW_PRICE,
  desc: 'Hot, thick, and no hangover. Heals',
  effect: 'heal',
  healFraction: STEW_HEAL_FRACTION,
};

const NIGHTCAP: Drink = {
  key: 'nightcap',
  label: 'The Sleeping Cat',
  price: NIGHTCAP_PRICE,
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

function pourDrink(drink: Drink, player: Player): void {
  player.recordSwallowed();
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
): PricedMenu {
  return {
    title: house,
    bark: host?.line ?? pubServeLine(house, turn),
    byline: host?.name,
    options: drinksFor(house).map((drink) => {
      const option: PricedOption = {
        key: drink.key,
        label: drink.label,
        price: drink.price,
        desc: drink.desc,
      };
      // Food is the only thing on any board whose whole effect is the mend, so
      // it is the only thing that can be bought for nothing. A drink that gets
      // you drunk still does something at full health; a bowl of stew does not.
      if (drink.effect === 'heal' && buyer.hp >= buyer.maxHp) option.unavailable = 'Unhurt';
      return option;
    }),
  };
}

/**
 * The purchase handler for one house — bound to the same board `buildTavernMenu`
 * showed, so a key can never be served from a different tavern's list.
 */
export function serveDrinkAt(house: string): PricedPurchaseHandler {
  return (option, player) => {
    const drink = drinksFor(house).find((d) => d.key === option.key);
    if (drink === undefined) return { ok: false, line: 'The barkeep shrugs.' };
    // Last line of defence behind the menu's own `Unhurt`, so a stale panel can
    // never take coin for a plate the buyer has no room for.
    if (drink.effect === 'heal' && player.hp >= player.maxHp) {
      return { ok: false, line: 'You have not got the room for it. Come back hungry.' };
    }
    pourDrink(drink, player);
    return { ok: true, line: `${option.label} — down the hatch!` };
  };
}
