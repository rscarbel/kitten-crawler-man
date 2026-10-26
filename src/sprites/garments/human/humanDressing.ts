/**
 * Dresses the human figure's compositor in an outfit: the `BipedDressing` his figure
 * calls at every piece, painting each garment of the outfit that covers that
 * part, read off the outfit his pose carries.
 */

import type { BipedDressing, BipedPoseOutfit } from '../../art/biped/bipedParts';
import { STILL_ROW } from '../../art/biped/bipedParts';
import type { BipedPose, ViewSpec } from '../../art/biped/rig';
import type { CardinalView } from '../../facingView';
import type { GarmentFrameContext } from '../garmentDef';
import { gloveOf, outfitOf, paintOutfitPart, sleevesOf, type Outfit } from '../outfit';
import type { HumanLook } from '../../looks/humanLook';

/**
 * `look`'s base garments with nothing put on over them: the outfit a pose
 * that carries none is painted in.
 */
export function defaultOutfitOf(look: HumanLook): Outfit<'human'> {
  const known = defaultOutfits.get(look);
  if (known !== undefined) return known;
  const outfit = outfitOf(look, []);
  defaultOutfits.set(look, outfit);
  return outfit;
}

const defaultOutfits = new WeakMap<HumanLook, Outfit<'human'>>();

function cardinalOf(view: ViewSpec): CardinalView {
  if (view.profile) return 'side';
  return view.showsBack ? 'back' : 'front';
}

/** A still of him in `outfit`, drawn from no row. */
export function stillOutfit(outfit: Outfit<'human'>): BipedPoseOutfit {
  return { outfit, row: STILL_ROW, frame: 0, frameCount: 1 };
}

/** What `pose` is wearing on `look`, and what its garments are told of the cell, as drawn in `view`. */
export function humanWornOn(
  pose: BipedPose,
  view: ViewSpec,
  look: HumanLook,
): { readonly outfit: Outfit<'human'>; readonly context: GarmentFrameContext<'human'> } {
  const worn = pose.outfit ?? stillOutfit(defaultOutfitOf(look));
  return {
    outfit: worn.outfit,
    context: {
      row: worn.row,
      frame: worn.frame,
      frameCount: worn.frameCount,
      view: cardinalOf(view),
      westward: false,
      pose,
    },
  };
}

/** The dressing that paints what `pose` carries on `look`, as drawn in `view`. */
export function humanDressingFor(pose: BipedPose, view: ViewSpec, look: HumanLook): BipedDressing {
  const { outfit, context } = humanWornOn(pose, view, look);
  return {
    part: (ctx, part, frame) => paintOutfitPart(ctx, outfit, part, frame, context),
    paints: (part) => outfit.garments.some((garment) => garment.paint[part] !== undefined),
    sleeves: sleevesOf(outfit),
    glove: (side) => gloveOf(outfit, side),
  };
}
