/**
 * Brother Anselm's look on the human rig: a weathered, olive-tanned man in
 * his fifties, his tonsure's ring of hair gone mostly grey, clean-shaven,
 * brown-eyed and calm. He is the rig's own build a touch shorter, and wears
 * nothing of his own under the habit: his clothes are the worn garments his
 * figure is dressed in.
 */

import { ANSELM_TONSURE } from '../../art/biped/anselmHead';
import {
  FACING_BROW_DEFAULT,
  FLAT_MOUTH,
  PROFILE_BROW_DEFAULT,
  RIG_BROW_TONE,
  RIG_EYES,
} from '../../art/biped/head';
import type { Ramp } from '../../art/biped/palette';
import { RIG_GARMENT_CUT } from '../../art/biped/torso';
import { MONK_WOOL } from '../../garments/human/monkHabit';
import type { HumanLook } from '../humanLook';
import { RIG_LOOK } from './rig';

/** Olive skin weathered by years on the road, warm in the light and brown in the shadow. */
const ANSELM_SKIN: Ramp = {
  deep: '#4d3326',
  shadow: '#6e4a36',
  dark: '#93664a',
  mid: '#a3735a',
  base: '#cf9c78',
  light: '#e4b995',
  rim: '#ecc9aa',
};

/** Brown hair most of the way to grey: pale enough that the ring reads against his scalp. */
const ANSELM_HAIR: Ramp = {
  deep: '#3f3328',
  shadow: '#574636',
  dark: '#6e5b48',
  mid: '#8a7660',
  base: '#a6937c',
  light: '#c1b19c',
  rim: '#d6cab8',
};

const ANSELM_IRIS = '#5b4330';

/** A touch shorter than the rig: a man of middling height, not a fighter's build. */
const ANSELM_HEIGHT_SCALE = 0.97;
/** Calm: almost none of the rig's combat scowl. */
const ANSELM_ANGER_SCALE = 0.1;
const ANSELM_LIP_FULLNESS = 0.9;

export const BROTHER_ANSELM_LOOK: HumanLook = {
  ...RIG_LOOK,
  id: 'brother_anselm',
  skin: ANSELM_SKIN,
  handSkin: null,
  hair: ANSELM_HAIR,
  iris: ANSELM_IRIS,
  garment: MONK_WOOL,
  garmentCut: { ...RIG_GARMENT_CUT, hasHardware: false },
  hairstyle: ANSELM_TONSURE,
  facialHair: null,
  expression: {
    angerScale: ANSELM_ANGER_SCALE,
    profileBrow: PROFILE_BROW_DEFAULT,
    facingBrow: FACING_BROW_DEFAULT,
    lipFullness: ANSELM_LIP_FULLNESS,
    mouthSmile: FLAT_MOUTH,
    eyes: RIG_EYES,
    browTone: RIG_BROW_TONE,
  },
  heightScale: ANSELM_HEIGHT_SCALE,
};
