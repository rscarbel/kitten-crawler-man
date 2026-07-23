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

import { mulberry32, range, centered, pick, chance, subSeed, type Rng } from './rng';
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

/**
 * A citizen's occupation in the Over City. Passed to `generatePersonAppearance`
 * to nudge a seeded genome toward a role's look (a guard's livery, a farmer's
 * hat, a child's smaller stature) without discarding the underlying variety.
 * `commoner` applies no bias — a plain seeded person.
 */
export type TownRole =
  | 'guard'
  | 'merchant'
  | 'farmer'
  | 'smith'
  | 'innkeeper'
  | 'priest'
  | 'child'
  | 'drunk'
  | 'noble'
  | 'beggar'
  | 'laborer'
  | 'skyfowl'
  | 'commoner';

const HEIGHT_MIN = 0.86;
const HEIGHT_MAX = 1.14;
const BUILD_MIN = 0;
const BUILD_MAX = 1;
const SHOULDER_MIN = 0.098;
const SHOULDER_MAX = 0.122;
const HIP_MIN = 0.086;
const HIP_MAX = 0.108;
const TORSO_MIN = 0.26;
const TORSO_MAX = 0.32;
const LEG_MIN = 0.34;
const LEG_MAX = 0.42;
const ARM_MIN = 0.3;
const ARM_MAX = 0.36;
/** Extra shoulder/hip half-width a fully heavy build adds, as a fraction of draw size. */
const BUILD_WIDTH_BONUS = 0.014;

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
    shoulderWidth: range(rng, SHOULDER_MIN, SHOULDER_MAX) + build * BUILD_WIDTH_BONUS,
    hipWidth: range(rng, HIP_MIN, HIP_MAX) + build * BUILD_WIDTH_BONUS,
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

// Role-biased palettes: livery, work clothes, and finery that read at a glance.
const GUARD_TOP_COLORS = ['#3a4a6a', '#42506a', '#4a5560', '#5a6070'] as const;
const GUARD_BOTTOM_COLORS = ['#2a2a34', '#2c3040', '#34383e'] as const;
const FARMER_TOP_COLORS = ['#6a5a3a', '#556b2f', '#7a6a4a', '#5a4a2a'] as const;
const FARMER_BOTTOM_COLORS = ['#4a3a2a', '#5a4a38', '#6a5a3a'] as const;
const SMITH_TOP_COLORS = ['#3a2a22', '#2a2420', '#4a3020'] as const;
const INNKEEPER_TOP_COLORS = ['#a0522d', '#8a5a2c', '#7a4a2a'] as const;
const INNKEEPER_ACCENTS = ['#e0d0c0', '#f0f0f0'] as const;
const PRIEST_TOP_COLORS = ['#2a2430', '#3a3040', '#d0d3d4'] as const;
const NOBLE_TOP_COLORS = ['#5a2a5a', '#7a2a3a', '#2a3a6a', '#4a2a6a'] as const;
const NOBLE_ACCENTS = ['#e0c060', '#e0d0c0'] as const;
const MERCHANT_TOP_COLORS = ['#8e44ad', '#c0447a', '#16a085', '#d68910'] as const;
const DRAB_TOP_COLORS = ['#5a5a5a', '#4a4a4a', '#6a5a4a', '#3a3a3a'] as const;
const DRAB_BOTTOM_COLORS = ['#3a3a3a', '#2a2a2e', '#4a3a2a'] as const;
const SKYFOWL_TOP_COLORS = ['#2c6ba0', '#27824f', '#c0392b', '#d68910', '#8e44ad'] as const;

const CHILD_HEIGHT_FACTOR = 0.62;
const CHILD_BUILD = 0.15;
const SMITH_BUILD_FLOOR = 0.6;
const LABORER_BUILD_FLOOR = 0.45;

const ROLE_BIAS_SALT = 0x00b1a5;

/**
 * How a role tugs a genome away from the neutral seed. Every field is optional
 * so a role only overrides the traits that make it recognizable, leaving the
 * rest to the seed.
 */
interface RoleBias {
  heightFactor?: number;
  build?: number;
  buildFloor?: number;
  topColors?: ReadonlyArray<string>;
  bottomColors?: ReadonlyArray<string>;
  accentColors?: ReadonlyArray<string>;
  /** Force this hat; `'none'` bares the head. */
  hat?: HatStyle;
  suppressFacialHair?: boolean;
}

const ROLE_BIASES: Partial<Record<TownRole, RoleBias>> = {
  guard: { topColors: GUARD_TOP_COLORS, bottomColors: GUARD_BOTTOM_COLORS, hat: 'brimmed' },
  merchant: { topColors: MERCHANT_TOP_COLORS },
  farmer: { topColors: FARMER_TOP_COLORS, bottomColors: FARMER_BOTTOM_COLORS, hat: 'brimmed' },
  smith: { topColors: SMITH_TOP_COLORS, buildFloor: SMITH_BUILD_FLOOR, hat: 'none' },
  innkeeper: { topColors: INNKEEPER_TOP_COLORS, accentColors: INNKEEPER_ACCENTS },
  priest: { topColors: PRIEST_TOP_COLORS, hat: 'none', suppressFacialHair: true },
  child: {
    heightFactor: CHILD_HEIGHT_FACTOR,
    build: CHILD_BUILD,
    suppressFacialHair: true,
    hat: 'none',
  },
  drunk: { topColors: DRAB_TOP_COLORS, hat: 'none' },
  noble: { topColors: NOBLE_TOP_COLORS, accentColors: NOBLE_ACCENTS, hat: 'brimmed' },
  beggar: { topColors: DRAB_TOP_COLORS, bottomColors: DRAB_BOTTOM_COLORS, hat: 'none' },
  laborer: { topColors: DRAB_TOP_COLORS, buildFloor: LABORER_BUILD_FLOOR },
  skyfowl: { topColors: SKYFOWL_TOP_COLORS },
};

/**
 * Applies a role's bias in place. Uses its own seeded stream (`ROLE_BIAS_SALT`)
 * so the neutral genome above is untouched — an identical seed with no role
 * still yields the identical person.
 */
function applyRoleBias(app: PersonAppearance, role: TownRole): void {
  const bias = ROLE_BIASES[role];
  if (!bias) return;
  const rng = mulberry32(subSeed(app.seed, ROLE_BIAS_SALT));

  if (bias.heightFactor !== undefined) app.body.heightScale *= bias.heightFactor;
  if (bias.build !== undefined) app.body.build = bias.build;
  if (bias.buildFloor !== undefined) app.body.build = Math.max(app.body.build, bias.buildFloor);
  if (bias.topColors) app.outfit.topColor = pick(rng, bias.topColors);
  if (bias.bottomColors) app.outfit.bottomColor = pick(rng, bias.bottomColors);
  if (bias.accentColors) app.outfit.topAccent = pick(rng, bias.accentColors);
  if (bias.hat !== undefined) app.outfit.hat = bias.hat;
  if (bias.suppressFacialHair) app.hair.facial = 'none';
}

/**
 * Builds a complete, reproducible appearance from `seed`. An optional `role`
 * biases the look toward an occupation (see {@link TownRole}) without losing
 * the seed's variety; omit it (or pass `'commoner'`) for a neutral citizen.
 */
export function generatePersonAppearance(seed: number, role?: TownRole): PersonAppearance {
  const rng = mulberry32(seed);
  // Drawn first so it can bias hair/facial-hair without correlating other traits.
  const masc = rng();
  const skin = pick(rng, SKIN_TONES);
  const skinShadow = shade(skin, SKIN_SHADOW_AMOUNT);

  const appearance: PersonAppearance = {
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

  if (role !== undefined && role !== 'commoner') applyRoleBias(appearance, role);
  return appearance;
}
