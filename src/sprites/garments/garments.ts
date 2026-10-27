/**
 * Every garment, by wearer and id. Complete by type: an id with no garment,
 * or a garment filed under another garment's id, does not load.
 */

import {
  CAT_HEARTHGUARD_BOOTS,
  CAT_MOUSEHIDE_BOOTIES,
  CAT_PROWLER_BOOTIES,
} from './cat/catBooties';
import { CAT_CLAW_GARMENTS } from './cat/catClaws';
import { CAT_COAT } from './cat/catCoat';
import { CAT_GILDED_MONOCLE } from './cat/catGildedMonocle';
import { CAT_GRINNING_MASK } from './cat/catGrinningMask';
import { CAT_KALEIDOSCOPE_SPECS } from './cat/catKaleidoscopeSpecs';
import { CAT_PENDANT_GARMENTS } from './cat/catPendants';
import { CAT_CHARM_GARMENTS } from './cat/catCollarCharms';
import { CAT_COCKSCOMB_CREST } from './cat/catCockscombCrest';
import { CAT_HALO_OF_THE_NINTH_LIFE } from './cat/catHaloOfTheNinthLife';
import { CAT_HEARTHGUARD_CAP } from './cat/catHearthguardCap';
import { CAT_HEARTHGUARD_QUILTED_VEST } from './cat/catHearthguardVest';
import { CAT_PROWLER_HOOD } from './cat/catProwlerHood';
import { CAT_SHOWMANS_TOP_HAT } from './cat/catShowmansTopHat';
import { CAT_STARGAZERS_CAP } from './cat/catStargazersCap';
import { CAT_PLUMED_COAT } from './cat/catPlumedCoat';
import { CAT_PROWLER_MANTLE } from './cat/catProwlerMantle';
import { CAT_SCRAPMAIL_VEST } from './cat/catScrapmailVest';
import { CAT_SEQUIN_TAILCOAT } from './cat/catSequinTailcoat';
import { CAT_VELVET_HARNESS } from './cat/catVelvetHarness';
import type { BaseGarmentDef, GarmentDef, GarmentWearer, WornGarmentDef } from './garmentDef';
import type {
  CatBaseGarmentId,
  CatWornGarmentId,
  GarmentIdFor,
  HumanBaseGarmentId,
  HumanWornGarmentId,
  WornGarmentIdFor,
} from './garmentIds';
import { DAVE_JACKET } from './human/daveJacket';
import { DAVE_TROUSERS } from './human/daveTrousers';
import { RYAN_BELT, RYAN_CHINOS } from './human/ryanChinos';
import { RYAN_SHIRT } from './human/ryanShirt';
import { RYAN_SNEAKERS } from './human/ryanSneakers';
import { RYAN_WATCH } from './human/ryanWatch';
import { LUCKY_HOODIE } from './human/luckyHoodie';
import { PATCHED_DUSTER } from './human/patchedDuster';
import { SEQUIN_TAILCOAT } from './human/sequinTailcoat';
import { HUMAN_HAZARD_GOGGLES } from './human/hazardGoggles';
import { HUMAN_GILDED_MONOCLE } from './human/gildedMonocle';
import { HUMAN_GRINNING_MASK } from './human/grinningMask';
import { FOREMANS_HARDHAT } from './human/foremansHardhat';
import { HEARTHGUARD_CAP } from './human/hearthguardCap';
import { COCKSCOMB_CREST } from './human/cockscombCrest';
import { SHOWMANS_TOP_HAT } from './human/showmansTopHat';
import { DEMOLITION_APRON } from './human/demolitionApron';
import { SCRAPMAIL_VEST } from './human/scrapmailVest';
import { HEARTHGUARD_QUILTED_VEST } from './human/hearthguardQuiltedVest';
import { HUMAN_MOON_LOCKET, HUMAN_STONEHEART_AMULET, HUMAN_SUN_LOCKET } from './human/neckPendants';
import {
  HUMAN_HAMHOCK_BOOTS,
  HUMAN_HEARTHGUARD_BOOTS,
  HUMAN_HOBNAIL_BOOTS,
} from './human/crawlerBoots';
import {
  HUMAN_HEARTHGUARD_BRACERS,
  HUMAN_IRON_KNUCKLE_GAUNTLET,
  HUMAN_SCRAPPERS_WRAPS,
  HUMAN_SILKSPINNER_GLOVES,
} from './human/handwear';
import { HUMAN_RIOT_KNEEGUARDS } from './human/riotKneeguards';
import {
  HUMAN_EMBERWARD_RING,
  HUMAN_FAE_IRON_RING,
  HUMAN_FANG_RING,
  HUMAN_FROSTWARD_RING,
  HUMAN_HOURGLASS_RING,
  HUMAN_LUCKY_PENNY_RING,
  HUMAN_NIMBLE_BANGLE,
} from './human/trinketRings';
import { TOWNSFOLK_SHOES, TOWNSFOLK_TROUSERS } from './human/townsfolkLegwear';
import { IVY_BOOTS, IVY_BRACER, IVY_TROUSERS } from './human/ivyAshgroveClothes';
import { MONK_HABIT, MONK_SANDALS } from './human/monkHabit';
import { HIRELING_ARMBAND } from './human/hirelingArmband';

const CAT_BASE_GARMENTS: Readonly<Record<CatBaseGarmentId, BaseGarmentDef<'cat'>>> = {
  cat_coat: CAT_COAT,
};

const HUMAN_BASE_GARMENTS: Readonly<Record<HumanBaseGarmentId, BaseGarmentDef<'human'>>> = {
  dave_jacket: DAVE_JACKET,
  dave_trousers: DAVE_TROUSERS,
  ryan_shirt: RYAN_SHIRT,
  ryan_belt: RYAN_BELT,
  ryan_chinos: RYAN_CHINOS,
  ryan_sneakers: RYAN_SNEAKERS,
  ryan_watch: RYAN_WATCH,
};

const CAT_WORN_GARMENTS: Readonly<Record<CatWornGarmentId, WornGarmentDef<'cat'>>> = {
  cat_hearthguard_quilted_vest: CAT_HEARTHGUARD_QUILTED_VEST,
  cat_stargazers_cap: CAT_STARGAZERS_CAP,
  cat_halo_of_the_ninth_life: CAT_HALO_OF_THE_NINTH_LIFE,
  cat_prowler_hood: CAT_PROWLER_HOOD,
  cat_hearthguard_cap: CAT_HEARTHGUARD_CAP,
  cat_cockscomb_crest: CAT_COCKSCOMB_CREST,
  cat_showmans_top_hat: CAT_SHOWMANS_TOP_HAT,
  cat_velvet_harness: CAT_VELVET_HARNESS,
  cat_plumed_coat: CAT_PLUMED_COAT,
  cat_prowler_mantle: CAT_PROWLER_MANTLE,
  cat_scrapmail_vest: CAT_SCRAPMAIL_VEST,
  cat_sequin_tailcoat: CAT_SEQUIN_TAILCOAT,
  cat_kaleidoscope_specs: CAT_KALEIDOSCOPE_SPECS,
  cat_gilded_monocle: CAT_GILDED_MONOCLE,
  cat_grinning_mask: CAT_GRINNING_MASK,
  cat_mousehide_booties: CAT_MOUSEHIDE_BOOTIES,
  cat_prowler_booties: CAT_PROWLER_BOOTIES,
  cat_hearthguard_boots: CAT_HEARTHGUARD_BOOTS,
  ...CAT_CLAW_GARMENTS,
  ...CAT_CHARM_GARMENTS,
  ...CAT_PENDANT_GARMENTS,
};

const HUMAN_WORN_GARMENTS: Readonly<Record<HumanWornGarmentId, WornGarmentDef<'human'>>> = {
  human_lucky_hoodie: LUCKY_HOODIE,
  human_patched_duster: PATCHED_DUSTER,
  human_sequin_tailcoat: SEQUIN_TAILCOAT,
  human_hazard_goggles: HUMAN_HAZARD_GOGGLES,
  human_gilded_monocle: HUMAN_GILDED_MONOCLE,
  human_grinning_mask: HUMAN_GRINNING_MASK,
  human_foremans_hardhat: FOREMANS_HARDHAT,
  human_hearthguard_cap: HEARTHGUARD_CAP,
  human_cockscomb_crest: COCKSCOMB_CREST,
  human_showmans_top_hat: SHOWMANS_TOP_HAT,
  human_demolition_apron: DEMOLITION_APRON,
  human_scrapmail_vest: SCRAPMAIL_VEST,
  human_hearthguard_quilted_vest: HEARTHGUARD_QUILTED_VEST,
  human_stoneheart_amulet: HUMAN_STONEHEART_AMULET,
  human_sun_locket: HUMAN_SUN_LOCKET,
  human_moon_locket: HUMAN_MOON_LOCKET,
  human_scrappers_wraps: HUMAN_SCRAPPERS_WRAPS,
  human_silkspinner_gloves: HUMAN_SILKSPINNER_GLOVES,
  human_iron_knuckle_gauntlet: HUMAN_IRON_KNUCKLE_GAUNTLET,
  human_hearthguard_bracers: HUMAN_HEARTHGUARD_BRACERS,
  human_riot_kneeguards: HUMAN_RIOT_KNEEGUARDS,
  human_hobnail_boots: HUMAN_HOBNAIL_BOOTS,
  human_hamhock_boots: HUMAN_HAMHOCK_BOOTS,
  human_hearthguard_boots: HUMAN_HEARTHGUARD_BOOTS,
  human_nimble_bangle: HUMAN_NIMBLE_BANGLE,
  human_lucky_penny_ring: HUMAN_LUCKY_PENNY_RING,
  human_fang_ring: HUMAN_FANG_RING,
  human_frostward_ring: HUMAN_FROSTWARD_RING,
  human_emberward_ring: HUMAN_EMBERWARD_RING,
  human_fae_iron_ring: HUMAN_FAE_IRON_RING,
  human_hourglass_ring: HUMAN_HOURGLASS_RING,
  townsfolk_trousers: TOWNSFOLK_TROUSERS,
  townsfolk_shoes: TOWNSFOLK_SHOES,
  monk_habit: MONK_HABIT,
  monk_sandals: MONK_SANDALS,
  hireling_armband: HIRELING_ARMBAND,
  ivy_trousers: IVY_TROUSERS,
  ivy_boots: IVY_BOOTS,
  ivy_bracer: IVY_BRACER,
};

const WORN_GARMENTS: {
  readonly [W in GarmentWearer]: Readonly<Record<WornGarmentIdFor<W>, WornGarmentDef<W>>>;
} = {
  cat: CAT_WORN_GARMENTS,
  human: HUMAN_WORN_GARMENTS,
};

const GARMENTS: {
  readonly [W in GarmentWearer]: Readonly<Record<GarmentIdFor<W>, GarmentDef<W>>>;
} = {
  cat: { ...CAT_BASE_GARMENTS, ...CAT_WORN_GARMENTS },
  human: { ...HUMAN_BASE_GARMENTS, ...HUMAN_WORN_GARMENTS },
};

for (const [key, garment] of [...Object.entries(GARMENTS.cat), ...Object.entries(GARMENTS.human)]) {
  if (garment.id !== key) {
    throw new Error(`Garment "${garment.name}" (${garment.id}) is filed under "${key}"`);
  }
}

/** The garment `id` a crawler of kind `wearer` puts on over their base. */
export function wornGarmentOf<W extends GarmentWearer>(
  wearer: W,
  id: WornGarmentIdFor<W>,
): WornGarmentDef<W> {
  return WORN_GARMENTS[wearer][id];
}

/** Every garment a crawler of kind `wearer` can put on over their base. */
export function wornGarmentsOf<W extends GarmentWearer>(wearer: W): readonly WornGarmentDef<W>[] {
  return Object.values<WornGarmentDef<W>>(WORN_GARMENTS[wearer]);
}

/** Every garment a crawler of kind `wearer` can be painted in. */
export function garmentsOf<W extends GarmentWearer>(wearer: W): readonly GarmentDef<W>[] {
  return Object.values<GarmentDef<W>>(GARMENTS[wearer]);
}
