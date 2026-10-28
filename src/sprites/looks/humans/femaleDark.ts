/**
 * The dark-skinned female crawler: deep brown skin, black hair worn close to
 * the head and drawn back into a single low braid, and dark brown eyes, on
 * the female crawler's build and clothes.
 */

import { LOW_BRAID } from '../../art/biped/crawlerHair';
import type { BipedExpression } from '../../art/biped/head';
import type { HumanLook } from '../humanLook';
import {
  BLACK_HAIR,
  DARK_BROWN_IRIS,
  DEEP_BROWN_HAND_SKIN,
  DEEP_BROWN_SKIN,
  DEEP_SKIN_BROW_TONE,
  DEEP_SKIN_LID_INK,
} from './deepComplexion';
import { FEMALE_CRAWLER_BUILD, FEMALE_CRAWLER_EXPRESSION } from './femaleBuild';

const FEMALE_DEEP_SKIN_EXPRESSION: BipedExpression = {
  ...FEMALE_CRAWLER_EXPRESSION,
  eyes: { ...FEMALE_CRAWLER_EXPRESSION.eyes, lidInk: DEEP_SKIN_LID_INK },
  browTone: DEEP_SKIN_BROW_TONE,
};

export const FEMALE_DARK_LOOK = {
  ...FEMALE_CRAWLER_BUILD,
  id: 'female_dark',
  skin: DEEP_BROWN_SKIN,
  handSkin: DEEP_BROWN_HAND_SKIN,
  hair: BLACK_HAIR,
  iris: DARK_BROWN_IRIS,
  hairstyle: LOW_BRAID,
  facialHair: null,
  expression: FEMALE_DEEP_SKIN_EXPRESSION,
} as const satisfies HumanLook;
