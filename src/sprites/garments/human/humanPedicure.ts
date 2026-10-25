/**
 * A pedicure on the human figure: small near-white glints of polish on the toenails that
 * face the camera and a sparkle on the top of each foot — polish rather than
 * wet skin. No item grants it yet; it is reachable only from the preview routes.
 */

import type { BipedToesFrame } from '../../art/biped/bipedParts';
import { TWO_PI } from '../../art/biped/geometry';
import { type Pt, rgba } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import { humanEveryView } from './views';

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

function paintToes(ctx: CanvasRenderingContext2D, frame: BipedToesFrame): void {
  ctx.fillStyle = rgba(GLITTER, GLITTER_ALPHA);
  for (const nail of frame.nails) {
    ctx.beginPath();
    ctx.arc(nail.x, nail.y, NAIL_GLINT_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  paintSparkle(ctx, frame.instep);
}

export const HUMAN_PEDICURE = defineGarment({
  id: 'human_pedicure',
  name: 'Pedicure',
  wearer: 'human',
  material: 'jewelry',
  layer: 'under',
  region: ['foot'],
  needsBare: 'feet',
  paint: { foot: humanEveryView(paintToes) },
});
