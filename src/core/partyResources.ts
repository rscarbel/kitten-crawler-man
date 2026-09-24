import { ITEM_DEF } from './ItemDefs';
import type { ToolOwner } from './PartyTools';
import { RESOURCE_IDS, type ResourceId } from './resourceIds';

/** A resource price list; an absent or zero line costs nothing. */
export type ResourceCost = Partial<Record<ResourceId, number>>;

/** Combined count of one resource across both crawlers' inventories. */
export function partyCount(human: ToolOwner, cat: ToolOwner, id: ResourceId): number {
  return human.inventory.countOf(id) + cat.inventory.countOf(id);
}

/** Whether the party's combined stock covers every line of `cost`. */
export function canAfford(human: ToolOwner, cat: ToolOwner, cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => {
    const amount = cost[id];
    return amount === undefined || partyCount(human, cat, id) >= amount;
  });
}

/**
 * Spends `cost` across the party's combined stock, taking from `active`
 * first and the companion only for what `active` cannot cover. Checks
 * affordability up front and removes nothing if the party cannot pay, so a
 * failed spend never leaves the party's inventories partway drained.
 *
 * @returns false when the party could not afford the cost.
 */
export function spend(
  human: ToolOwner,
  cat: ToolOwner,
  cost: ResourceCost,
  active: ToolOwner,
): boolean {
  if (!canAfford(human, cat, cost)) return false;

  const companion = active === human ? cat : human;
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    if (amount === undefined || amount <= 0) continue;

    const takenFromActive = Math.min(amount, active.inventory.countOf(id));
    if (takenFromActive > 0) active.inventory.removeItems(id, takenFromActive);

    const remainder = amount - takenFromActive;
    if (remainder > 0) companion.inventory.removeItems(id, remainder);
  }
  return true;
}

/** Applies a flat per-line discount, dropping any line the discount reaches 0. */
export function applyDiscount(cost: ResourceCost, discount: number): ResourceCost {
  const discounted: ResourceCost = {};
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    if (amount === undefined) continue;
    const remaining = Math.max(0, amount - discount);
    if (remaining > 0) discounted[id] = remaining;
  }
  return discounted;
}

/** Renders a cost as a UI string, e.g. "5 Boards of Wood, 1 Rope". */
export function formatCost(cost: ResourceCost): string {
  const lines: string[] = [];
  for (const id of RESOURCE_IDS) {
    const amount = cost[id];
    if (amount === undefined || amount <= 0) continue;
    lines.push(`${amount} ${ITEM_DEF[id].name}`);
  }
  return lines.join(', ');
}
