/**
 * The Enchanted Toe Ring of the Splatter Skunk on the human crawler: a thin gold band on
 * the second toe of his right foot. At the tile it is one warm pixel on the
 * toes, which is all a toe ring should ever be.
 */

import type { BipedToesFrame } from '../../art/biped/bipedParts';
import { TWO_PI } from '../../art/biped/geometry';
import { drawnSide } from '../../art/biped/rig';
import { defineGarment } from '../garmentDef';
import { humanEveryView } from './views';

const RING_GOLD = '#d4a23a';
const RING_GLINT = '#fff0b8';
const RING_BAND_HALF = 0.022;
const RING_BAND_WIDTH = 0.018;
const RING_GLINT_RADIUS = 0.008;
/** The glint sits halfway out along the band, on its lit end. */
const GLINT_ALONG = 0.5;

function paintToes(ctx: CanvasRenderingContext2D, frame: BipedToesFrame): void {
  if (drawnSide('right', frame.view) !== frame.drawn) return;
  const centre = frame.secondToe;
  const across = frame.ringAcross;
  ctx.lineCap = 'round';
  ctx.strokeStyle = RING_GOLD;
  ctx.lineWidth = RING_BAND_WIDTH;
  ctx.beginPath();
  ctx.moveTo(centre.x - across.x * RING_BAND_HALF, centre.y - across.y * RING_BAND_HALF);
  ctx.lineTo(centre.x + across.x * RING_BAND_HALF, centre.y + across.y * RING_BAND_HALF);
  ctx.stroke();
  ctx.fillStyle = RING_GLINT;
  ctx.beginPath();
  ctx.arc(
    centre.x - across.x * RING_BAND_HALF * GLINT_ALONG,
    centre.y - across.y * RING_BAND_HALF * GLINT_ALONG,
    RING_GLINT_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();
}

export const HUMAN_TOE_RING = defineGarment({
  id: 'human_toe_ring',
  name: 'Enchanted Toe Ring of the Splatter Skunk',
  wearer: 'human',
  material: 'jewelry',
  layer: 'over',
  region: ['foot'],
  needsBare: 'feet',
  paint: { foot: humanEveryView(paintToes) },
});
