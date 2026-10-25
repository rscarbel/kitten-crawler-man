/**
 * Ryan's look: fair skin with a warm pink undertone, medium-brown hair cut
 * short at the sides with a longer top swept up and back, a short full beard
 * of a warmer, more ginger brown, light blue-grey eyes and a relaxed mouth.
 * Six foot and slim. A light-blue chambray shirt with its sleeves rolled to
 * just below the elbow, tucked into charcoal chinos under a black belt, black
 * knit sneakers on white soles, and a silver smartwatch on his left wrist.
 */

import { type BrowShape, type EyeStyle } from '../../art/biped/head';
import type { GlossRamp, Ramp } from '../../art/biped/palette';
import { RYAN_SHORT_BEARD, RYAN_SWEPT_TOP } from '../../art/biped/ryanHead';
import { RYAN_ROLLED_SLEEVE } from '../../art/biped/sleeve';
import type { GarmentCut } from '../../art/biped/torso';
import { RYAN_BELT, RYAN_CHINOS } from '../../garments/human/ryanChinos';
import { RYAN_SHIRT } from '../../garments/human/ryanShirt';
import { RYAN_SNEAKERS } from '../../garments/human/ryanSneakers';
import { RYAN_WATCH } from '../../garments/human/ryanWatch';
import { type HumanLook, RIG_STATURE_METRES } from '../humanLook';
import type { LimbBuild } from '../../art/biped/limbs';

/** Fair, pink in the light and rose in the shadow. */
const RYAN_SKIN: Ramp = {
  deep: '#583a3a',
  shadow: '#7a504c',
  dark: '#a66c5f',
  mid: '#a86759',
  base: '#e6b7a4',
  light: '#f4d4c5',
  rim: '#f2d6c8',
};

/** His hands and knuckles, a little redder than his face. */
const RYAN_HAND_SKIN: Ramp = {
  deep: '#5f3238',
  shadow: '#905755',
  dark: '#b47766',
  mid: '#c98f7d',
  base: '#dca792',
  light: '#efc8b8',
  rim: '#f6dccf',
};

/** Medium brown. */
const RYAN_HAIR: Ramp = {
  deep: '#3e2e22',
  shadow: '#453324',
  dark: '#523d2b',
  mid: '#664c37',
  base: '#7b5d44',
  light: '#957457',
  rim: '#b0917a',
};

const RYAN_IRIS = '#9fb2c0';

/**
 * Light-blue chambray: a woven cotton, so its sheen is soft — the specular
 * step sits only just past the light one, or the shirt shines like nylon.
 */
const RYAN_CHAMBRAY: GlossRamp = {
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
const RYAN_TORSO_DEPTH = 0.5;
const RYAN_CHEST_ACROSS = 0.82;
/** A shirt's yoke is a fine stitched seam, not leather's bold welt. */
const SHIRT_SEAM_WEIGHT = 0.12;
/** Cotton drapes: its folds and flank shade lie a third as deep as stiff leather's. */
const SHIRT_FOLD_WEIGHT = 0.35;
/** His shoulders slope from the neck to the deltoid, where the rig's stand square. */
const RYAN_SHOULDER_DROP = 0.025;

/**
 * A shirt tucked in: its tail runs on past the waist to where his chinos
 * ride, low on the hips, and the belt sits over the top of them there; the
 * shirt blouses a little wider than the waist above the belt.
 */
const RYAN_SHIRT_TUCK_DROP = 0.1;
/**
 * Tucked in, the shirt's tail follows his waist in to the belt rather than
 * blousing past it: a hem wider than the waist widens him toward the hips.
 */
const RYAN_SHIRT_BLOUSE_FLARE = 0.92;
const RYAN_SHIRT_CUT: GarmentCut = {
  hemDrop: RYAN_SHIRT_TUCK_DROP,
  hasHardware: false,
  hemFlare: RYAN_SHIRT_BLOUSE_FLARE,
  profileDepth: RYAN_TORSO_DEPTH,
  chestAcross: RYAN_CHEST_ACROSS,
  seamWeight: SHIRT_SEAM_WEIGHT,
  shoulderDrop: RYAN_SHOULDER_DROP,
  neckline: 'openV',
  foldWeight: SHIRT_FOLD_WEIGHT,
};

/** Ryan stands 6'0", against the rig's 6'3". */
const RYAN_STATURE_INCHES = 72;
const METRES_PER_INCH = 0.0254;
const RYAN_STATURE_METRES = RYAN_STATURE_INCHES * METRES_PER_INCH;
const RYAN_STATURE_OVER_RIG = RYAN_STATURE_METRES / RIG_STATURE_METRES;
/**
 * The rig's crown sits on its game-sized head; with his head drawn at a real
 * man's size the crown drops to 0.923 of the rig's crown height (measured off
 * the standing cells), so his body is drawn that much longer to stand him back
 * up at his own height.
 */
const SMALLER_HEAD_CROWN_SHARE = 0.923;
const RYAN_HEIGHT_SCALE = RYAN_STATURE_OVER_RIG / SMALLER_HEAD_CROWN_SHARE;
/**
 * Across the picture he is drawn at his stature: what makes him slim is his
 * own build below — narrower shoulders, chest, seat and limbs — not a
 * narrower drawing, which would thin his head and hands with them.
 */
const RYAN_WIDTH_SCALE = RYAN_STATURE_OVER_RIG;

/**
 * His hands are a real man's: a little longer than the rig's and far
 * slimmer, so hanging open at his sides, seen past the thumb, they read as
 * hands rather than as balled fists.
 */
const RYAN_HAND_LENGTH = 1.25;
const RYAN_HAND_BREADTH = 0.6;

/** His forearm is three pixels at the tile, so its light turns a little toward the lit side. */
const RYAN_FOREARM_TERMINATOR = 0.4;

/** Edge-on his sleeve hangs over the middle third of his chest's depth. */
const RYAN_UPPER_ARM_DEPTH = 0.7;

/**
 * A lean man's limbs on the rig's bones: his thigh is about a tenth of his
 * height across, his calf about a twentieth, his forearm under a twentieth and
 * narrower than his upper arm — the rig's brawler's forearm is the thicker —
 * and a low-top shoe under a twentieth of his height wide head-on.
 */
const RYAN_LIMBS: LimbBuild = {
  thighGirth: 0.66,
  shinGirth: 0.56,
  legDepth: 0.7,
  upperArmGirth: 0.56,
  upperArmDepth: RYAN_UPPER_ARM_DEPTH,
  forearmGirth: 0.72,
  footWidth: 0.6,
  footLength: 0.82,
  handLength: RYAN_HAND_LENGTH,
  handBreadth: RYAN_HAND_BREADTH,
  forearmTerminator: RYAN_FOREARM_TERMINATOR,
};

/**
 * His head drawn at a real man's proportion — crown to chin about a sixth of
 * his height — rather than the rig's game-sized head, which on his slim
 * build makes him a stocky, top-heavy figure.
 */
const RYAN_HEAD_SCALE = 0.66;
/** His face is a real man's width: about a tenth of his height across at the ears. */
const RYAN_HEAD_BREADTH = 1.12;
/**
 * Scaled about a point two thirds of the way down from his eyes to his chin:
 * his neck stays nearly a real man's short one, and his eye stays high
 * enough above his shoulder that an arm drawing a heavy weapon over it
 * passes under his face rather than across it — about his chin, the stow
 * hides his eye.
 */
const RYAN_HEAD_PIVOT = 0.65;

/**
 * A clear masculine V head-on: his shoulders stand distinctly wider than his
 * hips, the upper torso widening out to them, and his arms hang outside them
 * with a gap at the waist.
 */
const RYAN_SHOULDER_SPREAD = 0.95;

/** Narrow hips, well inside his shoulders: the lower half of the V. */
const RYAN_HIP_SPREAD = 0.66;

/** A lean man's neck: about a seventeenth of his height across, where the rig's is a heavy man's. */
const RYAN_NECK_GIRTH = 0.72;
/** Smooth skin over a lean neck: the light rolls round it, with no muscle cut into it. */
const RYAN_NECK_SOFTNESS = 3;

/**
 * A relaxed face: the scowl the fighting poses ask for comes through only
 * faintly, so his brows stay nearly straight, and the corners of his mouth
 * turn up a little, slightly amused.
 */
const RYAN_ANGER_SCALE = 0.12;
/** Fairly straight, of medium weight: thinner than the rig's heavy brow bars, with a blunter tail. */
const RYAN_PROFILE_BROW: BrowShape = { thickness: 0.6, length: 0.95, tail: 0.5 };
const RYAN_FACING_BROW: BrowShape = { thickness: 0.5, length: 0.72, tail: 0.5 };
/**
 * Medium brown, two steps lighter than the rig's near-black brow: at the tile
 * a brow is a whole pixel however thin it is drawn, and any darker it bars
 * the face above the eye.
 */
const RYAN_BROW_TONE = 'dark' satisfies keyof Ramp;
const RYAN_LIP_FULLNESS = 1;
const RYAN_MOUTH_SMILE = 0.007;

/**
 * Open, pale eyes. Drawn at a real man's head size the eye is twice the rig's
 * at review scale, where the rig's dark slit under a heavy lid reads as an eye
 * screwed shut: the white shows, the light blue-grey iris keeps most of its
 * own colour round a dark pupil, and the lid is a fine line lightened toward
 * the skin's shadow. At the tile the lid is a whole pixel whatever its width,
 * and in the outline's black it covers the white and the iris: the eye reads
 * as a dark blot.
 */
const RYAN_EYES: EyeStyle = {
  facingSclera: true,
  scleraShade: 0.3,
  irisShade: 0.08,
  lidWeight: 0.35,
  lidInk: 0.65,
  openness: 1,
  colouredIris: true,
};

/** His swept top tops out 30 px above the anchor; head-on, shoulders and arms, he is 0.359375 of a tile either side. */
const RYAN_FIGURE_EXTENT = { spriteTopAboveTilePx: 30, halfWidthTiles: 0.359375 };

export const RYAN_LOOK: HumanLook = {
  id: 'ryan',
  wearer: 'human',
  skin: RYAN_SKIN,
  handSkin: RYAN_HAND_SKIN,
  hair: RYAN_HAIR,
  iris: RYAN_IRIS,
  garment: RYAN_CHAMBRAY,
  garmentCut: RYAN_SHIRT_CUT,
  sleeveCut: RYAN_ROLLED_SLEEVE,
  hairstyle: RYAN_SWEPT_TOP,
  facialHair: RYAN_SHORT_BEARD,
  expression: {
    angerScale: RYAN_ANGER_SCALE,
    profileBrow: RYAN_PROFILE_BROW,
    facingBrow: RYAN_FACING_BROW,
    lipFullness: RYAN_LIP_FULLNESS,
    mouthSmile: RYAN_MOUTH_SMILE,
    eyes: RYAN_EYES,
    browTone: RYAN_BROW_TONE,
  },
  heightScale: RYAN_HEIGHT_SCALE,
  widthScale: RYAN_WIDTH_SCALE,
  limbs: RYAN_LIMBS,
  headScale: RYAN_HEAD_SCALE,
  headBreadth: RYAN_HEAD_BREADTH,
  headPivot: RYAN_HEAD_PIVOT,
  neckGirth: RYAN_NECK_GIRTH,
  neckSoftness: RYAN_NECK_SOFTNESS,
  shoulderSpread: RYAN_SHOULDER_SPREAD,
  hipSpread: RYAN_HIP_SPREAD,
  figureExtent: RYAN_FIGURE_EXTENT,
  baseGarments: [RYAN_SHIRT, RYAN_BELT, RYAN_CHINOS, RYAN_SNEAKERS, RYAN_WATCH],
};
