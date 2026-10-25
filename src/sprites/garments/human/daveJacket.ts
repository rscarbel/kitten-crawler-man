/**
 * Dave's leather jacket: the base garment over his torso. It paints the
 * jacket's body, then its stand collar and the collar's lit lip, as the
 * compositor reaches each — so a shirt worn under it shows in the band
 * between them.
 */

import type { BipedTorsoFrame } from '../../art/biped/bipedParts';
import { paintCollar, paintCollarRim, paintJacket } from '../../art/biped/torso';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { humanEveryView } from './views';

function paintTorso(
  ctx: CanvasRenderingContext2D,
  frame: BipedTorsoFrame,
  context: GarmentFrameContext<'human'>,
): void {
  if (frame.piece === 'jacket') {
    paintJacket(ctx, frame.skeleton, context.pose, frame.view, frame.look);
  } else if (frame.piece === 'collar') paintCollar(ctx, frame.torso, frame.view);
  else paintCollarRim(ctx, frame.torso, frame.view);
}

export const DAVE_JACKET = defineGarment({
  id: 'dave_jacket',
  name: 'Leather jacket',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['torso'],
  paint: { torso: humanEveryView(paintTorso) },
});
