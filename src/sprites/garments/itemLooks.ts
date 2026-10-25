/**
 * From items to garments: what a crawler's equipment paints on them, read off
 * each item's declared `look`.
 */

import { catLookOf, humanLookOf, ITEM_DEF, type ItemDef, type ItemId } from '../../core/ItemDefs';
import type { CrawlerKind } from '../../core/SkillManager';
import type { GarmentMaterial, WornGarmentDef } from './garmentDef';
import { wornGarmentOf } from './garments';

/** The garments the cat figure shows wearing `items`, in item order; items with no look on her add none. */
export function catGarmentsWearing(items: readonly ItemId[]): WornGarmentDef<'cat'>[] {
  const garments: WornGarmentDef<'cat'>[] = [];
  for (const id of items) {
    const look = catLookOf(ITEM_DEF[id]);
    if (look?.kind === 'garment') garments.push(wornGarmentOf('cat', look.garment));
  }
  return garments;
}

/** The garments the human figure shows wearing `items`, in item order; items with no look on him add none. */
export function humanGarmentsWearing(items: readonly ItemId[]): WornGarmentDef<'human'>[] {
  const garments: WornGarmentDef<'human'>[] = [];
  for (const id of items) {
    const look = humanLookOf(ITEM_DEF[id]);
    if (look?.kind === 'garment') garments.push(wornGarmentOf('human', look.garment));
  }
  return garments;
}

/**
 * Every garment some item paints on the human figure, each once: crawler gear,
 * as against the garments only the townsfolk built on the rig wear.
 */
export function humanItemGarments(): WornGarmentDef<'human'>[] {
  const all = humanGarmentsWearing(Object.values(ITEM_DEF).map((item) => item.id));
  return all.filter((garment, index) => all.indexOf(garment) === index);
}

function materialOnHuman(def: ItemDef): GarmentMaterial | null {
  const look = humanLookOf(def);
  if (look === null) return null;
  return look.kind === 'garment'
    ? wornGarmentOf('human', look.garment).material
    : (look.heardAs ?? null);
}

function materialOnCat(def: ItemDef): GarmentMaterial | null {
  const look = catLookOf(def);
  if (look === null) return null;
  return look.kind === 'garment'
    ? wornGarmentOf('cat', look.garment).material
    : (look.heardAs ?? null);
}

/**
 * What `id` is made of when a crawler of kind `wearer` puts it on: the
 * material of the garment it shows as on them, or what their look of it is
 * heard as; failing both, the same read off the other crawler, so boxers the
 * human wears out of sight under his trousers are still cloth. Null for an
 * item nothing gives a material.
 */
export function garmentMaterialOf(id: ItemId, wearer: CrawlerKind): GarmentMaterial | null {
  const def = ITEM_DEF[id];
  return wearer === 'cat'
    ? (materialOnCat(def) ?? materialOnHuman(def))
    : (materialOnHuman(def) ?? materialOnCat(def));
}
