/**
 * Which bag slots the grid shows, in what order, split into pages of
 * {@link BAG_PAGE_SLOTS}. The `All` view with no query and the manual order is
 * the bag itself, empty slots and all, page for page, and is the only view that
 * can be rearranged; every other view collects its matches.
 */

import { sortStacks, type BagSortMode } from '../../../core/items/inventory/bagSort';
import type { Inventory } from '../../../core/items/inventory/Inventory';
import {
  ITEM_CATEGORIES,
  BAG_PAGE_SLOTS,
  ITEM_DEF,
  type InventoryItem,
  type ItemCategory,
} from '../../../core/items/defs/ItemDefs';
import type { BagFilter } from './inventoryTypes';

export interface BagCell {
  readonly slotIdx: number;
  readonly item: InventoryItem | null;
}

export interface BagView {
  readonly cells: readonly BagCell[];
  /** The cells are the bag's own slots in order, so a drag between them rearranges it. */
  readonly rearrangeable: boolean;
}

export interface BagViewOptions {
  readonly filter: BagFilter;
  readonly query: string;
  readonly sort: BagSortMode;
  /** Narrows the view further (the Character tab shows only what can be worn). */
  readonly accept?: (item: InventoryItem) => boolean;
}

/**
 * True when `item` passes the search. The id is matched alongside the name so
 * a shorthand the player knows the item by finds it even when its display
 * name never says it.
 */
export function matchesQuery(item: InventoryItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return item.name.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle);
}

export function categoryOf(item: InventoryItem): ItemCategory {
  return ITEM_DEF[item.id].category;
}

export function buildBagView(inventory: Inventory, opts: BagViewOptions): BagView {
  const slots = inventory.bag.slots;
  const query = opts.query.trim();
  const unnarrowed =
    opts.filter === 'all' && query.length === 0 && opts.sort === 'manual' && !opts.accept;
  if (unnarrowed) {
    const cells = slots.map((item, slotIdx) => ({ slotIdx, item }));
    return { cells, rearrangeable: true };
  }
  const matches = slots.flatMap((item, slotIdx) => {
    if (item === null) return [];
    if (opts.filter !== 'all' && categoryOf(item) !== opts.filter) return [];
    if (!matchesQuery(item, query)) return [];
    if (opts.accept !== undefined && !opts.accept(item)) return [];
    return [{ item, slotIdx }];
  });
  const cells = sortStacks(matches, opts.sort).map((stack) => ({
    slotIdx: stack.slotIdx,
    item: stack.item,
  }));
  return { cells, rearrangeable: false };
}

/** How many stacks of each category the bag holds; `all` counts every stack. */
export function categoryCounts(inventory: Inventory): ReadonlyMap<BagFilter, number> {
  const counts = new Map<BagFilter, number>();
  let total = 0;
  for (const item of inventory.bag.slots) {
    if (item === null) continue;
    total++;
    const category = categoryOf(item);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  counts.set('all', total);
  return counts;
}

/** `All` plus every category the bag holds something of, in the category order. */
export function visibleFilters(counts: ReadonlyMap<BagFilter, number>): BagFilter[] {
  return ['all', ...ITEM_CATEGORIES.filter((category) => (counts.get(category) ?? 0) > 0)];
}

export const FILTER_LABELS: Readonly<Record<BagFilter, string>> = {
  all: 'All',
  weapon: 'Weapons',
  armor: 'Armor',
  consumable: 'Consumables',
  tool: 'Tools',
  material: 'Materials',
  book: 'Books',
  quest: 'Quest',
  kit: 'Kits',
};

/** How many pages the view spans; an empty view still shows its one page. */
export function viewPageCount(view: BagView): number {
  return Math.max(1, Math.ceil(view.cells.length / BAG_PAGE_SLOTS));
}

/** The page of the view that shows `slotIdx`, or null when the view does not show it. */
export function pageShowing(view: BagView, slotIdx: number): number | null {
  const at = view.cells.findIndex((cell) => cell.slotIdx === slotIdx);
  return at === -1 ? null : Math.floor(at / BAG_PAGE_SLOTS);
}

/** The cells on `page` of the view. */
export function pageCells(view: BagView, page: number): readonly BagCell[] {
  const start = page * BAG_PAGE_SLOTS;
  return view.cells.slice(start, start + BAG_PAGE_SLOTS);
}
