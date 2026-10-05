/**
 * The orders a bag can be shown or tidied in. One comparator serves both the
 * inventory screen's sorted view and {@link Inventory.sortBag}, so tidying
 * leaves the bag in exactly the order the view was showing.
 */

import { ITEM_CATEGORIES, ITEM_DEF, type InventoryItem } from './ItemDefs';

/** `manual` is the bag's own slot order; tidying in it only closes the gaps. */
export const BAG_SORT_MODES = ['manual', 'category', 'name', 'value'] as const;

export type BagSortMode = (typeof BAG_SORT_MODES)[number];

export const BAG_SORT_LABELS: Readonly<Record<BagSortMode, string>> = {
  manual: 'Manual',
  category: 'Category',
  name: 'Name',
  value: 'Value',
};

/** A stack together with the bag slot it sits in, so ties keep their slot order. */
export interface PlacedStack {
  readonly item: InventoryItem;
  readonly slotIdx: number;
}

function byName(a: PlacedStack, b: PlacedStack): number {
  return a.item.name.localeCompare(b.item.name);
}

function categoryRank(stack: PlacedStack): number {
  return ITEM_CATEGORIES.indexOf(ITEM_DEF[stack.item.id].category);
}

/** What one stack is worth to a shop before markup, so a stack of forty outranks a single. */
function stackValue(stack: PlacedStack): number {
  return ITEM_DEF[stack.item.id].baseValue * stack.item.quantity;
}

const COMPARATORS: Readonly<Record<BagSortMode, (a: PlacedStack, b: PlacedStack) => number>> = {
  manual: () => 0,
  category: (a, b) => categoryRank(a) - categoryRank(b) || byName(a, b),
  name: byName,
  value: (a, b) => stackValue(b) - stackValue(a) || byName(a, b),
};

/** `stacks` in `mode`'s order; equal stacks keep their slot order. */
export function sortStacks(stacks: readonly PlacedStack[], mode: BagSortMode): PlacedStack[] {
  const compare = COMPARATORS[mode];
  return [...stacks].sort((a, b) => compare(a, b) || a.slotIdx - b.slotIdx);
}
