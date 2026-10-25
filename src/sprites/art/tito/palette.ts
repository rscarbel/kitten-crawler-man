/**
 * Tito's colours. His skin and hair are the Over City cast's own warm tan and
 * black, so he reads as one of the town's people rather than a visitor; the
 * rest is the croupier's uniform: a pressed white shirt, a burgundy satin
 * waistcoat with black lapels and gilt buttons, a skinny black bow tie and one
 * gold tooth, which is the brightest thing in his face on purpose.
 */

import { deriveRamp } from '../biped/palette';
import { HAIR_COLOR_BASES, SKIN_TONE_BASES } from '../../person/townCastLooks';
import { type Ramp } from '../deuce/palette';

export { OUTLINE } from '../deuce/palette';

const CAST_SKIN_TAN = SKIN_TONE_BASES[1];
const CAST_HAIR_BLACK = HAIR_COLOR_BASES[0];

function castRamp(base: string): Ramp {
  const ramp = deriveRamp(base);
  return { light: ramp.light, base: ramp.base, shade: ramp.dark, deep: ramp.shadow };
}

export const SKIN = castRamp(CAST_SKIN_TAN);
export const HAIR = castRamp(CAST_HAIR_BLACK);
/** Pomade: a hard cool streak along the slicked crown. */
export const HAIR_SHINE = 'rgba(190, 205, 230, 0.75)';
export const BROW = '#120d0b';
export const MOUSTACHE = '#0e0a09';
export const EYE_WHITE = '#f1e6d2';
export const IRIS = '#3a2414';
export const PUPIL = '#0c0806';
export const LIP = '#9a5440';
export const MOUTH_DARK = '#3a1410';
export const TEETH = '#f6f0de';
export const TEETH_SHADE = '#c9bfa6';
export const CHEEK_CREASE = '#8a5034';

export const SHIRT: Ramp = { light: '#fdfaf2', base: '#ebe4d6', shade: '#c0b6a2', deep: '#8e8572' };
export const WAISTCOAT: Ramp = {
  light: '#a4283c',
  base: '#741626',
  shade: '#4a0c18',
  deep: '#26050b',
};
export const LAPEL: Ramp = { light: '#3a3440', base: '#1c1820', shade: '#0e0c12', deep: '#060508' };
export const GOLD: Ramp = { light: '#f8e6a0', base: '#d8b458', shade: '#9c7c30', deep: '#5e4818' };
export const BOW_TIE: Ramp = {
  light: '#3a3640',
  base: '#18161c',
  shade: '#0a090c',
  deep: '#000000',
};

export const BLADE: Ramp = { light: '#ffffff', base: '#c8d0da', shade: '#7c8694', deep: '#3e4450' };
export const HANDLE: Ramp = {
  light: '#6a4a30',
  base: '#3e2616',
  shade: '#24140a',
  deep: '#120804',
};
export const BLADE_GLINT = 'rgba(255, 255, 255, 0.95)';

export const COUNTER_TOP: Ramp = {
  light: '#8a4a2a',
  base: '#5e2c16',
  shade: '#3e1a0c',
  deep: '#1e0a04',
};
export const COUNTER_FRONT: Ramp = {
  light: '#a01828',
  base: '#7a0c18',
  shade: '#4a0610',
  deep: '#24020a',
};
export const BRASS: Ramp = { light: '#fae7a4', base: '#d0a850', shade: '#8e6c28', deep: '#4a3810' };
