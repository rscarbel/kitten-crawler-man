/**
 * The light-skinned female crawler: fair skin, chestnut-brown hair drawn back
 * into a low ponytail, and blue-grey eyes, on the female crawler's build and
 * clothes.
 */

import type { Ramp } from '../../art/biped/palette';
import { LOW_PONYTAIL } from '../../art/biped/crawlerHair';
import type { HumanLook } from '../humanLook';
import { BLUE_GREY_IRIS } from './lightComplexion';
import { FEMALE_CRAWLER_BUILD, FEMALE_CRAWLER_EXPRESSION } from './femaleBuild';

/** Fair, a little less rose in the shadow than the male crawler's. */
const FEMALE_LIGHT_SKIN: Ramp = {
  deep: '#5e4038',
  shadow: '#82594f',
  dark: '#ab7766',
  mid: '#b67a68',
  base: '#ecc4ae',
  light: '#f7dccb',
  rim: '#f6e0d2',
};

const FEMALE_LIGHT_HAND_SKIN: Ramp = {
  deep: '#623a3a',
  shadow: '#955e58',
  dark: '#ba806c',
  mid: '#cf9984',
  base: '#e2b19b',
  light: '#f2d0c0',
  rim: '#f8e0d4',
};

/** A warm chestnut brown. */
const CHESTNUT_HAIR: Ramp = {
  deep: '#2f2018',
  shadow: '#3d2a1e',
  dark: '#4f3626',
  mid: '#644632',
  base: '#7a5840',
  light: '#946f52',
  rim: '#ad8b70',
};

export const FEMALE_LIGHT_LOOK = {
  ...FEMALE_CRAWLER_BUILD,
  id: 'female_light',
  skin: FEMALE_LIGHT_SKIN,
  handSkin: FEMALE_LIGHT_HAND_SKIN,
  hair: CHESTNUT_HAIR,
  iris: BLUE_GREY_IRIS,
  hairstyle: LOW_PONYTAIL,
  facialHair: null,
  expression: FEMALE_CRAWLER_EXPRESSION,
} as const satisfies HumanLook;
