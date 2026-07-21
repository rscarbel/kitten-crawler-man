/**
 * The "genome" of a procedurally generated person: every varying trait, derived
 * deterministically from a single integer seed. The renderer (`drawPerson.ts`)
 * and the skeleton (`skeleton.ts`) read only from this struct, so a person's
 * look is fully reproducible from its seed and the world can mint effectively
 * unlimited unique people at spawn time.
 *
 * All proportion fields are unitless multipliers/fractions the renderer scales
 * by the requested draw size — never pixels — so a person looks identical at any
 * size.
 */

import { mulberry32, range, centered, pick, chance, type Rng } from './rng';
import {
  SKIN_TONES,
  HAIR_COLORS,
  EYE_COLORS,
  TOP_COLORS,
  BOTTOM_COLORS,
  SHOE_COLORS,
  ACCENT_COLORS,
  shade,
} from './color';

export type HairStyle =
  | 'bald'
  | 'buzz'
  | 'short'
  | 'messy'
  | 'side_part'
  | 'ponytail'
  | 'bun'
  | 'long'
  | 'afro'
  | 'mohawk';

export type FacialHair = 'none' | 'stubble' | 'mustache' | 'goatee' | 'beard';

export type TopStyle = 'tshirt' | 'longsleeve' | 'jacket' | 'vest' | 'hoodie';
export type BottomStyle = 'pants' | 'shorts' | 'skirt';
export type HatStyle = 'none' | 'cap' | 'beanie' | 'brimmed';

export interface PersonBody {
  /** Overall stature multiplier — taller/shorter than the reference height. */
  heightScale: number;
  /** 0 = slight, 1 = heavy: widens torso and thickens limbs. */
  build: number;
  /** Shoulder half-width as a fraction of draw size. */
  shoulderWidth: number;
  /** Hip half-width as a fraction of draw size. */
  hipWidth: number;
  /** Torso length as a fraction of draw size. */
  torsoLength: number;
  /** Leg length as a fraction of draw size. */
  legLength: number;
  /** Arm length as a fraction of draw size. */
  armLength: number;
}

export interface PersonHead {
  widthFrac: number;
  heightFrac: number;
  jawWidth: number;
}

export interface PersonFace {
  skin: string;
  skinShadow: string;
  noseSize: number;
  noseLength: number;
  eyeSpacing: number;
  eyeSize: number;
  eyeColor: string;
  browThickness: number;
  browAngle: number;
  mouthWidth: number;
  earSize: number;
}

export interface PersonHair {
  style: HairStyle;
  color: string;
  facial: FacialHair;
}

export interface PersonOutfit {
  top: TopStyle;
  topColor: string;
  topAccent: string;
  bottom: BottomStyle;
  bottomColor: string;
  shoes: string;
  hat: HatStyle;
  hatColor: string;
}

/**
 * Per-person gait quirks so a crowd doesn't march in lockstep — read by
 * `gait.ts`. Fractions/multipliers, never pixels.
 */
export interface PersonGaitTraits {
  strideScale: number;
  bounceScale: number;
  armSwingScale: number;
  postureLean: number;
  /** Radians of phase offset so cycles aren't synchronized across people. */
  phaseOffset: number;
}

export interface PersonAppearance {
  seed: number;
  body: PersonBody;
  head: PersonHead;
  face: PersonFace;
  hair: PersonHair;
  outfit: PersonOutfit;
  gait: PersonGaitTraits;
}

const HEIGHT_MIN = 0.86;
const HEIGHT_MAX = 1.14;
const BUILD_MIN = 0;
const BUILD_MAX = 1;
const SHOULDER_MIN = 0.15;
const SHOULDER_MAX = 0.2;
const HIP_MIN = 0.12;
const HIP_MAX = 0.17;
const TORSO_MIN = 0.26;
const TORSO_MAX = 0.32;
const LEG_MIN = 0.34;
const LEG_MAX = 0.42;
const ARM_MIN = 0.3;
const ARM_MAX = 0.36;

const HEAD_WIDTH_MIN = 0.15;
const HEAD_WIDTH_MAX = 0.19;
const HEAD_HEIGHT_MIN = 0.19;
const HEAD_HEIGHT_MAX = 0.23;
const JAW_MIN = 0.7;
const JAW_MAX = 1;

const NOSE_SIZE_MIN = 0.7;
const NOSE_SIZE_MAX = 1.4;
const NOSE_LENGTH_MIN = 0.8;
const NOSE_LENGTH_MAX = 1.3;
const EYE_SPACING_MIN = 0.24;
const EYE_SPACING_MAX = 0.34;
const EYE_SIZE_MIN = 0.8;
const EYE_SIZE_MAX = 1.25;
const BROW_THICK_MIN = 0.6;
const BROW_THICK_MAX = 1.4;
const BROW_ANGLE_MIN = -0.18;
const BROW_ANGLE_MAX = 0.12;
const MOUTH_WIDTH_MIN = 0.8;
const MOUTH_WIDTH_MAX = 1.3;
const EAR_SIZE_MIN = 0.8;
const EAR_SIZE_MAX = 1.25;

const HAIR_STYLES: ReadonlyArray<HairStyle> = [
  'bald',
  'buzz',
  'short',
  'messy',
  'side_part',
  'ponytail',
  'bun',
  'long',
  'afro',
  'mohawk',
];
const TOP_STYLES: ReadonlyArray<TopStyle> = ['tshirt', 'longsleeve', 'jacket', 'vest', 'hoodie'];
const BOTTOM_STYLES: ReadonlyArray<BottomStyle> = ['pants', 'shorts', 'skirt'];

const FACIAL_HAIR_CHANCE = 0.4;
const MASC_FACIAL_HAIR: ReadonlyArray<FacialHair> = ['stubble', 'mustache', 'goatee', 'beard'];
const BALD_CHANCE_BY_MASC = 0.12;
const HAT_CHANCE = 0.22;
const HAT_STYLES: ReadonlyArray<HatStyle> = ['cap', 'beanie', 'brimmed'];

const STRIDE_MIN = 0.85;
const STRIDE_MAX = 1.2;
const BOUNCE_MIN = 0.8;
const BOUNCE_MAX = 1.25;
const ARM_SWING_MIN = 0.75;
const ARM_SWING_MAX = 1.3;
const POSTURE_MIN = -0.03;
const POSTURE_MAX = 0.05;

const SKIN_SHADOW_AMOUNT = 0.22;

function generateBody(rng: Rng): PersonBody {
  const build = range(rng, BUILD_MIN, BUILD_MAX);
  return {
    heightScale: centered(rng, HEIGHT_MIN, HEIGHT_MAX),
    build,
    shoulderWidth: range(rng, SHOULDER_MIN, SHOULDER_MAX) + build * 0.03,
    hipWidth: range(rng, HIP_MIN, HIP_MAX) + build * 0.03,
    torsoLength: centered(rng, TORSO_MIN, TORSO_MAX),
    legLength: centered(rng, LEG_MIN, LEG_MAX),
    armLength: centered(rng, ARM_MIN, ARM_MAX),
  };
}

function generateFace(rng: Rng, skin: string, skinShadow: string): PersonFace {
  return {
    skin,
    skinShadow,
    noseSize: range(rng, NOSE_SIZE_MIN, NOSE_SIZE_MAX),
    noseLength: range(rng, NOSE_LENGTH_MIN, NOSE_LENGTH_MAX),
    eyeSpacing: range(rng, EYE_SPACING_MIN, EYE_SPACING_MAX),
    eyeSize: range(rng, EYE_SIZE_MIN, EYE_SIZE_MAX),
    eyeColor: pick(rng, EYE_COLORS),
    browThickness: range(rng, BROW_THICK_MIN, BROW_THICK_MAX),
    browAngle: range(rng, BROW_ANGLE_MIN, BROW_ANGLE_MAX),
    mouthWidth: range(rng, MOUTH_WIDTH_MIN, MOUTH_WIDTH_MAX),
    earSize: range(rng, EAR_SIZE_MIN, EAR_SIZE_MAX),
  };
}

function generateHair(rng: Rng, masc: number): PersonHair {
  const forcedBald = chance(rng, masc * BALD_CHANCE_BY_MASC);
  const style = forcedBald ? 'bald' : pick(rng, HAIR_STYLES);
  const wantsFacial = masc > 0.5 && chance(rng, FACIAL_HAIR_CHANCE);
  return {
    style,
    color: pick(rng, HAIR_COLORS),
    facial: wantsFacial ? pick(rng, MASC_FACIAL_HAIR) : 'none',
  };
}

function generateOutfit(rng: Rng): PersonOutfit {
  const hasHat = chance(rng, HAT_CHANCE);
  return {
    top: pick(rng, TOP_STYLES),
    topColor: pick(rng, TOP_COLORS),
    topAccent: pick(rng, ACCENT_COLORS),
    bottom: pick(rng, BOTTOM_STYLES),
    bottomColor: pick(rng, BOTTOM_COLORS),
    shoes: pick(rng, SHOE_COLORS),
    hat: hasHat ? pick(rng, HAT_STYLES) : 'none',
    hatColor: pick(rng, TOP_COLORS),
  };
}

function generateGait(rng: Rng): PersonGaitTraits {
  return {
    strideScale: range(rng, STRIDE_MIN, STRIDE_MAX),
    bounceScale: range(rng, BOUNCE_MIN, BOUNCE_MAX),
    armSwingScale: range(rng, ARM_SWING_MIN, ARM_SWING_MAX),
    postureLean: range(rng, POSTURE_MIN, POSTURE_MAX),
    phaseOffset: range(rng, 0, Math.PI * 2),
  };
}

/** Builds a complete, reproducible appearance from `seed`. */
export function generatePersonAppearance(seed: number): PersonAppearance {
  const rng = mulberry32(seed);
  // Drawn first so it can bias hair/facial-hair without correlating other traits.
  const masc = rng();
  const skin = pick(rng, SKIN_TONES);
  const skinShadow = shade(skin, SKIN_SHADOW_AMOUNT);

  return {
    seed,
    body: generateBody(rng),
    head: {
      widthFrac: range(rng, HEAD_WIDTH_MIN, HEAD_WIDTH_MAX),
      heightFrac: range(rng, HEAD_HEIGHT_MIN, HEAD_HEIGHT_MAX),
      jawWidth: range(rng, JAW_MIN, JAW_MAX),
    },
    face: generateFace(rng, skin, skinShadow),
    hair: generateHair(rng, masc),
    outfit: generateOutfit(rng),
    gait: generateGait(rng),
  };
}
