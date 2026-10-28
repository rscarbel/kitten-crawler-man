/**
 * The deep complexion both dark-skinned crawler looks share: deep brown skin,
 * black hair and dark brown eyes, and how a face that dark draws its lids and
 * brows so they keep apart from its own shadows.
 */

import type { Ramp } from '../../art/biped/palette';

/**
 * Deep brown, its shadows going to a darker warm brown, never toward rose.
 * The light steps climb well clear of the base, as the sheen on dark skin
 * does: at the tile a forearm is three pixels, and a ramp as close-set as the
 * skin's own depth leaves it a flat brown capsule.
 */
export const DEEP_BROWN_SKIN: Ramp = {
  deep: '#160c07',
  shadow: '#24150d',
  dark: '#4f3222',
  mid: '#7a4f35',
  base: '#966346',
  light: '#b47c58',
  rim: '#cc9574',
};

/** The hands a shade warmer and lighter than the face, as the palms show through. */
export const DEEP_BROWN_HAND_SKIN: Ramp = {
  deep: '#190e08',
  shadow: '#28170f',
  dark: '#553625',
  mid: '#80533a',
  base: '#9b684a',
  light: '#b9815c',
  rim: '#d09a78',
};

/** Black, lifted just enough in the light that curls and plaits keep their shape. */
export const BLACK_HAIR: Ramp = {
  deep: '#0c0a09',
  shadow: '#121010',
  dark: '#1a1715',
  mid: '#24201d',
  base: '#2e2925',
  light: '#3d3732',
  rim: '#5a534c',
};

export const DARK_BROWN_IRIS = '#3b2618';

/**
 * The lid drawn all the way to the skin's shadow: on a face this dark the
 * outline's ink and the skin's shadow are close, and a lid any nearer the
 * ink joins the iris and the brow's shade into one dark band across the face.
 */
export const DEEP_SKIN_LID_INK = 1;

/**
 * Black hair's lightest body step: the face's own shadows already sit near
 * the darker steps, and a brow in them disappears into the brow ridge.
 */
export const DEEP_SKIN_BROW_TONE = 'light' satisfies keyof Ramp;
