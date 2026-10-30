/**
 * The sound of Belle noticing something only she can perceive: the cue
 * `CatSenseCue` raises as a sense source comes into her reach.
 *
 * The party's own cue, heard wherever a sense can be laid, so its takes are
 * preloaded through the `universal` group.
 */

import type { CueSlot } from '../../audio/cueSlot';

/**
 * Waits on `cat_senses_perk`, a soft curious chirp as her ears prick up.
 * Two of her sniffs stand in until it is recorded.
 */
export const CAT_SENSE_CUE: CueSlot<'cat_senses_perk'> = {
  takes: ['cat_sniff_1', 'cat_sniff_3'],
  standInFor: 'cat_senses_perk',
};
