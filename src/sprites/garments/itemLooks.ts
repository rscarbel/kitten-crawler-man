/**
 * From items to garments: what a crawler's equipment paints on them, read off
 * each item's declared `look`.
 */

import { catLookOf, humanLookOf, ITEM_DEF, type ItemDef, type ItemId } from '../../core/ItemDefs';
import type { CrawlerKind } from '../../core/SkillManager';
import type { GarmentDef, GarmentMaterial } from './garmentDef';
import { garmentOf } from './garments';

/** The garments Donut shows wearing `items`, in item order; items with no look on her add none. */
export function catGarmentsWearing(items: readonly ItemId[]): GarmentDef<'cat'>[] {
  const garments: GarmentDef<'cat'>[] = [];
  for (const id of items) {
    const look = catLookOf(ITEM_DEF[id]);
    if (look?.kind === 'garment') garments.push(garmentOf('cat', look.garment));
  }
  return garments;
}

/** The garments Carl shows wearing `items`, in item order; items with no look on him add none. */
export function humanGarmentsWearing(items: readonly ItemId[]): GarmentDef<'human'>[] {
  const garments: GarmentDef<'human'>[] = [];
  for (const id of items) {
    const look = humanLookOf(ITEM_DEF[id]);
    if (look?.kind === 'garment') garments.push(garmentOf('human', look.garment));
  }
  return garments;
}

/**
 * An item can look like a base garment (Carl's boxers) while still being put on
 * and taken off as an item, so it is heard as cloth rather than going silent.
 */
const BASE_GARMENT_ITEM_MATERIAL: GarmentMaterial = 'cloth';

function itemMaterialOf(garment: GarmentDef<'cat'> | GarmentDef<'human'>): GarmentMaterial {
  return garment.material ?? BASE_GARMENT_ITEM_MATERIAL;
}

function materialOnHuman(def: ItemDef): GarmentMaterial | null {
  const look = humanLookOf(def);
  if (look === null) return null;
  return look.kind === 'garment'
    ? itemMaterialOf(garmentOf('human', look.garment))
    : (look.heardAs ?? null);
}

function materialOnCat(def: ItemDef): GarmentMaterial | null {
  const look = catLookOf(def);
  if (look === null) return null;
  return look.kind === 'garment'
    ? itemMaterialOf(garmentOf('cat', look.garment))
    : (look.heardAs ?? null);
}

/**
 * What `id` is made of when a crawler of kind `wearer` puts it on: the
 * material of the garment it shows as on them, or what their look of it is
 * heard as; failing both, the same read off the other crawler, so a gambeson
 * Donut is drawn without is still cloth. Null for an item nothing gives a
 * material.
 */
export function garmentMaterialOf(id: ItemId, wearer: CrawlerKind): GarmentMaterial | null {
  const def = ITEM_DEF[id];
  return wearer === 'cat'
    ? (materialOnCat(def) ?? materialOnHuman(def))
    : (materialOnHuman(def) ?? materialOnCat(def));
}
