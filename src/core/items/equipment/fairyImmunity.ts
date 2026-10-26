import type { Player } from '../../../Player';
import type { FairyElement } from '../defs/ItemDefs';

/**
 * Whether `target` wears a ring that shrugs off `element` fairy magic.
 *
 * Asked at each fairy damage site rather than inside `Player.applyStatus` or
 * `Player.takeDamage`: a fireball's burn carries no applier, so by the time it
 * reaches the player nothing says a fairy threw it, and these rings must leave
 * every other ice and fire source landing.
 */
export function isImmuneToFairyElement(
  target: Pick<Player, 'inventory'>,
  element: FairyElement,
): boolean {
  return target.inventory.equipment.hasFairyImmunity(element);
}
