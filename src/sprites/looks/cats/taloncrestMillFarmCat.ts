/**
 * The mill farm's barn cat in Taloncrest: a scruffy brown mackerel tabby,
 * rough-coated with tufted cheeks, a buff underside and hazel eyes.
 */

import type { CoatTone } from '../../art/catArt';
import { townCatLook } from './townCatLook';

const COAT = {
  brown: { base: '#7a5a3a', dark: '#4e3820', light: '#9c7a56' },
  stripe: { base: '#342314', dark: '#1e140a', light: '#4a3420' },
  buff: { base: '#b89870', dark: '#8a6e4c', light: '#d4b890' },
} as const satisfies Record<string, CoatTone>;

export const TALONCREST_MILL_FARM_CAT_LOOK = townCatLook({
  id: 'taloncrest_mill_farm_cat',
  coat: COAT.brown,
  ear: COAT.brown,
  underside: COAT.buff,
  tabby: { pattern: 'mackerel', tone: COAT.stripe, boldness: 1.1 },
  patches: {},
  white: null,
  tail: { base: COAT.brown, rings: [COAT.stripe, COAT.brown] },
  muzzle: COAT.buff,
  iris: { inner: '#e8dc80', mid: '#b49a3a', outer: '#6a5a1e' },
  nose: { light: '#a8706a', dark: '#6e4440', mottle: [] },
  innerEar: { light: '#b89488', dark: '#74564c', furnishing: '#d8c8b0', reach: 0.6 },
  tooth: null,
  build: { bulk: 0.3, size: 1, head: 1, ears: 1.02, legs: 1, tail: 1.05, lift: 0 },
  fur: 'scruffy',
  dark: false,
  statusFigureBox: { centerX: 0.6, top: 0.25, bottom: 0.97, halfWidth: 0.34 },
});
