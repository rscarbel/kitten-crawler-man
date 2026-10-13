/**
 * Every garment's id, by wearer, and the look a wearable item declares. Kept
 * apart from the garment registry so the item table can name a garment
 * without importing any art.
 */

import type { CrawlerKind } from '../../core/SkillManager';
import type { GarmentMaterial } from './garmentDef';

/** Donut's garments: her coat, which every outfit of hers is built on, then what she can put on. */
export const CAT_GARMENT_IDS = [
  'cat_coat',
  'cat_shades',
  'cat_crown',
  'cat_kettle_helm',
  'cat_butterfly_talisman',
  'cat_scale_crupper',
  'cat_dex_bracelet',
] as const;
export type CatGarmentId = (typeof CAT_GARMENT_IDS)[number];

/** Carl's garments: his jacket and boxers, which every outfit of his is built on, then what he can put on. */
export const HUMAN_GARMENT_IDS = [
  'carl_jacket',
  'carl_boxers',
  'carl_trollskin_shirt',
  'carl_gauntlet',
  'carl_cloak',
  'carl_toe_ring',
  'carl_pedicure',
  'carl_crown',
  'carl_kettle_helm',
  'carl_gambeson',
  'carl_kneepads',
  'carl_bracers',
  'carl_boots',
] as const;
export type HumanGarmentId = (typeof HUMAN_GARMENT_IDS)[number];

interface GarmentIdsByWearer {
  readonly cat: CatGarmentId;
  readonly human: HumanGarmentId;
}

/** The ids of the garments a crawler of kind `W` can wear. */
export type GarmentIdFor<W extends CrawlerKind> = GarmentIdsByWearer[W];

/** The item is drawn as this garment on that crawler. */
export interface GarmentLook<W extends CrawlerKind> {
  readonly kind: 'garment';
  readonly garment: GarmentIdFor<W>;
}

/**
 * Nothing of the item shows on that crawler. `reason` says why: what makes it
 * unreadable at the tile, or what paints that crawler instead.
 */
export interface NoLook {
  readonly kind: 'none';
  readonly reason: string;
  /** What putting it on sounds like, for an item no crawler shows a garment for. */
  readonly heardAs?: GarmentMaterial;
}

interface LooksByWearer {
  readonly cat: GarmentLook<'cat'> | NoLook;
  readonly human: GarmentLook<'human'> | NoLook;
}

/** How an item looks on a crawler of kind `W`. */
export type WearerLook<W extends CrawlerKind> = LooksByWearer[W];

/** A look for each crawler: what an item either of them can wear declares. */
export type LookOnEach = { readonly [W in CrawlerKind]: WearerLook<W> };
