/**
 * The light-skinned male crawler: fair skin with a warm pink undertone,
 * medium-brown hair cut short at the sides with a longer top swept up and
 * back, a short full beard of a warmer, more ginger brown, and light
 * blue-grey eyes, on the male crawler's build and clothes.
 */

import type { Ramp } from '../../art/biped/palette';
import { shortBeard, SWEPT_TOP } from '../../art/biped/crawlerHair';
import type { HumanLook } from '../humanLook';
import { BLUE_GREY_IRIS } from './lightComplexion';
import { MALE_CRAWLER_BUILD, MALE_CRAWLER_EXPRESSION } from './maleBuild';

/** Fair, pink in the light and rose in the shadow. */
const MALE_LIGHT_SKIN: Ramp = {
  deep: '#583a3a',
  shadow: '#7a504c',
  dark: '#a66c5f',
  mid: '#a86759',
  base: '#e6b7a4',
  light: '#f4d4c5',
  rim: '#f2d6c8',
};

/** His hands and knuckles, a little redder than his face. */
const MALE_LIGHT_HAND_SKIN: Ramp = {
  deep: '#5f3238',
  shadow: '#905755',
  dark: '#b47766',
  mid: '#c98f7d',
  base: '#dca792',
  light: '#efc8b8',
  rim: '#f6dccf',
};

/** Medium brown. */
const MEDIUM_BROWN_HAIR: Ramp = {
  deep: '#3e2e22',
  shadow: '#453324',
  dark: '#523d2b',
  mid: '#664c37',
  base: '#7b5d44',
  light: '#957457',
  rim: '#b0917a',
};

/**
 * Brown with a warmer, more ginger cast than his hair: beard hair grows
 * redder than the scalp's on a great many brown-haired men.
 */
const GINGER_BROWN_BEARD: Ramp = {
  deep: '#3a2a20',
  shadow: '#4e3a2b',
  dark: '#634a37',
  mid: '#765b45',
  base: '#866a51',
  light: '#9a7e63',
  rim: '#b0967c',
};

export const MALE_LIGHT_LOOK = {
  ...MALE_CRAWLER_BUILD,
  id: 'male_light',
  skin: MALE_LIGHT_SKIN,
  handSkin: MALE_LIGHT_HAND_SKIN,
  hair: MEDIUM_BROWN_HAIR,
  iris: BLUE_GREY_IRIS,
  hairstyle: SWEPT_TOP,
  facialHair: shortBeard(GINGER_BROWN_BEARD),
  expression: MALE_CRAWLER_EXPRESSION,
} as const satisfies HumanLook;
