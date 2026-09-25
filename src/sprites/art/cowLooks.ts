/**
 * The six cattle looks: three coats, each as an adult cow and as a calf.
 *
 * Each is its own closed look — and its own figure — because a cached cell is
 * keyed on the figure and never on the instance: a painter reading a
 * per-instance coat would paint the first cow's patches onto every cow after it.
 */

import { type CowBuild, type CowHide, type CowLook, type HornSpec } from './cowArt';
import { deg } from './carlArt';

export type CowCoatId = 'holstein' | 'jersey' | 'dun';
export type CowAge = 'adult' | 'calf';

export const COW_COATS: readonly CowCoatId[] = ['holstein', 'jersey', 'dun'];
export const COW_AGES: readonly CowAge[] = ['adult', 'calf'];

/**
 * An adult: about 1.7 tiles nose to tail in profile and 1.1 tiles to the
 * withers, with a deep barrel on comparatively short legs.
 */
export const ADULT_COW_BUILD: CowBuild = {
  bodyCx: -0.12,
  bodyCy: -0.33,
  bodyHalfLength: 0.54,
  bodyHalfDepth: 0.31,
  foreRoot: { x: 0.28, y: -0.4 },
  hindRoot: { x: -0.52, y: -0.1 },
  foreFootX: 0.28,
  hindFootX: -0.6,
  foreUpper: 0.55,
  foreLower: 0.315,
  hindUpper: 0.295,
  hindLower: 0.3,
  legRootHalfWidth: 0.075,
  kneeHalfWidth: 0.048,
  cannonHalfWidth: 0.034,
  hoofHeight: 0.05,
  neckRoot: { x: 0.22, y: -0.4 },
  neckLength: 0.44,
  neckRestAngle: deg(-16),
  neckRootHalfWidth: 0.17,
  neckTipHalfWidth: 0.115,
  dewlapDrop: 0.09,
  headLength: 0.4,
  headDepth: 0.25,
  headRestAngle: deg(56),
  headFrontHalfWidth: 0.13,
  eyeRadius: 0.021,
  earLength: 0.155,
  earHalfWidth: 0.042,
  tailRoot: { x: -1.08, y: -0.92 },
  tailLength: 0.55,
  switchLength: 0.11,
  udderRadius: 0.075,
  axialBodyHalfWidth: 0.35,
  axialForeTrack: 0.16,
  axialHindTrack: 0.19,
  lieDrop: 0.4,
  goreScale: 1,
};

/**
 * A calf: about 0.6 of an adult by length, on legs long for its body, under a
 * head and eyes big for it. Size is read by counting heads into a body, and a
 * young animal carries *fewer* of them — its head is a larger share of it —
 * which is what makes it read as a baby rather than as a small cow.
 */
export const CALF_BUILD: CowBuild = {
  bodyCx: -0.06,
  bodyCy: -0.09,
  bodyHalfLength: 0.31,
  bodyHalfDepth: 0.15,
  foreRoot: { x: 0.13, y: -0.1 },
  hindRoot: { x: -0.24, y: 0.04 },
  foreFootX: 0.13,
  hindFootX: -0.29,
  foreUpper: 0.345,
  foreLower: 0.22,
  hindUpper: 0.23,
  hindLower: 0.23,
  legRootHalfWidth: 0.045,
  kneeHalfWidth: 0.033,
  cannonHalfWidth: 0.021,
  hoofHeight: 0.035,
  neckRoot: { x: 0.1, y: -0.12 },
  neckLength: 0.24,
  neckRestAngle: deg(-28),
  neckRootHalfWidth: 0.09,
  neckTipHalfWidth: 0.08,
  dewlapDrop: 0.015,
  headLength: 0.29,
  headDepth: 0.2,
  headRestAngle: deg(50),
  headFrontHalfWidth: 0.1,
  eyeRadius: 0.022,
  earLength: 0.115,
  earHalfWidth: 0.034,
  tailRoot: { x: -1.08, y: -0.92 },
  tailLength: 0.3,
  switchLength: 0.06,
  udderRadius: 0,
  axialBodyHalfWidth: 0.25,
  axialForeTrack: 0.1,
  axialHindTrack: 0.12,
  lieDrop: 0.3,
  goreScale: 0.6,
};

const HOLSTEIN_HIDE: CowHide = {
  base: '#ecebe6',
  shadow: '#8c8b93',
  light: '#ffffff',
  patch: '#1f1c21',
  patchCover: 0.45,
  belly: null,
  points: '#e4e1da',
  face: null,
  muzzle: '#d3a2a1',
  nostril: '#6b3b40',
  muzzleRing: null,
  eyeRing: null,
  earInner: '#d9a3a3',
  horn: '#e6dcc3',
  hornTip: '#4a4038',
  hoof: '#3a3130',
  tailSwitch: '#f2f0ea',
  udder: '#e8a8ae',
  ink: '#17131a',
  eye: '#1a1210',
};

const JERSEY_HIDE: CowHide = {
  base: '#b67a45',
  shadow: '#6a4124',
  light: '#e0b07a',
  patch: null,
  patchCover: 0,
  belly: '#d6ad7e',
  points: '#5e3d27',
  face: '#855836',
  muzzle: '#2a211d',
  nostril: '#0d0a09',
  muzzleRing: '#e8d6b8',
  eyeRing: '#dcc39a',
  earInner: '#e3b996',
  horn: '#e6dcc3',
  hornTip: '#4a4038',
  hoof: '#2a2220',
  tailSwitch: '#2a1f1a',
  udder: '#e3a39a',
  ink: '#1d130c',
  eye: '#150d09',
};

const DUN_HIDE: CowHide = {
  base: '#ad6f3e',
  shadow: '#5c341a',
  light: '#d9a267',
  patch: null,
  patchCover: 0,
  belly: null,
  points: '#7e4b27',
  face: null,
  muzzle: '#3a2c24',
  nostril: '#120c09',
  muzzleRing: null,
  eyeRing: null,
  earInner: '#d7b48a',
  horn: '#efe6cf',
  hornTip: '#6d5b44',
  hoof: '#2f2622',
  tailSwitch: '#6e3f1f',
  udder: '#d99b8f',
  ink: '#20150c',
  eye: '#150d09',
};

const HOLSTEIN_HORNS: HornSpec = { shape: 'stub', length: 0.07, baseHalfWidth: 0.018 };
const DUN_HORNS: HornSpec = { shape: 'upswept', length: 0.14, baseHalfWidth: 0.022 };

interface CoatStyle {
  readonly hide: CowHide;
  readonly horns: HornSpec | null;
  readonly shag: number;
  readonly forelock: number;
}

const COAT_STYLES: Readonly<Record<CowCoatId, CoatStyle>> = {
  holstein: { hide: HOLSTEIN_HIDE, horns: HOLSTEIN_HORNS, shag: 0, forelock: 0 },
  // Jerseys are very often polled, and a hornless head is one more thing that
  // tells the three coats apart at tile size.
  jersey: { hide: JERSEY_HIDE, horns: null, shag: 0, forelock: 0 },
  dun: { hide: DUN_HIDE, horns: DUN_HORNS, shag: 1, forelock: 1 },
};

/** How much of an adult's shag a calf has grown. */
const CALF_SHAG_SHARE = 0.75;

/** The figure id for a coat and an age: `cow_holstein`, `calf_dun`, and so on. */
export function cowFigureId(coat: CowCoatId, age: CowAge): string {
  return `${age === 'adult' ? 'cow' : 'calf'}_${coat}`;
}

export function cowLookOf(coat: CowCoatId, age: CowAge): CowLook {
  const style = COAT_STYLES[coat];
  const adult = age === 'adult';
  return {
    id: cowFigureId(coat, age),
    build: adult ? ADULT_COW_BUILD : CALF_BUILD,
    hide: style.hide,
    // A calf has not grown horns yet.
    horns: adult ? style.horns : null,
    shag: adult ? style.shag : style.shag * CALF_SHAG_SHARE,
    forelock: adult ? style.forelock : style.forelock * CALF_SHAG_SHARE,
  };
}
