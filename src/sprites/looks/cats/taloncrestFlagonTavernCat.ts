/**
 * The Flagon tavern's mouser in Taloncrest: a broad black-and-white tom — a
 * tuxedo, white bib, belly, socks, muzzle and blaze — with nicked ears and a
 * fang that shows past his lip.
 */

import type { CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  black: { base: '#1b1816', dark: '#0b0908', light: '#34302c' },
  white: { base: '#eeebe4', dark: '#bcb6ac', light: '#fcfbf8' },
  /** The healed tears in his ears: bare, pinker skin. */
  scar: { base: '#8a5a58', dark: '#5c3836', light: '#a87472' },
} as const satisfies Record<string, CoatTone>;

export const TALONCREST_FLAGON_TAVERN_CAT_LOOK = townCatLook({
  id: 'taloncrest_flagon_tavern_cat',
  coat: COAT.black,
  ear: COAT.black,
  underside: null,
  tabby: null,
  patches: {
    earFront: [{ x: 0.55, y: -0.62, rx: 0.42, ry: 0.13, tone: COAT.scar, seed: 3.1 }],
    earBack: [{ x: -0.55, y: -0.62, rx: 0.42, ry: 0.13, tone: COAT.scar, seed: 3.7 }],
  },
  white: { tone: COAT.white, bib: 1.1, belly: true, socks: 0.38, chin: 1.1, blaze: true },
  tail: { base: COAT.black, rings: [COAT.black] },
  muzzle: COAT.white,
  iris: { inner: '#eef49a', mid: '#b8d248', outer: '#5e8424' },
  nose: { light: '#d08a8e', dark: '#9a5660', mottle: ['#2a2020'] },
  innerEar: { light: '#3c3032', dark: '#201a1c', furnishing: '#46403e', reach: 0.5 },
  tooth: { side: 'left', colour: '#f4efe4' },
  build: { bulk: 0.6, size: 1.04, head: 1.05, ears: 0.9, legs: 1, tail: 1, lift: 0 },
  fur: 'short',
  dark: true,
  statusFigureBox: { centerX: 0.59, top: 0.22, bottom: 0.97, halfWidth: 0.37 },
});
