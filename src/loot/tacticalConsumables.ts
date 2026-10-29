import type { ItemId } from '../core/items/defs/ItemDefs';

/**
 * The consumables that turn a fight rather than heal through it. A mob's
 * stray drop and a treasure-room chest each roll one of these from the same
 * list, so an addition here reaches both at once.
 */
const TACTICAL_CONSUMABLE_DROPS = [
  'smoke_bomb',
  'scroll_of_entanglement',
] as const satisfies readonly ItemId[];

type TacticalConsumableId = (typeof TACTICAL_CONSUMABLE_DROPS)[number];

/** One of {@link TACTICAL_CONSUMABLE_DROPS}, each as likely as the next. */
export function rollTacticalConsumable(): TacticalConsumableId {
  const index = Math.floor(Math.random() * TACTICAL_CONSUMABLE_DROPS.length);
  return TACTICAL_CONSUMABLE_DROPS[index] ?? TACTICAL_CONSUMABLE_DROPS[0];
}
