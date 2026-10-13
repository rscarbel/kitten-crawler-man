/**
 * Dresses Carl's compositor in an outfit: the `CarlDressing` his figure
 * calls at every piece, painting each garment of the outfit that covers that
 * part, read off the outfit his pose carries.
 */

import type { CarlDressing, CarlPoseOutfit } from '../../art/carl/carlParts';
import { STILL_ROW } from '../../art/carl/carlParts';
import type { CarlPose, ViewSpec } from '../../art/carl/rig';
import type { CardinalView } from '../../facingView';
import type { GarmentFrameContext } from '../garmentDef';
import { garmentOf } from '../garments';
import { outfitOf, paintOutfitPart, type Outfit } from '../outfit';

/** His jacket and boxers and nothing else: how he is painted with nothing on. */
export const BARE_CARL_OUTFIT: Outfit<'human'> = outfitOf('human', []);

/**
 * The look every row was authored and reviewed in: the trollskin shirt over
 * his base garments. A pose that carries no outfit is painted in it.
 */
export const DEFAULT_CARL_OUTFIT: Outfit<'human'> = outfitOf('human', [
  garmentOf('human', 'carl_trollskin_shirt'),
]);

function cardinalOf(view: ViewSpec): CardinalView {
  if (view.profile) return 'side';
  return view.showsBack ? 'back' : 'front';
}

/** A still of him in `outfit`, drawn from no row. */
export function stillOutfit(outfit: Outfit<'human'>): CarlPoseOutfit {
  return { outfit, row: STILL_ROW, frame: 0, frameCount: 1 };
}

const DEFAULT_ON_POSE = stillOutfit(DEFAULT_CARL_OUTFIT);

/** What `pose` is wearing, and what its garments are told of the cell, as drawn in `view`. */
export function carlWornOn(
  pose: CarlPose,
  view: ViewSpec,
): { readonly outfit: Outfit<'human'>; readonly context: GarmentFrameContext<'human'> } {
  const worn = pose.outfit ?? DEFAULT_ON_POSE;
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

/** The dressing that paints what `pose` carries, as drawn in `view`. */
export function carlDressingFor(pose: CarlPose, view: ViewSpec): CarlDressing {
  const { outfit, context } = carlWornOn(pose, view);
  return {
    part: (ctx, part, frame) => paintOutfitPart(ctx, outfit, part, frame, context),
    paints: (part) => outfit.garments.some((garment) => garment.paint[part] !== undefined),
    hides: (feature) => outfit.hidden.has(feature),
    reach: (skeleton, drawnView) =>
      outfit.garments.flatMap((garment) => garment.reach?.(skeleton, drawnView, context) ?? []),
  };
}
