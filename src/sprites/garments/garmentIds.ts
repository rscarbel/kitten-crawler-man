/**
 * Every garment's id, by wearer, and the look a wearable item declares. Kept
 * apart from the garment registry so the item table can name a garment
 * without importing any art.
 */

import type { CrawlerKind } from '../../core/skills/SkillManager';
import type { GarmentMaterial } from './garmentDef';
import type { OffHandHeldVisualId } from '../held/heldVisualIds';

/** The coat every cat outfit is built on. */
export type CatBaseGarmentId = 'cat_coat';

/** Caps or talons over her forepaws' claws: what each claw weapon looks like on her. */
export type CatClawGarmentId =
  | 'cat_tin_claw_caps'
  | 'cat_venom_claws'
  | 'cat_frostbite_claws'
  | 'cat_prowler_claws'
  | 'cat_ink_dipped_claws'
  | 'cat_sunsteel_talons';

/** A trinket as she wears it: a charm hanging from a thin collar. */
export type CatCharmGarmentId =
  | 'cat_nimble_bangle_charm'
  | 'cat_lucky_penny_charm'
  | 'cat_fang_charm'
  | 'cat_frostward_charm'
  | 'cat_emberward_charm'
  | 'cat_fae_iron_charm'
  | 'cat_hourglass_charm';

/** A neck-slot piece as she wears it: a pendant on its own chain or thong. */
export type CatPendantGarmentId =
  'cat_moonmoth_pendant' | 'cat_stoneheart_amulet' | 'cat_sun_locket' | 'cat_moon_locket';

/** What the cat crawler can put on over her coat. */
export type CatWornGarmentId =
  | 'cat_hearthguard_quilted_vest'
  | 'cat_velvet_harness'
  | 'cat_plumed_coat'
  | 'cat_prowler_mantle'
  | 'cat_scrapmail_vest'
  | 'cat_sequin_tailcoat'
  | 'cat_kaleidoscope_specs'
  | 'cat_gilded_monocle'
  | 'cat_grinning_mask'
  | 'cat_mousehide_booties'
  | 'cat_prowler_booties'
  | 'cat_hearthguard_boots'
  | 'cat_stargazers_cap'
  | 'cat_halo_of_the_ninth_life'
  | 'cat_prowler_hood'
  | 'cat_hearthguard_cap'
  | 'cat_cockscomb_crest'
  | 'cat_showmans_top_hat'
  | CatClawGarmentId
  | CatCharmGarmentId
  | CatPendantGarmentId;

/** Dave's jacket and jeans and Ryan's clothes, which every outfit of each is built on. */
export type HumanBaseGarmentId =
  | 'dave_jacket'
  | 'dave_trousers'
  | 'ryan_shirt'
  | 'ryan_belt'
  | 'ryan_chinos'
  | 'ryan_sneakers'
  | 'ryan_watch';

/** Garments put on over the biped rig's base: what the townsfolk built on the rig wear. */
export type HumanWornGarmentId =
  | HumanHeadTorsoGarmentId
  | HumanLimbGarmentId
  | HumanTrinketGarmentId
  | 'townsfolk_trousers'
  | 'townsfolk_shoes';

/** What the human crawler wears on his hands, forearms, knees and feet. */
type HumanLimbGarmentId =
  | 'human_scrappers_wraps'
  | 'human_silkspinner_gloves'
  | 'human_iron_knuckle_gauntlet'
  | 'human_hearthguard_bracers'
  | 'human_riot_kneeguards'
  | 'human_hobnail_boots'
  | 'human_hamhock_boots'
  | 'human_hearthguard_boots';

/** The trinkets on the human crawler: a ring on his hand for each charm, a bangle at his wrist. */
export type HumanTrinketGarmentId =
  | 'human_nimble_bangle'
  | 'human_lucky_penny_ring'
  | 'human_fang_ring'
  | 'human_frostward_ring'
  | 'human_emberward_ring'
  | 'human_fae_iron_ring'
  | 'human_hourglass_ring';

/** What the human crawler wears over his head and torso. */
type HumanHeadTorsoGarmentId =
  | 'human_lucky_hoodie'
  | 'human_patched_duster'
  | 'human_sequin_tailcoat'
  | 'human_hazard_goggles'
  | 'human_gilded_monocle'
  | 'human_grinning_mask'
  | 'human_foremans_hardhat'
  | 'human_hearthguard_cap'
  | 'human_cockscomb_crest'
  | 'human_showmans_top_hat'
  | 'human_demolition_apron'
  | 'human_scrapmail_vest'
  | 'human_hearthguard_quilted_vest'
  | 'human_stoneheart_amulet'
  | 'human_sun_locket'
  | 'human_moon_locket';

interface BaseGarmentIdsByWearer {
  readonly cat: CatBaseGarmentId;
  readonly human: HumanBaseGarmentId;
}

interface WornGarmentIdsByWearer {
  readonly cat: CatWornGarmentId;
  readonly human: HumanWornGarmentId;
}

/** The ids of the garments a crawler of kind `W` can wear. */
export type GarmentIdFor<W extends CrawlerKind> =
  BaseGarmentIdsByWearer[W] | WornGarmentIdsByWearer[W];

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

/**
 * The item is a shield carried on the human's off hand: drawn as a held
 * visual in that fist, or stowed on him when the hand is wanted elsewhere.
 */
export interface OffHandLook {
  readonly kind: 'offHand';
  readonly heldVisual: OffHandHeldVisualId;
  /** What putting it on sounds like: a held thing is no garment to read a material off. */
  readonly heardAs: GarmentMaterial;
}

interface LooksByWearer {
  readonly cat: GarmentLook<'cat'> | NoLook;
  readonly human: GarmentLook<'human'> | OffHandLook | NoLook;
}

/** How an item looks on a crawler of kind `W`. */
export type WearerLook<W extends CrawlerKind> = LooksByWearer[W];

/** A look for each crawler: what an item either of them can wear declares. */
export type LookOnEach = { readonly [W in CrawlerKind]: WearerLook<W> };
