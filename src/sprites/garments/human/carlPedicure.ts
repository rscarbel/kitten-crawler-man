/**
 * A pedicure on Carl: small near-white glints of polish on the toenails that
 * face the camera and a sparkle on the top of each foot — polish rather than
 * wet skin. No item grants it yet; it is reachable only from the preview routes.
 */

import type { CarlToesFrame } from '../../art/carl/carlParts';
import { TWO_PI } from '../../art/carl/geometry';
import { type Pt, rgba } from '../../art/carlArt';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

const GLITTER = '#fff3f8';
const GLITTER_ALPHA = 0.9;
const NAIL_GLINT_RADIUS = 0.016;
const SPARKLE_ARM = 0.03;
const SPARKLE_WIDTH = 0.01;

/** A four-pointed sparkle: two crossed strokes, the glint a glittery surface throws. */
function paintSparkle(ctx: CanvasRenderingContext2D, at: Pt): void {
  ctx.strokeStyle = rgba(GLITTER, GLITTER_ALPHA);
  ctx.lineWidth = SPARKLE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(at.x - SPARKLE_ARM, at.y);
  ctx.lineTo(at.x + SPARKLE_ARM, at.y);
  ctx.moveTo(at.x, at.y - SPARKLE_ARM);
  ctx.lineTo(at.x, at.y + SPARKLE_ARM);
  ctx.stroke();
}

function paintToes(ctx: CanvasRenderingContext2D, frame: CarlToesFrame): void {
  ctx.fillStyle = rgba(GLITTER, GLITTER_ALPHA);
  for (const nail of frame.nails) {
    ctx.beginPath();
    ctx.arc(nail.x, nail.y, NAIL_GLINT_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  paintSparkle(ctx, frame.instep);
}

export const CARL_PEDICURE = defineGarment({
  id: 'carl_pedicure',
  name: 'Pedicure',
  wearer: 'human',
  material: 'jewelry',
  layer: 'under',
  region: ['foot'],
  paint: { foot: carlEveryView(paintToes) },
});
