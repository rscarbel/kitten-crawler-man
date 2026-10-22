/**
 * The human cast: a closed set of authored looks, none of them a per-instance
 * random painter. `pickTownCastLook` is the one place a seed still matters —
 * it buckets a citizen's seed onto one look of the set for its role, so two
 * citizens of the same role and a compatible build can land on the same look
 * and share its cache cells.
 *
 * Two painters share the set. Every adult look paints on Carl's own rig
 * (`carl/figure.ts`, `human/idles.ts`/`locomotion.ts`/`actionsMisc.ts`'s pose
 * functions), because his is the only convincing movement in the game — but
 * never in his look: his crop is hidden for a hairstyle and facial hair of
 * the look's own (`human/castHead.ts`), his boxers, bare legs and bare feet
 * are covered by trousers or stockings and shoes
 * (`garments/human/townsfolkLegwear.ts`), his jacket is recut and recoloured
 * as the look's garment, and no look wears his skin or hair colour. A worn accessory (`human/townAccessories.ts`)
 * gives the role cue. The two child looks stay on the simpler skeleton-based
 * painter from `drawPerson.ts`: Carl's rig is one
 * fixed adult's proportions, and a child is not that adult scaled down (a
 * uniform shrink reads as a doll, not a child — the head-count-is-how-size-
 * is-read lesson) — it needs its own larger head fraction and shorter limbs,
 * which only the person painter's parametrised proportions can give it
 * cheaply. `townCastFigure.ts` dispatches on `look.painter`.
 */

import { mulberry32, pick, subSeed } from './rng';
import {
  TOWN_ROLES,
  type PersonAppearance,
  type PersonBody,
  type PersonHead,
  type TownRole,
} from './PersonAppearance';
import { VARIETY_TIERS, type VarietyTier } from '../../core/varietyTier';
import { deriveGlossRamp, deriveRamp, type GlossRamp, type Ramp } from '../art/carl/palette';
import {
  FACING_BROW_DEFAULT,
  FEMININE_FACING_BROW,
  FEMININE_PROFILE_BROW,
  PROFILE_BROW_DEFAULT,
  type CarlExpression,
} from '../art/carl/head';
import type { AccessorySpec } from '../art/human/townAccessories';
import type { FacialHairKind, HairStyleKind } from '../art/human/castHead';
import type { LegwearCut } from '../art/human/legwear';
import type { CarlAttachments } from '../art/carl/figure';
import type { CarlPose } from '../art/carl/rig';
import { type CardinalView } from '../facingView';
import {
  WENDELL_ATTACHMENTS,
  WENDELL_TROUSER_COLOR,
  wendellPosture,
} from '../art/human/wendellAttachments';

/**
 * A named resident's own clothes and bearing beyond what a shared accessory
 * can say: garments painted inside the figure's composition so they follow
 * the pose, a posture applied to every row's pose, and marks laid over the
 * finished shoes.
 */
export interface TownCastLookDetails {
  readonly attachments: CarlAttachments;
  readonly posture: (pose: CarlPose, view: CardinalView) => CarlPose;
  /** Mud caked on the shoes, painted with them so it stays on them through the stride. */
  readonly muddyShoes: boolean;
}

export type TownCastBuild = 'child' | 'slight' | 'standard' | 'heavy';

interface TownCastLookCommon {
  readonly id: string;
  readonly build: TownCastBuild;
  /** The roles this look is offered for; `pickTownCastLook` only buckets within these. */
  readonly roles: ReadonlyArray<TownRole>;
  /** Whether this look has a `work` row (stationed trades only). */
  readonly hasWork: boolean;
  /** Whether this look paints the dance routines (the Desperado Club's dancers only). */
  readonly hasDance?: boolean;
  /** World px a full walk cycle covers, as a fraction of the draw size. */
  readonly strideFraction: number;
  /** Which of the two human voices speaks for this look; matches the face and build it is painted with. */
  readonly feminine: boolean;
  /**
   * A stable, look-scoped seed for anything that wants deterministic variety
   * without touching the citizen's own spawn seed (dialog line rotation,
   * mainly) — shared by every citizen wearing this look, the same way its
   * cells are.
   */
  readonly dialogSeed: number;
}

export interface TownCastLookPerson extends TownCastLookCommon {
  readonly painter: 'person';
  readonly appearance: PersonAppearance;
}

export interface TownCastLookCarl extends TownCastLookCommon {
  readonly painter: 'carl';
  /**
   * Multiplies Carl's own proportions sideways only — never his height. A
   * build is a frame, not a size: `slight` is narrower at his own full
   * standing height and `heavy` is wider at it, so no adult look is ever
   * shorter than a child by construction, and no build reads as merely a
   * shrunk or stretched Carl (the same axis the person painter's own builds
   * are careful about, applied the only way Carl's fixed-height rig allows).
   */
  readonly buildWidthScale: number;
  readonly skinRamp: Ramp;
  readonly hairRamp: Ramp;
  /** Never Carl's own crop: his hair is hidden and this style is painted in its place. */
  readonly hairStyle: HairStyleKind;
  readonly facialHair: FacialHairKind;
  /**
   * The garment's own material: Carl's torso and sleeve are repainted in this
   * ramp (`setCarlGarmentRamp`) rather than covered by a shape drawn over his
   * jacket, so none of his jacket's leather is ever left showing.
   */
  readonly garmentRamp: GlossRamp;
  /** How far past the waist the garment's hem drops, in the torso's own spine units — `setCarlTorsoCut`. */
  readonly garmentHemDrop: number;
  /** How far the hem flares past the waist — `setCarlTorsoCut`'s third argument. */
  readonly garmentHemFlare: number;
  /** Whether the garment carries the jacket's own hardware (a zip, a sewn waistband) — false for every civilian cut. */
  readonly garmentHasHardware: boolean;
  readonly accessory: AccessorySpec;
  /** Trousers under a short cut; slim stockings under a hem that already covers the thigh. */
  readonly legwear: LegwearCut;
  /** Covers Carl's own bare legs — his canon look, not the rig's — in the trousers' or stockings' colour. */
  readonly pantsColor: string;
  /** Covers Carl's own bare feet, the other half of his canon look. */
  readonly shoeColor: string;
  readonly expression: CarlExpression;
  readonly details?: TownCastLookDetails;
}

export type TownCastLook = TownCastLookPerson | TownCastLookCarl;

// ── The two child looks: the person painter, parametrised for a child's own proportions ──

const CHILD_BODY: PersonBody = {
  heightScale: 0.66,
  build: 0.2,
  shoulderWidth: 0.084,
  hipWidth: 0.078,
  torsoLength: 0.25,
  legLength: 0.3,
  armLength: 0.27,
};
/** A child's head is a much bigger share of its height than an adult's — the trait that reads "young" at a glance. */
const CHILD_HEAD: PersonHead = { widthFrac: 0.225, heightFrac: 0.27, jawWidth: 0.78 };
export const PERSON_PAINTER_STRIDE_FRACTION = 0.34;

interface ChildSpec {
  readonly id: string;
  readonly skin: string;
  readonly hairColor: string;
  readonly hairStyle: PersonAppearance['hair']['style'];
  readonly eyeColor: string;
  readonly topColor: string;
  readonly bottom: PersonAppearance['outfit']['bottom'];
  readonly bottomColor: string;
  readonly feminine: boolean;
}

const CHILD_SPECS: readonly ChildSpec[] = [
  {
    id: 'child_commoner_a',
    skin: '#f0c9a0',
    hairColor: '#5a3a18',
    hairStyle: 'messy',
    eyeColor: '#4a2e14',
    topColor: '#d68910',
    bottom: 'shorts',
    bottomColor: '#3a4a5a',
    feminine: false,
  },
  {
    id: 'child_commoner_b',
    skin: '#c68a52',
    hairColor: '#2a1a0e',
    hairStyle: 'bun',
    eyeColor: '#3a5a3a',
    topColor: '#c0447a',
    bottom: 'skirt',
    bottomColor: '#5a2a3a',
    feminine: true,
  },
];

function childAppearance(spec: ChildSpec, seed: number): PersonAppearance {
  return {
    seed,
    body: CHILD_BODY,
    head: CHILD_HEAD,
    face: {
      skin: spec.skin,
      skinShadow: spec.skin,
      noseSize: 1,
      noseLength: 1,
      eyeSpacing: 0.29,
      eyeSize: 1,
      eyeColor: spec.eyeColor,
      browThickness: 1,
      browAngle: -0.02,
      mouthWidth: 1,
      earSize: 1,
    },
    hair: { style: spec.hairStyle, color: spec.hairColor, facial: 'none' },
    outfit: {
      top: 'tshirt',
      topColor: spec.topColor,
      topAccent: '#e0d0c0',
      bottom: spec.bottom,
      bottomColor: spec.bottomColor,
      shoes: '#3a2a1a',
      hat: 'none',
      hatColor: spec.topColor,
    },
    gait: {
      archetype: 'trot',
      strideScale: 1,
      bounceScale: 1,
      armSwingScale: 1,
      postureLean: 0,
      phaseOffset: 0,
    },
  };
}

const CHILD_LOOKS: readonly TownCastLookPerson[] = CHILD_SPECS.map((spec, index) => ({
  id: spec.id,
  painter: 'person',
  build: 'child',
  roles: ['child'],
  hasWork: false,
  strideFraction: PERSON_PAINTER_STRIDE_FRACTION,
  feminine: spec.feminine,
  dialogSeed: index,
  appearance: childAppearance(spec, index),
}));

// ── The adult cast: Carl's own rig, dressed ─────────────────────────────────

/**
 * How much a build multiplies Carl's own proportions sideways — his height
 * (`buildWidthScale` only ever feeds the horizontal half of the figure's own
 * paint transform, never the vertical one) stays his own for every adult
 * look, so every adult stands the same height regardless of build and no
 * build is ever a shrunk or stretched Carl.
 */
const BUILD_WIDTH_SCALE: Readonly<Record<Exclude<TownCastBuild, 'child'>, number>> = {
  slight: 0.78,
  standard: 1.0,
  heavy: 1.32,
};

/** World px a full walk cycle covers, as a fraction of the draw size — Carl's own stride reach, independent of a build's own width. */
export const ADULT_STRIDE_FRACTION = 0.42;

/**
 * A feminine look's shoulders narrow by this share on top of its own build's
 * `BUILD_WIDTH_SCALE` — a real narrowing rather than a uniform shrink, since
 * `buildWidthScale` only ever touches the horizontal half of the paint
 * transform and never Carl's own height.
 */
const FEMININE_WIDTH_SCALE = 0.93;

/** How calm a townsfolk look's brow sits against Carl's own combat scowl (`pose.brow`, up to 1). */
const MASCULINE_ANGER_SCALE = 0.22;
const FEMININE_ANGER_SCALE = 0.14;
const FEMININE_LIP_FULLNESS = 1.15;

const MASCULINE_EXPRESSION: CarlExpression = {
  angerScale: MASCULINE_ANGER_SCALE,
  profileBrow: PROFILE_BROW_DEFAULT,
  facingBrow: FACING_BROW_DEFAULT,
  lipFullness: 1,
};
const FEMININE_EXPRESSION: CarlExpression = {
  angerScale: FEMININE_ANGER_SCALE,
  profileBrow: FEMININE_PROFILE_BROW,
  facingBrow: FEMININE_FACING_BROW,
  lipFullness: FEMININE_LIP_FULLNESS,
};

/**
 * The garment cuts a townsfolk look can wear, each replacing Carl's own
 * zipped moto jacket with a different length and none of his jacket's
 * hardware (`garmentHasHardware` is always false here — no civilian look
 * wears a zip). Hem drops are in the torso's own spine units, past the waist
 * line, the same units Carl's own jacket hem (`HEM_DROP_DEFAULT` in
 * `torso.ts`, 0.055) is measured in.
 */
export type GarmentCut = 'shirt' | 'tunic' | 'dress' | 'robe';
/**
 * Hem drops derived from `carl/proportions.ts`'s own absolute figure-space
 * landmarks (`HIP_Y` -1.015, `KNEE_Y` -0.55, `ANKLE_Y` -0.085), converted into
 * the torso frame's spine-local units past the waist (`WAIST_Y` -1.17) — the
 * frame's own local "down" units match absolute figure units 1:1 on an
 * upright spine. `dress` lands at the midpoint between knee and ankle, so a
 * skirt hem reaches mid-shin rather than stopping at the hip.
 */
const GARMENT_HEM_DROP: Readonly<Record<GarmentCut, number>> = {
  shirt: 0.03,
  tunic: 0.5,
  robe: 0.95,
  dress: 0.85,
};
/** How far the hem flares past the waist — a skirt has to flare well past a shirt's near-straight hem to read as a skirt rather than a tube. */
const GARMENT_HEM_FLARE: Readonly<Record<GarmentCut, number>> = {
  shirt: 1.05,
  tunic: 1.15,
  robe: 1.35,
  dress: 1.9,
};
/**
 * What each cut wears on its legs, painted under the hem from the solved
 * legs: trousers under a short cut, slim stockings under a hem that already
 * covers the thigh.
 */
const GARMENT_LEGWEAR: Readonly<Record<GarmentCut, LegwearCut>> = {
  shirt: 'trousers',
  tunic: 'trousers',
  robe: 'stockings',
  dress: 'stockings',
};

/** Skin tones for the cast. Carl's own skin is none of them. */
export const SKIN_TONE_BASES = ['#f0c9a0', '#c78a5a', '#8a5a34', '#5a3a22', '#b08a62'] as const;
/**
 * Hair colours for the cast. Carl's own red-brown is none of them; the
 * greying salt-and-pepper and the white are the older heads in the set.
 */
export const HAIR_COLOR_BASES = [
  '#1a1512',
  '#8a6a3a',
  '#c9a850',
  '#6a2a20',
  '#8c857a',
  '#d8d4cc',
  '#b0582a',
] as const;

type SkinTone = 'fair' | 'tan' | 'brown' | 'deep' | 'olive';
type HairColour = 'black' | 'lightBrown' | 'blonde' | 'auburn' | 'greying' | 'white' | 'ginger';

const SKIN_RAMPS: Readonly<Record<SkinTone, Ramp>> = {
  fair: deriveRamp(SKIN_TONE_BASES[0]),
  tan: deriveRamp(SKIN_TONE_BASES[1]),
  brown: deriveRamp(SKIN_TONE_BASES[2]),
  deep: deriveRamp(SKIN_TONE_BASES[3]),
  olive: deriveRamp(SKIN_TONE_BASES[4]),
};
const HAIR_RAMPS: Readonly<Record<HairColour, Ramp>> = {
  black: deriveRamp(HAIR_COLOR_BASES[0]),
  lightBrown: deriveRamp(HAIR_COLOR_BASES[1]),
  blonde: deriveRamp(HAIR_COLOR_BASES[2]),
  auburn: deriveRamp(HAIR_COLOR_BASES[3]),
  greying: deriveRamp(HAIR_COLOR_BASES[4]),
  white: deriveRamp(HAIR_COLOR_BASES[5]),
  ginger: deriveRamp(HAIR_COLOR_BASES[6]),
};

/** Worn leather shoes, dark enough to part from any trouser colour at the tile. */
const DEFAULT_SHOE_COLOR = '#3a2a1e';

interface AdultSpec {
  readonly id: string;
  readonly build: Exclude<TownCastBuild, 'child'>;
  readonly roles: ReadonlyArray<TownRole>;
  readonly hasWork: boolean;
  readonly pantsColor: string;
  readonly shoeColor?: string;
  readonly skin: SkinTone;
  readonly hair: HairColour;
  readonly hairStyle: HairStyleKind;
  readonly facialHair?: FacialHairKind;
  readonly garmentColor: string;
  readonly cut: GarmentCut;
  readonly accessory: AccessorySpec;
  /** A softer, unscowled expression, a thinner brow and fuller lips, and a narrower build — never Carl's own face. */
  readonly feminine: boolean;
  readonly details?: TownCastLookDetails;
}

const ADULT_SPECS: readonly AdultSpec[] = [
  {
    id: 'adult_guard',
    build: 'standard',
    roles: ['guard'],
    hasWork: false,
    pantsColor: '#2a2a34',
    shoeColor: '#1e1a1c',
    skin: 'olive',
    hair: 'black',
    hairStyle: 'sidePart',
    facialHair: 'moustache',
    garmentColor: '#3a4a6a',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'tabard', color: '#28344a', accentColor: '#c9c2ad' },
  },
  {
    id: 'adult_merchant',
    build: 'slight',
    roles: ['merchant'],
    hasWork: false,
    pantsColor: '#3a3a4a',
    skin: 'fair',
    hair: 'blonde',
    hairStyle: 'bun',
    garmentColor: '#8e44ad',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'satchel', color: '#5a2a5a', accentColor: '#c9975a' },
  },
  {
    id: 'adult_clerk',
    build: 'slight',
    roles: ['commoner'],
    hasWork: false,
    pantsColor: '#2c3e50',
    skin: 'tan',
    hair: 'lightBrown',
    hairStyle: 'sidePart',
    garmentColor: '#7f8c8d',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'satchel', color: '#4a4a52', accentColor: '#d0d3d4' },
  },
  {
    id: 'adult_laborer',
    build: 'standard',
    roles: ['laborer'],
    hasWork: false,
    pantsColor: '#4a3a2a',
    skin: 'brown',
    hair: 'black',
    hairStyle: 'curly',
    facialHair: 'goatee',
    garmentColor: '#8a7a5a',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'apron', color: '#6a5a44', accentColor: '#4a3a2a' },
  },
  {
    id: 'adult_farmer',
    build: 'standard',
    roles: ['farmer'],
    hasWork: false,
    pantsColor: '#5a4a38',
    shoeColor: '#5a3e24',
    skin: 'deep',
    hair: 'ginger',
    hairStyle: 'receding',
    facialHair: 'fullBeard',
    garmentColor: '#6a7a3a',
    cut: 'tunic',
    feminine: false,
    accessory: { kind: 'brimmedHat', color: '#c9a24a', accentColor: '#8a6a2a' },
  },
  {
    id: 'adult_innkeeper',
    build: 'standard',
    roles: ['innkeeper'],
    hasWork: false,
    pantsColor: '#4a3a2a',
    skin: 'fair',
    hair: 'greying',
    hairStyle: 'bun',
    garmentColor: '#a0522d',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'apron', color: '#e0d0c0', accentColor: '#a0522d' },
  },
  {
    id: 'adult_commoner',
    build: 'standard',
    roles: ['commoner'],
    hasWork: false,
    pantsColor: '#34495e',
    skin: 'tan',
    hair: 'auburn',
    hairStyle: 'long',
    garmentColor: '#16a085',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'none', color: '#000000' },
  },
  {
    id: 'adult_beggar',
    build: 'slight',
    roles: ['beggar', 'drunk'],
    hasWork: false,
    pantsColor: '#3a3a3a',
    skin: 'brown',
    hair: 'greying',
    hairStyle: 'receding',
    facialHair: 'fullBeard',
    garmentColor: '#5a5a5a',
    cut: 'tunic',
    feminine: false,
    accessory: { kind: 'patchedHood', color: '#5a4632', accentColor: '#7a6a4a' },
  },
  {
    id: 'adult_smith',
    build: 'heavy',
    roles: ['smith'],
    hasWork: false,
    pantsColor: '#2a2420',
    skin: 'deep',
    hair: 'black',
    hairStyle: 'bald',
    facialHair: 'fullBeard',
    garmentColor: '#5a4a3a',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'apron', color: '#3a2a22', accentColor: '#8a6a4a' },
  },
  {
    id: 'adult_priest',
    build: 'heavy',
    roles: ['priest'],
    hasWork: false,
    pantsColor: '#2a2430',
    skin: 'fair',
    hair: 'greying',
    hairStyle: 'receding',
    garmentColor: '#2a2430',
    cut: 'robe',
    feminine: false,
    accessory: { kind: 'stole', color: '#d0b060', accentColor: '#e8dcc0' },
  },
  {
    id: 'adult_noble',
    build: 'heavy',
    roles: ['noble'],
    hasWork: false,
    pantsColor: '#2a2a34',
    shoeColor: '#4a2232',
    skin: 'olive',
    hair: 'black',
    hairStyle: 'long',
    garmentColor: '#5a2a5a',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'brimmedHat', color: '#5a2a5a', accentColor: '#e0c060' },
  },
];

function adultLook(spec: AdultSpec, index: number): TownCastLookCarl {
  const widthScale = BUILD_WIDTH_SCALE[spec.build] * (spec.feminine ? FEMININE_WIDTH_SCALE : 1);
  return {
    id: spec.id,
    painter: 'carl',
    build: spec.build,
    roles: spec.roles,
    hasWork: spec.hasWork,
    strideFraction: ADULT_STRIDE_FRACTION,
    feminine: spec.feminine,
    dialogSeed: CHILD_SPECS.length + index,
    buildWidthScale: widthScale,
    skinRamp: SKIN_RAMPS[spec.skin],
    hairRamp: HAIR_RAMPS[spec.hair],
    hairStyle: spec.hairStyle,
    facialHair: spec.facialHair ?? 'none',
    garmentRamp: deriveGlossRamp(spec.garmentColor),
    garmentHemDrop: GARMENT_HEM_DROP[spec.cut],
    garmentHemFlare: GARMENT_HEM_FLARE[spec.cut],
    garmentHasHardware: false,
    legwear: GARMENT_LEGWEAR[spec.cut],
    pantsColor: spec.pantsColor,
    shoeColor: spec.shoeColor ?? DEFAULT_SHOE_COLOR,
    accessory: spec.accessory,
    expression: spec.feminine ? FEMININE_EXPRESSION : MASCULINE_EXPRESSION,
    details: spec.details,
  };
}

const ADULT_LOOKS: readonly TownCastLookCarl[] = ADULT_SPECS.map(adultLook);

/** The club dancer's skin and hair, exported so her look is built from the cast's own swatches. */
export const DANCER_SKIN_RAMP = SKIN_RAMPS.tan;
export const DANCER_HAIR_RAMP = HAIR_RAMPS.black;

// ── Named residents ──────────────────────────────────────────────────────────
//
// One look per named human resident, on the same Carl-rig pipeline the
// street cast dresses on — `roles: []` keeps each out of `pickTownCastLook`'s
// pools, so it is never handed to an unnamed citizen; only `residentLooks.ts`
// looks these up, by id.

const RESIDENT_ADULT_SPECS: readonly AdultSpec[] = [
  {
    // Trained as an architect, earned his living as a builder: a waistcoat
    // over rolled linen shirtsleeves, spectacles, a pencil behind his ear and
    // the folding rule at his belt, and mud on his boots from the pasture he
    // keeps ready. Lean, greying and a little stooped from the drafting table.
    id: 'resident_wendell',
    build: 'slight',
    roles: [],
    hasWork: false,
    pantsColor: WENDELL_TROUSER_COLOR,
    skin: 'fair',
    hair: 'greying',
    hairStyle: 'sidePart',
    garmentColor: '#cfc3a4',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'builderRule', color: '#8a6a3c' },
    details: {
      attachments: WENDELL_ATTACHMENTS,
      posture: wendellPosture,
      muddyShoes: true,
    },
  },
  {
    id: 'resident_old_hilda',
    build: 'slight',
    roles: [],
    hasWork: false,
    pantsColor: '#2a2420',
    skin: 'fair',
    hair: 'white',
    hairStyle: 'headscarf',
    garmentColor: '#3a2e3c',
    cut: 'robe',
    feminine: true,
    accessory: { kind: 'shawlCharms', color: '#6a4a5a', accentColor: '#c9a24a' },
  },
  {
    id: 'resident_marta_miller',
    build: 'standard',
    roles: [],
    hasWork: false,
    pantsColor: '#4a3a2a',
    skin: 'tan',
    hair: 'blonde',
    hairStyle: 'ponytail',
    garmentColor: '#7a6a4a',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'flourApron', color: '#e8dcc0', accentColor: '#c8b89c' },
  },
  {
    id: 'resident_apothecary_fen',
    build: 'slight',
    roles: [],
    hasWork: false,
    pantsColor: '#2c3e50',
    skin: 'olive',
    hair: 'auburn',
    hairStyle: 'long',
    garmentColor: '#7a8a7a',
    cut: 'shirt',
    feminine: true,
    accessory: { kind: 'vialCase', color: '#4a5a4a', accentColor: '#a8c8b8' },
  },
  {
    id: 'resident_innkeep_marlow',
    build: 'heavy',
    roles: [],
    hasWork: false,
    pantsColor: '#3a2a24',
    skin: 'brown',
    hair: 'black',
    hairStyle: 'curly',
    facialHair: 'fullBeard',
    garmentColor: '#4a5a6a',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'apron', color: '#4a3226', accentColor: '#2a1c14' },
  },
  {
    id: 'resident_stock_clerk_wick',
    build: 'slight',
    roles: [],
    hasWork: false,
    pantsColor: '#34495e',
    skin: 'deep',
    hair: 'black',
    hairStyle: 'sidePart',
    facialHair: 'moustache',
    garmentColor: '#8a9aa2',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'ledgerPencil', color: '#8a6a3c', accentColor: '#c9a24a' },
  },
];

const RESIDENT_ADULT_LOOKS: readonly TownCastLookCarl[] = RESIDENT_ADULT_SPECS.map((spec, i) =>
  adultLook(spec, ADULT_SPECS.length + i),
);

// ── The whole set ────────────────────────────────────────────────────────────

export const TOWN_CAST_LOOKS: readonly TownCastLook[] = [
  ...CHILD_LOOKS,
  ...ADULT_LOOKS,
  ...RESIDENT_ADULT_LOOKS,
];

const LOOK_BY_ID: ReadonlyMap<string, TownCastLook> = new Map(
  TOWN_CAST_LOOKS.map((look) => [look.id, look]),
);

export function townCastLook(id: string): TownCastLook {
  const look = LOOK_BY_ID.get(id);
  if (look === undefined) throw new Error(`no town cast look "${id}"`);
  return look;
}

const LOOKS_BY_ROLE = new Map<TownRole, readonly TownCastLook[]>();
for (const look of TOWN_CAST_LOOKS) {
  for (const role of look.roles) {
    const existing = LOOKS_BY_ROLE.get(role) ?? [];
    LOOKS_BY_ROLE.set(role, [...existing, look]);
  }
}

/** Roles with no look of their own borrow the plain commoner set. */
const FALLBACK_ROLE = 'commoner' as const satisfies TownRole;

/** The looks offered for `role` itself, before any variety tier trims them. */
function townCastLooksForRole(role: TownRole): readonly TownCastLook[] {
  return LOOKS_BY_ROLE.get(role) ?? LOOKS_BY_ROLE.get(FALLBACK_ROLE) ?? TOWN_CAST_LOOKS;
}

/** Roles that wear one look pool between them: the looks of the group's first role. */
type TownRoleGroup = readonly [TownRole, ...TownRole[]];

/** How a variety tier trims the human street cast. */
export interface TownCastTierPlan {
  /** Roles that share their lead's looks. A role in no group keeps its own. */
  readonly groups: readonly TownRoleGroup[];
  /**
   * How many of its lead role's looks each role keeps, first authored first.
   * A role with no entry keeps all of them.
   */
  readonly looksPerRole: Readonly<Partial<Record<TownRole, number>>>;
}

/** Everyone not named in `apart`, led by `lead`: the catch-all group of a lean tier. */
function restOfTheTown(lead: TownRole, apart: readonly TownRole[]): TownRoleGroup {
  return [lead, ...TOWN_ROLES.filter((role) => role !== lead && !apart.includes(role))];
}

const ONE_LOOK_PER_ROLE = 1;

function oneLookForEveryRole(): Partial<Record<TownRole, number>> {
  const limits: Partial<Record<TownRole, number>> = {};
  for (const role of TOWN_ROLES) limits[role] = ONE_LOOK_PER_ROLE;
  return limits;
}

const ONE_LOOK_FOR_EVERY_ROLE = oneLookForEveryRole();

const LEAN_CAST_PLAN: TownCastTierPlan = {
  groups: [['guard'], ['child'], restOfTheTown('commoner', ['guard', 'child'])],
  looksPerRole: ONE_LOOK_FOR_EVERY_ROLE,
};

/**
 * The human street cast at each variety tier. A citizen keeps its role, and
 * with it its behaviour and services; only the look it wears is drawn from a
 * smaller set. Guards and children always keep a look of their own, because a
 * guard's livery and a child's height are read as what the citizen is.
 */
export const TOWN_CAST_TIER_PLANS = {
  0: { groups: [], looksPerRole: {} },
  1: { groups: [], looksPerRole: { commoner: ONE_LOOK_PER_ROLE, child: ONE_LOOK_PER_ROLE } },
  2: {
    groups: [
      ['guard'],
      ['child'],
      ['commoner', 'beggar', 'drunk', 'priest'],
      ['laborer', 'farmer', 'smith'],
      ['merchant', 'innkeeper', 'noble'],
    ],
    looksPerRole: ONE_LOOK_FOR_EVERY_ROLE,
  },
  3: LEAN_CAST_PLAN,
  4: LEAN_CAST_PLAN,
} as const satisfies Record<VarietyTier, TownCastTierPlan>;

/** The role whose looks `role` wears under `plan`. */
export function townCastLeadRole(plan: TownCastTierPlan, role: TownRole): TownRole {
  return plan.groups.find((group) => group.includes(role))?.[0] ?? role;
}

function tieredPools(plan: TownCastTierPlan): ReadonlyMap<TownRole, readonly TownCastLook[]> {
  const pools = new Map<TownRole, readonly TownCastLook[]>();
  for (const role of TOWN_ROLES) {
    const leadLooks = townCastLooksForRole(townCastLeadRole(plan, role));
    const limit = plan.looksPerRole[role];
    pools.set(role, limit === undefined ? leadLooks : leadLooks.slice(0, limit));
  }
  return pools;
}

const POOLS_BY_TIER: ReadonlyMap<
  VarietyTier,
  ReadonlyMap<TownRole, readonly TownCastLook[]>
> = new Map(VARIETY_TIERS.map((tier) => [tier, tieredPools(TOWN_CAST_TIER_PLANS[tier])]));

/** Salt for the picker's own stream, so it never correlates with a role bias draw. */
const CAST_PICK_SALT = 0x7a5c11;

/**
 * Deterministically buckets `seed` onto one look offered for `role` at
 * variety `tier`. The *only* place a citizen's seed still touches its look —
 * everything else about how it is drawn comes from the fixed look, not from
 * the seed.
 */
export function pickTownCastLook(seed: number, role: TownRole, tier: VarietyTier): TownCastLook {
  const pool = POOLS_BY_TIER.get(tier)?.get(role) ?? townCastLooksForRole(role);
  const rng = mulberry32(subSeed(seed, CAST_PICK_SALT));
  return pick(rng, pool);
}
