/**
 * Dave's jeans: the base garment below his jacket's hem. The legs are the
 * townsfolk trousers' leg painter, cut from a fixed denim; the seat over his
 * hips is the trouser seat the cast's trousers are painted with.
 */

import type { BipedHipsFrame, BipedLegFrame } from '../../art/biped/bipedParts';
import type { GlossRamp } from '../../art/biped/palette';
import { paintTrouserSeat, RIG_SEAT, type SeatFit } from '../../art/human/legwear';
import { defineGarment } from '../garmentDef';
import { type LegCloth, paintLegCloth } from './townsfolkLegwear';
import { humanEveryView } from './views';

/**
 * Plain mid-blue denim, indigo in the shade and washed pale on the lit edge.
 * Its steps are spread wider than a ramp derived from the base colour: a leg
 * of a derived blue reads as a flat strip at the tile.
 */
const DENIM: GlossRamp = {
  deep: '#141a2e',
  shadow: '#1f2b48',
  dark: '#273759',
  mid: '#324876',
  base: '#4a6a9e',
  light: '#7fa2d2',
  rim: '#a3bde0',
  specular: '#b6c8e2',
};

export const DAVE_DENIM: LegCloth = { cloth: DENIM, cut: 'trousers' };

/**
 * His jeans sit closer to his hips than the rig's seat: the rig's seat at its
 * full size stands out round his narrower build like shorts head-on and
 * behind him like a nappy edge-on.
 */
const JEANS_SEAT: SeatFit = {
  across: 0.75,
  depth: 0.65,
  drop: RIG_SEAT.drop,
  style: { kind: 'legs', cut: DAVE_DENIM.cut },
};

function paintSeat(ctx: CanvasRenderingContext2D, frame: BipedHipsFrame): void {
  paintTrouserSeat(ctx, frame.skeleton, frame.view, DAVE_DENIM.cloth, JEANS_SEAT, frame.look.limbs);
}

function paintLegs(ctx: CanvasRenderingContext2D, frame: BipedLegFrame): void {
  paintLegCloth(ctx, frame, DAVE_DENIM);
}

export const DAVE_TROUSERS = defineGarment({
  id: 'dave_trousers',
  name: 'Jeans',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['hips', 'leg'],
  paint: {
    hips: humanEveryView(paintSeat),
    leg: humanEveryView(paintLegs),
  },
});
