/**
 * The Stormcaller's colours, shared by everything that draws it: the
 * sword in the human crawler's hand, its item icon, and the electric wave and sparks a
 * swing throws. One table, so the blade's crackle, the icon's edge and the
 * wave in the world are visibly the same lightning.
 */

import type { GlossRamp, Ramp } from './biped/palette';

/** Old bronze for the hilt: crossguard, grip wrap and pommel. Warm and dull, so the blade outshines it. */
export const STORMCALLER_BRONZE: Ramp = {
  deep: '#2b160b',
  shadow: '#4f2a12',
  dark: '#74401a',
  mid: '#985a24',
  base: '#b8752f',
  light: '#d9a04d',
  rim: '#f1cf86',
};

/** Polished silver for the blade, cool against the bronze, with a hard sheen down its fuller. */
export const STORMCALLER_SILVER: GlossRamp = {
  deep: '#2a3140',
  shadow: '#4a5466',
  dark: '#6c788b',
  mid: '#8e9aac',
  base: '#b4bfcd',
  light: '#d5dde7',
  rim: '#edf2f8',
  specular: '#ffffff',
};

/** The leather wrapped round the grip between guard and pommel. */
export const STORMCALLER_GRIP_WRAP = '#3a2416';

/** The blue-white of the lightning living along the edge and in every wave it throws. */
export const STORMCALLER_LIGHTNING = {
  /** The wide, faint halo round an arc. */
  glow: '#4f9dff',
  /** The arc itself. */
  arc: '#a9dcff',
  /** The white-hot thread down an arc's middle. */
  core: '#f3fbff',
} as const;

/** The warm near-black the sword is outlined in when it is drawn over the world rather than inside a figure. */
export const STORMCALLER_OUTLINE = '#1b120c';
