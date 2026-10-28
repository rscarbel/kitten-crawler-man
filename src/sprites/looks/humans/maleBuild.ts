/**
 * The male human crawler's build and clothes, shared by every male crawler
 * look: six foot and slim, in a light-blue chambray shirt with its sleeves
 * rolled to just below the elbow, tucked into charcoal chinos under a black
 * belt, black knit sneakers on white soles, and a silver smartwatch on his
 * left wrist. Also the relaxed face those looks wear.
 */

import {
  type BipedExpression,
  type BrowShape,
  type EyeStyle,
  RIG_FACE,
} from '../../art/biped/head';
import type { GlossRamp, Ramp } from '../../art/biped/palette';
import { ROLLED_SLEEVE } from '../../art/biped/sleeve';
import { type GarmentCut, NO_BUST, RIG_WAIST_ACROSS } from '../../art/biped/torso';
import { LEATHER_BELT, CHINOS } from '../../garments/human/chinos';
import { CHAMBRAY_SHIRT } from '../../garments/human/chambrayShirt';
import { KNIT_SNEAKERS } from '../../garments/human/knitSneakers';
import { SMARTWATCH } from '../../garments/human/wristwatches';
import {
  type HumanBuild,
  METRES_PER_INCH,
  RIG_STATURE_METRES,
  TROUSERS_OWN_SEAT,
} from '../humanLook';
import type { LimbBuild } from '../../art/biped/limbs';

/**
 * Light-blue chambray: a woven cotton, so its sheen is soft — the specular
 * step sits only just past the light one, or the shirt shines like nylon.
 */
const CHAMBRAY: GlossRamp = {
  deep: '#3d4b69',
  shadow: '#56688b',
  dark: '#6f84a8',
  mid: '#899dc1',
  base: '#a2b4d5',
  light: '#bccbe6',
  rim: '#d7e1f3',
  specular: '#c9d6ec',
};

/**
 * Lean: edge-on his chest is about an eighth of his height deep, where the
 * rig's heavy barrel is nearly a third. Head-on it widens from a narrow waist
 * out to the armpits, the upper half of a clear V.
 */
const MALE_TORSO_DEPTH = 0.5;
const MALE_CHEST_ACROSS = 0.82;
/** A shirt's yoke is a fine stitched seam, not leather's bold welt. */
const SHIRT_SEAM_WEIGHT = 0.12;
/** Cotton drapes: its folds and flank shade lie a third as deep as stiff leather's. */
const SHIRT_FOLD_WEIGHT = 0.35;
/** His shoulders slope from the neck to the deltoid, where the rig's stand square. */
const MALE_SHOULDER_DROP = 0.025;

/**
 * A shirt tucked in: its tail runs on past the waist to where his chinos
 * ride, low on the hips, and the belt sits over the top of them there; the
 * shirt blouses a little wider than the waist above the belt.
 */
const SHIRT_TUCK_DROP = 0.1;
/**
 * Tucked in, the shirt's tail follows his waist in to the belt rather than
 * blousing past it: a hem wider than the waist widens him toward the hips.
 */
const SHIRT_BLOUSE_FLARE = 0.92;
const TUCKED_SHIRT_CUT: GarmentCut = {
  hemDrop: SHIRT_TUCK_DROP,
  hasHardware: false,
  hemFlare: SHIRT_BLOUSE_FLARE,
  profileDepth: MALE_TORSO_DEPTH,
  chestAcross: MALE_CHEST_ACROSS,
  seamWeight: SHIRT_SEAM_WEIGHT,
  shoulderDrop: MALE_SHOULDER_DROP,
  neckline: 'openV',
  foldWeight: SHIRT_FOLD_WEIGHT,
  waistAcross: RIG_WAIST_ACROSS,
  bustDepth: NO_BUST,
};

/** He stands 6'0", against the rig's 6'3". */
const MALE_STATURE_INCHES = 72;
const MALE_STATURE_METRES = MALE_STATURE_INCHES * METRES_PER_INCH;
const MALE_STATURE_OVER_RIG = MALE_STATURE_METRES / RIG_STATURE_METRES;
/**
 * The rig's crown sits on its game-sized head; with his head drawn at a real
 * man's size the crown drops to 0.923 of the rig's crown height (measured off
 * the standing cells), so his body is drawn that much longer to stand him back
 * up at his own height.
 */
const SMALLER_HEAD_CROWN_SHARE = 0.923;
const MALE_HEIGHT_SCALE = MALE_STATURE_OVER_RIG / SMALLER_HEAD_CROWN_SHARE;
/**
 * Across the picture he is drawn at his stature: what makes him slim is his
 * own build below — narrower shoulders, chest, seat and limbs — not a
 * narrower drawing, which would thin his head and hands with them.
 */
const MALE_WIDTH_SCALE = MALE_STATURE_OVER_RIG;

/**
 * His hands are a real man's: a little longer than the rig's and far
 * slimmer, so hanging open at his sides, seen past the thumb, they read as
 * hands rather than as balled fists.
 */
const MALE_HAND_LENGTH = 1.25;
const MALE_HAND_BREADTH = 0.6;

/** His forearm is three pixels at the tile, so its light turns a little toward the lit side. */
const MALE_FOREARM_TERMINATOR = 0.4;

/** Edge-on his sleeve hangs over the middle third of his chest's depth. */
const MALE_UPPER_ARM_DEPTH = 0.7;

/**
 * A lean man's limbs on the rig's bones: his thigh is about a tenth of his
 * height across, his calf about a twentieth, his forearm under a twentieth and
 * narrower than his upper arm — the rig's brawler's forearm is the thicker —
 * and a low-top shoe under a twentieth of his height wide head-on.
 */
const MALE_LIMBS: LimbBuild = {
  thighGirth: 0.66,
  shinGirth: 0.56,
  legDepth: 0.7,
  upperArmGirth: 0.56,
  upperArmDepth: MALE_UPPER_ARM_DEPTH,
  forearmGirth: 0.72,
  footWidth: 0.6,
  footLength: 0.82,
  handLength: MALE_HAND_LENGTH,
  handBreadth: MALE_HAND_BREADTH,
  forearmTerminator: MALE_FOREARM_TERMINATOR,
};

/**
 * His head drawn at a real man's proportion — crown to chin about a sixth of
 * his height — rather than the rig's game-sized head, which on his slim
 * build makes him a stocky, top-heavy figure.
 */
const MALE_HEAD_SCALE = 0.66;
/** His face is a real man's width: about a tenth of his height across at the ears. */
const MALE_HEAD_BREADTH = 1.12;
/**
 * Scaled about a point two thirds of the way down from his eyes to his chin:
 * his neck stays nearly a real man's short one, and his eye stays high
 * enough above his shoulder that an arm drawing a heavy weapon over it
 * passes under his face rather than across it — about his chin, the stow
 * hides his eye.
 */
const MALE_HEAD_PIVOT = 0.65;

/**
 * A clear masculine V head-on: his shoulders stand distinctly wider than his
 * hips, the upper torso widening out to them, and his arms hang outside them
 * with a gap at the waist.
 */
const MALE_SHOULDER_SPREAD = 0.95;

/** Narrow hips, well inside his shoulders: the lower half of the V. */
const MALE_HIP_SPREAD = 0.66;

/** A lean man's neck: about a seventeenth of his height across, where the rig's is a heavy man's. */
const MALE_NECK_GIRTH = 0.72;
/** Smooth skin over a lean neck: the light rolls round it, with no muscle cut into it. */
const MALE_NECK_SOFTNESS = 3;

/** His swept top tops out 30 px above the anchor; head-on, shoulders and arms, he is 0.359375 of a tile either side. */
const MALE_FIGURE_EXTENT = { spriteTopAboveTilePx: 30, halfWidthTiles: 0.359375 };

/** The male crawler's body and clothes. */
export const MALE_CRAWLER_BUILD: HumanBuild = {
  wearer: 'human',
  garment: CHAMBRAY,
  garmentCut: TUCKED_SHIRT_CUT,
  sleeveCut: ROLLED_SLEEVE,
  heightScale: MALE_HEIGHT_SCALE,
  widthScale: MALE_WIDTH_SCALE,
  limbs: MALE_LIMBS,
  headScale: MALE_HEAD_SCALE,
  headBreadth: MALE_HEAD_BREADTH,
  headPivot: MALE_HEAD_PIVOT,
  neckGirth: MALE_NECK_GIRTH,
  neckSoftness: MALE_NECK_SOFTNESS,
  shoulderSpread: MALE_SHOULDER_SPREAD,
  hipSpread: MALE_HIP_SPREAD,
  seatFullness: TROUSERS_OWN_SEAT,
  face: RIG_FACE,
  figureExtent: MALE_FIGURE_EXTENT,
  baseGarments: [CHAMBRAY_SHIRT, LEATHER_BELT, CHINOS, KNIT_SNEAKERS, SMARTWATCH],
};

/**
 * A relaxed face: the scowl the fighting poses ask for comes through only
 * faintly, so his brows stay nearly straight, and the corners of his mouth
 * turn up a little, slightly amused.
 */
const MALE_ANGER_SCALE = 0.12;
/** Fairly straight, of medium weight: thinner than the rig's heavy brow bars, with a blunter tail. */
const MALE_PROFILE_BROW: BrowShape = { thickness: 0.6, length: 0.95, tail: 0.5 };
const MALE_FACING_BROW: BrowShape = { thickness: 0.5, length: 0.72, tail: 0.5 };
/**
 * Two steps lighter than the rig's near-black brow: at the tile a brow is a
 * whole pixel however thin it is drawn, and any darker it bars the face
 * above the eye.
 */
const MALE_BROW_TONE = 'dark' satisfies keyof Ramp;
const MALE_LIP_FULLNESS = 1;
const MALE_MOUTH_SMILE = 0.007;

/**
 * Open, pale eyes. Drawn at a real man's head size the eye is twice the rig's
 * at review scale, where the rig's dark slit under a heavy lid reads as an eye
 * screwed shut: the white shows, the iris keeps most of its own colour round
 * a dark pupil, and the lid is a fine line lightened toward the skin's
 * shadow. At the tile the lid is a whole pixel whatever its width, and in the
 * outline's black it covers the white and the iris: the eye reads as a dark
 * blot.
 */
export const OPEN_EYES: EyeStyle = {
  facingSclera: true,
  scleraShade: 0.3,
  irisShade: 0.08,
  lidWeight: 0.35,
  lidInk: 0.65,
  openness: 1,
  colouredIris: true,
};

/** The male crawler's resting face. */
export const MALE_CRAWLER_EXPRESSION: BipedExpression = {
  angerScale: MALE_ANGER_SCALE,
  profileBrow: MALE_PROFILE_BROW,
  facingBrow: MALE_FACING_BROW,
  lipFullness: MALE_LIP_FULLNESS,
  mouthSmile: MALE_MOUTH_SMILE,
  eyes: OPEN_EYES,
  browTone: MALE_BROW_TONE,
};
