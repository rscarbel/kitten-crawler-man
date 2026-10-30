/**
 * The builder behind Taloncrest's town cats. Each town cat is a short spec —
 * her coat tones, tabby stripes, white markings, hand-placed patches, eyes and
 * build — and this turns it into a whole `CatLook` on one shared short-haired
 * frame, so seven cats do not each repeat every layout the painters read.
 *
 * Every mark a spec or the stripe tables author is in shares of the radii of
 * the part it sits on (the head-on leg column excepted: tile units across it,
 * shares of its length down it, as the layout itself is), so the same stripe
 * table fits a slim cat and a fat one.
 */

import { deg, lerp, type CoatBlob, type CoatLayout, type CoatTone } from '../../art/catArt';
import { CAT_COAT } from '../../garments/cat/catCoat';
import type { StatusFigureBox } from '../../../Player';
import type {
  CatFace,
  CatFlankCoat,
  CatFur,
  CatIris,
  CatLook,
  CatProportions,
  CatRadii,
  CatTooth,
} from '../catLook';

/** The way her stripes lie: `mackerel`, narrow upright bands; `classic`, a bullseye swirl on each flank. */
export type TabbyPattern = 'mackerel' | 'classic';

export interface TabbyMarkings {
  readonly pattern: TabbyPattern;
  readonly tone: CoatTone;
  /** Multiplies every stripe's thickness: under the 32 px tile a thin stripe is mush. */
  readonly boldness: number;
}

/** White spotting over her coat, painted over every stripe and patch. */
export interface WhiteMarkings {
  readonly tone: CoatTone;
  /** Multiplies the size of the white bib on her chest; 0 for none. */
  readonly bib: number;
  readonly belly: boolean;
  /** How far up each leg her white reaches, as a share of the leg; 0 for none. */
  readonly socks: number;
  /** Multiplies the size of the white over her chin and muzzle; 0 for none. */
  readonly chin: number;
  /** A white stripe up her face between the eyes. */
  readonly blaze: boolean;
}

/** Every layout a spec may lay hand-placed patches on. */
export type PatchSite =
  | 'chest'
  | 'back'
  | 'haunch'
  | 'face'
  | 'backOfHead'
  | 'earFront'
  | 'earBack'
  | 'rightBarrel'
  | 'leftBarrel'
  | 'rightHaunch'
  | 'leftHaunch'
  | 'rightChest'
  | 'leftChest'
  | 'rightHead'
  | 'leftHead'
  | 'limb'
  | 'legColumn';

/** Patches by the layout they sit on, painted over her stripes and under her white. */
export type CoatPatches = Partial<Record<PatchSite, readonly CoatBlob[]>>;

/** Her build against the shared frame. */
export interface TownCatBuild {
  /** 0 a slim shorthair, 1 a comfortably chubby one, past 1 fatter still. */
  readonly bulk: number;
  /** Multiplies every part's size: under 1 a small cat. */
  readonly size: number;
  /** Multiplies her head, on top of `size`. */
  readonly head: number;
  /** Multiplies her ears, on top of her head. */
  readonly ears: number;
  /** Multiplies her leg bones, on top of `size`. */
  readonly legs: number;
  /** Multiplies her tail's length, on top of `size`. */
  readonly tail: number;
  /**
   * Tile units added to how far her legs hold her up: a smaller body leaves
   * more leg under it, which a negative lift takes back.
   */
  readonly lift: number;
}

/** How her coat lies: `short`, sleek; `scruffy`, a rough fringe breaking every outline and her cheeks. */
export type TownCatFur = 'short' | 'scruffy';

export interface TownCatTail {
  readonly base: CoatTone;
  readonly rings: readonly [CoatTone, ...CoatTone[]];
}

export interface TownCatSpec<Id extends string> {
  readonly id: Id;
  readonly coat: CoatTone;
  readonly ear: CoatTone;
  /** A paler tone under her belly, chest and chin; null for a coat the same all over. */
  readonly underside: CoatTone | null;
  readonly tabby: TabbyMarkings | null;
  readonly patches: CoatPatches;
  readonly white: WhiteMarkings | null;
  readonly tail: TownCatTail;
  /** The tone of her whisker pads where no white covers them. */
  readonly muzzle: CoatTone;
  readonly iris: CatIris;
  readonly nose: CatFace['nose'];
  readonly innerEar: CatFace['innerEar'];
  readonly tooth: CatTooth | null;
  readonly build: TownCatBuild;
  readonly fur: TownCatFur;
  /**
   * A coat dark enough to vanish into a dark floor at the tile: she gets a
   * light line round her silhouette and cool rims on her legs and tail.
   */
  readonly dark: boolean;
  /** Measured off her painted idle cell. */
  readonly statusFigureBox: StatusFigureBox;
}

// ── Proportions ──────────────────────────────────────────────────────────────

/** The parts of her build that thicken as she grows chubbier. */
type BulkMeasures = Pick<
  CatProportions,
  | 'body'
  | 'profileBody'
  | 'haunch'
  | 'profileChest'
  | 'belly'
  | 'legLift'
  | 'neckDrop'
  | 'legs'
  | 'ruff'
  | 'bladeRise'
  | 'limbWidth'
  | 'pawScale'
  | 'hindPawSpread'
>;

/** A slim, soft-bodied shorthair standing up on long legs. */
const SLIM: BulkMeasures = {
  body: { rx: 0.215, ry: 0.215, sittingRx: 0.21, sittingRy: 0.26 },
  profileBody: { rx: 0.35, ry: 0.17 },
  haunch: {
    headOn: { rx: 0.09, ry: 0.1 },
    headOnStandingShare: 0.55,
    back: { rx: 0.08, ry: 0.1 },
    profile: { rx: 0.165, ry: 0.16 },
  },
  profileChest: { rx: 0.13, ry: 0.14 },
  belly: { widthShare: 0.5, ry: 0.045 },
  legLift: { headOn: 0.13, profile: 0.13 },
  neckDrop: { headOn: 0.2, profile: 0.12 },
  legs: { foreUpper: 0.19, foreLower: 0.19, hindUpper: 0.2, hindLower: 0.205 },
  ruff: { rx: 0.2, ry: 0.1 },
  bladeRise: 0.06,
  limbWidth: 1.12,
  pawScale: 0.72,
  hindPawSpread: 0.6,
};

/** A comfortably chubby cat, low-slung on short legs, her haunches spread wide of her. */
const CHUBBY: BulkMeasures = {
  body: { rx: 0.34, ry: 0.28, sittingRx: 0.29, sittingRy: 0.32 },
  profileBody: { rx: 0.36, ry: 0.235 },
  haunch: {
    headOn: { rx: 0.155, ry: 0.145 },
    headOnStandingShare: 1,
    back: { rx: 0.165, ry: 0.15 },
    profile: { rx: 0.2, ry: 0.19 },
  },
  profileChest: { rx: 0.165, ry: 0.175 },
  belly: { widthShare: 0.62, ry: 0.1 },
  legLift: { headOn: 0, profile: 0 },
  neckDrop: { headOn: 0, profile: 0 },
  legs: { foreUpper: 0.16, foreLower: 0.17, hindUpper: 0.19, hindLower: 0.2 },
  ruff: { rx: 0.29, ry: 0.155 },
  bladeRise: 0,
  limbWidth: 1,
  pawScale: 1,
  hindPawSpread: 1,
};

function lerpRadii(a: CatRadii, b: CatRadii, t: number, scale: number): CatRadii {
  return { rx: lerp(a.rx, b.rx, t) * scale, ry: lerp(a.ry, b.ry, t) * scale };
}

/** Her build `bulk` of the way from slim to chubby, every radius and bone times `size`. */
function bulkMeasures(bulk: number, size: number, legs: number, lift: number): BulkMeasures {
  const a = SLIM;
  const b = CHUBBY;
  const at = (from: number, to: number): number => lerp(from, to, bulk);
  const sized = (from: number, to: number): number => at(from, to) * size;
  const bone = (from: number, to: number): number => sized(from, to) * legs;
  return {
    body: {
      rx: sized(a.body.rx, b.body.rx),
      ry: sized(a.body.ry, b.body.ry),
      sittingRx: sized(a.body.sittingRx, b.body.sittingRx),
      sittingRy: sized(a.body.sittingRy, b.body.sittingRy),
    },
    profileBody: lerpRadii(a.profileBody, b.profileBody, bulk, size),
    haunch: {
      headOn: lerpRadii(a.haunch.headOn, b.haunch.headOn, bulk, size),
      headOnStandingShare: at(a.haunch.headOnStandingShare, b.haunch.headOnStandingShare),
      back: lerpRadii(a.haunch.back, b.haunch.back, bulk, size),
      profile: lerpRadii(a.haunch.profile, b.haunch.profile, bulk, size),
    },
    profileChest: lerpRadii(a.profileChest, b.profileChest, bulk, size),
    belly: {
      widthShare: at(a.belly.widthShare, b.belly.widthShare),
      ry: sized(a.belly.ry, b.belly.ry),
    },
    legLift: {
      headOn: at(a.legLift.headOn, b.legLift.headOn) + lift,
      profile: at(a.legLift.profile, b.legLift.profile) + lift,
    },
    neckDrop: {
      headOn: at(a.neckDrop.headOn, b.neckDrop.headOn),
      profile: at(a.neckDrop.profile, b.neckDrop.profile),
    },
    legs: {
      foreUpper: bone(a.legs.foreUpper, b.legs.foreUpper),
      foreLower: bone(a.legs.foreLower, b.legs.foreLower),
      hindUpper: bone(a.legs.hindUpper, b.legs.hindUpper),
      hindLower: bone(a.legs.hindLower, b.legs.hindLower),
    },
    ruff: lerpRadii(a.ruff, b.ruff, bulk, size),
    bladeRise: at(a.bladeRise, b.bladeRise),
    limbWidth: at(a.limbWidth, b.limbWidth) * size,
    pawScale: at(a.pawScale, b.pawScale) * size,
    hindPawSpread: at(a.hindPawSpread, b.hindPawSpread),
  };
}

const HEAD: CatRadii = { rx: 0.2, ry: 0.185 };
const PROFILE_HEAD: CatRadii = { rx: 0.168, ry: 0.185 };
const CHEEK: CatRadii = { rx: 0.135, ry: 0.112 };
const EAR_HALF_WIDTH = 0.1;
const EAR_HEIGHT = 0.16;
const TAIL_LENGTH = 0.56;
const TAIL_BASE_WIDTH = 0.065;
const TAIL_TIP_WIDTH = 0.045;
/** A chubby cat's tail is thicker at the root as well as longer in the body. */
const CHUBBY_TAIL_THICKENING = 1.2;

function scaledRadii(r: CatRadii, scale: number): CatRadii {
  return { rx: r.rx * scale, ry: r.ry * scale };
}

function proportionsOf(build: TownCatBuild): CatProportions {
  const headScale = build.size * build.head;
  const earScale = headScale * build.ears;
  const tailWidth = build.size * lerp(1, CHUBBY_TAIL_THICKENING, build.bulk);
  return {
    ...bulkMeasures(build.bulk, build.size, build.legs, build.lift),
    head: scaledRadii(HEAD, headScale),
    profileHead: scaledRadii(PROFILE_HEAD, headScale),
    ear: {
      halfWidth: EAR_HALF_WIDTH * earScale,
      height: EAR_HEIGHT * earScale,
      lean: deg(30),
      straightEdges: 0.3,
    },
    cheek: scaledRadii(CHEEK, headScale),
    tail: {
      length: TAIL_LENGTH * build.size * build.tail,
      baseWidth: TAIL_BASE_WIDTH * tailWidth,
      tipWidth: TAIL_TIP_WIDTH * tailWidth,
      swell: 0.3,
    },
    profileLength: 1.05,
    muzzleWidth: 1,
    profileMuzzle: 0.9,
    profileEarWidth: 1.05,
    noseDrop: 0.035,
    profileEars: 'sideOn',
    earSpread: 1.12,
    hindHock: { share: 0.45, thigh: 1.35 },
    backView: {
      headScale: 1,
      headHeight: 0.96,
      earHeight: 1,
      earInset: 0.1,
      nape: 0.7,
      tailOverNape: true,
    },
    profileEarHeight: 0.85,
    pupilScale: 1.05,
    chinTaper: 0.05,
  };
}

// ── Marks ────────────────────────────────────────────────────────────────────

/** A mark in shares of its part's radii: what the stripe tables and every spec's patches are authored as. */
export interface Mark {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

/** Each mark of a tabby table is a stripe, or ground tone laid back over stripe: a classic swirl's ring. */
interface StripeMark extends Mark {
  readonly ink: 'stripe' | 'ground';
}

/** Stripes keep a slightly soft edge, crisp enough to stay stripes at the tile. */
const STRIPE_FEATHER = 0.35;
/** White spotting is sharp-edged on a real cat, with a little softness from the hair. */
const WHITE_FEATHER = 0.3;
/** A paler underside shades into the coat over most of its radius. */
const UNDERSIDE_FEATHER = 0.8;
/** Stops two layouts' marks sharing a wobble. */
const MARK_SEED_STRIDE = 1.37;

/** Blobs authored in shares of a part's radii, placed on that part in its layout's own units. */
function placeOn(blobs: readonly CoatBlob[], radii: CatRadii): CoatBlob[] {
  return blobs.map((blob) => ({
    ...blob,
    x: blob.x * radii.rx,
    y: blob.y * radii.ry,
    rx: blob.rx * radii.rx,
    ry: blob.ry * radii.ry,
  }));
}

/** Marks in one tone, as blobs still in shares of their part's radii. */
function inked(marks: readonly Mark[], tone: CoatTone, feather: number, seed: number): CoatBlob[] {
  return marks.map((mark, i) => ({
    x: mark.x,
    y: mark.y,
    rx: mark.rx,
    ry: mark.ry,
    tone,
    seed: seed + i * MARK_SEED_STRIDE,
    feather,
  }));
}

/** Thickens a stripe across its narrow axis, leaving its length alone. */
function thickened(mark: StripeMark, boldness: number): StripeMark {
  return mark.rx < mark.ry
    ? { ...mark, rx: mark.rx * boldness }
    : { ...mark, ry: mark.ry * boldness };
}

/** The layouts a tabby table lays stripes on. */
type StripeSite =
  | 'chest'
  | 'back'
  | 'haunch'
  | 'face'
  | 'backOfHead'
  | 'profileBarrel'
  | 'profileHaunch'
  | 'profileChest'
  | 'profileHead'
  | 'limb'
  | 'legColumn';

const stripe = (x: number, y: number, rx: number, ry: number): StripeMark => ({
  x,
  y,
  rx,
  ry,
  ink: 'stripe',
});
const ground = (x: number, y: number, rx: number, ry: number): StripeMark => ({
  x,
  y,
  rx,
  ry,
  ink: 'ground',
});

/** The marks every tabby shares: the M on her brow, her necklaces, barred legs and the lines down her head. */
const SHARED_TABBY = {
  chest: [stripe(0, 0.05, 0.6, 0.1), stripe(0, 0.42, 0.5, 0.1)],
  face: [
    stripe(-0.24, -0.62, 0.06, 0.2),
    stripe(0, -0.66, 0.06, 0.24),
    stripe(0.24, -0.62, 0.06, 0.2),
    stripe(-0.66, 0.12, 0.2, 0.06),
    stripe(0.66, 0.12, 0.2, 0.06),
  ],
  backOfHead: [
    stripe(-0.3, -0.2, 0.07, 0.42),
    stripe(0, -0.25, 0.07, 0.5),
    stripe(0.3, -0.2, 0.07, 0.42),
    stripe(0, 1.4, 0.12, 0.5),
  ],
  profileHead: [
    stripe(0.05, -0.72, 0.07, 0.2),
    stripe(-0.22, -0.62, 0.07, 0.2),
    stripe(-0.2, 0.15, 0.32, 0.06),
  ],
  limb: [stripe(0, 0.3, 1.3, 0.07), stripe(0, 0.6, 1.3, 0.07)],
  legColumn: [stripe(0, 0.32, 0.06, 0.05), stripe(0, 0.58, 0.06, 0.05)],
} as const satisfies Partial<Record<StripeSite, readonly StripeMark[]>>;

/** Each pattern's stripes on every site it marks. */
const TABBY_STRIPES: Readonly<
  Record<TabbyPattern, Readonly<Record<StripeSite, readonly StripeMark[]>>>
> = {
  mackerel: {
    ...SHARED_TABBY,
    back: [
      stripe(0, -0.1, 0.09, 0.85),
      stripe(-0.4, -0.35, 0.22, 0.07),
      stripe(0.4, -0.35, 0.22, 0.07),
      stripe(-0.45, 0.05, 0.24, 0.07),
      stripe(0.45, 0.05, 0.24, 0.07),
      stripe(-0.4, 0.45, 0.22, 0.07),
      stripe(0.4, 0.45, 0.22, 0.07),
    ],
    haunch: [stripe(0, -0.3, 0.7, 0.12), stripe(0, 0.25, 0.7, 0.12)],
    profileBarrel: [
      stripe(0, -0.86, 0.9, 0.16),
      stripe(-0.66, -0.25, 0.07, 0.6),
      stripe(-0.36, -0.2, 0.07, 0.65),
      stripe(-0.06, -0.2, 0.07, 0.65),
      stripe(0.24, -0.22, 0.07, 0.62),
      stripe(0.54, -0.28, 0.07, 0.55),
    ],
    profileHaunch: [stripe(-0.25, -0.15, 0.12, 0.7), stripe(0.2, -0.05, 0.12, 0.65)],
    profileChest: [stripe(-0.2, -0.2, 0.12, 0.55), stripe(0.25, 0.1, 0.45, 0.1)],
  },
  classic: {
    ...SHARED_TABBY,
    back: [
      stripe(-0.12, -0.05, 0.06, 0.8),
      stripe(0, -0.05, 0.06, 0.85),
      stripe(0.12, -0.05, 0.06, 0.8),
      stripe(-0.42, -0.45, 0.22, 0.16),
      stripe(0.42, -0.45, 0.22, 0.16),
      stripe(-0.5, 0.25, 0.25, 0.28),
      ground(-0.5, 0.25, 0.13, 0.15),
      stripe(0.5, 0.25, 0.25, 0.28),
      ground(0.5, 0.25, 0.13, 0.15),
    ],
    haunch: [stripe(0, 0, 0.75, 0.6), ground(0, 0, 0.42, 0.32)],
    profileBarrel: [
      stripe(0, -0.86, 0.9, 0.16),
      stripe(-0.05, -0.05, 0.42, 0.62),
      ground(-0.05, -0.05, 0.27, 0.38),
      stripe(-0.05, -0.05, 0.12, 0.16),
      stripe(0.62, -0.25, 0.08, 0.55),
    ],
    profileHaunch: [stripe(0, -0.05, 0.6, 0.6), ground(0, -0.05, 0.34, 0.34)],
    profileChest: [stripe(-0.15, -0.25, 0.14, 0.5), stripe(0.25, 0.1, 0.45, 0.1)],
  },
};

function stripesOn(
  tabby: TabbyMarkings | null,
  site: StripeSite,
  coat: CoatTone,
  seed: number,
): CoatBlob[] {
  if (tabby === null) return [];
  return TABBY_STRIPES[tabby.pattern][site].map((mark, i) => {
    const { x, y, rx, ry } = thickened(mark, tabby.boldness);
    return {
      x,
      y,
      rx,
      ry,
      tone: mark.ink === 'stripe' ? tabby.tone : coat,
      seed: seed + i * MARK_SEED_STRIDE,
      feather: STRIPE_FEATHER,
    };
  });
}

// ── White and underside ──────────────────────────────────────────────────────

/** Where a white bib, belly, chin and blaze lie on each layout, at a bib or chin size of 1. */
const WHITE = {
  chestBib: { x: 0, y: -0.05, rx: 0.5, ry: 0.65 },
  chestBelly: { x: 0, y: 0.95, rx: 0.65, ry: 0.35 },
  profileBarrelBelly: { x: 0.1, y: 1.05, rx: 0.6, ry: 0.28 },
  profileChestBib: { x: 0.45, y: 0.35, rx: 0.6, ry: 0.7 },
  faceChin: { x: 0, y: 0.6, rx: 0.42, ry: 0.32 },
  faceBlaze: { x: 0, y: -0.2, rx: 0.09, ry: 0.55 },
  profileHeadChin: { x: 0.55, y: 0.55, rx: 0.45, ry: 0.3 },
  profileHeadBlaze: { x: 0.62, y: -0.28, rx: 0.32, ry: 0.1 },
  cheekLower: { x: 0, y: 0.8, rx: 1, ry: 0.6 },
} as const satisfies Record<string, Mark>;

const LEG_COLUMN_SOCK_HALF_WIDTH = 0.08;
/** A chin this size or larger spreads white onto her lower cheeks too. */
const CHIN_REACHES_CHEEKS = 1;

/** Where her paler underside lies on each layout. */
const UNDERSIDE = {
  chest: { x: 0, y: 0.7, rx: 0.6, ry: 0.45 },
  profileBarrel: { x: 0, y: 0.85, rx: 0.8, ry: 0.32 },
  profileChest: { x: 0.35, y: 0.45, rx: 0.6, ry: 0.55 },
  face: { x: 0, y: 0.6, rx: 0.35, ry: 0.25 },
  profileHead: { x: 0.5, y: 0.55, rx: 0.4, ry: 0.25 },
} as const satisfies Record<string, Mark>;

function sizedMark(mark: Mark, scale: number): Mark {
  return { ...mark, rx: mark.rx * scale, ry: mark.ry * scale };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

/** Radii for a layout whose units are already shares or tile units: ears, cheeks, leg segments, leg columns. */
const UNIT: CatRadii = { rx: 1, ry: 1 };

/** What one layout paints over her coat, bottom to top. */
interface Layers {
  readonly under?: Mark;
  readonly stripes?: StripeSite;
  readonly patch?: PatchSite;
  readonly white?: readonly Mark[];
}

const LIGHT_OUTLINE = '#cfc6b8';
const COOL_RIM_LIGHT = '#7d8ea2';
const WHISKER_LIGHT = '#f2ede4';
/** The dark of the lines on her face, whatever her coat: a pale cat's lids still have to read. */
const FACE_INK = '#16110e';
const PUPIL = '#0a0908';
const GLINT = '#ffffff';
const MOUTH = '#2a1416';
const TONGUE = '#d88a92';
const FANG = '#f8f4ee';
const CLAW = '#e8e0d4';
/** A white paw's beans are pink; a coloured one's take her nose's dark. */
const PINK_TOE_BEAN = '#d98c94';

const SHORT_FUR: CatFur = {
  hairLength: 0.08,
  fringe: 0.02,
  ruff: false,
  cheekRuffs: false,
  tailPuff: 0.25,
};
const SCRUFFY_FUR: CatFur = {
  hairLength: 0.75,
  fringe: 0.85,
  ruff: false,
  cheekRuffs: true,
  tailPuff: 0.4,
};
const FUR: Readonly<Record<TownCatFur, CatFur>> = { short: SHORT_FUR, scruffy: SCRUFFY_FUR };

/** Her far legs sink this far into her body's shadow; a dark coat needs more to tell them from the near pair. */
const FAR_LIMB_SHADE_DARK = 0.55;
const FAR_LIMB_SHADE_LIGHT = 0.3;
const OUTLINE_ALPHA = 0.6;
const OUTLINE_WIDTH_PX = 1.5;
const LEG_RIM_ALPHA = 0.12;
const TAIL_RIM_ALPHA = 0.28;

/** Seeds for each layout's marks, so no two layouts share a wobble. */
const SEED = {
  chest: 1,
  back: 2,
  haunch: 3,
  ruff: 4,
  face: 5,
  backOfHead: 6,
  cheek: 7,
  legColumn: 8,
  ear: 9,
  barrel: 10,
  profileHaunch: 11,
  profileChest: 12,
  profileHead: 13,
  limb: 14,
} as const satisfies Record<string, number>;
/** Offsets her left flank's seeds from her right's. */
const LEFT_FLANK_SEED = 20;

/** A whole `CatLook` for one town cat. */
export function townCatLook<Id extends string>(
  spec: TownCatSpec<Id>,
): CatLook & { readonly id: Id } {
  const proportions = proportionsOf(spec.build);
  const white = spec.white;
  const bib = white?.bib ?? 0;
  const chin = white?.chin ?? 0;
  const socks = white?.socks ?? 0;
  const whiteBelly = white?.belly === true;
  const whiteBlaze = white?.blaze === true;
  const whiteTone = white?.tone ?? spec.coat;
  const undersideTone = spec.underside ?? spec.coat;

  const only = (wanted: boolean, mark: Mark): Mark[] => (wanted ? [mark] : []);
  const chestWhite = [
    ...only(bib > 0, sizedMark(WHITE.chestBib, bib)),
    ...only(whiteBelly, WHITE.chestBelly),
  ];
  const faceWhite = [
    ...only(chin > 0, sizedMark(WHITE.faceChin, chin)),
    ...only(whiteBlaze, WHITE.faceBlaze),
  ];
  const profileHeadWhite = [
    ...only(chin > 0, sizedMark(WHITE.profileHeadChin, chin)),
    ...only(whiteBlaze, WHITE.profileHeadBlaze),
  ];
  const profileChestWhite = only(bib > 0, sizedMark(WHITE.profileChestBib, bib));
  const legColumnSock = only(socks > 0, {
    x: 0,
    y: 1,
    rx: LEG_COLUMN_SOCK_HALF_WIDTH,
    ry: socks,
  });

  const layout = (radii: CatRadii, seed: number, layers: Layers): CoatLayout => {
    const under =
      spec.underside === null || layers.under === undefined
        ? []
        : inked([layers.under], spec.underside, UNDERSIDE_FEATHER, seed);
    const stripes =
      layers.stripes === undefined ? [] : stripesOn(spec.tabby, layers.stripes, spec.coat, seed);
    const patches = layers.patch === undefined ? [] : (spec.patches[layers.patch] ?? []);
    const whites = inked(layers.white ?? [], whiteTone, WHITE_FEATHER, seed);
    return {
      base: spec.coat,
      blobs: placeOn([...under, ...stripes, ...patches, ...whites], radii),
    };
  };
  const solid = (tone: CoatTone): CoatLayout => ({ base: tone, blobs: [] });

  const flank = (side: 'right' | 'left'): CatFlankCoat => {
    const offset = side === 'left' ? LEFT_FLANK_SEED : 0;
    return {
      barrel: layout(proportions.profileBody, SEED.barrel + offset, {
        under: UNDERSIDE.profileBarrel,
        stripes: 'profileBarrel',
        patch: side === 'left' ? 'leftBarrel' : 'rightBarrel',
        white: only(whiteBelly, WHITE.profileBarrelBelly),
      }),
      haunch: layout(proportions.haunch.profile, SEED.profileHaunch + offset, {
        stripes: 'profileHaunch',
        patch: side === 'left' ? 'leftHaunch' : 'rightHaunch',
      }),
      chest: layout(proportions.profileChest, SEED.profileChest + offset, {
        under: UNDERSIDE.profileChest,
        stripes: 'profileChest',
        patch: side === 'left' ? 'leftChest' : 'rightChest',
        white: profileChestWhite,
      }),
      head: layout(proportions.profileHead, SEED.profileHead + offset, {
        under: UNDERSIDE.profileHead,
        stripes: 'profileHead',
        patch: side === 'left' ? 'leftHead' : 'rightHead',
        white: profileHeadWhite,
      }),
      muzzle: solid(chin > 0 ? whiteTone : undersideTone),
    };
  };

  const cheek = layout(UNIT, SEED.cheek, {
    white: only(chin >= CHIN_REACHES_CHEEKS, WHITE.cheekLower),
  });
  const pawTone = socks > 0 ? whiteTone : spec.coat;
  const rim = spec.dark ? { colour: COOL_RIM_LIGHT, alpha: TAIL_RIM_ALPHA } : null;

  return {
    id: spec.id,
    wearer: 'cat',
    baseGarments: [CAT_COAT],
    coat: {
      nearLegRim: spec.dark ? { colour: COOL_RIM_LIGHT, alpha: LEG_RIM_ALPHA } : null,
      headOn: {
        barrel: layout(proportions.body, SEED.chest, {
          under: UNDERSIDE.chest,
          stripes: 'chest',
          patch: 'chest',
          white: chestWhite,
        }),
        backBarrel: layout(proportions.body, SEED.back, { stripes: 'back', patch: 'back' }),
        haunch: layout(proportions.haunch.headOn, SEED.haunch, {
          stripes: 'haunch',
          patch: 'haunch',
        }),
        ruff: layout(proportions.ruff, SEED.ruff, { white: chestWhite }),
        face: layout(proportions.head, SEED.face, {
          under: UNDERSIDE.face,
          stripes: 'face',
          patch: 'face',
          white: faceWhite,
        }),
        backOfHead: layout(proportions.head, SEED.backOfHead, {
          stripes: 'backOfHead',
          patch: 'backOfHead',
        }),
        cheeks: { screenLeft: cheek, screenRight: cheek },
        paw: solid(pawTone),
        legColumn: layout(UNIT, SEED.legColumn, {
          stripes: 'legColumn',
          patch: 'legColumn',
          white: legColumnSock,
        }),
      },
      ear: {
        front: { ...layout(UNIT, SEED.ear, { patch: 'earFront' }), base: spec.ear },
        back: { ...layout(UNIT, SEED.ear, { patch: 'earBack' }), base: spec.ear },
      },
      profile: {
        flanks: { right: flank('right'), left: flank('left') },
        farLimbShade: spec.dark ? FAR_LIMB_SHADE_DARK : FAR_LIMB_SHADE_LIGHT,
        belly: solid(whiteBelly ? whiteTone : undersideTone),
        // Every segment of a profile leg shares this one layout, so a sock on it
        // would band each knee and hock white too: in profile her socks are her paws.
        limb: layout(UNIT, SEED.limb, { stripes: 'limb', patch: 'limb' }),
      },
      tail: { base: spec.tail.base, rings: spec.tail.rings, flecks: null, rim },
    },
    face: {
      iris: spec.iris,
      pupil: PUPIL,
      glint: GLINT,
      ink: FACE_INK,
      nose: spec.nose,
      mouth: MOUTH,
      tongue: TONGUE,
      fang: FANG,
      whisker: WHISKER_LIGHT,
      eyeDrop: 0.034,
      pupilHeight: 0.72,
      whiskerLength: 0.45,
      whiskerAlpha: 0.5,
      whiskerAlternate: null,
      eyeRoundness: 1.4,
      eyeScale: 0.72,
      eyeSpread: 0.88,
      browWhiskerRise: 0.02,
      browWhiskerLength: 0.35,
      browWhiskerAlpha: 0.15,
      muzzlePads: chin > 0 ? whiteTone : spec.muzzle,
      muzzleMask: chin > 0 ? whiteTone.base : null,
      innerEar: spec.innerEar,
      blaze: null,
      tooth: spec.tooth,
    },
    paws: {
      toeBean: socks > 0 ? PINK_TOE_BEAN : spec.nose.dark,
      toeLine: pawTone.dark,
      claw: CLAW,
    },
    proportions,
    gait: 'lateralWalk',
    fur: FUR[spec.fur],
    statusFigureBox: spec.statusFigureBox,
    outline: spec.dark
      ? { colour: LIGHT_OUTLINE, alpha: OUTLINE_ALPHA, widthPx: OUTLINE_WIDTH_PX }
      : null,
  };
}
