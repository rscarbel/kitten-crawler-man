/**
 * The cat's three pairs of booties, four to a pair, each told apart at the
 * tile by its value and its sole: the Mousehide pair a soft mouse grey on a
 * soft dark sole, the Prowler pair charcoal felt under a silver-stitched cuff on a
 * thin dark sole, the Hearthguard boots garrison-brown leather on a thick
 * black hobnailed sole, rising highest up her leg.
 */

import { defineGarment } from '../garmentDef';
import { bootiePainters, type BootieLook } from './catFootwear';

/**
 * A mid mouse grey rather than a pale one: a pale paw reads as white socks, a
 * cat's own marking, however it is edged. The read is the one the boots make —
 * a pale rolled cuff standing out past the leg, the grey hide, a dark sole —
 * only softer and lower on the leg.
 */
const MOUSEHIDE: BootieLook = {
  fabric: { shadow: '#4e4a48', base: '#7d7772', light: '#9e9893', edge: '#d8d2ca' },
  shaftShare: 0.4,
  cuffWidth: 0.03,
  cuffFlare: 0.022,
  sole: { colour: '#2e2b2a', from: 0.72, studs: null },
};

/**
 * Charcoal lifted a step above her black coat so the felt is a shape, not a
 * hole, under a cuff whipped round in silver thread: the bright ring is what
 * says it is worn.
 */
const PROWLER: BootieLook = {
  fabric: { shadow: '#323034', base: '#4f4c52', light: '#726e76', edge: '#d8dde6' },
  shaftShare: 0.35,
  cuffWidth: 0.024,
  cuffFlare: 0.02,
  sole: { colour: '#16161a', from: 0.75, studs: null },
};

/**
 * A mid brown, well above a near-black: on a cat with black paws a dark boot
 * is no boot at all at the tile, and on a ginger one any brown sinks into her
 * fur. So the read is three bands on either cat: the pale rolled cuff high up
 * her leg, the brown shaft, and the near-black sole.
 */
const HEARTHGUARD: BootieLook = {
  fabric: { shadow: '#4a3424', base: '#80593c', light: '#a87e5a', edge: '#d2ab82' },
  shaftShare: 0.55,
  cuffWidth: 0.032,
  cuffFlare: 0.024,
  sole: {
    colour: '#120d0b',
    from: 0.6,
    studs: { colour: '#c8c7cc', count: 3, radius: 0.008 },
  },
};

const MOUSEHIDE_PAINTERS = bootiePainters(MOUSEHIDE);
const PROWLER_PAINTERS = bootiePainters(PROWLER);
const HEARTHGUARD_PAINTERS = bootiePainters(HEARTHGUARD);

export const CAT_MOUSEHIDE_BOOTIES = defineGarment({
  id: 'cat_mousehide_booties',
  name: 'Mousehide Booties',
  wearer: 'cat',
  material: 'leather',
  layer: 'outer',
  region: ['foreleg', 'hindleg'],
  paint: { foreleg: MOUSEHIDE_PAINTERS, hindleg: MOUSEHIDE_PAINTERS },
});

export const CAT_PROWLER_BOOTIES = defineGarment({
  id: 'cat_prowler_booties',
  name: 'Prowler Booties',
  wearer: 'cat',
  material: 'cloth',
  layer: 'outer',
  region: ['foreleg', 'hindleg'],
  paint: { foreleg: PROWLER_PAINTERS, hindleg: PROWLER_PAINTERS },
});

export const CAT_HEARTHGUARD_BOOTS = defineGarment({
  id: 'cat_hearthguard_boots',
  name: 'Hearthguard Boots',
  wearer: 'cat',
  material: 'leather',
  layer: 'outer',
  region: ['foreleg', 'hindleg'],
  paint: { foreleg: HEARTHGUARD_PAINTERS, hindleg: HEARTHGUARD_PAINTERS },
});
