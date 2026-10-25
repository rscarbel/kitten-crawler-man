/**
 * Belle: a short-haired tortoiseshell — a black coat clouded with soft
 * patches of ginger, rust and caramel, warmest over her shoulders, back and
 * flanks — a slim, soft-bodied cat with a round full-cheeked head, large dark
 * ears, round aqua eyes and a faint pale blaze down her face. She is drawn
 * stylised and cute rather than photographic: matched closely to the real
 * cat, she read as uncanny at the tile.
 */

import { deg, hash1, hash2, type CoatBlob, type CoatLayout, type CoatTone } from '../../art/catArt';
import { CAT_COAT } from '../../garments/cat/catCoat';
import type { CatFlankCoat, CatLook } from '../catLook';

/**
 * Her black is a warm near-black rather than pure black: pure black flattens
 * into a hole at the 32 px tile and loses the warm patches the hairs pick up.
 */
const COAT = {
  black: { base: '#1a1512', dark: '#0b0907', light: '#332822' },
  rust: { base: '#6a4228', dark: '#422614', light: '#8a5a3a' },
  ginger: { base: '#7e5634', dark: '#52361c', light: '#9c7248' },
  caramel: { base: '#8c704e', dark: '#5c4a32', light: '#a88c68' },
  /** Her ears are the darkest of her: near-black, a shade under her coat. */
  /** Her muzzle a shade lighter and warmer than her face, so it reads as a soft round puff. */
  muzzle: { base: '#221a17', dark: '#16110f', light: '#3a2e28' },
  earBlack: { base: '#120e0c', dark: '#070505', light: '#241e1c' },
  /** Her blaze is gold hairs mixed with silver, greyer than her warm patches. */
  blaze: { base: '#8c7a5e', dark: '#5e5040', light: '#a89878' },
} as const satisfies Record<string, CoatTone>;

/** A tone a brindled region draws its flecks from, and how often relative to the others. */
interface FleckTone {
  readonly tone: CoatTone;
  readonly weight: number;
}

/** The warm mix over her back and flanks. */
const WARM: readonly FleckTone[] = [
  { tone: COAT.ginger, weight: 2 },
  { tone: COAT.rust, weight: 4 },
  { tone: COAT.caramel, weight: 1 },
];

/**
 * Her haunches: the darker warm tones only, so the brightest brindle sits on
 * her shoulders and back where hers is densest.
 */
const DEEP_WARM: readonly FleckTone[] = [
  { tone: COAT.rust, weight: 3 },
  { tone: COAT.ginger, weight: 1 },
];

/** Her chest and belly: black, flecked with caramel and a little rust. */
const DARK_FLECKS: readonly FleckTone[] = [
  { tone: COAT.caramel, weight: 3 },
  { tone: COAT.rust, weight: 1 },
];

interface BrindleRegion {
  /** The region's centre and half-size, in the layout's own units. */
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly count: number;
  /** Each fleck's half-size along its long axis, smallest and largest, layout units. */
  readonly minSize: number;
  readonly maxSize: number;
  /** How much longer than wide a fleck is: brindling runs in streaks, not spots. */
  readonly streak: number;
  /** Whether the streaks run across the region (along x) or down it (along y). */
  readonly along: 'x' | 'y';
  readonly tones: readonly FleckTone[];
  readonly seed: number;
}

/**
 * Every patch of hers fades into the black over the outer part of its
 * radius: her warm colours drift through the black as soft clouds, and
 * crisp-edged flecks read as scraggly speckle at the 32 px tile.
 */
const PATCH_FEATHER = 0.9;

/** Stops two regions sharing a seed from laying out the same flecks. */
const SEED_STRIDE = 97;

function pickTone(tones: readonly FleckTone[], roll: number): CoatTone {
  const total = tones.reduce((sum, entry) => sum + entry.weight, 0);
  let left = roll * total;
  for (const entry of tones) {
    left -= entry.weight;
    if (left < 0) return entry.tone;
  }
  return tones[tones.length - 1].tone;
}

/** A fleck's own seed, for the wobble of its edge: drawn from its key apart from its placement. */
const FLECK_SEED_STRIDE = 2;
const FLECK_SEED_RANGE = 10;

/**
 * Soft overlapping patches scattered over an ellipse, the clouded warmth of
 * a tortoiseshell. Laid out from a seed so every bake paints the same coat.
 */
function brindle(region: BrindleRegion): CoatBlob[] {
  const blobs: CoatBlob[] = [];
  for (let i = 0; i < region.count; i++) {
    const key = region.seed * SEED_STRIDE + i;
    const angle = hash1(key) * Math.PI * 2;
    const reach = Math.sqrt(hash2(key, region.seed));
    const size = region.minSize + (region.maxSize - region.minSize) * hash2(region.seed, key);
    const long = size;
    const short = size / region.streak;
    blobs.push({
      x: region.cx + Math.cos(angle) * reach * region.rx,
      y: region.cy + Math.sin(angle) * reach * region.ry,
      rx: region.along === 'x' ? long : short,
      ry: region.along === 'x' ? short : long,
      tone: pickTone(region.tones, hash1(key + region.seed)),
      seed: hash1(key * FLECK_SEED_STRIDE) * FLECK_SEED_RANGE,
      feather: PATCH_FEATHER,
    });
  }
  return blobs;
}

/** The warm clouding over a barrel seen from the side: soft overlapping patches. */
function warmBack(cx: number, cy: number, rx: number, ry: number, seed: number): CoatBlob[] {
  return brindle({
    cx,
    cy,
    rx,
    ry,
    count: 5,
    minSize: 0.08,
    maxSize: 0.13,
    streak: 1.8,
    along: 'x',
    tones: WARM,
    seed,
  });
}

/** One soft warm cloud low on her chest, so she reads as a tortie from the front too. */
const CHEST_PATCH: CoatBlob = {
  x: -0.05,
  y: 0.06,
  rx: 0.07,
  ry: 0.06,
  tone: COAT.rust,
  seed: 2.6,
  feather: PATCH_FEATHER,
};

/** Her chest head-on: black, warm at the shoulders where they show past its edges. */
const SHOULDER_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: -0.13,
  rx: 0.26,
  ry: 0.05,
  count: 3,
  minSize: 0.05,
  maxSize: 0.07,
  streak: 2,
  along: 'x',
  tones: WARM,
  seed: 4,
});

const CHEST_BLOBS: readonly CoatBlob[] = [...SHOULDER_BLOBS, CHEST_PATCH];

/**
 * From behind, a few deep warm clouds over her shoulders, off to one side: a
 * band of them across her hips reads as a harness at the tile.
 */
const BACK_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0.05,
  cy: -0.1,
  rx: 0.16,
  ry: 0.12,
  count: 4,
  minSize: 0.06,
  maxSize: 0.1,
  streak: 1.4,
  along: 'x',
  tones: DEEP_WARM,
  seed: 5,
});

const HAUNCH_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: 0,
  rx: 0.12,
  ry: 0.12,
  count: 2,
  minSize: 0.03,
  maxSize: 0.045,
  streak: 1.8,
  along: 'y',
  tones: DEEP_WARM,
  seed: 6,
});

/**
 * Her face head-on, head-local units: black, with a few warm flecks at her
 * brow and her darker cheek on her right.
 */
const FACE_BLOBS: readonly CoatBlob[] = [
  ...brindle({
    cx: -0.09,
    cy: -0.06,
    rx: 0.03,
    ry: 0.03,
    count: 1,
    minSize: 0.055,
    maxSize: 0.065,
    streak: 1.6,
    along: 'y',
    tones: WARM,
    seed: 7,
  }),
];

/** The brindle of her back running up her nape, in head space under the skull. */
const NAPE_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: 0.3,
  rx: 0.2,
  ry: 0.16,
  count: 11,
  minSize: 0.04,
  maxSize: 0.07,
  streak: 2.2,
  along: 'x',
  tones: WARM,
  seed: 12,
});

/** Only a few warm hairs on the back of her head: flecks higher up it read as a pair of eyes. */
const BACK_OF_HEAD_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: 0.15,
  rx: 0.12,
  ry: 0.04,
  count: 3,
  minSize: 0.02,
  maxSize: 0.028,
  streak: 1.8,
  along: 'x',
  tones: WARM,
  seed: 8,
});

/** Her profile barrel: warm over her spine and down her flank, darker toward the belly. */
function flankBarrel(seed: number): CoatBlob[] {
  return [
    ...warmBack(0, -0.04, 0.34, 0.13, seed),
    ...brindle({
      cx: 0,
      cy: 0.1,
      rx: 0.3,
      ry: 0.06,
      count: 5,
      minSize: 0.03,
      maxSize: 0.045,
      streak: 2,
      along: 'x',
      tones: DARK_FLECKS,
      seed: seed + 1,
    }),
  ];
}

function flankHaunch(seed: number): CoatBlob[] {
  return brindle({
    cx: 0,
    cy: -0.02,
    rx: 0.15,
    ry: 0.13,
    count: 5,
    minSize: 0.03,
    maxSize: 0.05,
    streak: 2,
    along: 'x',
    tones: DEEP_WARM,
    seed,
  });
}

function flankChest(seed: number): CoatBlob[] {
  return [
    ...brindle({
      cx: -0.02,
      cy: -0.07,
      rx: 0.13,
      ry: 0.08,
      count: 7,
      minSize: 0.03,
      maxSize: 0.05,
      streak: 2,
      along: 'x',
      tones: WARM,
      seed,
    }),
    ...brindle({
      cx: 0.03,
      cy: 0.06,
      rx: 0.09,
      ry: 0.08,
      count: 3,
      minSize: 0.022,
      maxSize: 0.032,
      streak: 1.6,
      along: 'y',
      tones: DARK_FLECKS,
      seed: seed + 1,
    }),
    { x: 0.09, y: 0.04, rx: 0.035, ry: 0.05, tone: COAT.caramel, seed: 4.4 },
  ];
}

/**
 * Her blaze seen from the side: a line of tan along the top of her nose and
 * up her forehead, on the profile head's own frame.
 */
const PROFILE_BLAZE: readonly CoatBlob[] = [
  { x: 0.1, y: -0.075, rx: 0.05, ry: 0.016, tone: COAT.ginger, seed: 1.1 },
  { x: 0.04, y: -0.125, rx: 0.045, ry: 0.016, tone: COAT.ginger, seed: 2.3 },
];

/** Her right side of the face in profile, the side away from the blaze: black, with one ginger fleck at the brow. */
const RIGHT_HEAD: CoatLayout = {
  base: COAT.black,
  blobs: [{ x: 0.11, y: -0.07, rx: 0.035, ry: 0.012, tone: COAT.ginger, seed: 1.1 }],
};

const LEFT_HEAD: CoatLayout = {
  base: COAT.black,
  blobs: [
    ...PROFILE_BLAZE,
    ...brindle({
      cx: -0.02,
      cy: 0.02,
      rx: 0.07,
      ry: 0.05,
      count: 3,
      minSize: 0.02,
      maxSize: 0.03,
      streak: 1.6,
      along: 'x',
      tones: WARM,
      seed: 21,
    }),
  ],
};

/** Her muzzle on the blaze side is speckled tan; on the other it is black. */
const MUZZLE_SPECKLED: CoatLayout = {
  base: COAT.black,
  blobs: brindle({
    cx: 0.1,
    cy: 0.04,
    rx: 0.06,
    ry: 0.04,
    count: 3,
    minSize: 0.014,
    maxSize: 0.02,
    streak: 1.2,
    along: 'x',
    tones: [{ tone: COAT.caramel, weight: 1 }],
    seed: 22,
  }),
};

const MUZZLE_DARK: CoatLayout = { base: COAT.black, blobs: [] };

const RIGHT_FLANK: CatFlankCoat = {
  barrel: { base: COAT.black, blobs: flankBarrel(11) },
  haunch: { base: COAT.black, blobs: flankHaunch(13) },
  chest: { base: COAT.black, blobs: flankChest(14) },
  head: RIGHT_HEAD,
  muzzle: MUZZLE_DARK,
};

/**
 * Her left shoulder carries a denser streak of ginger than her right: a
 * tortie is never the same on both sides, and the difference has to survive
 * at the tile.
 */
const LEFT_SHOULDER_STREAK: readonly CoatBlob[] = brindle({
  cx: 0.15,
  cy: -0.03,
  rx: 0.1,
  ry: 0.06,
  count: 5,
  minSize: 0.04,
  maxSize: 0.06,
  streak: 2,
  along: 'x',
  tones: [
    { tone: COAT.ginger, weight: 2 },
    { tone: COAT.caramel, weight: 1 },
  ],
  seed: 17,
});

const LEFT_FLANK: CatFlankCoat = {
  barrel: { base: COAT.black, blobs: [...flankBarrel(16), ...LEFT_SHOULDER_STREAK] },
  haunch: { base: COAT.black, blobs: flankHaunch(18) },
  chest: { base: COAT.black, blobs: flankChest(19) },
  head: LEFT_HEAD,
  muzzle: MUZZLE_SPECKLED,
};

/** A leg: mottled down its length, x in shares of its half-width and y in shares of its length. */
const LIMB_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: 0.22,
  rx: 0.8,
  ry: 0.22,
  count: 4,
  minSize: 0.06,
  maxSize: 0.12,
  streak: 1.6,
  along: 'y',
  tones: WARM,
  seed: 30,
});

/**
 * A head-on leg column's coat is in tile units across it and shares of its
 * length down it, so flecks laid out round in shares are narrowed by this to
 * tile units across.
 */
const LEG_COLUMN_FLECK_NARROWING = 0.15;

/** A head-on leg column: x in tile units across it, y in shares of its length. */
const LEG_COLUMN_BLOBS: readonly CoatBlob[] = brindle({
  cx: 0,
  cy: 0.18,
  rx: 0.035,
  ry: 0.18,
  count: 3,
  minSize: 0.05,
  maxSize: 0.1,
  streak: 1,
  along: 'y',
  tones: WARM,
  seed: 31,
}).map((blob) => ({
  ...blob,
  rx: blob.rx * LEG_COLUMN_FLECK_NARROWING,
}));

/** The line round her whole silhouette that keeps a near-black cat's shape on a dark floor. */
const LIGHT_OUTLINE = '#cfc6b8';
/** The cool light that edges her black legs and tail against a dark floor. */
const COOL_RIM_LIGHT = '#7d8ea2';
const WHISKER_LIGHT = '#f2ede4';

export const BELLE_LOOK: CatLook = {
  id: 'belle',
  wearer: 'cat',
  baseGarments: [CAT_COAT],
  coat: {
    nearLegRim: { colour: COOL_RIM_LIGHT, alpha: 0.12 },
    headOn: {
      barrel: { base: COAT.black, blobs: CHEST_BLOBS },
      backBarrel: { base: COAT.black, blobs: BACK_BLOBS },
      haunch: { base: COAT.black, blobs: HAUNCH_BLOBS },
      ruff: { base: COAT.black, blobs: [] },
      face: { base: COAT.black, blobs: FACE_BLOBS },
      backOfHead: {
        base: COAT.black,
        blobs: [...BACK_OF_HEAD_BLOBS, ...NAPE_BLOBS],
      },
      cheeks: {
        screenLeft: { base: COAT.black, blobs: [] },
        screenRight: { base: COAT.black, blobs: [] },
      },
      paw: { base: COAT.black, blobs: [] },
      legColumn: { base: COAT.black, blobs: LEG_COLUMN_BLOBS },
    },
    ear: {
      front: { base: COAT.earBlack, blobs: [] },
      back: { base: COAT.earBlack, blobs: [] },
    },
    profile: {
      flanks: { right: RIGHT_FLANK, left: LEFT_FLANK },
      farLimbShade: 0.55,
      belly: {
        base: COAT.black,
        blobs: brindle({
          cx: 0,
          cy: 0,
          rx: 0.7,
          ry: 0.04,
          count: 4,
          minSize: 0.025,
          maxSize: 0.04,
          streak: 2,
          along: 'x',
          tones: DARK_FLECKS,
          seed: 32,
        }),
      },
      limb: { base: COAT.black, blobs: LIMB_BLOBS },
    },
    // Flecked with caramel and rust toward the root, black to the tip.
    tail: {
      base: COAT.black,
      rings: [COAT.black],
      flecks: {
        tones: [COAT.rust, COAT.ginger],
        count: 2,
        reach: 0.4,
        size: 0.9,
        feather: PATCH_FEATHER,
      },
      rim: { colour: COOL_RIM_LIGHT, alpha: 0.28 },
    },
  },
  face: {
    iris: { inner: '#cfe3a6', mid: '#a8dcc4', outer: '#5c8c7c' },
    pupil: '#0a0908',
    glint: '#ffffff',
    ink: COAT.black.dark,
    nose: { light: '#4a3632', dark: '#1e1614', mottle: ['#9a6e68', '#5a4234', '#2a1e1a'] },
    mouth: '#2a1416',
    tongue: '#d88a92',
    fang: '#f8f4ee',
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
    muzzlePads: COAT.muzzle,
    muzzleMask: null,
    innerEar: { light: '#3a3032', dark: '#201a1c', furnishing: '#433b3c', reach: 0.5 },
    blaze: {
      tone: COAT.blaze,
      side: 'left',
      offsetTop: 0.01,
      offsetBottom: 0.012,
      halfWidthTop: 0.0045,
      halfWidthBottom: 0.009,
      topShare: 0.35,
      bend: 0.012,
      opacity: 0.2,
      muzzleSpecks: 0,
    },
    tooth: null,
  },
  paws: { toeBean: '#2c1f1f', toeLine: COAT.black.dark, claw: '#e8e0d4' },
  proportions: {
    body: { rx: 0.215, ry: 0.215, sittingRx: 0.21, sittingRy: 0.26 },
    profileBody: { rx: 0.35, ry: 0.17 },
    head: { rx: 0.2, ry: 0.185 },
    profileHead: { rx: 0.168, ry: 0.185 },
    ear: { halfWidth: 0.1, height: 0.16, lean: deg(30), straightEdges: 0.3 },
    ruff: { rx: 0.2, ry: 0.1 },
    cheek: { rx: 0.135, ry: 0.112 },
    legs: { foreUpper: 0.19, foreLower: 0.19, hindUpper: 0.2, hindLower: 0.205 },
    tail: { length: 0.56, baseWidth: 0.065, tipWidth: 0.045, swell: 0.3 },
    legLift: { headOn: 0.13, profile: 0.13 },
    neckDrop: { headOn: 0.2, profile: 0.12 },
    profileLength: 1.05,
    muzzleWidth: 1,
    profileMuzzle: 0.9,
    profileEarWidth: 1.05,
    noseDrop: 0.035,
    profileEars: 'sideOn',
    bladeRise: 0.06,
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
    limbWidth: 1.12,
    hindPawSpread: 0.6,
    pawScale: 0.72,
    haunch: {
      headOn: { rx: 0.09, ry: 0.1 },
      headOnStandingShare: 0.55,
      back: { rx: 0.08, ry: 0.1 },
      profile: { rx: 0.165, ry: 0.16 },
    },
    profileChest: { rx: 0.13, ry: 0.14 },
    belly: { widthShare: 0.5, ry: 0.045 },
    chinTaper: 0.05,
  },
  gait: 'lateralWalk',
  fur: { hairLength: 0.08, fringe: 0.02, ruff: false, cheekRuffs: false, tailPuff: 0.25 },
  statusFigureBox: { centerX: 0.63, top: 0.25, bottom: 0.97, halfWidth: 0.33 },
  outline: { colour: LIGHT_OUTLINE, alpha: 0.6, widthPx: 1.5 },
};
