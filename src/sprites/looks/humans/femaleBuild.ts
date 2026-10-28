/**
 * The female human crawler's build, shared by every female crawler look: five
 * foot six, narrower in the shoulders than the male crawler, with a defined
 * waist, wider hips and a bust, smaller hands and feet and a slimmer neck. She
 * wears her own clothes: a wine twill jacket belted at the waist over an
 * ivory top, a teal silk scarf at the throat, stone tapered trousers,
 * chocolate ankle boots and a slim gold watch. Every worn garment fits her
 * through the same cut and build fields it reads on any look. Also the face
 * those looks wear.
 */

import {
  type BipedExpression,
  type BrowShape,
  type FaceShape,
  FEMININE_PROFILE_BROW,
} from '../../art/biped/head';
import { pt } from '../../art/biped/geometry';
import type { LimbBuild } from '../../art/biped/limbs';
import type { GarmentCut } from '../../art/biped/torso';
import {
  type HumanBuild,
  METRES_PER_INCH,
  RIG_STATURE_METRES,
  type SeatFullness,
} from '../humanLook';
import { ANKLE_BOOTS } from '../../garments/human/ankleBoots';
import {
  BELTED_TWILL_JACKET,
  TAILORED_SLEEVE,
  WINE_TWILL,
} from '../../garments/human/beltedJacket';
import { SILK_NECK_SCARF } from '../../garments/human/neckScarf';
import { TAPERED_TROUSERS } from '../../garments/human/taperedTrousers';
import { GOLD_WATCH } from '../../garments/human/wristwatches';
import { MALE_CRAWLER_BUILD, MALE_CRAWLER_EXPRESSION, OPEN_EYES } from './maleBuild';

/** She stands 5'6", against the rig's 6'3". */
const FEMALE_STATURE_INCHES = 66;
const FEMALE_STATURE_OVER_RIG = (FEMALE_STATURE_INCHES * METRES_PER_INCH) / RIG_STATURE_METRES;
/**
 * The rig's crown sits on its game-sized head; with her head drawn at a real
 * woman's size the crown drops to this share of the rig's crown height, so her
 * body is drawn that much longer to stand her back up at her own height.
 */
const SMALLER_HEAD_CROWN_SHARE = 0.925;
const FEMALE_HEIGHT_SCALE = FEMALE_STATURE_OVER_RIG / SMALLER_HEAD_CROWN_SHARE;
/** Across the picture she is drawn at her stature; her own build below makes her slight. */
const FEMALE_WIDTH_SCALE = FEMALE_STATURE_OVER_RIG;

/**
 * Edge-on her ribcage is a little shallower than the male crawler's; head-on
 * her chest is narrower and her waist draws in well inside it.
 */
const FEMALE_TORSO_DEPTH = 0.46;
const FEMALE_CHEST_ACROSS = 0.72;
const FEMALE_WAIST_ACROSS = 0.74;
/** Her bust stands forward of her chest edge-on, in torso units. */
const FEMALE_BUST_DEPTH = 0.05;
/** Her shoulders slope further from the neck than his. */
const FEMALE_SHOULDER_DROP = 0.045;
/**
 * The jacket is cropped: its hem stops just below the belt, where her
 * high-waisted trousers take over, so in every view the narrowest line of
 * her torso is where the jacket ends and the trousers widen out over her hips.
 */
const JACKET_HEM_DROP = 0.06;
const JACKET_HEM_FLARE = 1.04;
/** Twill is lighter than leather and heavier than shirting: its seams and folds sit between them. */
const TWILL_SEAM_WEIGHT = 0.25;
const TWILL_FOLD_WEIGHT = 0.5;

const FEMALE_JACKET_CUT: GarmentCut = {
  ...MALE_CRAWLER_BUILD.garmentCut,
  hemDrop: JACKET_HEM_DROP,
  hemFlare: JACKET_HEM_FLARE,
  seamWeight: TWILL_SEAM_WEIGHT,
  foldWeight: TWILL_FOLD_WEIGHT,
  profileDepth: FEMALE_TORSO_DEPTH,
  chestAcross: FEMALE_CHEST_ACROSS,
  shoulderDrop: FEMALE_SHOULDER_DROP,
  waistAcross: FEMALE_WAIST_ACROSS,
  bustDepth: FEMALE_BUST_DEPTH,
};

/** Edge-on her sleeve hangs over a little less of her chest's depth than his does of his. */
const FEMALE_UPPER_ARM_DEPTH = 0.62;
/** Her forearm is three pixels at the tile too, so its light turns toward the lit side as his does. */
const FEMALE_FOREARM_TERMINATOR = 0.4;
/**
 * Her hands are a woman's: shorter and narrower than the male crawler's, still
 * long and slim enough that an open hand at her side reads as a hand rather
 * than a balled fist.
 */
const FEMALE_HAND_LENGTH = 1.08;
const FEMALE_HAND_BREADTH = 0.5;

/**
 * A woman's limbs on the rig's bones: her thighs fuller against her height
 * than his, her calves, arms and forearms slimmer, her hands and feet smaller.
 */
const FEMALE_LIMBS: LimbBuild = {
  thighGirth: 0.66,
  shinGirth: 0.5,
  legDepth: 0.68,
  upperArmGirth: 0.46,
  upperArmDepth: FEMALE_UPPER_ARM_DEPTH,
  forearmGirth: 0.6,
  footWidth: 0.5,
  footLength: 0.72,
  handLength: FEMALE_HAND_LENGTH,
  handBreadth: FEMALE_HAND_BREADTH,
  forearmTerminator: FEMALE_FOREARM_TERMINATOR,
};

/** A woman's head is very nearly a man's size, so on her shorter body it stands a little larger. */
const FEMALE_HEAD_SCALE = 0.68;
/** A narrower face and finer jaw than the male crawler's. */
const FEMALE_HEAD_BREADTH = 1;
const FEMALE_HEAD_PIVOT = 0.65;
/** A slim neck: well under the male crawler's, rounding softly into the jaw. */
const FEMALE_NECK_GIRTH = 0.52;
const FEMALE_NECK_SOFTNESS = 3;

/** Head-on her shoulders stand only a little past her chest. */
const FEMALE_SHOULDER_SPREAD = 0.72;
/** Her thighs root wider apart than his, under hips as wide as her shoulders. */
const FEMALE_HIP_SPREAD = 0.92;
/** Her seat is wider across the hips and rounder behind them than the chinos' slim cut. */
const FEMALE_SEAT: SeatFullness = { across: 1.5, depth: 1.1 };

/** Her hair tops out 25 px above the anchor; head-on, shoulders and arms, she is 0.296875 of a tile either side. */
const FEMALE_FIGURE_EXTENT = { spriteTopAboveTilePx: 25, halfWidthTiles: 0.296875 };

/**
 * A woman's face on the rig's skull. Head-on the cheeks stay full high under
 * the cheekbones and the jaw curves in from there to a small, softly pointed
 * chin, with no corner at the jaw: the rig's squared jaw and broad chin are
 * what read as a man's face at the tile, under any hair. Edge-on the forehead
 * rounds down to the nose with no brow ridge standing over the eye, the nose
 * is small, the lips stand forward and the jaw rises toward the ear. The
 * hollows under the cheekbones and the brow are shaded faintly, the eyes are
 * a little larger, with lashes flicking past the outer corner, and the lips
 * carry a rose tint.
 */
const FEMALE_FACE: FaceShape = {
  cheekControl: pt(0.98, 0.24),
  jawCorner: pt(0.78, 0.72),
  jawCornerControl: pt(0.62, 0.98),
  jawCornerEnd: pt(0.4, 1.1),
  chinCorner: pt(0.2, 1.18),
  chinControlX: 0.08,
  sidePlaneEdge: [
    pt(0.66, -1.0),
    pt(0.58, -0.5),
    pt(0.72, 0.02),
    pt(0.66, 0.4),
    pt(0.58, 0.76),
    pt(0.2, 1.14),
  ],
  profileLine: [
    pt(0.95, -0.72),
    pt(0.94, -0.3),
    pt(0.9, -0.13),
    pt(1.08, 0.18),
    pt(0.93, 0.28),
    pt(1.01, 0.43),
    pt(0.95, 0.52),
    pt(1.0, 0.63),
    pt(0.9, 0.77),
    pt(0.94, 0.97),
    pt(0.64, 1.13),
  ],
  profileJawAngle: pt(-0.3, 0.88),
  cheekHollow: 0.3,
  browRidge: 0.5,
  noseSize: 0.75,
  eyeSize: 1.25,
  lashes: 0.14,
  lipTint: '#b24a58',
};

/** The female crawler's body and clothes. */
export const FEMALE_CRAWLER_BUILD: HumanBuild = {
  ...MALE_CRAWLER_BUILD,
  garment: WINE_TWILL,
  garmentCut: FEMALE_JACKET_CUT,
  sleeveCut: TAILORED_SLEEVE,
  heightScale: FEMALE_HEIGHT_SCALE,
  widthScale: FEMALE_WIDTH_SCALE,
  limbs: FEMALE_LIMBS,
  headScale: FEMALE_HEAD_SCALE,
  headBreadth: FEMALE_HEAD_BREADTH,
  headPivot: FEMALE_HEAD_PIVOT,
  neckGirth: FEMALE_NECK_GIRTH,
  neckSoftness: FEMALE_NECK_SOFTNESS,
  shoulderSpread: FEMALE_SHOULDER_SPREAD,
  hipSpread: FEMALE_HIP_SPREAD,
  seatFullness: FEMALE_SEAT,
  face: FEMALE_FACE,
  figureExtent: FEMALE_FIGURE_EXTENT,
  baseGarments: [BELTED_TWILL_JACKET, SILK_NECK_SCARF, TAPERED_TROUSERS, ANKLE_BOOTS, GOLD_WATCH],
};

/** Fuller lips than the male face's, as the townswomen's are drawn. */
const FEMININE_LIP_FULLNESS = 1.15;

/** Head-on her brows are fine and short, tapering to a thin tail. */
const FEMALE_FACING_BROW: BrowShape = { thickness: 0.42, length: 0.62, tail: 0.32 };

/**
 * Her upper lid is drawn darker and heavier than the male crawler's lightened
 * line: with the lashes it is the line that reads as a woman's eye.
 */
const FEMALE_LID_WEIGHT = 0.42;
const FEMALE_LID_INK = 0.55;

/** The female crawler's resting face: the male crawler's calm, under finer brows and fuller lips. */
export const FEMALE_CRAWLER_EXPRESSION: BipedExpression = {
  ...MALE_CRAWLER_EXPRESSION,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMALE_FACING_BROW,
  lipFullness: FEMININE_LIP_FULLNESS,
  eyes: { ...OPEN_EYES, lidWeight: FEMALE_LID_WEIGHT, lidInk: FEMALE_LID_INK },
};
