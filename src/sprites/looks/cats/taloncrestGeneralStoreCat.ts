/**
 * The Taloncrest general store's cat: a calico — a white cat with distinct,
 * crisp-edged patches of orange and black — never brindled like a tortie.
 * Orange runs down her right side and black down her left.
 */

import type { CoatBlob, CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  white: { base: '#eee8dc', dark: '#bfb6a6', light: '#fcf9f2' },
  orange: { base: '#d0802e', dark: '#94531a', light: '#eca050' },
  black: { base: '#25201d', dark: '#110e0c', light: '#3e3632' },
} as const satisfies Record<string, CoatTone>;

/** Calico patches are sharp-edged: the white between them is what tells her from a tortie. */
const PATCH_FEATHER = 0.15;

type PatchColour = 'orange' | 'black';

const patch = (
  colour: PatchColour,
  x: number,
  y: number,
  rx: number,
  ry: number,
  seed: number,
): CoatBlob => ({ x, y, rx, ry, tone: COAT[colour], seed, feather: PATCH_FEATHER });

export const TALONCREST_GENERAL_STORE_CAT_LOOK = townCatLook({
  id: 'taloncrest_general_store_cat',
  coat: COAT.white,
  ear: COAT.orange,
  underside: null,
  tabby: null,
  patches: {
    chest: [
      patch('orange', -0.75, -0.55, 0.35, 0.35, 1.1),
      patch('black', 0.75, -0.5, 0.3, 0.3, 1.7),
    ],
    back: [
      patch('black', -0.45, -0.35, 0.5, 0.45, 2.3),
      patch('orange', 0.4, 0.3, 0.5, 0.5, 2.9),
      patch('orange', -0.2, 0.55, 0.3, 0.25, 3.3),
    ],
    haunch: [patch('orange', -0.2, -0.3, 0.6, 0.5, 3.9)],
    face: [
      patch('orange', -0.55, -0.55, 0.55, 0.5, 4.3),
      patch('black', 0.55, -0.55, 0.55, 0.5, 4.9),
    ],
    backOfHead: [
      patch('black', -0.5, -0.3, 0.6, 0.6, 5.3),
      patch('orange', 0.5, -0.3, 0.6, 0.6, 5.9),
    ],
    rightBarrel: [
      patch('orange', -0.35, -0.45, 0.45, 0.5, 6.1),
      patch('black', 0.3, -0.5, 0.35, 0.42, 6.7),
      patch('orange', 0.72, -0.05, 0.2, 0.22, 7.1),
    ],
    leftBarrel: [
      patch('black', -0.3, -0.5, 0.45, 0.48, 7.7),
      patch('orange', 0.35, -0.4, 0.38, 0.45, 8.3),
    ],
    rightHaunch: [patch('black', 0, -0.25, 0.65, 0.55, 8.9)],
    leftHaunch: [patch('orange', 0, -0.25, 0.65, 0.55, 9.3)],
    rightChest: [patch('orange', -0.2, -0.45, 0.6, 0.45, 9.9)],
    leftChest: [patch('black', -0.2, -0.45, 0.6, 0.45, 10.3)],
    rightHead: [patch('orange', -0.15, -0.5, 0.8, 0.55, 10.9)],
    leftHead: [patch('black', -0.15, -0.5, 0.8, 0.55, 11.3)],
  },
  white: null,
  tail: { base: COAT.orange, rings: [COAT.black, COAT.orange] },
  muzzle: COAT.white,
  iris: { inner: '#f8d890', mid: '#e09840', outer: '#9a5a1c' },
  nose: { light: '#e8a0a4', dark: '#b8686e', mottle: [] },
  innerEar: { light: '#e0a8a8', dark: '#a86a6a', furnishing: '#f4ece0', reach: 0.6 },
  tooth: null,
  build: { bulk: 0.35, size: 0.98, head: 1, ears: 1, legs: 1, tail: 1, lift: 0 },
  fur: 'short',
  dark: false,
  statusFigureBox: { centerX: 0.6, top: 0.27, bottom: 0.97, halfWidth: 0.3 },
});
