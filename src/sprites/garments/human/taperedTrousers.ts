/**
 * High-waisted tapered trousers in warm stone twill: full through the seat
 * and thigh and narrowing to a clean ankle, where they end just above a pair
 * of ankle boots.
 */

import type { GlossRamp } from '../../art/biped/palette';
import type { SeatFit } from '../../art/human/legwear';
import { defineGarment } from '../garmentDef';
import { trouserPainters } from './chinos';
import type { LegCloth } from './townsfolkLegwear';
import { humanEveryView } from './views';

/**
 * Warm stone: a mid value between the wine jacket above and the dark boots
 * below, so the figure reads as three bands at the tile. Like the chinos'
 * slate, its lit side climbs well clear of the shadow, or a slim leg two
 * pixels across reads as one flat strip.
 */
const STONE_TWILL: GlossRamp = {
  deep: '#1e1814',
  shadow: '#2c241e',
  dark: '#3d332b',
  mid: '#4d4137',
  base: '#857362',
  light: '#b6a38f',
  rim: '#c7b6a2',
  specular: '#a8957f',
};

export const STONE_TROUSER_CLOTH: LegCloth = { cloth: STONE_TWILL, cut: 'slimTrousers' };

/**
 * Cut close to the hips like the chinos, and let out by the wearer's own seat:
 * a full seat at its full size stands off her hips like a skirt. Edge-on the
 * high waist rises to her belt, so it is cut shallower than the chinos' seat,
 * or its top stands out behind the cropped jacket as a box.
 */
const TAPERED_SEAT: SeatFit = {
  across: 0.46,
  depth: 0.48,
  drop: 0.6,
  style: { kind: 'legs', cut: STONE_TROUSER_CLOTH.cut },
};

const PAINTERS = trouserPainters(STONE_TROUSER_CLOTH, TAPERED_SEAT);

export const TAPERED_TROUSERS = defineGarment({
  id: 'tapered_trousers',
  name: 'Tapered trousers',
  wearer: 'human',
  base: true,
  layer: 'over',
  region: ['hips', 'leg'],
  paint: {
    hips: humanEveryView(PAINTERS.hips),
    leg: humanEveryView(PAINTERS.leg),
  },
});
