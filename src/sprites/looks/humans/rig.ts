/**
 * The rig as a look: every build field at the rig's own value, painted in
 * Dave's colours, crop, sleeve and jacket. Every figure on the rig that is
 * not a player crawler starts from this and overrides what is its own, so a
 * player look's build — his height, shoulders, head and limbs — never leaks
 * into the town's cast or a named resident.
 */

import { FACING_SHOULDER_SPREAD } from '../../art/biped/proportions';
import { RIG_LIMBS } from '../../art/biped/limbs';
import { RIG_GARMENT_CUT } from '../../art/biped/torso';
import { DAVE_JACKET } from '../../garments/human/daveJacket';
import {
  type HumanLook,
  RIG_HEAD_BREADTH,
  RIG_HEAD_SCALE,
  RIG_HIP_SPREAD,
  RIG_NECK_GIRTH,
  RIG_NECK_SOFTNESS,
} from '../humanLook';
import { DAVE_LOOK } from './dave';

/** The rig is drawn at its own height and breadth. */
const RIG_HEIGHT_SCALE = 1;
const RIG_WIDTH_SCALE = 1;
/**
 * Halfway from eyes to chin. Moot at the rig's own head size, where scaling
 * about any point leaves the head where it is.
 */
const RIG_HEAD_PIVOT = 0.5;

export const RIG_LOOK: HumanLook = {
  ...DAVE_LOOK,
  id: 'rig',
  garmentCut: RIG_GARMENT_CUT,
  heightScale: RIG_HEIGHT_SCALE,
  widthScale: RIG_WIDTH_SCALE,
  limbs: RIG_LIMBS,
  headScale: RIG_HEAD_SCALE,
  headBreadth: RIG_HEAD_BREADTH,
  headPivot: RIG_HEAD_PIVOT,
  neckGirth: RIG_NECK_GIRTH,
  neckSoftness: RIG_NECK_SOFTNESS,
  shoulderSpread: FACING_SHOULDER_SPREAD,
  hipSpread: RIG_HIP_SPREAD,
  baseGarments: [DAVE_JACKET],
};
