/**
 * Pumpkin: a long-haired tortoiseshell — a brindled black-and-ginger coat with a
 * cream bib, cream socks and a split face — comfortably chubby, with a deep
 * chest ruff and cheek ruffs that break the head outline.
 */

import { deg, type CoatBlob, type CoatLayout, type CoatTone } from '../../art/catArt';
import { CAT_COAT } from '../../garments/cat/catCoat';
import type { CatFlankCoat, CatLook } from '../catLook';

/**
 * Tortie black is a warm charcoal, never pure black — pure black flattens into
 * a hole at the 32px in-game size and kills the fur texture.
 */
const COAT = {
  black: { base: '#342c27', dark: '#181310', light: '#5f5045' },
  ginger: { base: '#a95d22', dark: '#6b3611', light: '#e0943f' },
  cream: { base: '#e9d8bc', dark: '#b39a76', light: '#fdf4e4' },
} as const satisfies Record<string, CoatTone>;

/**
 * Torties are asymmetric by definition, so the patches are hand-placed rather
 * than generated: a ginger flank on her left, black over the right shoulder and
 * rump, a cream bib running down the chest.
 */
const BODY_BLOBS: readonly CoatBlob[] = [
  { x: -0.17, y: -0.04, rx: 0.19, ry: 0.17, tone: COAT.ginger, seed: 1.3 },
  { x: -0.09, y: 0.19, rx: 0.15, ry: 0.12, tone: COAT.ginger, seed: 4.1 },
  { x: 0.21, y: 0.09, rx: 0.12, ry: 0.11, tone: COAT.ginger, seed: 2.7 },
  { x: 0.05, y: -0.16, rx: 0.09, ry: 0.07, tone: COAT.ginger, seed: 5.9 },
  { x: 0.16, y: -0.06, rx: 0.11, ry: 0.13, tone: COAT.black, seed: 3.3 },
  { x: -0.24, y: 0.14, rx: 0.09, ry: 0.08, tone: COAT.black, seed: 6.4 },
];

const BIB_BLOBS: readonly CoatBlob[] = [
  { x: 0.0, y: 0.06, rx: 0.11, ry: 0.13, tone: COAT.cream, seed: 2.2 },
  { x: -0.02, y: -0.04, rx: 0.055, ry: 0.045, tone: COAT.cream, seed: 7.1 },
];

const RUFF_BLOBS: readonly CoatBlob[] = [
  { x: -0.16, y: -0.02, rx: 0.13, ry: 0.1, tone: COAT.ginger, seed: 8.3 },
  { x: 0.18, y: 0.0, rx: 0.11, ry: 0.09, tone: COAT.black, seed: 1.9 },
  ...BIB_BLOBS,
];

/** The split face: black down her right side, ginger down her left, cream chin. */
const HEAD_BLOBS: readonly CoatBlob[] = [
  { x: -0.12, y: -0.03, rx: 0.14, ry: 0.16, tone: COAT.ginger, seed: 3.9 },
  { x: -0.05, y: -0.18, rx: 0.07, ry: 0.06, tone: COAT.ginger, seed: 9.2 },
  { x: 0.13, y: 0.08, rx: 0.06, ry: 0.05, tone: COAT.ginger, seed: 5.1 },
  { x: 0.0, y: 0.12, rx: 0.105, ry: 0.075, tone: COAT.cream, seed: 6.6 },
  { x: -0.05, y: 0.05, rx: 0.05, ry: 0.045, tone: COAT.cream, seed: 2.4 },
];

const HEAD_BACK_BLOBS: readonly CoatBlob[] = [
  { x: -0.11, y: 0.0, rx: 0.13, ry: 0.15, tone: COAT.ginger, seed: 3.9 },
  { x: 0.08, y: -0.1, rx: 0.07, ry: 0.06, tone: COAT.ginger, seed: 8.8 },
];

const HAUNCH_BLOBS: readonly CoatBlob[] = [
  { x: -0.04, y: -0.03, rx: 0.13, ry: 0.12, tone: COAT.ginger, seed: 7.7 },
  { x: 0.08, y: 0.07, rx: 0.08, ry: 0.07, tone: COAT.black, seed: 3.1 },
];

/** Profile patches stretch along her barrel and squash down it: the side of a body is longer than its front. */
const PROFILE_BARREL_STRETCH = 1.15;
const PROFILE_BARREL_SQUASH = 0.85;
/** The profile head is narrower than the face head-on, and its face sits forward of the skull's middle. */
const PROFILE_FACE_NARROWING = 0.7;
const PROFILE_FACE_FORWARD = 0.02;

const WHISKER = '#f6efe2';

const CHEST_BIB: CoatBlob = { x: 0, y: 0.02, rx: 0.1, ry: 0.11, tone: COAT.cream, seed: 7.8 };

/** Her cream muzzle, the same on both sides of her face. */
const PROFILE_MUZZLE: CoatLayout = {
  base: COAT.cream,
  blobs: [{ x: 0.08, y: 0.06, rx: 0.11, ry: 0.07, tone: COAT.cream, seed: 8.1 }],
};

/** Her right flank, which the east-facing profile shows: the head-on patches seen from the side. */
const RIGHT_FLANK: CatFlankCoat = {
  barrel: {
    base: COAT.black,
    blobs: BODY_BLOBS.map((b) => ({
      ...b,
      x: b.x * PROFILE_BARREL_STRETCH,
      y: b.y * PROFILE_BARREL_SQUASH,
    })),
  },
  haunch: { base: COAT.black, blobs: HAUNCH_BLOBS },
  chest: {
    base: COAT.black,
    blobs: [CHEST_BIB, { x: -0.06, y: -0.08, rx: 0.07, ry: 0.06, tone: COAT.ginger, seed: 2.9 }],
  },
  head: {
    base: COAT.black,
    blobs: HEAD_BLOBS.map((b) => ({
      ...b,
      x: b.x * PROFILE_FACE_NARROWING + PROFILE_FACE_FORWARD,
      y: b.y,
    })),
  },
  muzzle: PROFILE_MUZZLE,
};

/**
 * Her left flank, which the west-facing profile shows: the other half of a
 * tortie — black, with a ginger saddle over the shoulder, a black face with a
 * ginger cheek by the muzzle, and the cream bib and chin she has on both sides.
 * It matches the head-on views, whose screen-right half is her left: a black
 * cheek ruff and black down that side of her face.
 */
const LEFT_FLANK: CatFlankCoat = {
  barrel: {
    base: COAT.black,
    blobs: [
      { x: 0.14, y: -0.06, rx: 0.17, ry: 0.14, tone: COAT.ginger, seed: 7.2 },
      { x: -0.15, y: -0.12, rx: 0.11, ry: 0.08, tone: COAT.ginger, seed: 8.6 },
      { x: -0.05, y: 0.14, rx: 0.08, ry: 0.06, tone: COAT.ginger, seed: 9.4 },
    ],
  },
  haunch: {
    base: COAT.black,
    blobs: [{ x: -0.02, y: 0.04, rx: 0.09, ry: 0.08, tone: COAT.ginger, seed: 5.2 }],
  },
  chest: { base: COAT.black, blobs: [CHEST_BIB] },
  head: {
    base: COAT.black,
    blobs: [
      { x: 0.1, y: 0.06, rx: 0.05, ry: 0.04, tone: COAT.ginger, seed: 5.1 },
      { x: 0.02, y: 0.12, rx: 0.105, ry: 0.075, tone: COAT.cream, seed: 6.6 },
    ],
  },
  muzzle: PROFILE_MUZZLE,
};

export const PUMPKIN_LOOK: CatLook = {
  id: 'pumpkin',
  wearer: 'cat',
  baseGarments: [CAT_COAT],
  coat: {
    nearLegRim: null,
    headOn: {
      barrel: { base: COAT.black, blobs: BODY_BLOBS },
      // From behind she shows the same patches mirrored across her spine.
      backBarrel: { base: COAT.black, blobs: BODY_BLOBS.map((b) => ({ ...b, x: -b.x })) },
      haunch: { base: COAT.black, blobs: HAUNCH_BLOBS },
      ruff: { base: COAT.black, blobs: RUFF_BLOBS },
      face: { base: COAT.black, blobs: HEAD_BLOBS },
      backOfHead: { base: COAT.black, blobs: HEAD_BACK_BLOBS },
      cheeks: {
        screenLeft: {
          base: COAT.black,
          blobs: [{ x: 0, y: 0, rx: 1, ry: 1, tone: COAT.ginger, seed: 4.2 }],
        },
        screenRight: { base: COAT.black, blobs: [] },
      },
      paw: {
        base: COAT.cream,
        blobs: [{ x: 0.0, y: 0.01, rx: 0.07, ry: 0.05, tone: COAT.cream, seed: 4.4 }],
      },
      legColumn: {
        base: COAT.cream,
        blobs: [{ x: 0, y: 0.15, rx: 0.05, ry: 0.3, tone: COAT.ginger, seed: 3.4 }],
      },
    },
    ear: {
      front: {
        base: COAT.black,
        blobs: [{ x: 0, y: -0.55, rx: 1, ry: 0.4, tone: COAT.black, seed: 4.8 }],
      },
      back: { base: COAT.black, blobs: [] },
    },
    profile: {
      flanks: { right: RIGHT_FLANK, left: LEFT_FLANK },
      farLimbShade: 0.3,
      belly: {
        base: COAT.cream,
        blobs: [{ x: 0, y: 0, rx: 0.5, ry: 0.08, tone: COAT.cream, seed: 6.3 }],
      },
      // Legs carry the flank's ginger down into cream socks; a black column
      // reads as a hole punched in the coat.
      limb: {
        base: COAT.ginger,
        blobs: [{ x: 0, y: 0.8, rx: 1, ry: 0.3, tone: COAT.cream, seed: 5.6 }],
      },
    },
    // Tortie tails band rather than blotch.
    tail: { base: COAT.black, rings: [COAT.ginger, COAT.black], flecks: null, rim: null },
  },
  face: {
    iris: { inner: '#dcec96', mid: '#9cc648', outer: '#4e7a24' },
    pupil: '#0c0b09',
    glint: '#ffffff',
    ink: COAT.black.dark,
    nose: { light: '#bd6f76', dark: '#8d4650', mottle: [] },
    mouth: '#3b1c21',
    tongue: '#e28c96',
    fang: '#fdf6ec',
    whisker: WHISKER,
    eyeDrop: 0,
    pupilHeight: 1.5,
    whiskerLength: 1,
    whiskerAlpha: 1,
    whiskerAlternate: null,
    eyeRoundness: 1,
    eyeScale: 1,
    eyeSpread: 1,
    browWhiskerRise: 0,
    browWhiskerLength: 1,
    browWhiskerAlpha: 1,
    muzzlePads: COAT.cream,
    muzzleMask: COAT.cream.base,
    innerEar: { light: '#c08b8b', dark: '#8f5f63', furnishing: WHISKER, reach: 0.74 },
    blaze: null,
    tooth: null,
  },
  paws: { toeBean: '#d98c94', toeLine: COAT.cream.dark, claw: '#fdf6ec' },
  proportions: {
    body: { rx: 0.34, ry: 0.28, sittingRx: 0.29, sittingRy: 0.32 },
    profileBody: { rx: 0.36, ry: 0.235 },
    head: { rx: 0.21, ry: 0.19 },
    profileHead: { rx: 0.2, ry: 0.19 },
    ear: { halfWidth: 0.094, height: 0.178, lean: deg(18), straightEdges: 0 },
    ruff: { rx: 0.29, ry: 0.155 },
    cheek: { rx: 0.115, ry: 0.115 },
    legs: { foreUpper: 0.16, foreLower: 0.17, hindUpper: 0.19, hindLower: 0.2 },
    tail: { length: 0.82, baseWidth: 0.062, tipWidth: 0.03, swell: 0.35 },
    legLift: { headOn: 0, profile: 0 },
    neckDrop: { headOn: 0, profile: 0 },
    profileLength: 1,
    muzzleWidth: 1,
    profileMuzzle: 1,
    profileEarWidth: 1,
    noseDrop: 0,
    profileEars: 'squeezed',
    bladeRise: 0,
    earSpread: 1,
    hindHock: null,
    backView: {
      headScale: 1,
      headHeight: 1,
      earHeight: 1,
      earInset: 0,
      nape: 0,
      tailOverNape: false,
    },
    profileEarHeight: 1,
    pupilScale: 1,
    limbWidth: 1,
    hindPawSpread: 1,
    pawScale: 1,
    haunch: {
      headOn: { rx: 0.155, ry: 0.145 },
      headOnStandingShare: 1,
      back: { rx: 0.165, ry: 0.15 },
      profile: { rx: 0.2, ry: 0.19 },
    },
    profileChest: { rx: 0.165, ry: 0.175 },
    belly: { widthShare: 0.62, ry: 0.1 },
    chinTaper: 0,
  },
  gait: 'trot',
  fur: { hairLength: 1, fringe: 1, ruff: true, cheekRuffs: true, tailPuff: 0.55 },
  statusFigureBox: { centerX: 0.63, top: 0.2, bottom: 1.03, halfWidth: 0.44 },
  outline: null,
};
