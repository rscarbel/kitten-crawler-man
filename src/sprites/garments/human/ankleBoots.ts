/**
 * Dark chocolate leather ankle boots on a slim, flat sole: a walking boot cut
 * neat, with no heel to speak of. Worn under the trousers, whose hem breaks
 * over the top of the shaft.
 */

import { deriveRamp, type GlossRamp } from '../../art/biped/palette';
import { defineGarment } from '../garmentDef';
import { bootPainter } from './crawlerBoots';
import type { BootLook, SoleBuild } from './footwear';
import { humanEveryView } from './views';

/**
 * Chocolate brown, its ramp spread wider than a derived one so the toe keeps
 * a lit cap at the tile rather than reading as a black blot, and warmer than
 * the stone trousers above so the two do not merge.
 */
const CHOCOLATE_LEATHER: GlossRamp = {
  deep: '#110a07',
  shadow: '#1d120c',
  dark: '#2b1a11',
  mid: '#3d2518',
  base: '#553423',
  light: '#80553b',
  rim: '#a77a5b',
  specular: '#b58c6c',
};
const DARK_RUBBER_SOLE = deriveRamp('#1a1514');
/** The shaft stops just above the ankle bone, under the trousers' break. */
const ANKLE_SHAFT_AT = 0.66;
/** A slim sole with only a low block of heel: thinner than a work boot's, heavier than a sneaker's. */
const SLIM_SOLE: SoleBuild = { sole: 0.75, heel: 0.6 };

const ANKLE_BOOT_LOOK: BootLook = {
  leather: CHOCOLATE_LEATHER,
  sole: DARK_RUBBER_SOLE,
  shaftTopAt: ANKLE_SHAFT_AT,
  soleBuild: SLIM_SOLE,
};

export const ANKLE_BOOTS = defineGarment({
  id: 'ankle_boots',
  name: 'Ankle boots',
  wearer: 'human',
  base: true,
  layer: 'under',
  covers: ['feet'],
  region: ['leg'],
  paint: { leg: humanEveryView(bootPainter(ANKLE_BOOT_LOOK)) },
});
