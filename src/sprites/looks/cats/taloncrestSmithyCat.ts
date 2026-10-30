/**
 * The Taloncrest smithy's cat: sooty all-black, smudged with ash grey from
 * the forge, with deep amber eyes.
 */

import type { CoatBlob, CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  black: { base: '#181615', dark: '#090808', light: '#2c2927' },
  soot: { base: '#3c3836', dark: '#26231f', light: '#544e4a' },
} as const satisfies Record<string, CoatTone>;

/** Ash smears drift into the black rather than sitting on it as spots. */
const SOOT_FEATHER = 0.85;

const smudge = (x: number, y: number, rx: number, ry: number, seed: number): CoatBlob => ({
  x,
  y,
  rx,
  ry,
  tone: COAT.soot,
  seed,
  feather: SOOT_FEATHER,
});

export const TALONCREST_SMITHY_CAT_LOOK = townCatLook({
  id: 'taloncrest_smithy_cat',
  coat: COAT.black,
  ear: COAT.black,
  underside: null,
  tabby: null,
  patches: {
    rightBarrel: [smudge(-0.3, -0.35, 0.35, 0.3, 1.2), smudge(0.4, 0.2, 0.25, 0.25, 2.4)],
    leftBarrel: [smudge(0.2, -0.4, 0.4, 0.3, 3.6)],
    back: [smudge(-0.3, -0.2, 0.35, 0.3, 4.8)],
    rightHaunch: [smudge(0, -0.2, 0.45, 0.4, 5.1)],
    face: [smudge(0.45, -0.5, 0.3, 0.25, 6.3)],
    leftHead: [smudge(-0.1, -0.5, 0.4, 0.3, 7.5)],
  },
  white: null,
  tail: { base: COAT.black, rings: [COAT.black] },
  muzzle: { base: '#221e1c', dark: '#16120f', light: '#3a3430' },
  iris: { inner: '#ffe080', mid: '#f0a028', outer: '#a85a10' },
  nose: { light: '#3e3434', dark: '#1a1414', mottle: [] },
  innerEar: { light: '#3a3032', dark: '#201a1c', furnishing: '#433b3c', reach: 0.5 },
  tooth: null,
  build: { bulk: 0.4, size: 1.02, head: 1, ears: 0.95, legs: 1, tail: 0.95, lift: 0 },
  fur: 'short',
  dark: true,
  statusFigureBox: { centerX: 0.6, top: 0.23, bottom: 0.97, halfWidth: 0.34 },
});
