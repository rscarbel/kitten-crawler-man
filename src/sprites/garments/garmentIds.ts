/**
 * Every garment's id, by wearer, and the look a wearable item declares. Kept
 * apart from the garment registry so the item table can name a garment
 * without importing any art.
 */

import type { CrawlerKind } from '../../core/SkillManager';
import type { GarmentMaterial } from './garmentDef';

/** The coat every cat outfit is built on. */
export type CatBaseGarmentId = 'cat_coat';

/** What the cat crawler can put on. */
export type CatWornGarmentId =
  | 'cat_shades'
  | 'cat_crown'
  | 'cat_kettle_helm'
  | 'cat_butterfly_talisman'
  | 'cat_scale_crupper'
  | 'cat_dex_bracelet'
  | 'cat_trollskin_shirt'
  | 'cat_gambeson'
  | 'cat_bracers'
  | 'cat_boots'
  | 'cat_bigboi_boxers';

type CatGarmentId = CatBaseGarmentId | CatWornGarmentId;

/** Dave's jacket and jeans and Ryan's clothes, which every outfit of each is built on. */
export type HumanBaseGarmentId =
  | 'dave_jacket'
  | 'dave_trousers'
  | 'ryan_shirt'
  | 'ryan_belt'
  | 'ryan_chinos'
  | 'ryan_sneakers'
  | 'ryan_watch';

/**
 * Garments put on over the biped rig's base: what the human crawler can put
 * on, then what only the townsfolk built on the rig wear.
 */
export type HumanWornGarmentId =
  | 'human_trollskin_shirt'
  | 'human_gauntlet'
  | 'human_cloak'
  | 'human_toe_ring'
  | 'human_pedicure'
  | 'human_crown'
  | 'human_kettle_helm'
  | 'human_gambeson'
  | 'human_kneepads'
  | 'human_bracers'
  | 'human_boots'
  | 'townsfolk_trousers'
  | 'townsfolk_shoes';

type HumanGarmentId = HumanBaseGarmentId | HumanWornGarmentId;

interface GarmentIdsByWearer {
  readonly cat: CatGarmentId;
  readonly human: HumanGarmentId;
}

interface WornGarmentIdsByWearer {
  readonly cat: CatWornGarmentId;
  readonly human: HumanWornGarmentId;
}

/** The ids of the garments a crawler of kind `W` can wear. */
export type GarmentIdFor<W extends CrawlerKind> = GarmentIdsByWearer[W];

/** The ids of the garments a crawler of kind `W` can put on over their base. */
export type WornGarmentIdFor<W extends CrawlerKind> = WornGarmentIdsByWearer[W];

/**
 * The item is drawn as this garment on that crawler: one put on over the
 * base, since a base garment is in every outfit already.
 */
export interface GarmentLook<W extends CrawlerKind> {
  readonly kind: 'garment';
  readonly garment: WornGarmentIdFor<W>;
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
