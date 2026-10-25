/**
 * Deuce's colours. He is an old card mechanic with a drinker's complexion:
 * weathered, ruddy skin a long way warmer than Dave's, grey hair, and the club's
 * green-and-gold uniform — waistcoat, pressed shirt, sleeve garters, eyeshade.
 *
 * Every form is shaded from a three- or four-step ramp with hard steps between
 * the values, not a gradient: at the sizes he is drawn at a smooth blend
 * averages into one flat colour and the form reads as a doll's.
 */

/** A value ramp, lightest to darkest. `light` is optional on matte forms. */
export interface Ramp {
  readonly light?: string;
  readonly base: string;
  readonly shade: string;
  readonly deep: string;
}

export const SKIN: Ramp = {
  light: '#e9b796',
  base: '#cf9372',
  shade: '#a2674c',
  deep: '#6f3f2c',
};
/** The palm and finger pads are paler and pinker than the back of the hand. */
export const PALM: Ramp = { light: '#f0c4a8', base: '#dea286', shade: '#b07560', deep: '#7c4a38' };
/** Broken veins on the nose and cheeks — the drinker's flush. */
export const FLUSH = '#c25e52';
export const LIP = '#9a5146';
export const LIP_DARK = '#5e2a24';

export const HAIR: Ramp = { light: '#e4e0d8', base: '#b3aea4', shade: '#7d786f', deep: '#4f4b45' };
/** Brows and moustache keep some pepper in the salt, or they vanish against skin. */
export const BROW = '#6d675f';
export const EYE_WHITE = '#efe5d3';
export const IRIS = '#4a3424';
export const PUPIL = '#120c08';

export const SHIRT: Ramp = { light: '#fbf7ec', base: '#e7decd', shade: '#bdb19c', deep: '#8e836f' };
export const WAISTCOAT: Ramp = {
  light: '#2c6249',
  base: '#1a4334',
  shade: '#0f2a20',
  deep: '#071510',
};
export const GOLD: Ramp = { light: '#f6e39a', base: '#d6b153', shade: '#9a7a2c', deep: '#5e4818' };
export const BOW_TIE: Ramp = {
  light: '#c04656',
  base: '#8e2434',
  shade: '#5c1420',
  deep: '#360a12',
};

export const VISOR_BAND: Ramp = {
  light: '#3a9a6c',
  base: '#1f6b4a',
  shade: '#12452f',
  deep: '#0a2a1c',
};
/** The eyeshade's brim is tinted celluloid: the face shows through it, green. */
export const VISOR_GLASS = 'rgba(70, 200, 140, 0.38)';
export const VISOR_GLASS_SHADOW = 'rgba(10, 60, 40, 0.42)';

export const CARD_FACE = '#f6efdc';
export const CARD_EDGE = '#cfc4a8';
export const CARD_BACK = '#8e1f2e';
export const CARD_BACK_LINE = '#d0606c';
export const CARD_RED = '#b8202e';
export const CARD_BLACK = '#1a1614';

export const FELT: Ramp = { light: '#1d5a40', base: '#123f2d', shade: '#0b2a1e', deep: '#05140e' };
export const RAIL: Ramp = { light: '#6a4128', base: '#3e2416', shade: '#24130b', deep: '#120804' };

/** The silhouette line every part is rimmed with, warm so it sits with the skin. */
export const OUTLINE = '#1c120e';

/**
 * The key light, as a screen-space unit vector pointing *toward* it: high and
 * to the left, matching the club's other figures.
 */
export const LIGHT_DIR = { x: -0.55, y: -0.835 } as const;
