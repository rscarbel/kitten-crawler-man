/**
 * The human cast: a closed set of authored looks, none of them a per-instance
 * random painter. `pickTownCastLook` is the one place a seed still matters —
 * it buckets a citizen's seed onto one look of the set for its role, so two
 * citizens of the same role and a compatible build can land on the same look
 * and share its cache cells.
 *
 * Two painters share the set. Every adult look paints on Carl's own rig
 * (`carl/figure.ts`, `human/idles.ts`/`locomotion.ts`/`actionsMisc.ts`'s pose
 * functions) — the same anatomy, face, hair and hand painting Carl himself is
 * drawn with, dressed in his own gear plus a worn accessory
 * (`human/townAccessories.ts`) for the role cue. The two child looks stay on
 * the simpler skeleton-based painter from `drawPerson.ts`: Carl's rig is one
 * fixed adult's proportions, and a child is not that adult scaled down (a
 * uniform shrink reads as a doll, not a child — the head-count-is-how-size-
 * is-read lesson) — it needs its own larger head fraction and shorter limbs,
 * which only the person painter's parametrised proportions can give it
 * cheaply. `townCastFigure.ts` dispatches on `look.painter`.
 */

import { mulberry32, pick, subSeed } from './rng';
import type { PersonAppearance, PersonBody, PersonHead, TownRole } from './PersonAppearance';
import type { CarlGear } from '../art/carl/gear';
import { deriveGlossRamp, deriveRamp, type GlossRamp, type Ramp } from '../art/carl/palette';
import {
  FACING_BROW_DEFAULT,
  FEMININE_FACING_BROW,
  FEMININE_PROFILE_BROW,
  PROFILE_BROW_DEFAULT,
  type CarlExpression,
} from '../art/carl/head';
import type { AccessorySpec, HairStyleKind } from '../art/human/townAccessories';
import type { CarlAttachments } from '../art/carl/figure';
import type { CarlPose, CarlView } from '../art/carl/rig';
import {
  WENDELL_ATTACHMENTS,
  WENDELL_TROUSER_COLOR,
  wendellBootMud,
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
  readonly posture: (pose: CarlPose, view: CarlView) => CarlPose;
  readonly overShoes: (ctx: CanvasRenderingContext2D, view: CarlView, pose: CarlPose) => void;
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
  readonly gear: CarlGear;
  readonly skinRamp: Ramp;
  readonly hairRamp: Ramp;
  readonly hairStyle: HairStyleKind;
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
  /** `'none'` for a dress/skirt cut, whose own hem already covers the legs. */
  readonly legwear: 'trousers' | 'none';
  /** Covers Carl's own bare legs — his canon look, not the rig's — with a role-appropriate trouser colour. Unused when `legwear` is `'none'`. */
  readonly pantsColor: string;
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
/** A dress/skirt hem already covers the legs down to mid-shin; every other cut needs trousers under it. */
/**
 * `robe`'s own hem already reaches near the ankle — the same length trousers
 * would — so drawing trousers under one hides the robe's own hem under
 * opaque trouser fabric rather than layering under it. `shirt`/`tunic` stop
 * well above the ankle and need trousers to cover the rest of the leg.
 */
const GARMENT_LEGWEAR: Readonly<Record<GarmentCut, 'trousers' | 'none'>> = {
  shirt: 'trousers',
  tunic: 'trousers',
  robe: 'none',
  dress: 'none',
};

/** Four skin tones beyond Carl's own default, so five in total. */
const SKIN_TONE_BASES = ['#f0c9a0', '#c78a5a', '#8a5a34', '#5a3a22'] as const;
/**
 * Carl's own default brown plus these. The last is a salt-and-pepper
 * grey-brown, the one middle-aged head in the set.
 */
const HAIR_COLOR_BASES = ['#1a1512', '#8a6a3a', '#c9a850', '#6a2a20', '#8c857a'] as const;
const GREYING_HAIR = HAIR_COLOR_BASES.length;

const SKIN_RAMPS: readonly Ramp[] = [
  {
    deep: '#5c2d35',
    shadow: '#8b4a42',
    dark: '#b0654e',
    mid: '#c27a5a',
    base: '#d89c76',
    light: '#f0cba3',
    rim: '#fae9c6',
  },
  ...SKIN_TONE_BASES.map(deriveRamp),
];
const HAIR_RAMPS: readonly Ramp[] = [
  {
    deep: '#2a1316',
    shadow: '#421e1a',
    dark: '#5c2e1f',
    mid: '#784326',
    base: '#975b2b',
    light: '#b97d38',
    rim: '#d8ae5a',
  },
  ...HAIR_COLOR_BASES.map(deriveRamp),
];

interface AdultSpec {
  readonly id: string;
  readonly build: Exclude<TownCastBuild, 'child'>;
  readonly roles: ReadonlyArray<TownRole>;
  readonly hasWork: boolean;
  readonly cloak: boolean;
  readonly pantsColor: string;
  readonly skin: number;
  readonly hair: number;
  readonly hairStyle: HairStyleKind;
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
    cloak: false,
    pantsColor: '#2a2a34',
    skin: 0,
    hair: 0,
    hairStyle: 'short',
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
    cloak: false,
    pantsColor: '#3a3a4a',
    skin: 1,
    hair: 2,
    hairStyle: 'long',
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
    cloak: false,
    pantsColor: '#2c3e50',
    skin: 2,
    hair: 1,
    hairStyle: 'short',
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
    cloak: false,
    pantsColor: '#4a3a2a',
    skin: 3,
    hair: 1,
    hairStyle: 'curly',
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
    cloak: false,
    pantsColor: '#5a4a38',
    skin: 4,
    hair: 3,
    hairStyle: 'short',
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
    cloak: false,
    pantsColor: '#4a3a2a',
    skin: 1,
    hair: 4,
    hairStyle: 'long',
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
    cloak: false,
    pantsColor: '#34495e',
    skin: 2,
    hair: 3,
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
    cloak: false,
    pantsColor: '#3a3a3a',
    skin: 3,
    hair: 0,
    hairStyle: 'curly',
    garmentColor: '#5a5a5a',
    cut: 'tunic',
    feminine: false,
    accessory: { kind: 'patchedHood', color: '#4a4a4a', accentColor: '#6a5a3a' },
  },
  {
    id: 'adult_smith',
    build: 'heavy',
    roles: ['smith'],
    hasWork: false,
    cloak: false,
    pantsColor: '#2a2420',
    skin: 4,
    hair: 0,
    hairStyle: 'bald',
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
    cloak: true,
    pantsColor: '#2a2430',
    skin: 1,
    hair: 3,
    hairStyle: 'bald',
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
    cloak: true,
    pantsColor: '#2a2a34',
    skin: 0,
    hair: 2,
    hairStyle: 'long',
    garmentColor: '#5a2a5a',
    cut: 'dress',
    feminine: true,
    accessory: { kind: 'brimmedHat', color: '#5a2a5a', accentColor: '#e0c060' },
  },
];

function adultLook(spec: AdultSpec, index: number): TownCastLookCarl {
  const gear: CarlGear = { trollskinShirt: true, cloak: spec.cloak };
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
    gear,
    skinRamp: SKIN_RAMPS[spec.skin],
    hairRamp: HAIR_RAMPS[spec.hair],
    hairStyle: spec.hairStyle,
    garmentRamp: deriveGlossRamp(spec.garmentColor),
    garmentHemDrop: GARMENT_HEM_DROP[spec.cut],
    garmentHemFlare: GARMENT_HEM_FLARE[spec.cut],
    garmentHasHardware: false,
    legwear: GARMENT_LEGWEAR[spec.cut],
    pantsColor: spec.pantsColor,
    accessory: spec.accessory,
    expression: spec.feminine ? FEMININE_EXPRESSION : MASCULINE_EXPRESSION,
    details: spec.details,
  };
}

const ADULT_LOOKS: readonly TownCastLookCarl[] = ADULT_SPECS.map(adultLook);

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
    cloak: false,
    pantsColor: WENDELL_TROUSER_COLOR,
    skin: 1,
    hair: GREYING_HAIR,
    hairStyle: 'short',
    garmentColor: '#cfc3a4',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'builderRule', color: '#8a6a3c' },
    details: {
      attachments: WENDELL_ATTACHMENTS,
      posture: wendellPosture,
      overShoes: wendellBootMud,
    },
  },
  {
    id: 'resident_old_hilda',
    build: 'slight',
    roles: [],
    hasWork: false,
    cloak: false,
    pantsColor: '#2a2420',
    skin: 1,
    hair: 2,
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
    cloak: false,
    pantsColor: '#4a3a2a',
    skin: 2,
    hair: 3,
    hairStyle: 'long',
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
    cloak: false,
    pantsColor: '#2c3e50',
    skin: 0,
    hair: 4,
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
    cloak: false,
    pantsColor: '#3a2a24',
    skin: 3,
    hair: 0,
    hairStyle: 'curly',
    garmentColor: '#6a3a2a',
    cut: 'shirt',
    feminine: false,
    accessory: { kind: 'apron', color: '#4a3226', accentColor: '#2a1c14' },
  },
  {
    id: 'resident_stock_clerk_wick',
    build: 'slight',
    roles: [],
    hasWork: false,
    cloak: false,
    pantsColor: '#34495e',
    skin: 4,
    hair: 0,
    hairStyle: 'short',
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
const FALLBACK_ROLE: TownRole = 'commoner';

/** Salt for the picker's own stream, so it never correlates with a role bias draw. */
const CAST_PICK_SALT = 0x7a5c11;

/**
 * Deterministically buckets `seed` onto one look offered for `role`. The
 * *only* place a citizen's seed still touches its look — everything else
 * about how it is drawn comes from the fixed look, not from the seed.
 */
export function pickTownCastLook(seed: number, role: TownRole): TownCastLook {
  const pool = LOOKS_BY_ROLE.get(role) ?? LOOKS_BY_ROLE.get(FALLBACK_ROLE) ?? TOWN_CAST_LOOKS;
  const rng = mulberry32(subSeed(seed, CAST_PICK_SALT));
  return pick(rng, pool);
}
