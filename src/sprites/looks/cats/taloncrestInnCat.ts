/**
 * The Taloncrest inn's cat: a fat ginger tabby, the classic swirl on each
 * flank, cream underneath with a white chin and a little white bib.
 */

import type { CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  ginger: { base: '#c27a38', dark: '#8a4f1e', light: '#e09a55' },
  stripe: { base: '#7e3f16', dark: '#52260a', light: '#9c5426' },
  cream: { base: '#e6c08a', dark: '#b8925e', light: '#f6daa8' },
  white: { base: '#f2ebe0', dark: '#c4b9a8', light: '#fdfaf4' },
} as const satisfies Record<string, CoatTone>;

export const TALONCREST_INN_CAT_LOOK = townCatLook({
  id: 'taloncrest_inn_cat',
  coat: COAT.ginger,
  ear: COAT.ginger,
  underside: COAT.cream,
  tabby: { pattern: 'classic', tone: COAT.stripe, boldness: 1.2 },
  patches: {},
  white: { tone: COAT.white, bib: 0.55, belly: false, socks: 0, chin: 0.8, blaze: false },
  tail: { base: COAT.ginger, rings: [COAT.stripe, COAT.ginger] },
  muzzle: COAT.cream,
  iris: { inner: '#f2e48a', mid: '#c8c04a', outer: '#7c8028' },
  nose: { light: '#e3988a', dark: '#b0645a', mottle: [] },
  innerEar: { light: '#d8a08e', dark: '#9c6650', furnishing: '#f0dcc0', reach: 0.6 },
  tooth: null,
  build: { bulk: 1, size: 1.05, head: 1.06, ears: 0.88, legs: 0.95, tail: 0.95, lift: 0 },
  fur: 'short',
  dark: false,
  statusFigureBox: { centerX: 0.55, top: 0.23, bottom: 0.97, halfWidth: 0.37 },
});
