/**
 * Dave's look: light skin, a short brown crop, blue eyes, the worn brown
 * moto jacket over plain blue jeans, and dark-brown leather work boots under
 * the jeans' hem.
 */

import {
  DAVE_CROP,
  FACING_BROW_DEFAULT,
  FLAT_MOUTH,
  RIG_BROW_TONE,
  RIG_EYES,
  PROFILE_BROW_DEFAULT,
  RIG_FACE,
} from '../../art/biped/head';
import type { GlossRamp, Ramp } from '../../art/biped/palette';
import { DAVE_SHOVED_UP_SLEEVE } from '../../art/biped/sleeve';
import { RIG_GARMENT_CUT, type GarmentCut } from '../../art/biped/torso';
import { DAVE_BOOTS } from '../../garments/human/daveBoots';
import { DAVE_JACKET } from '../../garments/human/daveJacket';
import { DAVE_TROUSERS } from '../../garments/human/daveTrousers';
import {
  type HumanLook,
  RIG_HEAD_BREADTH,
  RIG_HIP_SPREAD,
  RIG_NECK_GIRTH,
  RIG_NECK_SOFTNESS,
  TROUSERS_OWN_SEAT,
} from '../humanLook';
import { type LimbBuild, RIG_LIMBS } from '../../art/biped/limbs';

/** Light skin, warm in the light, rose-cool in the shadow. */
const DAVE_SKIN: Ramp = {
  deep: '#5c2d35',
  shadow: '#8b4a42',
  dark: '#b0654e',
  mid: '#bb7354',
  base: '#d89c76',
  light: '#f0cba3',
  rim: '#fae9c6',
};

/** Short brown hair. */
const DAVE_HAIR: Ramp = {
  deep: '#2a1316',
  shadow: '#421e1a',
  dark: '#5c2e1f',
  mid: '#784326',
  base: '#975b2b',
  light: '#b97d38',
  rim: '#d8ae5a',
};

const DAVE_IRIS = '#4a7cc0';

/**
 * Worn brown moto leather: glossy, so it carries a specular step. A saddle
 * brown leaning red, with lights that warm toward orange rather than yellow:
 * lit toward yellow the same values read as olive-gold, and gloss on gold is
 * brass armour, not a jacket.
 */
const DAVE_LEATHER: GlossRamp = {
  deep: '#1c1016',
  shadow: '#2c1619',
  dark: '#3d1d1b',
  mid: '#51281f',
  base: '#653423',
  light: '#86492c',
  rim: '#a8694a',
  specular: '#c09a86',
};

/**
 * His head a little smaller than the rig's game-sized one: crown to chin a
 * fifth of his height rather than nearly a quarter, which would make him a
 * four-and-a-half-head figure. Still larger than life, so his face reads at
 * the tile.
 */
const DAVE_HEAD_SCALE = 0.88;
/** Two fifths of the way from his eyes to his chin: a heavy man's neck, a little longer than the rig's under his smaller head. */
const DAVE_HEAD_PIVOT = 0.4;
/**
 * The rig is drawn at his 6'3"; with his head drawn smaller his crown drops
 * to 0.966 of the rig's crown height (measured off the standing cells), so his body
 * is drawn that much longer to stand him back up at his own height.
 */
const SMALLER_HEAD_CROWN_SHARE = 0.966;
const DAVE_HEIGHT_SCALE = 1 / SMALLER_HEAD_CROWN_SHARE;
/**
 * Broad, but a heavily muscled man's breadth rather than the rig's: at the
 * rig's full width he reads as thick all over, a block rather than a strong
 * man.
 */
const DAVE_WIDTH_SCALE = 0.94;
/**
 * Edge-on a heavily muscled man's chest is about a seventh of his height
 * deep; the rig's barrel is nearly a third.
 */
const DAVE_TORSO_DEPTH = 0.62;
/** A heavily muscled man's limbs, leaner than the rig's lifter's, his calves most of all. */
const DAVE_LIMBS: LimbBuild = {
  thighGirth: 0.9,
  shinGirth: 0.75,
  legDepth: 0.8,
  upperArmGirth: 0.95,
  upperArmDepth: RIG_LIMBS.upperArmDepth,
  forearmGirth: RIG_LIMBS.forearmGirth,
  footWidth: RIG_LIMBS.footWidth,
  footLength: RIG_LIMBS.footLength,
  handLength: RIG_LIMBS.handLength,
  handBreadth: RIG_LIMBS.handBreadth,
  forearmTerminator: RIG_LIMBS.forearmTerminator,
};
/**
 * Head-on his chest a little narrower than the rig's, so his arms hang clear
 * of it with a real gap rather than a sliver the outline closes.
 */
const DAVE_CHEST_ACROSS = 0.8;
/** The jacket's hem cut in to his waist rather than flaring past it, for the same gap. */
const DAVE_HEM_FLARE = 0.96;
/**
 * His shoulders a little narrower head-on than the rig's heavy V: across the
 * deltoids the rig stands over two fifths of his height, a block. Set here his
 * arms hang beside a chest cut narrower still, with a gap at the waist wider
 * than the silhouette outline closes. Any narrower, the two-handed pick's
 * grip, authored on the rig's shoulders, turns the palm off its handle.
 */
const DAVE_SHOULDER_SPREAD = 1.34;
/** The welted yoke across his back is a seam, not a strap across his shoulders. */
const DAVE_YOKE_WEIGHT = 0.55;
const DAVE_JACKET_FIT: GarmentCut = {
  ...RIG_GARMENT_CUT,
  profileDepth: DAVE_TORSO_DEPTH,
  chestAcross: DAVE_CHEST_ACROSS,
  hemFlare: DAVE_HEM_FLARE,
  seamWeight: DAVE_YOKE_WEIGHT,
};

/** His crop tops out 32.5 px above the anchor; head-on he is 0.453125 of a tile either side. */
const DAVE_FIGURE_EXTENT = { spriteTopAboveTilePx: 33, halfWidthTiles: 0.453125 };

/** Dave's scowl at its own strength and his mouth at its own width. */
const DAVE_ANGER_SCALE = 1;
const DAVE_LIP_FULLNESS = 1;

export const DAVE_LOOK: HumanLook = {
  id: 'dave',
  wearer: 'human',
  skin: DAVE_SKIN,
  handSkin: null,
  hair: DAVE_HAIR,
  iris: DAVE_IRIS,
  garment: DAVE_LEATHER,
  garmentCut: DAVE_JACKET_FIT,
  sleeveCut: DAVE_SHOVED_UP_SLEEVE,
  hairstyle: DAVE_CROP,
  facialHair: null,
  expression: {
    angerScale: DAVE_ANGER_SCALE,
    profileBrow: PROFILE_BROW_DEFAULT,
    facingBrow: FACING_BROW_DEFAULT,
    lipFullness: DAVE_LIP_FULLNESS,
    mouthSmile: FLAT_MOUTH,
    eyes: RIG_EYES,
    browTone: RIG_BROW_TONE,
  },
  heightScale: DAVE_HEIGHT_SCALE,
  widthScale: DAVE_WIDTH_SCALE,
  limbs: DAVE_LIMBS,
  headScale: DAVE_HEAD_SCALE,
  headBreadth: RIG_HEAD_BREADTH,
  headPivot: DAVE_HEAD_PIVOT,
  neckGirth: RIG_NECK_GIRTH,
  neckSoftness: RIG_NECK_SOFTNESS,
  shoulderSpread: DAVE_SHOULDER_SPREAD,
  hipSpread: RIG_HIP_SPREAD,
  seatFullness: TROUSERS_OWN_SEAT,
  face: RIG_FACE,
  figureExtent: DAVE_FIGURE_EXTENT,
  baseGarments: [DAVE_JACKET, DAVE_TROUSERS, DAVE_BOOTS],
};
