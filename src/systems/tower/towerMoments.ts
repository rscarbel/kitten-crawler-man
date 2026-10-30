/**
 * The points in the tower's storey works that the questline's chapters turn
 * on. The works raise each as a `towerMoment` on the scene's event bus, and
 * whatever hands a chapter over, plays a cutscene or speaks a line hooks it
 * there; the works themselves never hand over or speak.
 *
 * Every lasting outcome behind a moment is also written to the questline's
 * progress first, so a hook that missed the event still finds the record.
 */

import type { KitchenStage } from '../../core/quests/missingCatsProgress';
import type { TownCatId } from '../../core/state/townCatIds';

export type TowerMoment =
  /** Belle has worked her own cage's latch open (`crawlerCatUncaged`). */
  | { readonly kind: 'crawler_cat_uncaged' }
  /** A town cat's cage is open and she has bolted for the stair (`catsFreed`). */
  | { readonly kind: 'town_cat_freed'; readonly cat: TownCatId }
  /** The cellmate's cage is open and she has joined Belle (`cellmateFreed`). */
  | { readonly kind: 'cellmate_freed' }
  /** The keeper saw a paw at a latch. */
  | { readonly kind: 'latch_seen' }
  /** The keeper caught Belle out of her cage and shut her back in it (`crawlerCatUncaged` cleared). */
  | { readonly kind: 'crawler_cat_recaged' }
  /** Belle has come down into the archive while its wards still burn solid: the cattery is behind her. */
  | { readonly kind: 'cattery_exit_reached' }
  /** The key ring went into the archive's hatch (`keyRingSent`). */
  | { readonly kind: 'key_ring_sent' }
  /** A warden caught a crawler in the archive, which was set back at its stair. */
  | { readonly kind: 'archive_caught' }
  /** A warden called by the dumbwaiter's bell has reached the hatch and is peering in, its room left empty. */
  | { readonly kind: 'archive_bell_answered' }
  /** Belle has come down out of the archive onto the bell storey before the reunion: the archive is crossed. */
  | { readonly kind: 'archive_crossed' }
  /**
   * The kitchen has come to `stage` (`kitchen`): the step just done, or the
   * kitchen's first step as the human first steps into it. `tunaInHand` is
   * whether a crawler there had a tin of tuna to send up then.
   */
  | {
      readonly kind: 'kitchen_stage_reached';
      readonly stage: KitchenStage;
      readonly tunaInHand: boolean;
    }
  /** The portcullis chain was pulled while the portcullis is held from above. */
  | { readonly kind: 'portcullis_chain_held' }
  /** The cellmate has sat down on a counterweight plate. */
  | { readonly kind: 'cellmate_holding_plate' }
  /** The counterweight has fallen and the kitchen's portcullis is up (`portcullisRaised`). */
  | { readonly kind: 'portcullis_raised' }
  /** A swinging bell struck a crawler on a beam. */
  | { readonly kind: 'bell_struck' }
  /** The human broke a ward stone Belle had found. */
  | { readonly kind: 'ward_stone_broken'; readonly stoneId: string };
