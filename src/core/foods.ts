/**
 * What eating each food does to the eater — one function per food.
 *
 * Pure game rules with no audio, bus or UI: `MenusKit.eatFood` is the one
 * caller that turns an outcome into a sound, a toast and an event, so the bag,
 * the hotbar and a mobile long-press all agree, and a headless gate can drive
 * these directly.
 */

import type { Player } from '../Player';
import type { Inventory } from './Inventory';
import type { ItemId } from './ItemDefs';
import { HAMBURGER_HEAL_FRACTION } from './foodEffects';
import { HAMBURGER_FED_STATUS, makeHamburgerFed } from './StatusEffect';

/** The items that are eaten rather than drunk. */
export type FoodId = Extract<ItemId, 'hamburger' | 'hollow_stew'>;

/**
 * How an attempt to eat went.
 * - `eaten`: the food went down and its effect applied.
 * - `full`: refused because eating would change nothing.
 * - `cooldown`: refused because the shared potion cooldown is running.
 * - `cannotAct`: refused because the eater cannot use items right now.
 * - `noneLeft`: the stack the eater reached for was empty.
 */
export type EatOutcome = 'eaten' | 'full' | 'cooldown' | 'cannotAct' | 'noneLeft';

/** Takes one of the food out of whichever stack the eater reached for; false if it was empty. */
export type ConsumeOne = () => boolean;

/**
 * Hamburger: heals a quarter of max HP and lends strength for a while.
 *
 * Refused only when it would do nothing at all — full HP *and* already fed. A
 * full-HP eater who isn't fed still gets the boon, and a fed one who is hurt
 * still gets the heal; both are worth a burger.
 */
export function eatHamburger(eater: Player, consume: ConsumeOne): EatOutcome {
  if (!eater.canAct) return 'cannotAct';
  const atFullHp = eater.hp >= eater.maxHp;
  if (atFullHp && eater.hasStatus(HAMBURGER_FED_STATUS)) return 'full';
  if (!consume()) return 'noneLeft';
  eater.healByFraction(HAMBURGER_HEAL_FRACTION);
  eater.applyStatus(makeHamburgerFed());
  return 'eaten';
}

/**
 * Hollow Stew: a health potion in a bowl. It goes through `usePotion` itself,
 * so its heal, its refusals and the cooldown it starts are the potion's own and
 * cannot drift from it.
 */
export function eatHollowStew(eater: Player, consume: ConsumeOne): EatOutcome {
  if (!eater.canAct) return 'cannotAct';
  if (eater.potionCooldownFrames > 0) return 'cooldown';
  if (eater.hp >= eater.maxHp) return 'full';
  return eater.usePotion(consume) ? 'eaten' : 'noneLeft';
}

/** Whether `id` is eaten, and so handled by {@link eatFood}. */
export function isFoodId(id: ItemId): id is FoodId {
  return id === 'hamburger' || id === 'hollow_stew';
}

/** Dispatches to the one function that knows how to eat `id`. */
export function eatFood(eater: Player, id: FoodId, consume: ConsumeOne): EatOutcome {
  return id === 'hamburger' ? eatHamburger(eater, consume) : eatHollowStew(eater, consume);
}

/** The heals an auto-drinking companion reaches for, in the order it reaches for them. */
export type HealingConsumableId = Extract<ItemId, 'health_potion' | 'hollow_stew'>;

/**
 * The heal a companion should auto-use from `inventory`: a potion first, then
 * stew, or null when it carries neither.
 *
 * Stew is on the list because it heals exactly like a potion; a party that
 * bought stew instead of potions would otherwise watch its companion die
 * holding a heal.
 */
export function firstHealingConsumable(inventory: Inventory): HealingConsumableId | null {
  if (inventory.countOf('health_potion') > 0) return 'health_potion';
  if (inventory.countOf('hollow_stew') > 0) return 'hollow_stew';
  return null;
}
