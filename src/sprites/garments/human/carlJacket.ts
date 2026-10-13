/**
 * Carl's leather jacket: the base garment over his torso. It paints the
 * jacket's body, then its stand collar and the collar's lit lip, as the
 * compositor reaches each — so a shirt worn under it shows in the band
 * between them.
 */

import type { CarlTorsoFrame } from '../../art/carl/carlParts';
import { paintCollar, paintCollarRim, paintJacket } from '../../art/carl/torso';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { carlEveryView } from './views';

function paintTorso(
  ctx: CanvasRenderingContext2D,
  frame: CarlTorsoFrame,
  context: GarmentFrameContext<'human'>,
): void {
  if (frame.piece === 'jacket') paintJacket(ctx, frame.skeleton, context.pose, frame.view);
  else if (frame.piece === 'collar') paintCollar(ctx, frame.torso, frame.view);
  else paintCollarRim(ctx, frame.torso, frame.view);
}

export const CARL_JACKET = defineGarment({
  id: 'carl_jacket',
  name: 'Leather jacket',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['torso'],
  paint: { torso: carlEveryView(paintTorso) },
});
