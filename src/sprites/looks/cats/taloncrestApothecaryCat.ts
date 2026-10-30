/**
 * The Taloncrest apothecary's cat: a lean, long-legged silver mackerel tabby
 * with bold black stripes, big ears and green eyes.
 */

import type { CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  silver: { base: '#a9acad', dark: '#777a7c', light: '#d0d2d0' },
  stripe: { base: '#2c2d30', dark: '#18191b', light: '#46484c' },
  pale: { base: '#d8d8d2', dark: '#a8a8a2', light: '#efefea' },
} as const satisfies Record<string, CoatTone>;

export const TALONCREST_APOTHECARY_CAT_LOOK = townCatLook({
  id: 'taloncrest_apothecary_cat',
  coat: COAT.silver,
  ear: COAT.silver,
  underside: COAT.pale,
  tabby: { pattern: 'mackerel', tone: COAT.stripe, boldness: 1.3 },
  patches: {},
  white: null,
  tail: { base: COAT.silver, rings: [COAT.stripe, COAT.silver] },
  muzzle: COAT.pale,
  iris: { inner: '#d4f49a', mid: '#6cc850', outer: '#2a7a30' },
  nose: { light: '#c07a70', dark: '#8a4a44', mottle: [] },
  innerEar: { light: '#d0a8a8', dark: '#8a6466', furnishing: '#e8e8e2', reach: 0.6 },
  tooth: null,
  build: { bulk: -0.1, size: 1, head: 0.95, ears: 1.15, legs: 1.08, tail: 1.1, lift: 0.02 },
  fur: 'short',
  dark: false,
  statusFigureBox: { centerX: 0.62, top: 0.27, bottom: 0.97, halfWidth: 0.32 },
});
