/**
 * The Enchanted Trollskin Shirt of Pummeling on Carl: a dark navy, just
 * visible above his jacket's zipped collar. At the tile it is a one-pixel dark
 * band that parts his face from the jacket. Taken off, the collar closes on
 * bare neck.
 */

import type { CarlNeckFrame } from '../../art/carl/carlParts';
import { COLLAR_RIM_WIDTH, collarShape, traceCollar } from '../../art/carl/torso';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

const TROLLSKIN = '#1d2236';
const TROLLSKIN_LIT = '#2a3150';
/** How far the shirt shows above the collar's top edge. */
const TROLLSKIN_BAND = 0.026;

/** Under the collar, the band; over it, the band's top edge lifted a step so it reads as cloth, not a gap. */
function paintNeck(ctx: CanvasRenderingContext2D, frame: CarlNeckFrame): void {
  const shirt = collarShape(frame.torso, frame.view, TROLLSKIN_BAND);
  if (frame.piece === 'shirtUnder') {
    traceCollar(ctx, shirt);
    ctx.fillStyle = TROLLSKIN;
    ctx.fill();
    return;
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = COLLAR_RIM_WIDTH;
  ctx.strokeStyle = TROLLSKIN_LIT;
  ctx.beginPath();
  ctx.moveTo(shirt.topLeft.x, shirt.topLeft.y);
  ctx.quadraticCurveTo(shirt.topMid.x, shirt.topMid.y, shirt.topRight.x, shirt.topRight.y);
  ctx.stroke();
}

export const CARL_TROLLSKIN_SHIRT = defineGarment({
  id: 'carl_trollskin_shirt',
  name: 'Enchanted Trollskin Shirt of Pummeling',
  wearer: 'human',
  material: 'leather',
  layer: 'under',
  region: ['neck'],
  paint: { neck: carlEveryView(paintNeck) },
});
