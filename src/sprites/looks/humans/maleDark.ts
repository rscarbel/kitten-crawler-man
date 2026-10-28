/**
 * The dark-skinned male crawler: deep brown skin, black hair in short tight
 * curls, a short black beard and dark brown eyes, on the male crawler's build
 * and clothes.
 */

import { shortBeard, TIGHT_CURL_CROP } from '../../art/biped/crawlerHair';
import type { BipedExpression, EyeStyle } from '../../art/biped/head';
import type { HumanLook } from '../humanLook';
import {
  BLACK_HAIR,
  DARK_BROWN_IRIS,
  DEEP_BROWN_HAND_SKIN,
  DEEP_BROWN_SKIN,
  DEEP_SKIN_BROW_TONE,
  DEEP_SKIN_LID_INK,
} from './deepComplexion';
import { MALE_CRAWLER_BUILD, MALE_CRAWLER_EXPRESSION, OPEN_EYES } from './maleBuild';

const DEEP_SKIN_EYES: EyeStyle = { ...OPEN_EYES, lidInk: DEEP_SKIN_LID_INK };

const DEEP_SKIN_EXPRESSION: BipedExpression = {
  ...MALE_CRAWLER_EXPRESSION,
  eyes: DEEP_SKIN_EYES,
  browTone: DEEP_SKIN_BROW_TONE,
};

export const MALE_DARK_LOOK = {
  ...MALE_CRAWLER_BUILD,
  id: 'male_dark',
  skin: DEEP_BROWN_SKIN,
  handSkin: DEEP_BROWN_HAND_SKIN,
  hair: BLACK_HAIR,
  iris: DARK_BROWN_IRIS,
  hairstyle: TIGHT_CURL_CROP,
  facialHair: shortBeard(BLACK_HAIR),
  expression: DEEP_SKIN_EXPRESSION,
} as const satisfies HumanLook;
