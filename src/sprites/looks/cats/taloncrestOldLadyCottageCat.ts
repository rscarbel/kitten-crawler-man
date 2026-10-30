/**
 * The old lady's cottage cat in Taloncrest: a tiny solid blue-grey cat with
 * white socks, a white chin and big pale-gold eyes in a kittenish head.
 */

import type { CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  grey: { base: '#7c8189', dark: '#545961', light: '#9ca1a9' },
  ear: { base: '#6a6f77', dark: '#464a52', light: '#868b93' },
  white: { base: '#f0eee8', dark: '#c0bcb4', light: '#fcfbf8' },
} as const satisfies Record<string, CoatTone>;

export const TALONCREST_OLD_LADY_COTTAGE_CAT_LOOK = townCatLook({
  id: 'taloncrest_old_lady_cottage_cat',
  coat: COAT.grey,
  ear: COAT.ear,
  underside: null,
  tabby: null,
  patches: {},
  white: { tone: COAT.white, bib: 0.35, belly: false, socks: 0.3, chin: 0.6, blaze: false },
  tail: { base: COAT.grey, rings: [COAT.grey] },
  muzzle: COAT.grey,
  iris: { inner: '#fbf2b0', mid: '#e6c862', outer: '#a07c2a' },
  nose: { light: '#a08a92', dark: '#6c5860', mottle: [] },
  innerEar: { light: '#c4a2a8', dark: '#7c6268', furnishing: '#dcdad4', reach: 0.6 },
  tooth: null,
  build: { bulk: 0.2, size: 0.72, head: 1.12, ears: 0.92, legs: 0.82, tail: 1.2, lift: -0.08 },
  fur: 'short',
  dark: false,
  statusFigureBox: { centerX: 0.58, top: 0.34, bottom: 0.97, halfWidth: 0.28 },
});
