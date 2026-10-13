/**
 * The Wheel of Fortune's colours, shared by everything that paints the wheel:
 * the upright prop on the club floor and the wheel screen Tito spins. One
 * table, so the wheel the player walks past and the wheel they bet on are
 * visibly the same object.
 */

import type { WheelTone } from '../../systems/casino/wheel/wheelBoard';

export interface WheelToneInk {
  /** The wedge's flat face. */
  readonly base: string;
  /** Where the room light falls across the wedge, toward the rim. */
  readonly light: string;
  /** The wedge near the hub, in the shadow of the pointer housing. */
  readonly dark: string;
  /** The label painted on the wedge; red wedges carry white text. */
  readonly label: string;
}

export const WHEEL_TONE_INK: Readonly<Record<WheelTone, WheelToneInk>> = {
  red: { base: '#c4232c', light: '#e8464a', dark: '#6e0d14', label: '#fff6ea' },
  green: { base: '#1f9a4c', light: '#3fcf72', dark: '#0b4a22', label: '#fff6ea' },
  gold: { base: '#e2ae22', light: '#ffd75a', dark: '#7a5608', label: '#2a1804' },
  purple: { base: '#7838c4', light: '#a66af0', dark: '#351261', label: '#fff6ea' },
  neutral: { base: '#c9c4b8', light: '#f2eee4', dark: '#6c675c', label: '#2a2620' },
};

/** The gilded rim, the spokes between wedges and the hub. */
export const WHEEL_GOLD = {
  deep: '#5a3c06',
  dark: '#9a6c12',
  base: '#d2a032',
  light: '#f6d77a',
  glint: '#fff6d0',
} as const;

/** The pointer at the top: a lacquered red flapper on a gold mount. */
export const WHEEL_POINTER = {
  body: '#b0141e',
  light: '#f05a50',
  dark: '#4e060a',
} as const;

/** A rim bulb, unlit and lit. */
export const WHEEL_BULB = {
  socket: '#3a2a10',
  unlit: '#8a7a58',
  lit: '#fff4c8',
  litCore: '#ffffff',
  glow: 'rgba(255,220,120,0.55)',
  glowEdge: 'rgba(255,200,90,0)',
} as const;

/** Masking tape over the Nothing on a free spin, and the marker written on it. */
export const WHEEL_TAPE = {
  face: '#efe2b8',
  /** The crinkled band along each strip's edges. */
  edge: '#c9b682',
  /** The slight sheen across the middle of a strip. */
  sheen: '#fbf4dc',
  marker: '#16161e',
} as const;
