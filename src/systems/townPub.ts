/**
 * The tavern round. Talking to a barkeep opens a short drink menu: a few coins
 * for something served on the spot rather than sold as an item the way the market
 * stalls do. Pure data + effect application here; `ServiceMenuPanel` owns the UI
 * and `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import { makeDrunk } from '../core/StatusEffect';
import type { Player } from '../Player';
import type { ServiceMenu, ServiceOption, ServicePurchaseHandler } from '../ui/ServiceMenuPanel';

/** What a drink does to whoever downs it. */
type DrinkEffect = 'drunk' | 'drunk_and_heal' | 'speed';

const ALE_PRICE = 6;
const BOOZY_MILK_PRICE = 14;
const SPEED_FIZZ_PRICE = 10;
/** Fraction of max HP a Boozy Milk restores on top of getting you drunk. */
const BOOZY_MILK_HEAL_FRACTION = 0.25;

const DRINKS: ReadonlyArray<ServiceOption & { effect: DrinkEffect }> = [
  {
    key: 'ale',
    label: 'Mug of Ale',
    price: ALE_PRICE,
    desc: 'Cheap, warm, and it hits. Drunk for 30s',
    effect: 'drunk',
  },
  {
    key: 'boozy_milk',
    label: 'Boozy Milk',
    price: BOOZY_MILK_PRICE,
    desc: 'Nutritious. Arguably. Drunk, and it heals',
    effect: 'drunk_and_heal',
  },
  {
    key: 'speed_fizz',
    label: 'Speed Fizz',
    price: SPEED_FIZZ_PRICE,
    desc: 'Not a drink, really. Move speed x2, 25s',
    effect: 'speed',
  },
];

const BARKEEP_BARKS: ReadonlyArray<string> = [
  'What’ll it be, crawler? Coin first, questions later.',
  'Sit anywhere that isn’t already bleeding. Now — drinking?',
  'You look like you’ve been down a floor or two. Name your poison.',
];

/** A barkeep's greeting, rotated by how many times the player has talked to them. */
function pubServeLine(turn: number): string {
  const index = ((turn % BARKEEP_BARKS.length) + BARKEEP_BARKS.length) % BARKEEP_BARKS.length;
  return BARKEEP_BARKS[index];
}

function pourDrink(effect: DrinkEffect, player: Player): void {
  if (effect === 'speed') {
    player.activateSpeedFizz();
    return;
  }
  player.applyStatus(makeDrunk());
  if (effect === 'drunk_and_heal') {
    const healed = player.hp + Math.round(player.maxHp * BOOZY_MILK_HEAL_FRACTION);
    player.hp = Math.min(player.maxHp, healed);
  }
}

/** The drink menu for a tavern. */
export function buildTavernMenu(title: string, turn: number): ServiceMenu {
  return {
    title,
    bark: pubServeLine(turn),
    options: DRINKS.map((drink) => ({
      key: drink.key,
      label: drink.label,
      price: drink.price,
      desc: drink.desc,
    })),
  };
}

/** Serve whichever drink the player bought and return the barkeep's line. */
export const serveDrink: ServicePurchaseHandler = (option, player) => {
  const drink = DRINKS.find((d) => d.key === option.key);
  if (drink === undefined) return 'The barkeep shrugs.';
  pourDrink(drink.effect, player);
  return `${option.label} — down the hatch!`;
};
