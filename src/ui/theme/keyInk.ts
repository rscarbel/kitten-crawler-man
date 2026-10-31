/**
 * Colours for the keys a party collects floor by floor: the metal a key is
 * cast in, the gem set in its bow, the dark engraved silhouette a missing
 * fragment leaves behind, and the light a held piece gives off.
 *
 * Keyed by {@link KeyKind}, so a new kind of key cannot compile until its
 * look is written here.
 */

import type { KeyKind } from '../../core/keys/keyKinds';

/** The key's metal as flat tones, for the light, motes and lettering painted round it. */
export interface KeyMetal {
  readonly highlight: string;
  readonly light: string;
  readonly base: string;
}

/**
 * A tone ramp: how bright a surface is (0 unlit, 1 a full-strength
 * reflection of the brightest light) mapped to the colour it shows, with each
 * stop's colour held at its brightness and blended between stops. Brightness
 * past the last stop keeps the last stop's colour.
 */
export type ToneRamp = readonly { readonly at: number; readonly color: string }[];

export interface KeyInk {
  readonly metal: KeyMetal;
  /** Polished cast metal, from the floor's dark reflected in a bevel to a light's hot spot. */
  readonly metalRamp: ToneRamp;
  /** The cut gem's body, seen through its facets: deepest where no light comes back out. */
  readonly gemRamp: ToneRamp;
  /** The dark stone of the socket a missing fragment leaves, its lip catching the light. */
  readonly socketRamp: ToneRamp;
  /** The warm near-black of a seam's cut and a broken edge's torn face. */
  readonly outline: string;
  /** The specular glint on the polished metal and the gem. */
  readonly glint: string;
  /** The lit lip of the seams cut between a socket's pieces. */
  readonly silhouetteLine: string;
  /** The halo round the silhouette's held pieces and a forged key. */
  readonly glow: string;
}

export const KEY_INK = {
  golden: {
    metal: {
      highlight: '#fff3b0',
      light: '#f2c443',
      base: '#c9921d',
    },
    metalRamp: [
      { at: 0, color: '#120801' },
      { at: 0.12, color: '#331c03' },
      { at: 0.27, color: '#663d07' },
      { at: 0.42, color: '#9c650e' },
      { at: 0.56, color: '#c98f1d' },
      { at: 0.7, color: '#e8b737' },
      { at: 0.82, color: '#fad866' },
      { at: 0.93, color: '#fff0b0' },
      { at: 1.05, color: '#fffbea' },
    ],
    gemRamp: [
      { at: 0, color: '#1c0206' },
      { at: 0.25, color: '#5c0a17' },
      { at: 0.5, color: '#a3152b' },
      { at: 0.75, color: '#e23a52' },
      { at: 1, color: '#ffb6c0' },
    ],
    socketRamp: [
      { at: 0, color: '#070503' },
      { at: 0.25, color: '#18120b' },
      { at: 0.45, color: '#262016' },
      { at: 0.65, color: '#3d3322' },
      { at: 0.85, color: '#6e5a34' },
      { at: 1.05, color: '#9a8452' },
    ],
    outline: '#2b1a04',
    glint: '#fffbe0',
    silhouetteLine: '#6e5a34',
    glow: '#ffd860',
  },
} as const satisfies Record<KeyKind, KeyInk>;
