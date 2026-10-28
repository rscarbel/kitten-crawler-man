/**
 * Dave's boots: sturdy dark-brown leather lace-ups, ankle height, worn under
 * his jeans so the hem breaks over the shaft. At the tile a boot is a few
 * pixels below the denim, so what carries it is a dark foot heavier than a
 * bare one, a thick sole under it, and a lace line up the instep.
 */

import { deriveRamp, type GlossRamp } from '../../art/biped/palette';
import { defineGarment } from '../garmentDef';
import { bootPainter } from './crawlerBoots';
import type { BootLook, SoleBuild } from './footwear';
import { humanEveryView } from './views';

/**
 * Dark oiled leather, cooler and deeper than his jacket's saddle brown so the
 * two leathers do not read as one suit. Its ramp is spread wider than a
 * derived one, so the toe box keeps a lit cap at the tile instead of a black
 * blot.
 */
const WORK_LEATHER: GlossRamp = {
  deep: '#0d0806',
  shadow: '#170f0a',
  dark: '#21160f',
  mid: '#33231a',
  base: '#45301f',
  light: '#6a4a33',
  rim: '#8f6b4f',
  specular: '#a3826a',
};
/** A dark rubber lug sole. */
const LUG_SOLE = deriveRamp('#1b1613');
/** Waxed tan laces: light enough against the dark leather to show as a line up the instep. */
const WAXED_LACE = '#a07a4e';
/** The shaft stops a little above the ankle bone, under the jeans' break. */
const ANKLE_SHAFT_AT = 0.62;
/** A work boot's heavy sole and heel block. */
const WORK_SOLE: SoleBuild = { sole: 1.25, heel: 1 };

const WORK_BOOTS: BootLook = {
  leather: WORK_LEATHER,
  sole: LUG_SOLE,
  shaftTopAt: ANKLE_SHAFT_AT,
  soleBuild: WORK_SOLE,
  laces: WAXED_LACE,
};

export const DAVE_BOOTS = defineGarment({
  id: 'dave_boots',
  name: 'Work boots',
  wearer: 'human',
  base: true,
  layer: 'under',
  covers: ['feet'],
  region: ['leg'],
  paint: { leg: humanEveryView(bootPainter(WORK_BOOTS)) },
});
